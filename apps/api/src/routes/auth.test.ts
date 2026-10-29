import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import bcrypt from 'bcryptjs';

/**
 * Prisma diganti tiruan supaya pengujian alur auth tidak menyentuh database
 * sungguhan sama sekali.
 */
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock('../lib/prisma', () => ({
  default: { user: { findUnique } },
}));

import authRoutes from './auth';

const PLAIN_PASSWORD = 'correct-horse-battery';
const ACTIVE_USER = {
  id: 'user-1',
  name: 'Super Admin',
  email: 'admin@test.local',
  role: 'SUPER_ADMIN',
  isActive: true,
  // cost 4 hanya untuk kecepatan pengujian
  password: bcrypt.hashSync(PLAIN_PASSWORD, 4),
};

async function buildServer() {
  const server = Fastify({ trustProxy: true });
  await server.register(cookie);
  await server.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
  await server.register(authRoutes);
  await server.ready();
  return server;
}

function readRefreshCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader.join(';') : setCookieHeader || '';
  const match = /pdits_rt=([^;]*)/.exec(raw);
  return match ? match[1] : '';
}

describe('alur auth dengan refresh token di cookie', () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it('login sukses mengirim accessToken di body dan refreshToken lewat cookie httpOnly', async () => {
    findUnique.mockResolvedValue(ACTIVE_USER);
    const server = await buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ACTIVE_USER.email, password: PLAIN_PASSWORD },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.user).toEqual({
      id: ACTIVE_USER.id,
      name: ACTIVE_USER.name,
      email: ACTIVE_USER.email,
      role: ACTIVE_USER.role,
    });

    // refreshToken TIDAK boleh lagi ikut di body
    expect(body.refreshToken).toBeUndefined();

    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain('pdits_rt=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
    expect(setCookie).toContain('Path=/api/v1/auth');

    await server.close();
  });

  it('login dengan password salah ditolak tanpa mengirim cookie', async () => {
    findUnique.mockResolvedValue(ACTIVE_USER);
    const server = await buildServer();

    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ACTIVE_USER.email, password: 'password-salah' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();

    await server.close();
  });

  it('refresh membaca token dari cookie dan merotasinya', async () => {
    findUnique.mockResolvedValue(ACTIVE_USER);
    const server = await buildServer();

    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ACTIVE_USER.email, password: PLAIN_PASSWORD },
    });
    const firstCookie = readRefreshCookie(login.headers['set-cookie']);
    expect(firstCookie).not.toBe('');

    const refresh = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pdits_rt: firstCookie },
    });

    expect(refresh.statusCode).toBe(200);
    const refreshBody = refresh.json();
    expect(refreshBody.accessToken).toBeTruthy();
    expect(refreshBody.user.email).toBe(ACTIVE_USER.email);
    expect(refreshBody.refreshToken).toBeUndefined();

    // Cookie dirotasi: nilai baru tetap dikirim
    const rotated = readRefreshCookie(refresh.headers['set-cookie']);
    expect(rotated).not.toBe('');

    await server.close();
  });

  it('refresh tanpa cookie dan dengan cookie rusak sama-sama 401', async () => {
    findUnique.mockResolvedValue(ACTIVE_USER);
    const server = await buildServer();

    const withoutCookie = await server.inject({ method: 'POST', url: '/api/v1/auth/refresh' });
    expect(withoutCookie.statusCode).toBe(401);

    const badCookie = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      cookies: { pdits_rt: 'bukan-token-yang-valid' },
    });
    expect(badCookie.statusCode).toBe(401);

    await server.close();
  });

  it('logout menghapus cookie refresh', async () => {
    const server = await buildServer();

    const response = await server.inject({ method: 'POST', url: '/api/v1/auth/logout' });

    expect(response.statusCode).toBe(200);
    const setCookie = String(response.headers['set-cookie']);
    expect(setCookie).toContain('pdits_rt=');
    expect(setCookie.toLowerCase()).toMatch(/expires=thu, 01 jan 1970|max-age=0/);

    await server.close();
  });

  it('login dibatasi 10 percobaan per menit per IP', async () => {
    findUnique.mockResolvedValue(null);
    const server = await buildServer();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'tidak-ada@test.local', password: 'x' },
      });
      statuses.push(response.statusCode);
    }

    // 10 percobaan pertama 401, percobaan ke-11 kena rate limit.
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);

    await server.close();
  });
});
