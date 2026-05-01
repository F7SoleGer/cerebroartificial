# Hubmais (Zoop) — Estado da integração no Método C.A

> Documento complementar ao `zoop.md` original (Fórmula Precisa).
> Aqui ficam apenas os deltas, decisões e validações desta sessão.
> Última atualização: 01/05/2026.

---

## 1. Onde a integração vive neste projeto

```
cerebroartificial/
├── supabase/
│   ├── config.toml                              # verify_jwt = false nas 3 functions
│   ├── README.md                                # passo a passo de deploy
│   ├── migrations/
│   │   └── 20260501000000_payments.sql          # pedidos, configuracoes, taxas_pagamento + RLS
│   └── functions/
│       ├── _shared/
│       │   ├── cors.ts
│       │   └── hubmais.ts                       # cliente Hubmais (buyers, PIX, cartão)
│       ├── create-pix-payment/index.ts
│       ├── create-credit-payment/index.ts
│       └── check-pix-status/index.ts
├── assets/app.js                                # dispatcher submitCheckout
├── assets/styles.css                            # PIX panel + card fields
├── checkout/<6 slugs>/index.html                # frontends de cobrança
└── zoop2.md                                     # este arquivo
```

| Item | Valor |
|---|---|
| Supabase project | `ynaeybytorspfsdvikzb` |
| Hubmais base URL | `https://exatablack.api.payments.hubmais.tec.br/v1` |
| `zoop_marketplace_id` | `e3200693…6e134c9` |
| `zoop_seller_id` | `c9b7018f…6bd294b0` |
| `zoop_api_key` | guardada em `public.configuracoes` (RLS bloqueia anon) |
| Token Supabase do operador | macOS Keychain — `metodo-ca-supabase / supabase-access-token` |

---

## 2. O que foi deployado e validado nesta sessão

| Etapa | Comando / método | Status |
|---|---|---|
| Migration aplicada | `supabase db push` | ok |
| 13 taxas Hubmais seedadas | seed inline na migration | ok |
| Edge functions deployadas | `supabase functions deploy …` | ok (3/3) |
| Credenciais gravadas | `PATCH /rest/v1/configuracoes` (service_role) | ok |
| RLS verificado | anon vê só configs `tipo='sistema'` | ok |
| Smoke test **PIX real** | pedido R$ 47 → EMV 196 chars + SVG QR 16 KB | **ok** |
| Smoke test **cartão real** | pedido R$ 1 → erro coerente do gateway (ver §5) | **ok** |
| Webhook | não cadastrado (polling de 5 s no frontend basta por ora) | pendente |

---

## 3. Diferenças vs `zoop.md` (Fórmula Precisa)

| Tópico | Fórmula Precisa | Método C.A |
|---|---|---|
| Tabela do pedido | `clientes_certificados` (compartilhada com o app) | `pedidos` (dedicada ao gateway) |
| Coluna do CPF | `cpf` | `cpf` (igual) |
| Coluna do EMV PIX | `pix_emv_code` | `pix_emv_code` (igual) |
| Coluna do QR base64 | `pix_qrcode64` | `pix_qrcode64` (igual) |
| Trigger `notify_pedido_aprovado` | sim, com `pg_net` → Resend | **não criado** (a notificação por e-mail entra depois, se necessário) |
| `taxas_pagamento` | igual | igual (mesmas 13 linhas seedadas) |
| Insert do pedido | feito por React/Vite com SDK | feito por HTML estático com `fetch` REST anon |
| RLS | service_role para tudo | anon só faz INSERT em `pedidos`; SELECT só em `configuracoes` `sistema` e `taxas_pagamento` |
| Front | `Pagamento.tsx` (SPA) | `assets/app.js` + 6 páginas estáticas em `/checkout/<slug>/` |

---

## 4. Como o frontend chama o gateway

`assets/app.js → submitCheckout(event)`:

