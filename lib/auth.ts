import { SignJWT, jwtVerify } from 'jose';

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
}

export type ActiveOrgResolution =
  | { ok: true; orgId: string; roleType: string }
  | { ok: false; status: 400 | 403; error: string; code: 'ORG_REQUIRED' | 'ORG_MEMBERSHIP' };

/** Pure, edge-safe resolution of the tab's requested org against the signed membership list. */
export function resolveActiveOrg(payload: TokenPayload, requestedOrgId: string | null): ActiveOrgResolution {
  const memberships = payload.memberships ?? [];
  const requested = requestedOrgId ?? (memberships.length === 1 ? memberships[0].orgId : null);
  if (!requested) {
    return { ok: false, status: 400, error: 'x-active-org header required', code: 'ORG_REQUIRED' };
  }
  const match = memberships.find((m) => m.orgId === requested);
  if (!match) {
    return { ok: false, status: 403, error: 'Not a member of this organization', code: 'ORG_MEMBERSHIP' };
  }
  return { ok: true, orgId: match.orgId, roleType: match.roleType };
}

function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(raw);
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
    if (!Array.isArray(candidate.memberships)) return null; // pre-multi-company token → force re-login
    return candidate;
  } catch {
    return null;
  }
}
