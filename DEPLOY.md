# Deploy — Método C.A

Dois alvos de deploy convivem no repositório:

| Alvo | Workflow | Quando usar |
|---|---|---|
| GitHub Pages (`ca.franklingmendes.com`) | `.github/workflows/deploy.yml` | Default; já configurado |
| HostGator via cPanel API | `.github/workflows/deploy-hostgator.yml` | Quando o domínio for hospedado direto no cPanel/HostGator |

Ambos disparam em cada push para `main`. Você pode desabilitar um deles
em **Settings → Actions → General → Workflow permissions** se quiser
manter só um ativo.

---

## 1. Visão geral do deploy HostGator

```
push para main
  ↓
GitHub Actions
  ├── injeta SUPABASE_URL / SUPABASE_ANON_KEY em assets/app.js
  ├── deploy das 5 edge functions no Supabase
  └── upload dos arquivos estáticos para o HostGator via cPanel API
```

Site é estático — sem build (não usa Vite/React). O upload sobe
direto: `index.html`, `404.html`, `.htaccess`, `CNAME`, `assets/`,
e os 6 diretórios de produto/seção (`conceito/`, `metodo/`,
`ferramentas/`, `aplicacoes/`, `produtos/`, `cadastro/`, `checkout/`).

---

## 2. Secrets necessários no GitHub

Settings → Secrets and variables → Actions:

| Secret | Para que serve |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase (ex.: `https://ynaeybytorspfsdvikzb.supabase.co`) |
| `SUPABASE_ANON_KEY` | Publishable key (`sb_publishable_…`) ou anon legada |
| `SUPABASE_ACCESS_TOKEN` | Personal access token (`sbp_…`) — só o deploy de edge functions usa |
| `CPANEL_HOST` | Servidor cPanel (ex.: `sh00140.hostgator.com.br`) |
| `CPANEL_USERNAME` | Usuário cPanel |
| `CPANEL_API_TOKEN` | Token gerado em cPanel → Manage API Tokens |
| `CPANEL_DEPLOY_DIR` | Pasta do domínio relativa ao homedir (ex.: `ca.franklingmendes.com`) |

### Como gerar os tokens

**`CPANEL_API_TOKEN`:**
1. cPanel → busca → **Manage API Tokens**
2. **Create Token** → nome `github-deploy` (sem expiração ou data longa)
3. Copie o token (só aparece uma vez)

**`SUPABASE_ACCESS_TOKEN`:**
1. https://supabase.com/dashboard/account/tokens
2. **Generate new token** → nome `github-deploy`
3. Copie

---

## 3. Workflow HostGator — etapas

Arquivo: `.github/workflows/deploy-hostgator.yml`.

1. **Checkout** do repo.
2. **Injeção dos secrets em `assets/app.js`** — Python `str.replace()`
   troca `__SUPABASE_URL__` e `__SUPABASE_ANON_KEY__` pelos valores
   reais. Falha se algum placeholder sobrar (proteção contra deploy
   incompleto).
3. **Setup do Node 20** — só para usar `npx supabase`.
4. **Deploy das edge functions** — itera sobre as 5 funções
   (`submit-lead`, `submit-pedido`, `create-pix-payment`,
   `create-credit-payment`, `check-pix-status`) e roda
   `supabase functions deploy <fn> --project-ref ynaeybytorspfsdvikzb
   --no-verify-jwt`.
5. **Upload via cPanel API** — `bash scripts/cpanel-deploy.sh` cria os
   diretórios remotos com `Fileman/mkdir` e envia cada arquivo via
   `Fileman/upload_files`.

---

## 4. Edge Functions

| Função | Descrição | JWT |
|---|---|---|
| `submit-lead` | Insere lead em `public.leads` (service-role) e devolve URL/título do e-book ativo | Sem JWT |
| `submit-pedido` | Insere pedido em `public.pedidos` (service-role) e devolve `{ pedidoId }` | Sem JWT |
| `create-pix-payment` | Cria transação PIX na Hubmais e devolve QR + EMV | Sem JWT |
| `create-credit-payment` | Cobrança em cartão (Hubmais form-urlencoded) | Sem JWT |
| `check-pix-status` | Polling — atualiza pedido quando Hubmais aprova | Sem JWT |

### Deploy manual de uma única função

```bash
SUPABASE_ACCESS_TOKEN=sbp_... npx supabase functions deploy NOME_FUNCAO \
  --project-ref ynaeybytorspfsdvikzb --no-verify-jwt
```

---

## 5. Migrations (banco)

Migrations SQL estão em `supabase/migrations/` e **não são aplicadas
pelo workflow** — rode manualmente quando criar uma nova:

```bash
SUPABASE_ACCESS_TOKEN=sbp_... npx supabase link --project-ref ynaeybytorspfsdvikzb
SUPABASE_ACCESS_TOKEN=sbp_... npx supabase db push --dry-run   # ver pendentes
SUPABASE_ACCESS_TOKEN=sbp_... npx supabase db push             # aplicar
```

