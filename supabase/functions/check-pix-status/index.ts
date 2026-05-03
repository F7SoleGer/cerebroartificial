// ════════════════════════════════════════════════════════════════════
// check-pix-status
// POST { pedidoId } → { status }
// Chamado em polling (5s) pelo frontend após exibir o QR PIX.
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import { getCredentials, getServiceClient, getTransaction } from "../_shared/hubmais.ts";
import { makeLogger, newTxId } from "../_shared/log.ts";
import { fireCompraWebhook } from "../_shared/webhook-compra.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const txId = req.headers.get("X-Tx-Id") ?? newTxId();
  const log = makeLogger("check-pix-status", txId);

  try {
    const { pedidoId } = await req.json();
    if (!pedidoId) throw new Error("pedidoId obrigatório");

    const supabase = getServiceClient();

    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select("id, status_pagamento, transaction_id, nome, email, telefone, produto_slug, produto_nome, valor, forma_pagamento")
      .eq("id", pedidoId)
      .single();
    if (error || !pedido) throw new Error(`pedido não encontrado: ${error?.message}`);

    if (pedido.status_pagamento === "approved") {
      return new Response(
        JSON.stringify({ status: "approved" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Tx-Id": txId } }
      );
    }
    if (!pedido.transaction_id) {
      return new Response(
        JSON.stringify({ status: "pending" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json", "X-Tx-Id": txId } }
      );
    }

    const credentials = await getCredentials(supabase);
    const tx = await getTransaction(credentials, pedido.transaction_id);

    const approved = tx.status === "succeeded" || tx.status === "approved";
    if (approved) {
      await supabase
        .from("pedidos")
        .update({ status_pagamento: "approved" })
        .eq("id", pedidoId);
      log.info("pix aprovado", { pedido_id: pedido.id, produto_slug: pedido.produto_slug });
      fireCompraWebhook({
        id: pedido.id,
        nome: pedido.nome,
        email: pedido.email,
        telefone: pedido.telefone,
        produto_slug: pedido.produto_slug,
        produto_nome: pedido.produto_nome ?? "",
        valor: Number(pedido.valor),
        forma_pagamento: pedido.forma_pagamento,
      }, txId);
    }

    return new Response(
      JSON.stringify({ status: approved ? "approved" : tx.status ?? "pending" }),
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
