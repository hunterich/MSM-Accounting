/**
 * Framework-free error types shared across the lib layer.
 *
 * Kept separate from `api-utils` (which pulls in `next/server`, Prisma, CORS,
 * etc.) so that pure business-logic modules — and standalone scripts run under
 * tsx — can throw typed HTTP errors without dragging in the Next.js runtime.
 * `api-utils` re-exports `ApiError`, so existing `@/lib/api-utils` imports and
 * `instanceof ApiError` checks continue to work unchanged.
 */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}
