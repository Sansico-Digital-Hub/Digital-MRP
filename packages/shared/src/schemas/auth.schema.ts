import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Email tidak valid'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
});

export const registerSchema = z.object({
  email: z.string().email('Email tidak valid'),
  name: z.string().min(3, 'Nama minimal 3 karakter'),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.enum([
    'SUPER_ADMIN',
    'ADMIN',
    'PRODUCTION_PLANNER',
    'MATERIAL_PLANNER',
    'USER',
  ]),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
