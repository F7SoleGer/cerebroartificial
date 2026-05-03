// Validação HMAC-SHA256 para webhooks recebidos (PRD §5.3).
// Usa comparação em tempo constante para evitar timing attacks.

export interface HmacOptions {
  secret: string;
  signatureHeader: string;
  body: string;
  algorithm?: "sha256" | "sha1";
  prefix?: string;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeHmac(secret: string, body: string, algorithm: "sha256" | "sha1" = "sha256"): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: algorithm === "sha1" ? "SHA-1" : "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return bufToHex(sig);
}

export async function verifyHmac(opts: HmacOptions): Promise<boolean> {
  if (!opts.secret) return false;
  if (!opts.signatureHeader) return false;
  const received = opts.prefix && opts.signatureHeader.startsWith(opts.prefix)
    ? opts.signatureHeader.slice(opts.prefix.length)
    : opts.signatureHeader;
  const expected = await computeHmac(opts.secret, opts.body, opts.algorithm ?? "sha256");
  return timingSafeEqual(received.trim().toLowerCase(), expected.toLowerCase());
}
