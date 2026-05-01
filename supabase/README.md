# Supabase — Hubmais (Zoop) gateway

Estrutura espelha as orientações do `zoop.md` (Fórmula Precisa), adaptada
para o site estático do Método C.A.

## Conteúdo

```
supabase/
├── config.toml                              # opções de deploy + verify_jwt
├── migrations/
│   └── 20260501000000_payments.sql          # tabelas pedidos, configuracoes, taxas_pagamento
└── functions/
    ├── _shared/
    │   ├── cors.ts                           # cabeçalhos CORS
    │   └── hubmais.ts                        # cliente Hubmais (buyers, PIX, cartão)
    ├── create-pix-payment/index.ts           # cria transação PIX e devolve QR
    ├── create-credit-payment/index.ts        # cobra cartão (form-urlencoded)
    └── check-pix-status/index.ts             # polling 5s → atualiza status
```

## 1. Configurar credenciais no projeto Supabase

Aplique a migration:

```bash
npx supabase link --project-ref ynaeybytorspfsdvikzb
npx supabase db push
```

Depois preencha as credenciais Hubmais via SQL no painel:

```sql
update public.configuracoes set valor = '<MARKETPLACE_ID>' where chave = 'zoop_marketplace_id';
update public.configuracoes set valor = '<SELLER_ID>'      where chave = 'zoop_seller_id';
update public.configuracoes set valor = '<API_KEY>'        where chave = 'zoop_api_key';
```

> As chaves `zoop_*` ficam com `tipo='credencial'` e **não** são lidas pelo
> anon — só pelas edge functions via `SUPABASE_SERVICE_ROLE_KEY`.

## 2. Deploy das edge functions

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx

npx supabase functions deploy create-pix-payment    --project-ref ynaeybytorspfsdvikzb --no-verify-jwt
npx supabase functions deploy create-credit-payment --project-ref ynaeybytorspfsdvikzb --no-verify-jwt
npx supabase functions deploy check-pix-status      --project-ref ynaeybytorspfsdvikzb --no-verify-jwt
```

## 3. Como o frontend usa

`/checkout/<slug>/` chama `submitCheckout(event)` em `assets/app.js`. O
fluxo é:

1. **Insert** em `public.pedidos` via REST anon (apenas `insert` é permitido).
2. Edge function correspondente:
   - **PIX:** `create-pix-payment` → renderiza QR + EMV + polling em
     `check-pix-status` (5 s) até `approved`.
   - **Cartão:** `create-credit-payment` → captura imediata; aprovado já
     marca `status_pagamento='approved'`.
   - **Boleto / gratuito:** apenas registra o pedido (envio manual).

## 4. Detalhes Hubmais que estão respeitados aqui

Tudo o que `zoop.md` lista como armadilha já está aplicado em `_shared/hubmais.ts`:

- Cartão usa `application/x-www-form-urlencoded`, **não** JSON.
- `expiration_year` enviado com 2 dígitos.
- `installments` no root (não `installment_plan.number_installments`).
- `card[brand]` obrigatório; bandeiras case-sensitive (`Visa`, `MasterCard`, `Elo`).
- Sem tokenização separada — dados do cartão direto no endpoint de transação.
- `amount` em **reais** como string (`"49.70"`), não centavos.
- QR Code retornado é SVG base64 (`image/svg+xml`), o frontend usa esse MIME.

## 5. Webhook (opcional)

Para reduzir o polling, cadastre um webhook no portal Hubmais apontando
para uma futura edge function `zoop-webhook`. Hoje o polling é suficiente
para o volume previsto.
