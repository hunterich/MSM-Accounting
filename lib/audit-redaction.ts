/** Redact sensitive fields while preserving normal JSON serialization semantics. */
const SENSITIVE_KEY = /password|passwd|token|secret|apikey|privatekey|accountnumber|authorization|cookie/;

// Foreign keys (bankAccountId, refundBankAccountId, ...) are references the audit
// trail needs, not secrets.
const REFERENCE_KEY = /(id|ids)$/;

function isSensitive(key: string, value: unknown): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!SENSITIVE_KEY.test(normalized)) return false;
  if (REFERENCE_KEY.test(normalized)) return false;
  // Flags such as mustChangePassword carry no secret and matter for security audits.
  if (typeof value === 'boolean') return false;
  return true;
}

export function redactAuditPayload(value: unknown): unknown {
  const json = JSON.stringify(value, (key, child: unknown) =>
    key !== '' && isSensitive(key, child) ? '[REDACTED]' : child,
  );
  return json === undefined ? undefined : JSON.parse(json);
}
