/**
 * Demo sign-ins created by `prisma/seed.ts`. The passwords are published in the
 * README, so they must never protect a live installation (#236).
 *
 * No Node-only imports here: `lib/password.ts` uses this file and is reachable
 * from the browser bundle through `types/api.ts`.
 */
export const DEMO_ACCOUNTS = [
  { email: 'admin@demo.com', password: 'admin123', envVar: 'SEED_ADMIN_PASSWORD' },
  { email: 'cashier@demo.com', password: 'cashier123', envVar: 'SEED_CASHIER_PASSWORD' },
] as const;

const DEMO_PASSWORDS = new Set<string>(DEMO_ACCOUNTS.map((a) => a.password));

type Env = Record<string, string | undefined>;

/**
 * Published demo passwords are fine for development and the test suites. In
 * production they are refused unless the operator opts in explicitly, for a
 * throwaway benchmark or demo install only.
 */
export function demoPasswordsAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_DEMO_PASSWORDS === 'true';
}

export function isDemoPassword(password: string): boolean {
  return DEMO_PASSWORDS.has(password);
}

export type SeedPassword = {
  password: string;
  /** Where it came from; `generated` passwords must be shown to the operator once. */
  source: 'env' | 'demo' | 'generated';
  /** Force a change at first sign-in. */
  mustChangePassword: boolean;
};

/**
 * Password for a demo account the seed is about to CREATE. Existing accounts are
 * never passed through here: the seed leaves their password and status alone.
 */
export function resolveSeedPassword(
  account: (typeof DEMO_ACCOUNTS)[number],
  generate: () => string,
  env: Env = process.env,
): SeedPassword {
  const allowed = demoPasswordsAllowed(env);
  const fromEnv = env[account.envVar];
  if (fromEnv) {
    if (!allowed && isDemoPassword(fromEnv)) {
      throw new Error(`${account.envVar} is a published demo password; choose another one.`);
    }
    return { password: fromEnv, source: 'env', mustChangePassword: !allowed };
  }
  if (allowed) return { password: account.password, source: 'demo', mustChangePassword: false };
  return { password: generate(), source: 'generated', mustChangePassword: true };
}