1. Lê o `<form data-produto-slug data-produto-nome data-produto-valor>`.
2. Faz `INSERT` em `public.pedidos` via REST com `apikey = SUPABASE_ANON_KEY`.
3. Encaminha de acordo com o radio `pagamento`:
   - `pix`  → `POST /functions/v1/create-pix-payment`, renderiza QR (MIME `image/svg+xml`) + EMV + botão "Copiar código PIX", inicia polling em `check-pix-status` a cada 5 s.
   - `cartao` → valida campos, monta `card { number, holder_name, expiration_month, expiration_year, security_code }` e chama `POST /functions/v1/create-credit-payment`. Se `status` ∈ {`succeeded`, `authorized`}, exibe "Pagamento confirmado".
   - `boleto` ou `gratuito` → apenas registra o pedido (envio manual / e-book).

Polling termina assim que `check-pix-status` devolve `status: "approved"` (a edge function também faz o `UPDATE` para `status_pagamento='approved'`).

---

## 5. Respostas reais observadas no Hubmais (úteis para troubleshooting)

### 5.1 PIX — sucesso

```json
{
  "id": "51ddcc8d…39658e",
  "uid": "dcdde7d7…1fba40",
  "gateway": "zoop",
  "status": "pending",
  "amount": "47.00",
  "payment_type": "pix",
  "operation_type": "pix",
  "card_brand": "Pix",
  "pix": {
    "qrcode":   "00020101021226850014br.gov.bcb.pix2563qrcode.zoop.com.br/dynamic/…",
    "qrcode64": "PD94bWwgdmVyc2lvbj0i…",   // SVG base64
    "link":     "https://exatablack.payments.hubmais.tec.br/pix/51ddcc8d…",
    "key_type": "EVP",
    "expiration_date": "2026-05-01 06:15:12"
  }
}
```

> **Diferente do que o `zoop.md` sugeria.** O EMV vem em `pix.qrcode` e o
> base64 em `pix.qrcode64` — não em `payment_method.qr_code.{emv,image}`.
> O parser em `_shared/hubmais.ts` foi ajustado.

### 5.2 Cartão — recusado por falta de plano

```json
{ "message": "Nenhum plano de venda encontrado nessa modalidade." }
```

> Vem como **HTTP 200**, somente o campo `message`. O parser de erro foi
> corrigido para esse formato (precedência do `||` colapsava `json.message`
> e a mensagem caía como `"undefined"`).

### 5.3 Cartão — recusado pela operadora

```json
{ "message": "Seu cartão foi recusado. …" }
```

Mesmo tratamento — o frontend mostra a mensagem ao cliente.

---

## 6. Bugs encontrados nesta sessão e como foram resolvidos

| # | Sintoma | Causa | Fix |
|---|---|---|---|
| 1 | `emv` e `qrcode64` voltavam vazios após smoke test PIX | parser procurava `payment_method.qr_code.{emv,image}` (formato Zoop padrão); Hubmais devolve `pix.qrcode` e `pix.qrcode64` | `_shared/hubmais.ts → createPixTransaction` agora lê `json.pix.qrcode` / `json.pix.qrcode64` com fallback para o shape antigo |
| 2 | Cartão retornava `"hubmais credit: undefined"` em vez da mensagem real | precedência `json.message \|\| json.errors ? JSON.stringify(json.errors) : …` → o ternário sempre stringifica `json.errors` (que é `undefined`) | parêntese explícito + tratamento extra para 200-com-`message` |
| 3 | Migration recriou políticas e trigger sem proteger contra reaplicação | esperado em primeiro deploy — agora as `policy` e `trigger` usam `drop … if exists` antes de criar | nada a corrigir, comportamento idempotente |

Tudo o que `zoop.md` listava como armadilha (`form-urlencoded` para cartão,
`expiration_year` 2 dígitos, `installments` no root, `card[brand]`
case-sensitive, sem tokenização separada, `amount` em reais) já estava
implementado corretamente em `_shared/hubmais.ts` desde o primeiro commit.

---

## 7. Estado da conta Hubmais hoje

