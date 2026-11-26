import { SignJWT, jwtVerify } from 'jose';
import { createHmac } from 'node:crypto';

export const COOKIE_NAME = 'msm_token';
const EXPIRY = '8h';

export interface OrgMembershipClaim {
  orgId: string;
  roleType: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  memberships: OrgMembershipClaim[];
  credentialStamp?: string;
}

/**
 * Session-secret policy (SEC-02). Anyone who knows the secret can sign a
 * session for any user, including an administrator, without a password, so a
 * copied example value or a short word is as bad as no secret at all.
 */
export const MIN_JWT_SECRET_LENGTH = 32;
const GENERATE_HINT = 'Generate one with `openssl rand -base64 48` (see deploy/README.md).';
/** The example values shipped in this repository's env templates. */
const EXAMPLE_JWT_SECRETS = new Set([
  'replace-with-a-long-random-string-in-production',
  'change-me-to-a-long-random-string',
]);
const PLACEHOLDER_MARKERS = ['replace-with', 'change-me', 'changeme', 'your-secret', 'example'];

/** Why `secret` is unfit to sign production sessions, or null when it is fine. */
export function jwtSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'JWT_SECRET environment variable is required';
  const lowered = secret.toLowerCase();
  if (EXAMPLE_JWT_SECRETS.has(secret) || PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker))) {
    return `JWT_SECRET is still an example value. ${GENERATE_HINT}`;
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    return `JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters long (it is ${secret.length}). ${GENERATE_HINT}`;
  }
  if (new Set(secret).size < 8) {
    return `JWT_SECRET is too repetitive to be secret. ${GENERATE_HINT}`;
  }
  return null;
}

/**
 * The signing secret. In production a weak secret is refused here as well as
 * at startup (src/instrumentation.ts), so if a server somehow starts with one,
 * sign-in and every authenticated request fail closed instead of accepting
 * forgeable sessions. Development and test runs only need a non-empty value.
 */
function readJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error('JWT_SECRET environment variable is required');
  if (process.env.NODE_ENV === 'production') {
    const problem = jwtSecretProblem(raw);
    if (problem) throw new Error(problem);
  }
  return raw;
}

// A keyed digest avoids exposing the password hash in the signed (but readable) token.
export function credentialStamp(passwordHash: string | null): string {
  const secret = readJwtSecret();
  return createHmac('sha256', secret).update('credential-stamp\0').update(passwordHash ?? '').digest('hex');
}

export type ActiveOrgResolution =
  | { ok: true; orgId: string; roleType: string }
  | { ok: false; status: 400 | 403; error: string; code: 'ORG_REQUIRED' | 'ORG_MEMBERSHIP' };

/** Pure, edge-safe resolution of the tab's requested org against the signed membership list. */
export function resolveActiveOrg(payload: TokenPayload, requestedOrgId: string | null): ActiveOrgResolution {
  const memberships = payload.memberships ?? [];
  // Treat a blank header ("" or whitespace) as absent so the single-membership default still applies.
  const requested =
    (requestedOrgId?.trim() || null) ?? (memberships.length === 1 ? memberships[0].orgId : null);
  if (!requested) {
    return { ok: false, status: 400, error: 'x-active-org header required', code: 'ORG_REQUIRED' };
  }
  const match = memberships.find((m) => m.orgId === requested);
  if (!match) {
    return { ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP' };
  }
  return { ok: true, orgId: match.orgId, roleType: match.roleType };
}

/**
 * Routes that need authentication but NOT a tenant context.
 *
 * `resolveActiveOrg` fails closed for a caller with no company (or with
 * several and no pinned tab), which is exactly the caller who needs to reach
 * company creation. These paths are let through with `x-user-id` only; the
 * handler is responsible for its own authorization (see
 * `src/app/api/v1/organizations/route.ts`). Everything else keeps the strict
 * org gate.
 *
 * Matching is exact on the path, ignoring a trailing slash and any query
 * string — a prefix match would also open `/api/v1/organizations/<id>/...`
 * sub-routes that are genuinely tenant-scoped.
 */
const ORG_OPTIONAL_PATHS = new Set(['/api/v1/organizations']);

/** Pure, edge-safe: may this path be served without an active org? */
export function isOrgOptionalPath(pathname: string): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ORG_OPTIONAL_PATHS.has(normalized);
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(readJwtSecret());
}

export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const secret = getSecret();
  try {
    const { payload } = await jwtVerify(token, secret);
    const candidate = payload as unknown as TokenPayload;
    if (!Array.isArray(candidate.memberships) || typeof candidate.credentialStamp !== 'string') return null;
    return candidate;
  } catch {
    return null;
  }
}
