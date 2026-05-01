// ════════════════════════════════════════════════════════════════════
// create-pix-payment
// POST { pedidoId } → { emv, qrcode64, transactionId }
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import {
  createPixTransaction,
  getCredentials,
  getOrCreateBuyer,
  getServiceClient,
} from "../_shared/hubmais.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  try {
    const { pedidoId } = await req.json();
    if (!pedidoId) throw new Error("pedidoId obrigatório");

    const supabase = getServiceClient();

    const { data: pedido, error: fetchErr } = await supabase
      .from("pedidos")
      .select("*")
      .eq("id", pedidoId)
      .single();
    if (fetchErr || !pedido) throw new Error(`pedido não encontrado: ${fetchErr?.message}`);

    if (pedido.transaction_id && pedido.pix_emv_code) {
      return new Response(
        JSON.stringify({
          emv: pedido.pix_emv_code,
          qrcode64: pedido.pix_qrcode64,
          transactionId: pedido.transaction_id,
          cached: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const credentials = await getCredentials(supabase);

    const buyerId = await getOrCreateBuyer(credentials, {
      nome: pedido.nome,
      email: pedido.email,
      cpf: pedido.cpf ?? "",
      telefone: pedido.telefone ?? undefined,
    });

    const pix = await createPixTransaction(credentials, {
      amount: Number(pedido.valor),
      description: `${pedido.produto_nome} — pedido ${String(pedido.id).slice(0, 8)}`,
      buyerId,
    });

    const { error: updErr } = await supabase
      .from("pedidos")
      .update({
        transaction_id: pix.transactionId,
        zoop_transaction_id: pix.transactionId,
        pix_emv_code: pix.emv,
        pix_qrcode64: pix.qrcode64,
        hubmais_buyer_id: buyerId,
      })
      .eq("id", pedidoId);
    if (updErr) console.error("update pedido pix:", updErr);

    return new Response(
      JSON.stringify({
        emv: pix.emv,
        qrcode64: pix.qrcode64,
        transactionId: pix.transactionId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("create-pix-payment:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
