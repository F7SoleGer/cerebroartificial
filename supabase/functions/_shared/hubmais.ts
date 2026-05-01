// ════════════════════════════════════════════════════════════════════
// Hubmais (Zoop wrapper) — cliente compartilhado entre edge functions
// Referência: zoop.md (Fórmula Precisa) + Postman da Hubmais
// ════════════════════════════════════════════════════════════════════

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface HubmaisCredentials {
  marketplaceId: string;
  sellerId: string;
  apiKey: string;
  baseUrl: string;
}

export function getServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function getCredentials(supabase: SupabaseClient): Promise<HubmaisCredentials> {
  const { data, error } = await supabase
    .from("configuracoes")
    .select("chave, valor")
    .in("chave", ["zoop_marketplace_id", "zoop_seller_id", "zoop_api_key", "hubmais_base_url"]);
  if (error) throw new Error(`configuracoes: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.chave] = row.valor ?? "";
  const baseUrl = map.hubmais_base_url || "https://exatablack.api.payments.hubmais.tec.br/v1";
  if (!map.zoop_marketplace_id || !map.zoop_seller_id || !map.zoop_api_key) {
    throw new Error("Credenciais Hubmais não configuradas em public.configuracoes");
  }
  return {
    marketplaceId: map.zoop_marketplace_id,
    sellerId: map.zoop_seller_id,
    apiKey: map.zoop_api_key,
    baseUrl,
  };
}

export function authHeaders(c: HubmaisCredentials): HeadersInit {
  return { Authorization: `Bearer ${c.apiKey}` };
}

// ── Buyers ──────────────────────────────────────────────────────────
export async function getOrCreateBuyer(
  c: HubmaisCredentials,
  buyer: { nome: string; email: string; cpf: string; telefone?: string }
): Promise<string | null> {
  const cpfClean = buyer.cpf.replace(/\D/g, "");
  if (cpfClean.length === 0) return null;

  const searchUrl = `${c.baseUrl}/marketplaces/${c.marketplaceId}/sellers/${c.sellerId}/buyers?search=${cpfClean}`;
  const search = await fetch(searchUrl, { headers: authHeaders(c) });
  if (search.ok) {
    const json = await search.json();
    const items = json.items ?? json.data ?? [];
    if (Array.isArray(items) && items.length > 0 && items[0]?.id) return items[0].id;
  }

  const form = new URLSearchParams();
  form.append("first_name", buyer.nome.split(" ")[0] || buyer.nome);
  form.append("last_name", buyer.nome.split(" ").slice(1).join(" ") || ".");
  form.append("email", buyer.email);
  form.append("taxpayer_id", cpfClean);
  if (buyer.telefone) form.append("phone_number", buyer.telefone.replace(/\D/g, ""));

  const createUrl = `${c.baseUrl}/marketplaces/${c.marketplaceId}/sellers/${c.sellerId}/buyers`;
  const create = await fetch(createUrl, {
    method: "POST",
    headers: { ...authHeaders(c), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!create.ok) return null;
  const json = await create.json();
  return json.id ?? null;
}

// ── PIX (JSON) ──────────────────────────────────────────────────────
export interface PixResponse {
  transactionId: string;
  emv: string;
  qrcode64: string;
}

export async function createPixTransaction(
  c: HubmaisCredentials,
  args: { amount: number; description: string; buyerId: string | null }
): Promise<PixResponse> {
  const url = `${c.baseUrl}/marketplaces/${c.marketplaceId}/sellers/${c.sellerId}/transactions`;
  const body: Record<string, unknown> = {
    amount: args.amount.toFixed(2),
    payment_type: "pix",
    description: args.description,
  };
  if (args.buyerId) body.buyer = { id: args.buyerId };

  const resp = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(c), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`hubmais pix: ${json.message ?? resp.status}`);

  // Hubmais retorna { id, pix: { qrcode, qrcode64, ... } }
  const pix = json.pix ?? json.payment_method ?? {};
  return {
    transactionId: json.id ?? json.uid,
    emv: pix.qrcode ?? pix.emv ?? pix.qr_code?.emv ?? "",
    qrcode64: pix.qrcode64 ?? pix.qr_code?.image ?? "",
  };
}

// ── Cartão de Crédito (form-urlencoded) ────────────────────────────
export interface CardInput {
  number: string;
  holder_name: string;
  expiration_month: string;
  expiration_year: string;
  security_code: string;
}

export interface CreditResponse {
  transactionId: string;
  status: string;
  cardBrand: string | null;
  last4: string | null;
}

export function detectBrand(cardNumber: string): string {
  const n = cardNumber.replace(/\D/g, "");
  if (/^4/.test(n)) return "Visa";
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return "MasterCard";
  if (/^(636368|636369|438935|504175|451416|636297|506[67])/.test(n)) return "Elo";
  return "Visa";
}

export async function createCreditTransaction(
  c: HubmaisCredentials,
  args: { amount: number; description: string; installments: number; buyerId: string | null; card: CardInput }
): Promise<CreditResponse> {
  const number = args.card.number.replace(/\D/g, "");
  let expYear = args.card.expiration_year.toString();
  if (expYear.length === 4) expYear = expYear.slice(2);
  const brand = detectBrand(number);

  const form = new URLSearchParams();
  form.append("amount", args.amount.toFixed(2));
  form.append("payment_type", "credit");
  form.append("description", args.description);
  form.append("installments", String(args.installments));
  form.append("card[holder_name]", args.card.holder_name.toUpperCase());
  form.append("card[card_number]", number);
  form.append("card[expiration_month]", args.card.expiration_month.padStart(2, "0"));
  form.append("card[expiration_year]", expYear);
  form.append("card[security_code]", args.card.security_code);
  form.append("card[brand]", brand);
  if (args.buyerId) form.append("buyer[id]", args.buyerId);

  const url = `${c.baseUrl}/marketplaces/${c.marketplaceId}/sellers/${c.sellerId}/transactions`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(c), "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const msg = json.message || (json.errors ? JSON.stringify(json.errors) : `HTTP ${resp.status}`);
    throw new Error(`hubmais credit: ${msg}`);
  }
  // Hubmais may return 200 with a "message" field for declined cards
  if (json.message && !json.id && !json.uid) {
    throw new Error(`hubmais credit: ${json.message}`);
  }

  return {
    transactionId: json.id ?? json.uid,
    status: json.status ?? "pending",
    cardBrand: json.card?.card_brand ?? brand,
    last4: json.card?.last4_digits ?? number.slice(-4),
  };
}

// ── Consulta de transação ───────────────────────────────────────────
export async function getTransaction(c: HubmaisCredentials, txId: string) {
  const url = `${c.baseUrl}/marketplaces/${c.marketplaceId}/sellers/${c.sellerId}/transactions/${txId}`;
  const resp = await fetch(url, { headers: authHeaders(c) });
  if (!resp.ok) throw new Error(`hubmais get tx: ${resp.status}`);
  return resp.json();
}
