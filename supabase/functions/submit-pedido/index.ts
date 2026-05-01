// ════════════════════════════════════════════════════════════════════
// submit-pedido
// POST { nome, email, telefone, cpf, produto_slug, produto_nome,
//        valor, installments, forma_pagamento } → { pedidoId }
// Insere o pedido via service_role (bypassa RLS).
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/hubmais.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

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

    return new Response(
      JSON.stringify({ pedidoId: data.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("submit-pedido:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
