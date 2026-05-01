// ════════════════════════════════════════════════════════════════════
// check-pix-status
// POST { pedidoId } → { status }
// Chamado em polling (5s) pelo frontend após exibir o QR PIX.
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import { getCredentials, getServiceClient, getTransaction } from "../_shared/hubmais.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const { pedidoId } = await req.json();
    if (!pedidoId) throw new Error("pedidoId obrigatório");

    const supabase = getServiceClient();

    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select("id, status_pagamento, transaction_id")
      .eq("id", pedidoId)
      .single();
    if (error || !pedido) throw new Error(`pedido não encontrado: ${error?.message}`);

    if (pedido.status_pagamento === "approved") {
      return new Response(
        JSON.stringify({ status: "approved" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!pedido.transaction_id) {
      return new Response(
        JSON.stringify({ status: "pending" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    }

    return new Response(
      JSON.stringify({ status: approved ? "approved" : tx.status ?? "pending" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("check-pix-status:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