- **PIX:** habilitado, transação aprovada em ambiente real.
- **Cartão de crédito:** seller sem plano de venda nessa modalidade. A
  Hubmais devolve `"Nenhum plano de venda encontrado nessa modalidade."`
  para qualquer transação `payment_type=credit`.
- **Listagem de planos / detalhes do seller:** a API key atual não tem
  permissão de leitura nesses endpoints (`Acesso negado`). A consulta
  precisa ser feita pelo portal Hubmais ou via suporte.

### Para destravar cartão

1. Abrir chamado / contato com o suporte Hubmais pedindo a habilitação
   do plano "Cartão de crédito" para o seller `c9b7018f…6bd294b0`.
2. Confirmar quais bandeiras ficam ativas (mínimo `Visa`, `MasterCard`,
   `Elo` — nomes case-sensitive).
3. **Nenhuma alteração de código é necessária** — o `create-credit-payment`
   já está em produção, com `card[brand]` correto, `installments` no root
   e `expiration_year` truncado.

---

## 8. Como repetir os smoke tests

```bash
# Token do operador (já no Keychain)
TOKEN=$(security find-generic-password -a metodo-ca-supabase -s supabase-access-token -w)

# Service-role + anon key dinâmicas
SERVICE=$(curl -s "https://api.supabase.com/v1/projects/ynaeybytorspfsdvikzb/api-keys" \
  -H "Authorization: Bearer $TOKEN" | python3 -c \
  "import sys,json;[print(k['api_key']) for k in json.load(sys.stdin) if k.get('name')=='service_role']")
ANON=$(curl -s "https://api.supabase.com/v1/projects/ynaeybytorspfsdvikzb/api-keys" \
  -H "Authorization: Bearer $TOKEN" | python3 -c \
  "import sys,json;[print(k['api_key']) for k in json.load(sys.stdin) if k.get('name')=='anon']")

# 1) cria pedido
PEDIDO=$(curl -s -X POST "https://ynaeybytorspfsdvikzb.supabase.co/rest/v1/pedidos" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"nome":"Smoke","email":"smoke@test.local","cpf":"11144477735",
       "produto_slug":"ebook-codigos","produto_nome":"E-book","valor":47.00,
       "forma_pagamento":"pix"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")

# 2) PIX
curl -s -X POST "https://ynaeybytorspfsdvikzb.supabase.co/functions/v1/create-pix-payment" \
  -H "Content-Type: application/json" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -d "{\"pedidoId\":\"$PEDIDO\"}" | python3 -m json.tool

# 3) cartão (após Hubmais habilitar plano)
curl -s -X POST "https://ynaeybytorspfsdvikzb.supabase.co/functions/v1/create-credit-payment" \
  -H "Content-Type: application/json" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  -d "{\"pedidoId\":\"$PEDIDO\",\"card\":{\"number\":\"4111111111111111\",
       \"holder_name\":\"FULANO TESTE\",\"expiration_month\":\"12\",
       \"expiration_year\":\"30\",\"security_code\":\"123\"}}" | python3 -m json.tool

# 4) limpeza
curl -s -X DELETE "https://ynaeybytorspfsdvikzb.supabase.co/rest/v1/pedidos?id=eq.$PEDIDO" \
  -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE"
```

---

## 9. Próximos passos sugeridos

- [ ] Pedir ao suporte Hubmais a ativação do plano de cartão para o
      seller atual (sem isso o frontend mostra a mensagem do gateway).
- [ ] (Opcional) cadastrar webhook no portal Hubmais apontando para uma
      futura `zoop-webhook` edge function — reduz polling e fica mais
      robusto a falhas de rede do cliente.
- [ ] (Opcional) trigger SQL `notify_pedido_aprovado` + edge function
      `notify-pedido-aprovado` (espelho do `zoop.md`) para enviar
      automaticamente o e-book / convite quando o pedido vira `approved`.
- [ ] Depois que o token Supabase do operador deixar de ser necessário,
      revogá-lo em https://supabase.com/dashboard/account/tokens e
      apagar a entrada do Keychain:
      `security delete-generic-password -a metodo-ca-supabase -s supabase-access-token`.
