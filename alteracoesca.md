# Alterações no projeto Método C.A — fora do escopo de pagamento

> Tudo o que foi alterado nas últimas sessões e **não** se refere ao
> gateway Hubmais/Zoop. As mudanças relacionadas a pagamento estão
> documentadas em [`zoop2.md`](zoop2.md).
> Última atualização: 01/05/2026.

---

## Sumário

1. [Reestruturação SPA → multi-página](#1-reestruturação-spa--multi-página)
2. [Domínio customizado](#2-domínio-customizado)
3. [Grafo animado de fundo](#3-grafo-animado-de-fundo)
4. [Página `/produtos/` — escada de valor](#4-página-produtos--escada-de-valor)
5. [Seção de entregáveis](#5-seção-de-entregáveis)
6. [Servidor local de preview + página 404](#6-servidor-local-de-preview--página-404)
7. [`.gitignore`](#7-gitignore)
8. [E-book gratuito hospedado no Supabase Storage](#8-e-book-gratuito-hospedado-no-supabase-storage)
9. [Inserção de leads e pedidos via edge function](#9-inserção-de-leads-e-pedidos-via-edge-function)
10. [Memória persistente do projeto](#10-memória-persistente-do-projeto)

---

## 1. Reestruturação SPA → multi-página

**Antes:** um único `index.html` (~3.200 linhas) com roteamento por
JavaScript via `goTo(pageId)`, alternando `display:none/block` em divs
`.page`. Sem URL real para cada seção.

**Depois:** site multi-página com uma URL por seção. Cada página é um
documento HTML independente, com `<title>`, `<meta description>` e
`<link rel="canonical">` próprios.

```
/                  → index.html         (Home)
/conceito/         → conceito/index.html
/metodo/           → metodo/index.html
/ferramentas/      → ferramentas/index.html
/aplicacoes/       → aplicacoes/index.html
/produtos/         → produtos/index.html
/cadastro/         → cadastro/index.html
/404.html          → fallback
/assets/styles.css → CSS compartilhado
/assets/app.js     → JS compartilhado (canvas + observadores + handlers)
```

Implicações:

- Os `onclick="goTo(...)"` dos botões/CTAs viraram `<a href="/...">`.
  `window.goTo()` continua existindo só como wrapper de
  `location.href`, para qualquer chamada residual.
- Cada página declara `body[data-page="..."]` e o `app.js` inicializa
  somente o `IntersectionObserver` apropriado para aquela seção
  (evita rodar quatro observadores simultaneamente).
- O `<canvas id="graph-canvas">` e o `<nav>` são repetidos em cada
  página, mas o CSS e o JS são únicos via `/assets/`.
- Memória institucional do projeto (`project_metodo_ca.md`) atualizada
  com a nova estrutura.

---

## 2. Domínio customizado

- Arquivo `CNAME` no root do repositório fixa o host em cada deploy do
  GitHub Pages: **`ca.franklingmendes.com`**.
- Todo `<link rel="canonical">` aponta para o domínio customizado.
- Falta apenas: criar o registro CNAME no DNS apontando `ca` →
  `f7soleger.github.io` e habilitar HTTPS no Pages — passos manuais
  documentados na conversa de configuração.

---

## 3. Grafo animado de fundo

Várias correções e expansões no canvas global do `assets/app.js`:

- Grafo cresceu de 30 para **50 nós** (adicionados *Estrutura, Fluxo,
  Obsidian, Claude, Integração, Criatividade, Aprendizado, Curadoria,
  Recuperação, Escrita, Tese, Automação, Metadados, Vínculo, Foco,
  Ontologia, Vocabulário, Repetição, Feedback, Iteração*).
- Lista de `LINKS` cresceu de ~49 para ~140 ligações.
- `setInterval` que controlava o brilho dos nós foi consolidado em um
  acumulador de `dt` dentro do próprio `requestAnimationFrame`, que
  já existia para a animação principal — uma única fonte de tempo.
- `tick(now = performance.now())` com fallback para evitar `dt = NaN`
  no primeiro frame (bug que apagava todas as conexões depois do
  refactor de RAF).
- Distância máxima das ligações ampliada de 440 para **600 px** e
  opacidade da linha "fria" subiu de 0,18 para 0,28 — o grafo voltou
  a ficar visivelmente conectado.
- 4 funções `init<Page>Observer()` quase idênticas viraram uma
  fábrica `initPageObserver({...})` com mapa `_observers` que faz
  `disconnect()` antes de recriar (corrige memory leak ao trocar
  de página).
- 4 funções `scrollTo<Page>()` viraram um `scrollToSection(scrollId,
  dataAttr, idx)` com aliases nomeados (`scrollToBlock`,
  `scrollToPhase`, etc.).
- `parseInt(idx, 10)` aplicado em todos os concats de querySelector
  com índices vindos do DOM.
- `aria-hidden="true"` no `<canvas>` (acessibilidade).

---

## 4. Página `/produtos/` — escada de valor

Nova seção do site, baseada na visualização *jarvis-escada-valor-v4*
adaptada para a paleta dourada do projeto e tipografia Playfair
Display + DM Sans (substitui Cinzel + Rajdhani da fonte original).

- Seis colunas (degraus) que sobem progressivamente conforme o
  visitante clica para revelar — animação `riseIn` com easing
  `cubic-bezier(.16,1.1,.3,1)`.
- Barras com gradiente `#E8B84B → #C89A2E → #6E5519`.
- Rótulos com nome do produto + preço editável inline (input de
  texto com underline pontilhada).
- Tier label abaixo de cada barra (`tráfego / isca`, `entrada`,
  `high ticket`, `ultra high`, etc.).
- Reaproveita o canvas global, então o background é o mesmo grafo
  animado.

---

## 5. Seção de entregáveis

Logo abaixo do gráfico, seis cards que detalham o que cada degrau
inclui, com base no mockup `escada-valor-entregaveis.html`. Convertidos
para a paleta do projeto, sem emojis.

- Cada card tem: número (01–06), nome do produto, duas seções com
  `→` como bullet, divider sutil e CTA (link âncora) para a página
  de checkout correspondente.
- Cards 5 e 6 marcados como `featured`/`premium` — borda superior
  dourada de 3 px e CTA preenchido em vez de outline.
- Card 01 enxugado (removidos *Captura de e-mail (lead)* e *Sequência
  de boas-vindas*; CTA renomeada de "Isca digital" para "Digital").
- Bloco "Equipe" listando *Adriana Pascale, Franklin G Mendes, Jose
  Aurelio* na borda inferior da seção.

> Os destinos das CTAs (`/checkout/<slug>/`) levam às páginas de
> cobrança que fazem parte da integração de pagamento — esses ficam
> documentados em `zoop2.md`.

---

## 6. Servidor local de preview + página 404

- `serve.js` foi reescrito para:
  - resolver índice de diretório (`/conceito/` →
    `/conceito/index.html`),
  - servir o `404.html` para qualquer rota inexistente,
  - cobrir os MIME types adicionais (`.css`, `.js`, `.json`, `.txt`)
    com `charset=utf-8`.
- `.claude/launch.json` configura a integração de preview com
  `port:3001, autoPort:true` para evitar conflitos quando outro
  preview já estiver rodando.
- `404.html` reaproveita o shell da home (canvas + nav) e mostra
  uma chamada "Sem endereço · 404 · Voltar ao início".

---

## 7. `.gitignore`

Repositório passou a ter `.gitignore` cobrindo:

- `.claude/` — estado local do agente
- `.DS_Store` — metadado do Finder
- `node_modules/` — caso alguém rode `npm install` localmente
- `supabase/.temp/`, `supabase/.branches/` — estado do CLI Supabase
- `.env`, `.env.local` — secrets que nunca devem entrar no repo

> O `project_id` em `supabase/config.toml` continua versionado — não é
> segredo, é só o ref do projeto.

---

## 8. E-book gratuito hospedado no Supabase Storage

Antes a coluna `url_download` da tabela `public.ebooks` apontava para
um placeholder (`https://sua-url-do-ebook.com/ebook.pdf`).

Mudanças aplicadas:

| Item | Valor |
|---|---|
| Bucket criado | `ebooks` (público; somente `application/pdf`; limite 50 MB) |
| Arquivo enviado | `obsidian-segundo-cerebro-para-claude.pdf` (~36 KB) |
| URL pública | `https://ynaeybytorspfsdvikzb.supabase.co/storage/v1/object/public/ebooks/obsidian-segundo-cerebro-para-claude.pdf` |
| Linha de `public.ebooks` atualizada | `id=8359d4f0-…f878` → `titulo="Obsidian — Segundo Cérebro para Claude"`, `url_download=<URL acima>`, `ativo=true` |

Isso é o que `supabaseGetEbook()` em `assets/app.js` lê toda vez que
um lead se cadastra em `/cadastro/`. A consulta exata
(`?ativo=eq.true&limit=1&select=url_download,titulo`) já foi validada
contra a anon key e devolve o novo PDF.

Para trocar o PDF no futuro, fazer upload com `x-upsert: true` no
mesmo bucket (ou em um path novo) e dar `PATCH` na linha ativa de
`public.ebooks` apontando para a nova URL pública.

---

## 9. Inserção de leads e pedidos via edge function

Em testes locais o formulário do `/cadastro/` falhou com
`"new row violates row-level security policy for table leads"` mesmo
após criar a policy `for insert to public with check (true)`. Após
algumas tentativas (recriar policy só para `anon`, alternar entre
chave anon legada e a `sb_publishable_…`, `set role anon` direto via
SQL), o sintoma persistiu — o projeto novo da Supabase, que já tem
publishable/secret keys, não está mapeando o anon JWT para o role
`anon` de forma confiável (o próprio `pg_has_role('anon','member')`
retornava false rodando como anon).

Em vez de continuar caçando o detalhe da nova autenticação, o INSERT
foi movido para edge functions com `service_role`, mesmo padrão das
funções `create-pix-payment` / `create-credit-payment` que já estavam
provadamente funcionando.

Mudanças:

- Novas edge functions:
  - `supabase/functions/submit-lead/index.ts` — recebe
    `{ nome, email, telefone, ocupacao }`, insere em `public.leads`
    via service-role e devolve `{ url_download, titulo }` do e-book
    ativo.
  - `supabase/functions/submit-pedido/index.ts` — recebe os dados do
    formulário de checkout, insere em `public.pedidos` via
    service-role e devolve `{ pedidoId }`.
- `supabase/config.toml` ganha `verify_jwt=false` para as duas para
  o frontend estático poder chamá-las só com a publishable key.
- `assets/app.js` perde `supabaseInsert()` e `supabaseGetEbook()`;
  ganha um único `callEdgeFn(name, body)`. `submitCadastro` chama
  `submit-lead`; `createPedido` chama `submit-pedido`. O dispatch
  PIX/cartão downstream é o mesmo.

Smoke test pós-deploy:

| Function | Resultado |
|---|---|
| `submit-lead` | devolve `{url_download, titulo}` apontando para o PDF do Obsidian no Storage |
| `submit-pedido` | devolve `{pedidoId}` (UUID novo gerado pela tabela) |
| Form `/cadastro/` no preview | sucesso visual + `window.open()` chamado com a URL real do PDF |

Outro efeito: o frontend continua precisando da chave pública para
autenticar o gateway, e a chave certa para o projeto novo é a
**publishable key** (`sb_publishable_…`) — não a anon JWT legada.
`assets/app.js` agora carrega a publishable key como fallback quando
os placeholders `__SUPABASE_URL__` / `__SUPABASE_ANON_KEY__` não
foram substituídos (uso local) e usa o valor injetado pelo workflow
em produção.

---

## 10. Memória persistente do projeto

O memory file
`~/.claude/projects/-Users-franklingmendes-Documents-GitHub-cerebroartificial/memory/project_metodo_ca.md`
foi atualizado para refletir:

- novo domínio (`ca.franklingmendes.com`),
- nova estrutura multi-página com lista de rotas,
- ponto de injeção dos secrets agora é `assets/app.js` (era
  `index.html`),
- presença do `CNAME` no repositório.

O índice `MEMORY.md` continua compacto, apontando para
`project_metodo_ca.md` e `feedback_code_style.md`.
