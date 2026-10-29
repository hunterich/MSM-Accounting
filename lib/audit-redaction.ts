/** Redact sensitive fields while preserving normal JSON serialization semantics. */
export function redactAuditPayload(value: unknown): unknown {
  const json = JSON.stringify(value, (key, child: unknown) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    return /password|passwd|token|secret|apikey|privatekey|bankaccount|accountnumber|authorization|cookie/.test(normalized)
      ? '[REDACTED]'
      : child;
  });
  return json === undefined ? undefined : JSON.parse(json);
}
