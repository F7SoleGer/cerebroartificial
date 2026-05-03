// Fire-and-forget POST ao webhook do n8n quando um lead é capturado.
// Mesma estratégia do webhook-compra: assinatura HMAC opcional, logs
// JSON estruturados e máscara de PII.

import { computeHmac } from "./hmac.ts";
import { makeLogger, maskEmail, maskPhone } from "./log.ts";

export interface LeadCapturado {
  nome: string;
  email: string;
  telefone?: string;
  ocupacao?: string;
  origem?: string;
  url_download?: string;
  titulo_ebook?: string;
}

export function fireLeadWebhook(lead: LeadCapturado, txId?: string): void {
  const url = Deno.env.get("N8N_WEBHOOK_LEAD_URL");
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET") ?? "";
  const log = makeLogger("webhook-lead", txId);
  if (!url) {
    log.warn("N8N_WEBHOOK_LEAD_URL ausente — webhook ignorado");
    return;
  }

  const payload = JSON.stringify({
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone ?? "",
    ocupacao: lead.ocupacao ?? "",
    origem: lead.origem ?? "site_metodo_ca",
    url_download: lead.url_download ?? "",
    titulo_ebook: lead.titulo_ebook ?? "",
    criado_em: new Date().toISOString(),
    tx_id: log.txId,
  });

  (async () => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Tx-Id": log.txId,
    };
    if (secret) headers["X-Signature"] = `sha256=${await computeHmac(secret, payload)}`;
    try {
      const res = await fetch(url, { method: "POST", headers, body: payload });
      log.info("webhook lead disparado", {
        email: maskEmail(lead.email),
        telefone: maskPhone(lead.telefone),
        origem: lead.origem,
        status: res.status,
        signed: Boolean(secret),
      });
    } catch (err) {
      log.error("webhook lead falhou", { error: (err as Error).message });
    }
  })();
}
