import { z } from 'zod';
import { isDemoPassword } from './demo-credentials';

/**
 * Shared password policy: min 8 chars, at least one letter and one number.
 * Single source of truth for every new-password input (admin reset + self change).
 * Symbols are allowed but not required. Published demo passwords are refused.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .refine((p) => !isDemoPassword(p), 'This is a published demo password; choose another one');

export const hashPassword = async (plain: string) => {
  const bcrypt = await import('bcryptjs');
  return bcrypt.hash(plain, 12);
};

export const comparePassword = async (plain: string, hash: string) => {
  const bcrypt = await import('bcryptjs');
  return bcrypt.compare(plain, hash);
};
