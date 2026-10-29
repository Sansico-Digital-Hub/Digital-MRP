import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { config } from './config';
import prisma from './lib/prisma';
import redis from './lib/redis';
import authRoutes from './routes/auth';
import itemsRoutes from './routes/items';
import dailyScheduleRoutes from './routes/dailySchedule';
import fgStockRoutes from './routes/fgStock';
import wipRoutes from './routes/wip';
import trackingRoutes from './routes/tracking';
import usersRoutes from './routes/users';
import weeklyScheduleRoutes from './routes/weeklySchedule';
import hotlistRoutes from './routes/hotlist';
import stockRawMaterialRoutes from './routes/stockRawMaterial';
import outstandingPoRoutes from './routes/outstandingPo';
import npofMaterialsRoutes from './routes/npofMaterials';
import materialCalcRoutes from './routes/materialCalc';
import materialPlanningRoutes from './routes/materialPlanning';
import mrpVersionRoutes from './routes/mrpVersions';
import historyRoutes from './routes/history';
import fgStockHistoryRoutes from './routes/fgStockHistory';
import { startCleanupSchedule, stopCleanupSchedule } from './lib/cleanup';
import { bootstrapAdmin } from './lib/bootstrapAdmin';
import multipart from '@fastify/multipart';

const server = Fastify({
  bodyLimit: 52428800, // 50MB
  // Di belakang Traefik (Dokploy), koneksi TCP datang dari container Traefik.
  // Tanpa trustProxy, request.ip berisi IP Traefik untuk SEMUA user, sehingga
  // rate limit menjadi satu kuota bersama seluruh perusahaan (dan 429 muncul
  // acak). Aman di sini karena port API tidak dipublikasikan ke host.
  trustProxy: true,
  logger: {
    level: config.nodeEnv === 'development' ? 'info' : 'warn',
    transport:
      config.nodeEnv === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'HH:MM:ss Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  },
});

// Register plugins
async function registerPlugins() {
  // CORS
  await server.register(cors, {
    origin: config.nodeEnv === 'development' ? true : config.corsOrigins,
    credentials: true,
  });

  // Cookie — dipakai untuk menyimpan refresh token sebagai cookie httpOnly.
  await server.register(cookie);

  // Security headers
  await server.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
  });

  // Rate limiting
  await server.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  // Multipart
  await server.register(multipart);

  // API Routes
  await server.register(authRoutes);
  await server.register(itemsRoutes);
  await server.register(dailyScheduleRoutes);
  await server.register(fgStockRoutes);
  await server.register(wipRoutes);
  await server.register(trackingRoutes);
  await server.register(usersRoutes);
  await server.register(weeklyScheduleRoutes);
  await server.register(mrpVersionRoutes);
  await server.register(hotlistRoutes);
  await server.register(stockRawMaterialRoutes);
  await server.register(outstandingPoRoutes);
  await server.register(npofMaterialsRoutes);
  await server.register(materialCalcRoutes);
  await server.register(materialPlanningRoutes);
  await server.register(historyRoutes);
  await server.register(fgStockHistoryRoutes);
}

// Health check route
server.get('/api/v1/health', async (request, reply) => {
  let dbStatus = 'disconnected';
  let redisStatus = 'disconnected';
  let hasError = false;
  let errorMessage = '';

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch (error) {
    hasError = true;
    errorMessage = `Database error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }

  try {
    if (redis.disabled) {
      redisStatus = 'disabled';
    } else {
      // Check Redis connection
      await redis.ping();
      redisStatus = 'connected';
    }
  } catch (error) {
    redisStatus = 'disconnected';
    // Redis is optional, so we don't mark health check as failed
  }

  if (hasError) {
    reply.code(503);
    return {
      status: 'error',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
        redis: redisStatus,
      },
      error: errorMessage,
    };
  }

  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      redis: redisStatus,
    },
  };
});

// Root route
server.get('/', async (request, reply) => {
  return {
    name: 'PDITS API',
    version: '1.0.0',
    description: 'Production Demand & Inventory Tracking System API',
    documentation: '/api/v1/docs',
  };
});

// Start server
async function start() {
  try {
    await registerPlugins();

    // Buat akun admin pertama bila database masih kosong (lihat lib/bootstrapAdmin.ts).
    await bootstrapAdmin();

    await server.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    // Start daily cleanup of old schedule records (>14 days)
    startCleanupSchedule();

    console.log(`
    🚀 PDITS API Server is running!
    
    📍 URL: http://localhost:${config.port}
    🏥 Health: http://localhost:${config.port}/api/v1/health
    📚 Docs: http://localhost:${config.port}/api/v1/docs
    🌍 Environment: ${config.nodeEnv}
    `);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Graceful shutdown
const signals = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down gracefully...`);
    
    stopCleanupSchedule();
    await server.close();
    await prisma.$disconnect();
    await redis.quit();
    
    console.log('✅ Server closed');
    process.exit(0);
  });
});

start();
