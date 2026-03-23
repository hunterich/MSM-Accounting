import { SignJWT, jwtVerify } from 'jose';

export const COOKIE_NAME = 'msm_token';
const EXPIRY = '8h';

export interface TokenPayload {
  userId: string;
  orgId: string;
  email: string;
  roleType: string;
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
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}
