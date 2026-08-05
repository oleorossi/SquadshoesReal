-- ============================================================================
-- Lote 2.1 + 2.2 — fecha a exposição das tabelas alcançáveis pela chave anon.
--
-- Antes desta migration o advisor de segurança acusava 24 ERROR, sendo 5 de
-- `rls_disabled_in_public` (tabelas 100% legíveis por anon, com ficha técnica e
-- solado dentro) + 4 INFO de `rls_enabled_no_policy`.
--
-- Salvaguarda, verificações e o porquê de cada decisão:
--   docs/backup-tabelas-derrubadas-2026-08-05.md
-- ============================================================================


-- 1) Backups sem RLS — LIGAR RLS, **NÃO** derrubar --------------------------
--
-- O plano original era `DROP TABLE`. A inspeção mostrou que isso destruiria
-- dado insubstituível: `backed_up_at` das cinco é 2026-08-02, três dias atrás.
-- São a rede de rollback declarada da migration
-- `20261102120000_purge-sole-rows-from-bom-and-fix-standard-flag.sql`
-- ("Reversível: as linhas removidas ficam em `_backup_bom_sole_rows_20261102`"),
-- que deletou 56 linhas de `sheet_materials` em 8 fichas técnicas e desarmou
-- `is_standard_sole_item` em 7 solados. Conferido em 05/08/2026: das 56 linhas
-- do backup, **0 ainda existem** em `sheet_materials` — o backup é a única cópia.
-- Como custeio e MRP leem `sheet_materials`, derrubar aqui tiraria a única saída
-- de uma mudança de custo ainda não validada em produção.
--
-- O furo é "legível por anon", não "a tabela existe". RLS ligada sem policy
-- nega tudo via PostgREST (anon e authenticated), zera os 5 ERROR e preserva o
-- rollback. Mesmo remédio que `20260903110000_rls-backup-table.sql` já aplicou
-- em `sole_technical_specs_backup_20260630`.
--
-- service_role e SQL Editor seguem lendo — o único uso legítimo de um backup.

alter table public._backup_bom_sole_rows_20261102        enable row level security;
alter table public._backup_standard_sole_flag_20261102   enable row level security;
alter table public._backup_sole_technical_specs_20261102 enable row level security;
alter table public._backup_fn_by_grade_20261102          enable row level security;
alter table public._parity_before_20261102               enable row level security;

comment on table public._backup_bom_sole_rows_20261102 is
  'Backup 2026-08-02 (mig 20261102120000): 56 linhas de solado removidas de '
  'sheet_materials em 8 fichas. ÚNICA CÓPIA — nenhuma voltou pra tabela viva. '
  'RLS ligada sem policy de propósito: só service_role lê. Rollback em '
  'docs/backup-tabelas-derrubadas-2026-08-05.md. Derrubar só depois de validar '
  'custeio/MRP das 8 fichas.';

comment on table public._backup_standard_sole_flag_20261102 is
  'Backup 2026-08-02 (mig 20261102120000): os 7 solados que tinham '
  'is_standard_sole_item = true antes do desarme. RLS sem policy de propósito.';

comment on table public._backup_sole_technical_specs_20261102 is
  'Snapshot 2026-08-02 de sole_technical_specs (77 linhas), tirado na mudança de '
  'consumo por grade. RLS sem policy de propósito.';

comment on table public._backup_fn_by_grade_20261102 is
  'Fonte da função calculate_order_consumption_by_grade antes da troca de '
  '2026-08-02 (47 KB). RLS sem policy de propósito.';

comment on table public._parity_before_20261102 is
  'Baseline de paridade de consumo por ficha, anterior à mudança de 2026-08-02. '
  'Comparar contra run_consumption_parity_tests() antes de descartar. '
  'RLS sem policy de propósito.';


-- 2) `punch_device_map` — MANTIDA, e de propósito SEM policy ----------------
--
-- Está em uso: 7 dispositivos vinculados, FK pra employees, e é lida por
-- `punch_map_resolve` + `get_punch_reconciliation` (ambas SECURITY DEFINER,
-- dono postgres) e pelo gatilho `trg_resolve_tr_employee`.
--
-- O gatilho é SECURITY INVOKER e faz `select ... into new.employee_id` — se a
-- RLS o cegasse, gravaria NULL em silêncio. NÃO cega: o caminho real de
-- importação é a RPC `import_time_records_safe`, SECURITY DEFINER com dono
-- postgres, e dono de tabela ignora RLS. Confirmado no dado: das linhas de
-- time_records criadas depois do último backfill, 131/131 têm employee_id
-- resolvido nos 7 dispositivos vinculados.
--
-- Portanto nenhum caminho do app precisa de policy. Uma
-- `using (is_approved_user())` só exporia o vínculo device_id ↔ employee_id
-- (PII de RH) via PostgREST, sem ganho funcional. Deixar como está é o estado
-- mais fechado que ainda funciona.

comment on table public.punch_device_map is
  'Mapa matrícula do relógio -> employee_id. RLS ligada e SEM POLICY de '
  'PROPÓSITO: todo acesso passa por RPC SECURITY DEFINER (punch_map_resolve, '
  'get_punch_reconciliation) e pelo gatilho trg_resolve_tr_employee, que roda '
  'sob import_time_records_safe (DEFINER, dono postgres, ignora RLS). NÃO criar '
  'policy — expor device_id -> employee_id ao PostgREST é PII de RH sem ganho. '
  'O advisor marca rls_enabled_no_policy (INFO) e isso é o esperado.';


-- 3) `sole_technical_specs_backup_20260630` — MANTIDA -----------------------
--
-- Já estava fechada (RLS sem policy, mig 20260903110000) — não é exposição.
-- E não é redundante: dos 63 IDs, 7 **não existem mais** em
-- sole_technical_specs e 54 têm consumo divergente do vivo. É a única cópia
-- desse estado. Consumo é dado load-bearing e historicamente sensível a
-- regressão (ver CLAUDE.md), então o valor forense supera a higiene.

comment on table public.sole_technical_specs_backup_20260630 is
  'Backup 2026-06-30 de sole_technical_specs. Guarda 7 IDs que sumiram da tabela '
  'viva e 54 linhas com consumo divergente — única cópia desse estado. RLS sem '
  'policy de propósito (mig 20260903110000).';


-- 4) `wa_messages` / `wa_pending_actions` — DROP ----------------------------
--
-- Esqueleto de uma ingestão de WhatsApp que nunca entrou no ar: **0 linhas** nas
-- duas, nenhuma edge function (`supabase/functions/` não cita), nenhum uso em
-- src/ além do `types.ts` gerado, e nenhuma migration no repo (criadas ad-hoc
-- via MCP/SQL Editor). Zero dado destruído. DDL completo pra recriar está em
-- docs/backup-tabelas-derrubadas-2026-08-05.md caso a feature volte.
--
-- wa_pending_actions primeiro por causa da FK pra suppliers (não há FK entre as
-- duas, mas a ordem mantém a intenção explícita).

drop table if exists public.wa_pending_actions;
drop table if exists public.wa_messages;