Migrations já aplicadas:

| Migration | Descrição |
|---|---|
| `20260501000000_payments.sql` | Tabelas `pedidos`, `configuracoes`, `taxas_pagamento` + RLS |

---

## 6. Estrutura no servidor (HostGator)

```
/home/<user>/ca.franklingmendes.com/
├── .htaccess           ← gerenciado pelo deploy (DirectoryIndex + 404)
├── index.html
├── 404.html
├── CNAME               ← inerte no HostGator, mas mantido para coerência
├── assets/
│   ├── styles.css
│   └── app.js          ← com SUPABASE_URL / SUPABASE_ANON_KEY já substituídos
├── conceito/
├── metodo/
├── ferramentas/
├── aplicacoes/
├── produtos/
├── cadastro/
└── checkout/
    ├── conteudo-gratuito/
    ├── ebook-codigos/
    ├── comunidade/
    ├── curso-online/
    ├── acompanhamento-grupo/
    └── mentoria-individual/
```

O `.htaccess` é **enviado pelo deploy** (não é manual). Ele:

- mantém `Options -MultiViews +FollowSymLinks`,
- garante `DirectoryIndex index.html`,
- adiciona barra final em diretórios (`/conceito` → `/conceito/`),
- aponta `ErrorDocument 404 /404.html`,
- define cache moderado para estáticos e `no-cache` para HTML,
- liga `mod_deflate` para texto.

---

## 7. Primeiro setup em um novo domínio HostGator

1. **Adicionar o domínio** no cPanel (Addon Domains ou Subdomains)
   apontando para a pasta `ca.franklingmendes.com/` (ou outra).
2. **Configurar os 7 secrets** no GitHub (tabela acima).
3. **Vincular o Supabase** localmente (uma vez):
   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_... npx supabase link --project-ref ynaeybytorspfsdvikzb
   ```
4. **Aplicar migrations**:
   ```bash
   SUPABASE_ACCESS_TOKEN=sbp_... npx supabase db push
   ```
5. **Push para `main`** — o workflow sobe tudo automaticamente.

---

## 8. Limpeza de arquivos antigos

O upload sobrescreve, mas não deleta arquivos órfãos. Para limpar:

1. cPanel → **File Manager** → pasta do domínio.
2. Apague o que sobrou (geralmente nada, já que os nomes são fixos).
3. Faça um novo push para `main` para reupload completo.

---

## 9. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| Workflow falha em "Inject Supabase keys" | secret `SUPABASE_URL` ou `SUPABASE_ANON_KEY` ausente | adicionar em Settings → Secrets |
| `HTTP 401` no upload cPanel | `CPANEL_API_TOKEN` expirado ou inválido | regerar em Manage API Tokens |
| `"status":0` no upload | permissão da pasta no servidor | dar `755` na pasta do domínio via File Manager |
| Site novo retorna 404 em `/conceito/` | `.htaccess` não foi enviado | conferir presença do `.htaccess` no servidor; reenviar push |
| Site mostra HTML mas chamada Supabase falha | placeholders `__SUPABASE_URL__` ainda no `assets/app.js` | conferir se os secrets foram lidos pelo workflow (logs) |
| Edge function falha com `Acesso negado` da Hubmais | credenciais Hubmais não configuradas | rodar os `update` em `public.configuracoes` (ver `zoop2.md` §1) |

### Health check rápido

```bash
# Frontend hospedado
curl -I https://ca.franklingmendes.com/

# Edge function viva
curl -X POST https://ynaeybytorspfsdvikzb.supabase.co/functions/v1/submit-pedido \
  -H "apikey: $PUB" -H "Authorization: Bearer $PUB" \
  -H "Content-Type: application/json" \
  -d '{"nome":"x"}'
# → deve retornar { "error": "nome e email são obrigatórios" } (200/400 OK significa que a função está no ar)
```

---

## 10. Rodando o upload localmente (sem GitHub Actions)

Útil para hotfix urgente:

```bash
export CPANEL_HOST=sh00140.hostgator.com.br
export CPANEL_USERNAME=...
export CPANEL_API_TOKEN=...
export CPANEL_DEPLOY_DIR=ca.franklingmendes.com

# Substitua os placeholders no assets/app.js antes de subir!
sed -i.bak \
  -e 's|__SUPABASE_URL__|https://ynaeybytorspfsdvikzb.supabase.co|g' \
  -e "s|__SUPABASE_ANON_KEY__|sb_publishable_...|g" \
  assets/app.js

bash scripts/cpanel-deploy.sh

# devolva o app.js ao estado com placeholders
mv assets/app.js.bak assets/app.js
```

> Em produção real, prefira o workflow — ele garante o estado certo do
> repositório.
