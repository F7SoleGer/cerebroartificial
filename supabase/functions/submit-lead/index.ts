// ════════════════════════════════════════════════════════════════════
// submit-lead
// POST { nome, email, telefone, ocupacao } → { url_download, titulo }
// Insere o lead via service_role (bypassa RLS), dispara webhook n8n
// (fire-and-forget) e devolve o link do ebook ativo para o frontend.
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/hubmais.ts";
import { makeLogger, maskEmail, maskPhone, newTxId } from "../_shared/log.ts";
import { fireLeadWebhook } from "../_shared/webhook-lead.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

  const txId = req.headers.get("X-Tx-Id") ?? newTxId();
  const log = makeLogger("submit-lead", txId);

  try {
    const body = await req.json();
    const nome = (body.nome ?? "").trim();
    const email = (body.email ?? "").trim();
    if (!nome || !email) throw new Error("nome e email são obrigatórios");

    const telefone = (body.telefone ?? "").trim();
    const ocupacao = (body.ocupacao ?? "").trim();
    const origem = body.origem ?? "site_metodo_ca";

    const supabase = getServiceClient();

    const { error: insertErr } = await supabase
      .from("leads")
      .insert({ nome, email, telefone, ocupacao, origem });
    if (insertErr) throw new Error(`leads insert: ${insertErr.message}`);

    const { data: ebooks, error: ebookErr } = await supabase
      .from("ebooks")
      .select("url_download, titulo")
      .eq("ativo", true)
      .limit(1);
    if (ebookErr) throw new Error(`ebooks select: ${ebookErr.message}`);
    const ebook = ebooks?.[0];
    if (!ebook?.url_download) throw new Error("Nenhum ebook ativo cadastrado");

    log.info("lead inserido", { email: maskEmail(email), telefone: maskPhone(telefone), origem });

    fireLeadWebhook({
      nome,
      email,
      telefone,
      ocupacao,
      origem,
      url_download: ebook.url_download,
      titulo_ebook: ebook.titulo ?? "Método C.A",
    }, txId);

    return new Response(
      JSON.stringify(ebook),
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
