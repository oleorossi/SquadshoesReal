-- ============================================================================
-- FASE 2 — "Costura" vira DOIS setores de fluxo independentes
--
-- Decisão do dono (2026-07-26): a costura de PALMILHA e a de CABEDAL são
-- equipes independentes que trabalham lado a lado. O fluxo real da fábrica:
--
--   1º  Corte Palmilha ‖ Corte Forração              (grupo 'corte')
--   2º  Costura Palmilha ‖ Costura Cabedal ‖ Aviamento (grupo 'costura_aviamento')
--   3º  Silk → Colagem → Montagem → Solagem → Acabamento → Expedição
--
-- A fase 1 (20260719170000) já havia criado os dois nomes nas camadas de
-- IMPRESSÃO e CUSTEIO, deixando o fluxo/DAG/capacidade com 'Costura' única e
-- documentando a fase 2 como pendente. É esta migration.
--
-- ⚠ ESCOPO CONSCIENTE: o enum `production_stage_enum` (motor de ONDAS) NÃO é
-- dividido aqui — os dois setores mapeiam para o valor 'costura' existente.
-- Como as duas costuras são PARALELAS, a onda continua enxergando uma única
-- "fase de costura", cujo lead time é o maior dos dois lados — que é o
-- comportamento correto no nível da onda. A independência vive no nível da OP
-- (order_stages), do apontamento e da capacidade, que é onde a fábrica opera.
--
-- ⚠ ORDEM IMPORTA: o trigger `tg_normalize_production_sectors` DESCARTA em
-- silêncio qualquer setor fora da sua lista canônica. Ele é atualizado ANTES
-- do backfill de `technical_sheets.production_sectors`, senão os nomes novos
-- sumiriam ao gravar.
-- ============================================================================

-- ── 1. Capacidade/dia por setor ─────────────────────────────────────────────
-- Equipes independentes ⇒ capacidades independentes. Ambas nascem herdando a
-- capacidade da Costura única, pra não zerar o planejamento no dia da virada.
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS costura_palmilha_capacity_per_day integer,
  ADD COLUMN IF NOT EXISTS costura_cabedal_capacity_per_day  integer;

ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS costura_palmilha_capacity_per_day integer,
  ADD COLUMN IF NOT EXISTS costura_cabedal_capacity_per_day  integer;

UPDATE public.technical_sheets
   SET costura_palmilha_capacity_per_day = COALESCE(costura_palmilha_capacity_per_day, costura_capacity_per_day),
       costura_cabedal_capacity_per_day  = COALESCE(costura_cabedal_capacity_per_day,  costura_capacity_per_day)
 WHERE costura_capacity_per_day IS NOT NULL;

UPDATE public.default_lead_times
   SET costura_palmilha_capacity_per_day = COALESCE(costura_palmilha_capacity_per_day, costura_capacity_per_day),
       costura_cabedal_capacity_per_day  = COALESCE(costura_cabedal_capacity_per_day,  costura_capacity_per_day)
 WHERE costura_capacity_per_day IS NOT NULL;

