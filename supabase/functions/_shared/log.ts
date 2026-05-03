// Logs JSON estruturados + máscara de PII (PRD §7.3, §7.4).
// Cada chamada gera/recebe um transaction_id propagável entre etapas.

export type LogLevel = "info" | "warn" | "error";

export function newTxId(): string {
  return crypto.randomUUID();
}

export function maskEmail(value: string | null | undefined): string {
  if (!value) return "";
  const [user, domain] = String(value).split("@");
  if (!domain) return "***";
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export function maskDoc(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function maskPhone(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function emit(level: LogLevel, fn: string, txId: string, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    fn,
    tx_id: txId,
    msg,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function makeLogger(fn: string, txId: string = newTxId()) {
  return {
    txId,
    info: (msg: string, fields?: Record<string, unknown>) => emit("info", fn, txId, msg, fields),
    warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", fn, txId, msg, fields),
    error: (msg: string, fields?: Record<string, unknown>) => emit("error", fn, txId, msg, fields),
  };
}
