-- ════════════════════════════════════════════════════════════════════════
-- Agente WhatsApp (wa-agent) — tabelas de CONTROLE do agente.
--
-- O agente lança em tabelas de negócio que JÁ EXISTEM (accounts_payable,
-- group_supplier_materials, suppliers, materials). Aqui criamos APENAS o
-- estado próprio do agente:
--   1) wa_messages         — idempotência: 1 linha por mensagem recebida da
--                            Evolution (key.id), bloqueia débito/catálogo
--                            duplicado em retry de webhook.
--   2) wa_pending_actions  — staging das ações pendentes de confirmação
--                            humana (máquina de estados pending→confirmed/
--                            cancelled→committed). NADA é gravado nas tabelas
--                            reais antes de um "SIM" do número autorizado.
--
-- RLS: ON nas duas, SEM policy pública. Só a Edge Function (service_role,
-- que faz bypass de RLS) acessa. Qualquer chave anon/authenticated é negada.
-- ════════════════════════════════════════════════════════════════════════

-- 1. Idempotência ----------------------------------------------------------
create table if not exists public.wa_messages (
  id            uuid primary key default gen_random_uuid(),
  wa_message_id text not null unique,          -- key.id da Evolution
  from_number   text not null,                 -- só dígitos (E.164 sem +)
  kind          text not null,                 -- 'text' | 'image'
  raw           jsonb not null,                -- payload bruto p/ auditoria
  received_at   timestamptz not null default now()
);

-- 2. Staging das ações pendentes ------------------------------------------
create table if not exists public.wa_pending_actions (
  id            uuid primary key default gen_random_uuid(),
  from_number   text not null,
  intent        text not null,                 -- 'catalog' | 'payable'
  extracted     jsonb not null,                -- payload já validado, pronto p/ commit
  supplier_id   uuid references public.suppliers(id),
  status        text not null default 'pending', -- pending | confirmed | cancelled | committed
  summary_sent  text,                          -- texto de confirmação enviado no Zap
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);

-- Busca "última pendente daquele número" (fluxo SIM/NÃO) e expiração por cron.
create index if not exists wa_pending_actions_from_status_created_idx
  on public.wa_pending_actions (from_number, status, created_at desc);

-- RLS ON, sem policy pública ----------------------------------------------
alter table public.wa_messages        enable row level security;
alter table public.wa_pending_actions enable row level security;
-- (sem CREATE POLICY de propósito — somente service_role acessa)

comment on table public.wa_messages is
  'wa-agent: idempotência de mensagens recebidas da Evolution API (1 linha por key.id).';
comment on table public.wa_pending_actions is
  'wa-agent: staging de ações pendentes de confirmação humana antes de gravar em accounts_payable / group_supplier_materials.';
