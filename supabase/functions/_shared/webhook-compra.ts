// Fire-and-forget POST ao webhook do n8n quando um pedido é aprovado.
// Não bloqueia a resposta — falha silenciosa (o pedido já está salvo).
//
// Segurança (PRD §5.3): payload é assinado com HMAC-SHA256 e enviado no
// header X-Signature. O n8n deve validar a assinatura usando o mesmo
// segredo (N8N_WEBHOOK_SECRET) antes de processar.

import { computeHmac } from "./hmac.ts";
import { makeLogger, maskEmail, maskPhone } from "./log.ts";

export interface PedidoAprovado {
  id: string;
  nome: string;
  email: string;
  telefone?: string | null;
  produto_slug: string;
  produto_nome: string;
  valor: number;
  forma_pagamento: string;
}

export function fireCompraWebhook(pedido: PedidoAprovado, txId?: string): void {
  const url = Deno.env.get("N8N_WEBHOOK_COMPRA_URL");
  const secret = Deno.env.get("N8N_WEBHOOK_SECRET") ?? "";
  const log = makeLogger("webhook-compra", txId);
  if (!url) {
    log.warn("N8N_WEBHOOK_COMPRA_URL ausente — webhook ignorado", { pedido_id: pedido.id });
    return;
  }

  const payload = JSON.stringify({
    pedido_id: pedido.id,
    nome: pedido.nome,
    email: pedido.email,
    telefone: pedido.telefone ?? "",
    produto_slug: pedido.produto_slug,
    produto_nome: pedido.produto_nome,
    valor: pedido.valor,
    forma_pagamento: pedido.forma_pagamento,
    aprovado_em: new Date().toISOString(),
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
      log.info("webhook compra disparado", {
        pedido_id: pedido.id,
        email: maskEmail(pedido.email),
        telefone: maskPhone(pedido.telefone),
        produto_slug: pedido.produto_slug,
        status: res.status,
        signed: Boolean(secret),
      });
    } catch (err) {
      log.error("webhook compra falhou", {
        pedido_id: pedido.id,
        error: (err as Error).message,
      });
    }
  })();
}