-- ── 2. Ordem canônica do fluxo (11 setores) ─────────────────────────────────
-- Fonte de verdade do servidor pra ordenação de etapas. 'Costura' legado
-- continua mapeado pra posição da Costura Palmilha (OPs antigas que escaparem).
CREATE OR REPLACE FUNCTION public.canonical_stage_order(p_stage_name text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE p_stage_name
    WHEN 'Corte Palmilha'   THEN 1
    WHEN 'Corte Forração'   THEN 2
    WHEN 'Corte Forracao'   THEN 2
    WHEN 'Corte Cabedal'    THEN 2
    WHEN 'Costura Palmilha' THEN 3
    WHEN 'Costura'          THEN 3   -- legado → posição da palmilha
    WHEN 'Costura Cabedal'  THEN 4
    WHEN 'Aviamento'        THEN 5
    WHEN 'Mesa'             THEN 5
    WHEN 'Silk'             THEN 6
    WHEN 'Colagem'          THEN 7
    WHEN 'Montagem'         THEN 8
    WHEN 'Solagem'          THEN 9
    WHEN 'Acabamento'       THEN 10
    WHEN 'Expedição'        THEN 11
    WHEN 'Expedicao'        THEN 11
    ELSE 99
  END;
$function$;

-- ── 3. Display → enum da onda ───────────────────────────────────────────────
-- Os dois setores compartilham o enum 'costura' (ver escopo no cabeçalho).
CREATE OR REPLACE FUNCTION public.sector_display_to_enum(p_name text)
 RETURNS production_stage_enum
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(trim(p_name))
    WHEN 'corte palmilha'   THEN 'corte_palmilha'::production_stage_enum
    WHEN 'corte forração'   THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte forracao'   THEN 'corte_forracao'::production_stage_enum
    WHEN 'corte cabedal'    THEN 'corte_cabedal'::production_stage_enum
    WHEN 'costura palmilha' THEN 'costura'::production_stage_enum
    WHEN 'costura cabedal'  THEN 'costura'::production_stage_enum
    WHEN 'costura'          THEN 'costura'::production_stage_enum
    WHEN 'mesa'             THEN 'mesa'::production_stage_enum
    WHEN 'aviamento'        THEN 'mesa'::production_stage_enum
    WHEN 'silk'             THEN 'silk'::production_stage_enum
    WHEN 'colagem'          THEN 'colagem'::production_stage_enum
    WHEN 'montagem'         THEN 'montagem'::production_stage_enum
    WHEN 'solagem'          THEN 'solagem'::production_stage_enum
    WHEN 'acabamento'       THEN 'acabamento'::production_stage_enum
    WHEN 'expedição'        THEN 'expedicao'::production_stage_enum
    WHEN 'expedicao'        THEN 'expedicao'::production_stage_enum
    -- Legacy: 'Corte' genérico antigo, mapeia pra palmilha (default mais seguro).
    WHEN 'corte'            THEN 'corte_palmilha'::production_stage_enum
    WHEN 'palmilha'         THEN 'corte_palmilha'::production_stage_enum
    WHEN 'forração'         THEN 'corte_forracao'::production_stage_enum
    WHEN 'forracao'         THEN 'corte_forracao'::production_stage_enum
    WHEN 'forro'            THEN 'corte_forracao'::production_stage_enum
    WHEN 'cabedal'          THEN 'corte_cabedal'::production_stage_enum
    WHEN 'serigrafia'       THEN 'silk'::production_stage_enum
    WHEN 'silkscreen'       THEN 'silk'::production_stage_enum
    ELSE NULL
  END;
$function$;

-- ── 4. Lista canônica do roteiro da ficha ───────────────────────────────────
-- ⚠ Este trigger é o portão: nome fora da lista é DESCARTADO sem erro. Precisa
-- conhecer os dois setores novos ANTES do backfill do item 6.
CREATE OR REPLACE FUNCTION public.tg_normalize_production_sectors()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura Palmilha','Costura Cabedal',
    'Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_input text[];
  v_normalized text[];
  v_clean jsonb;
  v_had_corte boolean := false;
BEGIN
  IF NEW.production_sectors IS NULL OR jsonb_typeof(NEW.production_sectors) <> 'array' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(value) INTO v_input
  FROM jsonb_array_elements_text(NEW.production_sectors);

  IF v_input IS NULL THEN RETURN NEW; END IF;

  v_had_corte := 'Corte' = ANY(v_input);

  SELECT array_agg(DISTINCT
    CASE
      WHEN x = 'Corte' THEN 'Corte Palmilha'
      WHEN x = 'Forração' THEN 'Corte Forração'
      WHEN x = 'Mesa' THEN 'Aviamento'
      -- Legado: 'Costura' única vira a de palmilha (a de cabedal é opt-in
      -- explícito, pra não inventar etapa em modelo de tiras).
      WHEN x = 'Costura' THEN 'Costura Palmilha'
      ELSE x
    END
  )
  INTO v_normalized
  FROM unnest(v_input) x;

  IF v_had_corte THEN
    v_normalized := v_normalized || ARRAY['Corte Forração'];
  END IF;

  SELECT jsonb_agg(s.value)
  INTO v_clean
  FROM (
    SELECT c.value, c.ord
    FROM unnest(v_canonical) WITH ORDINALITY AS c(value, ord)
    WHERE c.value = ANY(v_normalized)
    ORDER BY c.ord
  ) s;

  NEW.production_sectors := COALESCE(v_clean, '[]'::jsonb);
  RETURN NEW;
END;
$function$;

-- ── 5. sector_settings: os dois setores + grupos paralelos ──────────────────
-- parallel_group 'corte' e 'costura_aviamento' substituem o antigo 'preparacao'
-- (que punha os 4 começando juntos). Agora os cortes vêm primeiro e a costura
-- roda em paralelo com o aviamento — o fluxo real descrito pelo dono.
INSERT INTO public.sector_settings
  (sector, flow_order, enabled, parallel_group, daily_capacity_pairs, ficha_capacity_column)
SELECT 'Costura Palmilha', 30, true, 'costura_aviamento',
       COALESCE((SELECT daily_capacity_pairs FROM public.sector_settings WHERE sector='Costura'), 600),
       'costura_palmilha_capacity_per_day'
WHERE NOT EXISTS (SELECT 1 FROM public.sector_settings WHERE sector='Costura Palmilha');

INSERT INTO public.sector_settings
  (sector, flow_order, enabled, parallel_group, daily_capacity_pairs, ficha_capacity_column)
SELECT 'Costura Cabedal', 40, true, 'costura_aviamento',
       COALESCE((SELECT daily_capacity_pairs FROM public.sector_settings WHERE sector='Costura'), 600),
       'costura_cabedal_capacity_per_day'
WHERE NOT EXISTS (SELECT 1 FROM public.sector_settings WHERE sector='Costura Cabedal');

UPDATE public.sector_settings SET flow_order = 10,  parallel_group = 'corte'             WHERE sector = 'Corte Palmilha';
UPDATE public.sector_settings SET flow_order = 20,  parallel_group = 'corte'             WHERE sector = 'Corte Forração';
UPDATE public.sector_settings SET flow_order = 30,  parallel_group = 'costura_aviamento' WHERE sector = 'Costura Palmilha';
UPDATE public.sector_settings SET flow_order = 40,  parallel_group = 'costura_aviamento' WHERE sector = 'Costura Cabedal';
UPDATE public.sector_settings SET flow_order = 50,  parallel_group = 'costura_aviamento' WHERE sector = 'Aviamento';
UPDATE public.sector_settings SET flow_order = 60,  parallel_group = NULL WHERE sector = 'Silk';
UPDATE public.sector_settings SET flow_order = 70,  parallel_group = NULL WHERE sector = 'Colagem';
UPDATE public.sector_settings SET flow_order = 80,  parallel_group = NULL WHERE sector = 'Montagem';
UPDATE public.sector_settings SET flow_order = 90,  parallel_group = NULL WHERE sector = 'Solagem';
UPDATE public.sector_settings SET flow_order = 100, parallel_group = NULL WHERE sector = 'Acabamento';
UPDATE public.sector_settings SET flow_order = 110, parallel_group = NULL WHERE sector = 'Expedição';

DELETE FROM public.sector_settings WHERE sector = 'Costura';

-- ── 6. Roteiro das fichas ───────────────────────────────────────────────────
-- Hoje "Costura" já significa coisas diferentes por modelo (ver
-- ConstructionConfigPanel): em TIRAS é só palmilha+forração; em CABEDAL cobre
-- palmilha+forração E o cabedal. Por isso: toda ficha com Costura ganha a de
-- palmilha; só as que NÃO são de tiras ganham também a de cabedal.
UPDATE public.technical_sheets ts
   SET production_sectors = sub.novo
  FROM (
    SELECT t.id,
           (SELECT jsonb_agg(s.v ORDER BY public.canonical_stage_order(s.v))
              FROM (
                SELECT DISTINCT CASE WHEN e.value = 'Costura' THEN 'Costura Palmilha' ELSE e.value END AS v
                  FROM jsonb_array_elements_text(t.production_sectors) e
                UNION
                SELECT 'Costura Cabedal' WHERE NOT COALESCE(t.has_straps, false)
              ) s
           ) AS novo
      FROM public.technical_sheets t
     WHERE t.production_sectors @> '["Costura"]'::jsonb
  ) sub
 WHERE ts.id = sub.id;

-- ── 7. Etapas das OPs em andamento ──────────────────────────────────────────
-- Decisão do dono: migrar TODAS agora (inclusive as 162 com produção apontada).
-- 7a. A Costura existente É a de palmilha — renomear PRESERVA o apontado.
UPDATE public.order_stages SET stage_name = 'Costura Palmilha' WHERE stage_name = 'Costura';

-- 7b. Cria a de cabedal, zerada, só onde o roteiro da ficha pede.
INSERT INTO public.order_stages
  (order_id, stage_name, stage_order, status, quantity_total, quantity_processed,
   observations, defects, standard_time_minutes, cost_per_hour, cost_per_pair, actual_time_minutes)
SELECT os.order_id, 'Costura Cabedal', public.canonical_stage_order('Costura Cabedal'),
       'pendente', os.quantity_total, 0, '', '', 0, 0, 0, 0
  FROM public.order_stages os
  JOIN public.orders o          ON o.id  = os.order_id
  JOIN public.technical_sheets ts ON ts.id = o.reference_id
 WHERE os.stage_name = 'Costura Palmilha'
   AND ts.production_sectors @> '["Costura Cabedal"]'::jsonb
ON CONFLICT (order_id, stage_name) DO NOTHING;

-- 7c. Renumera as etapas pela ordem canônica nova (Aviamento saiu de 4 pra 5,
--     e tudo depois dele deslocou uma casa).
UPDATE public.order_stages
   SET stage_order = public.canonical_stage_order(stage_name)
 WHERE public.canonical_stage_order(stage_name) <> 99
   AND stage_order IS DISTINCT FROM public.canonical_stage_order(stage_name);

-- 7d. Agenda diária: as linhas de 'Costura' passam a ser da palmilha (o motor
--     recalcula o resto no próximo run).
UPDATE public.production_schedule SET sector = 'Costura Palmilha' WHERE sector = 'Costura';
