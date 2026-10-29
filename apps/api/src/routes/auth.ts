import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../lib/jwt';
import prisma from '../lib/prisma';
import { config } from '../config';
import { authenticate } from '../middleware/auth';

const REFRESH_COOKIE = config.refreshCookie.name;

/**
 * Opsi cookie refresh token.
 *
 * httpOnly     : JavaScript tidak bisa membacanya, sehingga satu XSS tidak lagi
 *                bisa mencuri sesi 7 hari seperti saat token disimpan di
 *                localStorage.
 * secure       : hanya dikirim lewat HTTPS (dimatikan saat development karena
 *                dev berjalan di http://localhost).
 * sameSite lax : mencegah pengiriman lintas situs. Web dan API berada di domain
 *                induk yang sama (app.domain.com vs api.domain.com), jadi
 *                cookie tetap terkirim.
 * path         : dibatasi ke /api/v1/auth agar tidak ikut pada setiap request
 *                API biasa.
 */
function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax' as const,
    path: config.refreshCookie.path,
    maxAge: config.refreshCookie.maxAgeSeconds,
  };
}

function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, { path: config.refreshCookie.path });
}

function publicUser(user: { id: string; name: string; email: string; role: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export default async function authRoutes(server: FastifyInstance) {
  // Login
  //
  // Rate limit dipasang per-route supaya brute-force password tidak menumpang
  // limit global (1000/menit). 10 percobaan per menit per IP cukup longgar
  // untuk kantor yang berbagi satu IP publik (NAT), tetapi terlalu lambat
  // untuk menebak password secara efektif.
  server.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as any;

      if (!email || !password) {
        return reply
          .code(400)
          .send({ error: 'Bad Request', message: 'Email and password are required' });
      }

      const user = await prisma.user.findUnique({ where: { email } });

      if (!user || !user.isActive) {
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Invalid credentials or inactive account' });
      }

      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Invalid credentials' });
      }

      const accessToken = generateAccessToken(user.id, user.role);
      const refreshToken = generateRefreshToken(user.id);

      // Refresh token HANYA lewat cookie httpOnly, tidak lagi di body respons.
      setRefreshCookie(reply, refreshToken);

      return reply.send({ user: publicUser(user), accessToken });
    }
  );

  // Refresh
  //
  // Token dibaca dari cookie. Body `refreshToken` tetap diterima sebagai
  // cadangan agar klien lama (mis. skrip uji) tidak langsung rusak.
  server.post(
    '/api/v1/auth/refresh',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          keyGenerator: (request: FastifyRequest) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const fromCookie = request.cookies?.[REFRESH_COOKIE];
      const fromBody = (request.body as any)?.refreshToken as string | undefined;
      const token = fromCookie || fromBody;

      if (!token) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Refresh token is required' });
      }

      try {
        const decoded = verifyRefreshToken(token);
        const user = await prisma.user.findUnique({ where: { id: decoded.userId } });

        if (!user || !user.isActive) {
          clearRefreshCookie(reply);
          return reply
            .code(401)
            .send({ error: 'Unauthorized', message: 'User not found or inactive' });
        }

        const accessToken = generateAccessToken(user.id, user.role);

        // Rotasi: cookie selalu diperbarui dengan token baru setiap refresh.
        setRefreshCookie(reply, generateRefreshToken(user.id));

        return reply.send({ user: publicUser(user), accessToken });
      } catch (err) {
        clearRefreshCookie(reply);
        return reply
          .code(401)
          .send({ error: 'Unauthorized', message: 'Invalid or expired refresh token' });
      }
    }
  );

  // Logout — hapus cookie refresh token
  server.post('/api/v1/auth/logout', async (_request, reply) => {
    clearRefreshCookie(reply);
    return reply.send({ success: true });
  });

  // Me
  server.get('/api/v1/auth/me', { preValidation: [authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'Not Found', message: 'User not found' });
    }

    return reply.send({ user });
  });
}
