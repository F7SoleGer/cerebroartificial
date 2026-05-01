-- ════════════════════════════════════════════════════════════════════
-- Método C.A — schema de pagamentos via Hubmais (Zoop wrapper)
-- ════════════════════════════════════════════════════════════════════

-- 1. Tabela de configurações (chave/valor) — credenciais privadas + sistema público
create table if not exists public.configuracoes (
  chave        text primary key,
  valor        text not null,
  tipo         text not null check (tipo in ('credencial','sistema')),
  descricao    text,
  atualizado_em timestamptz not null default now()
);

alter table public.configuracoes enable row level security;

-- Apenas configurações 'sistema' são lidas pelo anon — credenciais ficam para service_role
drop policy if exists configuracoes_sistema_select on public.configuracoes;
create policy configuracoes_sistema_select on public.configuracoes
  for select using (tipo = 'sistema');

-- 2. Tabela de pedidos
create table if not exists public.pedidos (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  email               text not null,
  telefone            text,
  cpf                 text,
  produto_slug        text not null,
  produto_nome        text,
  valor               numeric(10,2) not null default 0,
  installments        integer default 1,
  forma_pagamento     text not null check (forma_pagamento in ('pix','cartao','boleto','gratuito')),
  status_pagamento    text not null default 'pending' check (status_pagamento in ('pending','approved','failed','cancelled')),
  transaction_id      text,
  zoop_transaction_id text,
  pix_emv_code        text,
  pix_qrcode64        text,
  hubmais_buyer_id    text,
  card_brand          text,
  card_last4          text,
  origem              text default 'site_metodo_ca',
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create index if not exists pedidos_email_idx           on public.pedidos (email);
create index if not exists pedidos_status_idx          on public.pedidos (status_pagamento);
create index if not exists pedidos_transaction_id_idx  on public.pedidos (transaction_id);

alter table public.pedidos enable row level security;

-- O frontend (anon) só pode INSERIR pedidos. Leitura/atualização ficam para edge functions (service_role).
drop policy if exists pedidos_anon_insert on public.pedidos;
create policy pedidos_anon_insert on public.pedidos
  for insert with check (true);

-- 3. Tabela de taxas (referência para o cálculo de parcelamento)
create table if not exists public.taxas_pagamento (
  id               uuid primary key default gen_random_uuid(),
  forma_pagamento  text not null,
  parcelas         integer not null default 1,
  percentual_total numeric(5,2) not null,
  ativo            boolean not null default true,
  unique (forma_pagamento, parcelas)
);

alter table public.taxas_pagamento enable row level security;

drop policy if exists taxas_select on public.taxas_pagamento;
create policy taxas_select on public.taxas_pagamento for select using (ativo);

-- Seeds das taxas Hubmais (referência: zoop.md §7)
insert into public.taxas_pagamento (forma_pagamento, parcelas, percentual_total) values
  ('debito',          1, 1.90),
  ('credito_avista',  1, 4.64),
  ('credito',         2, 6.08),
  ('credito',         3, 6.88),
  ('credito',         4, 7.69),
  ('credito',         5, 8.51),
  ('credito',         6, 9.34),
  ('credito',         7, 10.42),
  ('credito',         8, 11.26),
  ('credito',         9, 12.12),
  ('credito',        10, 12.98),
  ('credito',        11, 13.85),
  ('credito',        12, 14.74)
on conflict (forma_pagamento, parcelas) do nothing;

-- 4. Trigger para manter atualizado_em em sincronia
create or replace function public.set_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists pedidos_set_atualizado_em on public.pedidos;
create trigger pedidos_set_atualizado_em
  before update on public.pedidos
  for each row execute function public.set_atualizado_em();

-- 5. Placeholders das credenciais — preencher manualmente no painel Supabase
insert into public.configuracoes (chave, valor, tipo, descricao) values
  ('zoop_marketplace_id', '', 'credencial', 'ID do marketplace na Hubmais'),
  ('zoop_seller_id',      '', 'credencial', 'ID do seller na Hubmais'),
  ('zoop_api_key',        '', 'credencial', 'Bearer token da API Hubmais'),
  ('hubmais_base_url',    'https://exatablack.api.payments.hubmais.tec.br/v1', 'sistema', 'Base URL da API Hubmais')
on conflict (chave) do nothing;
