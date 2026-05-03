// ════════════════════════════════════════════════════════════════════
// create-credit-payment
// POST { pedidoId, card } → { status, cardBrand, last4, transactionId }
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import {
  createCreditTransaction,
  getCredentials,
  getOrCreateBuyer,
  getServiceClient,
} from "../_shared/hubmais.ts";
import { makeLogger, newTxId } from "../_shared/log.ts";
import { fireCompraWebhook } from "../_shared/webhook-compra.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const txId = req.headers.get("X-Tx-Id") ?? newTxId();
  const log = makeLogger("create-credit-payment", txId);

  try {
    const { pedidoId, card } = await req.json();
    if (!pedidoId) throw new Error("pedidoId obrigatório");
    if (!card?.number || !card?.holder_name || !card?.expiration_month || !card?.expiration_year || !card?.security_code) {
      throw new Error("card incompleto");
    }

    const supabase = getServiceClient();

    const { data: pedido, error: fetchErr } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", pedidoId)
      .single();
    if (fetchErr || !pedido) throw new Error(`pedido não encontrado: ${fetchErr?.message}`);

    if (pedido.status_pagamento === "approved") {
      return new Response(
        JSON.stringify({
          status: "succeeded",
          cardBrand: pedido.card_brand,
          last4: pedido.card_last4,
          transactionId: pedido.transaction_id,
          cached: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Tx-Id": txId } }
      );
    }

    const credentials = await getCredentials(supabase);

    const buyerId = await getOrCreateBuyer(credentials, {
      nome: pedido.nome,
      email: pedido.email,
      cpf: pedido.cpf ?? "",
      telefone: pedido.telefone ?? undefined,
    });

    const result = await createCreditTransaction(credentials, {
      amount: Number(pedido.valor),
      description: `${pedido.produto_nome} — pedido ${String(pedido.id).slice(0, 8)}`,
      installments: Number(pedido.installments) || 1,
      buyerId,
      card,
    });

    const approved = result.status === "succeeded" || result.status === "authorized";

    const { error: updErr } = await supabase
      .from("pedidos")
      .update({
        transaction_id: result.transactionId,
        zoop_transaction_id: result.transactionId,
        hubmais_buyer_id: buyerId,
        card_brand: result.cardBrand,
        card_last4: result.last4,
        status_pagamento: approved ? "approved" : "failed",
      })
      .eq("id", pedidoId);
    if (updErr) log.error("update pedido credit", { error: updErr.message });

    if (approved) {
      log.info("cartão aprovado", { pedido_id: pedidoId, produto_slug: pedido.produto_slug });
      fireCompraWebhook({
        id: pedidoId,
        nome: pedido.nome,
        email: pedido.email,
        telefone: pedido.telefone,
        produto_slug: pedido.produto_slug,
        produto_nome: pedido.produto_nome ?? "",
        valor: Number(pedido.valor),
        forma_pagamento: pedido.forma_pagamento,
      }, txId);
    } else {
      log.warn("cartão não aprovado", { pedido_id: pedidoId, status: result.status });
    }

    return new Response(
      JSON.stringify({
        status: result.status,
        cardBrand: result.cardBrand,
        last4: result.last4,
        transactionId: result.transactionId,
      }),
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
