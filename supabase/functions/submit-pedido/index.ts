// ════════════════════════════════════════════════════════════════════
// submit-pedido
// POST { nome, email, telefone, cpf, produto_slug, produto_nome,
//        valor, installments, forma_pagamento } → { pedidoId }
// Insere o pedido via service_role (bypassa RLS).
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/hubmais.ts";
import { makeLogger, maskEmail, newTxId } from "../_shared/log.ts";
import { fireCompraWebhook } from "../_shared/webhook-compra.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const txId = req.headers.get("X-Tx-Id") ?? newTxId();
  const log = makeLogger("submit-pedido", txId);

  try {
    const b = await req.json();
    if (!b.nome || !b.email) throw new Error("nome e email são obrigatórios");
    if (!b.produto_slug) throw new Error("produto_slug é obrigatório");
    if (!b.forma_pagamento) throw new Error("forma_pagamento é obrigatória");

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("pedidos")
      .insert({
        nome: String(b.nome).trim(),
        email: String(b.email).trim(),
        telefone: String(b.telefone ?? "").trim(),
        cpf: String(b.cpf ?? "").replace(/\D/g, ""),
        produto_slug: String(b.produto_slug),
        produto_nome: String(b.produto_nome ?? ""),
        valor: Number(b.valor) || 0,
        installments: Number.isFinite(Number(b.installments)) ? Number(b.installments) : 1,
        forma_pagamento: String(b.forma_pagamento),
        origem: b.origem ?? "site_metodo_ca",
      })
      .select("id")
      .single();
    if (error) throw new Error(`pedidos insert: ${error.message}`);

    log.info("pedido criado", {
      pedido_id: data.id,
      email: maskEmail(b.email),
      produto_slug: b.produto_slug,
      forma_pagamento: b.forma_pagamento,
    });

    if (b.forma_pagamento === "gratuito") {
      fireCompraWebhook({
        id: data.id,
        nome: String(b.nome).trim(),
        email: String(b.email).trim(),
        telefone: String(b.telefone ?? "").trim(),
        produto_slug: String(b.produto_slug),
        produto_nome: String(b.produto_nome ?? ""),
        valor: Number(b.valor) || 0,
        forma_pagamento: "gratuito",
      }, txId);
    }

    return new Response(
      JSON.stringify({ pedidoId: data.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Tx-Id": txId } }
    );
  } catch (err) {
    log.error("falha", { error: (err as Error).message });
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json", "X-Tx-Id": txId } }
    );
  }
});
