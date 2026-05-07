-- =============================================================================
-- PR 7 — DROP de colunas mortas em technical_sheets
-- =============================================================================
-- Resultado da auditoria SQL `audit-technical-sheets-fill-rate.sql`:
--   • 75 colunas com 0% de fill rate em 22 fichas técnicas.
--   • Cruzando com o código (src/ + funções SQL atuais), separamos:
--       - Colunas usadas pela fórmula de onda / consumo / triggers → MANTER
--         (estão vazias só porque nenhuma ficha foi configurada ainda)
--       - Colunas usadas só como stub no form (`useTechnicalSheets.ts`)
--         e nunca lidas por nada funcional → DROP nesta migration.
--
-- Total dropado: 38 colunas. Lista abaixo agrupada por motivo.
--
-- Reversibilidade: o `git log` desta migration tem o nome de cada coluna,
-- e a tabela `technical_sheets` mantém todas as fichas atuais (não toca
-- dados — só schema). Se algum campo precisar voltar, basta ALTER TABLE
-- ADD COLUMN no futuro.
-- =============================================================================

-- ─── 1. Stubs de marketing/etiqueta (nunca preenchidos, sem display) ────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS acceptance_criteria;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS assembly_instructions;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS care_instructions;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS certifications;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS commercial_description;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS country_origin;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS keywords;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS label_info;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS legal_composition;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS storage_instructions;

-- ─── 2. Versionamento manual stub (nunca usado) ─────────────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS approvals;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS change_log;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS data_ultima_revisao;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS responsavel_revisao;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS responsible_person;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS qtd_prevista;

-- ─── 3. Specs técnicos manuais (substitutos por sole_technical_specs) ──────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS heel_base;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS heel_material;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS heel_type;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS insole_thickness;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS lining_weight;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS upper_finish;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS stitch_spec;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS material_solado_tipo;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS sole_code;

-- ─── 4. Cola/Química — campos manuais nunca usados ─────────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cola_cure_time;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS cola_type;

-- ─── 5. Embalagem manual (info hoje vem de product_groups) ─────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS packaging_box_dimensions;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS packaging_notes;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS packaging_tissue;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS palletization;

-- ─── 6. Capacidades legacy (substituídas pelas *_capacity_per_day novas) ────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS daily_capacity_pairs;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS palmilha_daily_capacity;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS handling_time_minutes;

-- ─── 7. QC/máquinas/medições stub ──────────────────────────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS quality_tests;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS sampling_plan;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS tolerances;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS machine_settings;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS measurements;

-- ─── 8. Outros (versão "last_*" e específicos sem uso) ──────────────────────
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_code;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_exclusive;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_name;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS last_notes;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS obs_harmonizacao;
ALTER TABLE public.technical_sheets DROP COLUMN IF EXISTS acabamento_tiras;
