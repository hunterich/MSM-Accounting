import { randomBytes } from 'node:crypto';

/** 192 bits of randomness; fixed suffix/prefix satisfy the shared password policy. */
export function generateTemporaryPassword(): string {
  return `Msm-${randomBytes(24).toString('base64url')}a1`;
}
