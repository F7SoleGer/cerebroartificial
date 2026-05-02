---
name: registrar-deploy
description: Fluxo de uma rodada deste projeto — registra alterações no markdown certo, faz commit, dispara deploy HostGator + Supabase e verifica produção. Usar sempre que houver mudanças prontas para subir, e antes de "passo cego" como `git push`. Aplica-se a este repositório (Método C.A) e leva em conta o split alteracoesca.md (não-pagamento) vs zoop2.md (pagamento).
---

# registrar-deploy — ciclo de release do Método C.A

## Quando aplicar

- Há alterações no working tree ou commits recentes não refletidos no changelog.
- Acabou de mudar nav/layout/CSS/HTML/edge function e quer subir.
- O usuário pediu "registre as alterações", "faça o commit", "deploye", "registre e suba", etc.
- Antes de pedir uma `gh workflow run` manual.

## Convenção do projeto

| Tipo de mudança | Documentar em |
|---|---|
| Gateway de pagamento, edge functions de Hubmais, Supabase migrations relacionadas a `pedidos`/Hubmais/RLS dessas tabelas | [`zoop2.md`](../../../zoop2.md) |
| Tudo o mais — UI, copy, navegação, deploy, infra, e-book gratuito, formulário de lead, novas seções | [`alteracoesca.md`](../../../alteracoesca.md) |

Cada novo bloco vai numerado em ordem crescente, com cabeçalho `## N. Título`. O sumário no topo do documento também precisa ser atualizado.

## Passos

### 1. Levantar o delta

Antes de escrever qualquer linha de markdown, mapeie:

```bash
# o que está em vias de subir
git -C "$REPO" status -s
git -C "$REPO" diff --stat HEAD~5..HEAD

# o que JÁ subiu mas talvez não tenha sido documentado
git -C "$REPO" log --oneline -10
```

Confronte cada commit ou mudança não-comitada com a última seção numerada de `alteracoesca.md` e `zoop2.md`. Se um commit relevante não está mencionado em nenhum dos dois, é um delta. Commits triviais (`docs:`, ajustes de typo etc.) podem entrar consolidados em um bloco único.

### 2. Escrever o registro

Para cada documento que recebe novidades:

- Adicione uma nova seção `## N. Título` no fim, antes de qualquer apêndice.
- Atualize a lista do **Sumário** no topo do documento.
- Inclua uma tabela curta quando houver muitos itens; texto corrido quando for uma decisão única.
- Sem emojis. Linguagem PT-BR.
- Se o assunto for "deploy ou infra", cite o nome dos arquivos relevantes (`scripts/cpanel-deploy.sh`, `.github/workflows/...`, `supabase/functions/...`).
- Se for UI, cite a regra CSS principal e o breakpoint quando relevante.

### 3. Commit

Use a convenção do repositório (`feat:`/`fix:`/`docs:`/`chore:` + corpo explicativo + footer **`Alterado por Franklin G Mendes`**).

Heredoc obrigatório para formatação correta:

```bash
git add <paths> && git commit -m "$(cat <<'EOF'
<title>

<body>

Alterado por Franklin G Mendes
EOF
)"
```

Se houver mudanças de payment + não-payment no mesmo turno, **commitar separadamente** — um commit cada para o `zoop2.md` e o `alteracoesca.md`, mais um commit do código se aplicável. Mantém histórico legível.

### 4. Push e deploy

```bash
git push origin main
```

O push para `main` dispara automaticamente:

- `.github/workflows/deploy-hostgator.yml` → injeta secrets em `assets/app.js`, deploya as 5 edge functions, sobe os 18+ arquivos via cPanel API.
- `.github/workflows/deploy.yml` (Pages) — pode ser ignorado se HostGator está como alvo principal.

Acompanhar:

```bash
sleep 6
RUN=$(gh run list --workflow="Deploy HostGator + Supabase" --limit 1 --json databaseId -q '.[0].databaseId')
until [ "$(gh run view "$RUN" --json status -q .status)" = "completed" ]; do sleep 5; done
gh run view "$RUN" --json conclusion,status
```

Se `conclusion != success`, ler logs (`gh run view "$RUN" --log-failed`) e iterar. Erros recorrentes:

| Sintoma | Causa | Correção |
|---|---|---|
| `Invalid access token format` | `SUPABASE_ACCESS_TOKEN` sem `sbp_` | editar secret no GitHub |
| `Could not resolve host: https` | `CPANEL_HOST` com `https://` na frente | já tratado no `cpanel-deploy.sh` (sanitização) |
| `O arquivo "X" para carregamento já existe` | `Fileman/upload_files` sem flag | já tratado (`overwrite=1` no script) |
| `Acesso negado` da Hubmais | credenciais ausentes em `public.configuracoes` | rodar os `update` documentados em `zoop2.md` |

### 5. Verificar em produção

Sempre que a release tocar HTML/CSS/JS, validar com User-Agent realista (HostGator/ModSecurity recusa `Mozilla/5.0` curto):

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
curl -sL -A "$UA" -o /dev/null -w "home: %{http_code} | %{size_download}b\n" https://franklingmendes.com/
curl -sL -A "$UA" -o /dev/null -w "produtos: %{http_code} | %{size_download}b\n" https://franklingmendes.com/produtos/
curl -sIL -A "$UA" -e "https://franklingmendes.com/" https://franklingmendes.com/assets/styles.css | grep -E "HTTP|content-length|last-modified"
```

Se houver mudanças nas edge functions, smoke test:

```bash
PUB="sb_publishable_JPCEzZ5qMVUTkFQ5kkHK9A_it5W-kr2"
curl -s -X POST https://ynaeybytorspfsdvikzb.supabase.co/functions/v1/submit-pedido \
  -H "apikey: $PUB" -H "Authorization: Bearer $PUB" \
  -H "Content-Type: application/json" -d '{}' | head -c 200
# deve responder { "error": "nome e email são obrigatórios" } — função no ar
```

### 6. Reportar

Mensagem final ao usuário sempre traz:

- Status do workflow (link para o run no GitHub).
- Status HTTP de pelo menos 2 endpoints em produção.
- Resumo de uma linha do que foi documentado em cada `.md`.
- Pendências externas (ex.: secret a corrigir, plano da Hubmais a habilitar).

## O que não fazer

- Editar `alteracoesca.md` com conteúdo de pagamento (vai para `zoop2.md`).
- Adicionar seção sem atualizar o **Sumário** do mesmo documento.
- Empurrar deploy sem commit do markdown — o changelog não pode ficar atrás do `main`.
- Esquecer o footer `Alterado por Franklin G Mendes` no commit.
- Marcar o passo de Supabase como falha bloqueante quando o secret só está mal-formatado — o workflow já isola via `continue-on-error`.

## Cheatsheet

```text
1. delta              → git status / git log + diff vs último N. dos .md
2. escrever           → ## N+1. … + atualizar sumário (no doc certo)
3. commit             → heredoc + "Alterado por Franklin G Mendes"
4. push + watch       → gh run watch
5. verificar          → curl -A UA-real https://franklingmendes.com/...
6. reportar           → workflow link + HTTP + pendências externas
```
