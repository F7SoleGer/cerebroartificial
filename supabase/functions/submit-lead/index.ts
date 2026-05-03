// ════════════════════════════════════════════════════════════════════
// submit-lead
// POST { nome, email, telefone, ocupacao } → { url_download, titulo }
// Insere o lead via service_role (bypassa RLS), dispara webhook n8n
// (fire-and-forget) e devolve o link do ebook ativo para o frontend.
// ════════════════════════════════════════════════════════════════════

import { corsHeaders } from "../_shared/cors.ts";
import { getServiceClient } from "../_shared/hubmais.ts";

// Dispara o webhook sem bloquear a resposta ao cliente.
// Falha silenciosa — o lead já foi salvo, o webhook é best-effort.
function fireWebhook(payload: Record<string, string>): void {
  const url = Deno.env.get("N8N_WEBHOOK_LEAD_URL");
  if (!url) return;

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((err) => console.error("webhook n8n:", err));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });

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

    fireWebhook({
      nome,
      email,
      telefone,
      ocupacao,
      origem,
      url_download: ebook.url_download,
      titulo_ebook: ebook.titulo ?? "Método C.A",
      criado_em: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify(ebook),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("submit-lead:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
