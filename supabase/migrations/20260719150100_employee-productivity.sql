-- =============================================================================
-- EQUIPE & CAPACIDADE — ETAPA 1: produtividade por funcionário
-- (specs/equipe-e-capacidade-fonte-unica.md, R19-R20, R22-R27)
--
-- A produtividade individual em pares/dia JÁ EXISTE: é a Chamada do Dia
-- (ficha_montadores). Aqui ela é lida como fonte de capacidade do setor —
-- NÃO se cria campo novo em employees (seria a 4ª fonte do mesmo fato).
--
--   R19 employee_productivity()        — média da Chamada na janela, ou override
--   R27 employee_sector_allocation     — fração por setor, Σ por pessoa ≤ 1,0
--   R20/R23/R24/R26 sector_measured_capacity() — Σ pares, Σ jornadas ÷ Σ pares,
--                                       cobertura e extrapolação pela média
--   R22 distribute_sector_pairs()      — reparte na proporção do rendimento,
--                                       sem criar nem perder par no arredondamento
-- =============================================================================

-- 1) Alocação e override por pessoa × setor (R27/R19) --------------------------
CREATE TABLE IF NOT EXISTS public.employee_sector_allocation (
  employee_id           uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  sector                text NOT NULL,
  -- Fração da jornada dedicada a este setor. Sem isto, quem atua em dois
  -- setores tem os mesmos 540 min contados duas vezes.
  allocation_fraction   numeric NOT NULL DEFAULT 1
                        CHECK (allocation_fraction > 0 AND allocation_fraction <= 1),
  -- Pares/dia SE DEDICADO INTEGRALMENTE. Usado quando não há Chamada do Dia.
  productivity_override numeric NULL
                        CHECK (productivity_override IS NULL OR productivity_override > 0),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid NULL DEFAULT auth.uid(),
  PRIMARY KEY (employee_id, sector)
);

CREATE INDEX IF NOT EXISTS idx_emp_sector_alloc_sector
  ON public.employee_sector_allocation (sector);

-- Σ das frações de um mesmo funcionário não pode passar de 1,0 (R27).
CREATE OR REPLACE FUNCTION public.tg_check_allocation_sum()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_total numeric;
BEGIN
  SELECT coalesce(sum(allocation_fraction), 0) INTO v_total
    FROM employee_sector_allocation
   WHERE employee_id = NEW.employee_id AND sector <> NEW.sector;

  IF v_total + NEW.allocation_fraction > 1.0001 THEN
    RAISE EXCEPTION 'Alocação de % ultrapassa 100%% (já alocado: %%, tentando somar: %%)',
      (SELECT name FROM employees WHERE id = NEW.employee_id),
      round(v_total * 100, 0), round(NEW.allocation_fraction * 100, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_employee_allocation_sum ON public.employee_sector_allocation;
CREATE TRIGGER tg_employee_allocation_sum
  BEFORE INSERT OR UPDATE ON public.employee_sector_allocation
  FOR EACH ROW EXECUTE FUNCTION public.tg_check_allocation_sum();

ALTER TABLE public.employee_sector_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_all_emp_sector_alloc ON public.employee_sector_allocation;
CREATE POLICY approved_all_emp_sector_alloc
  ON public.employee_sector_allocation FOR ALL
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
REVOKE ALL ON TABLE public.employee_sector_allocation FROM anon;

-- 2) Jornada individual (fallback no parâmetro global) -------------------------
CREATE OR REPLACE FUNCTION public.employee_journey_minutes(p_employee_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT NULLIF(round(extract(epoch from (ws.exit_time - ws.entry_time
              - coalesce(ws.lunch_end - ws.lunch_start, interval '0'))) / 60), 0)
       FROM employees e JOIN work_schedules ws ON ws.id = e.work_schedule_id
      WHERE e.id = p_employee_id),
    (SELECT journey_minutes FROM capacity_parameters LIMIT 1),
    540)
$$;

-- 3) Produtividade de uma pessoa num setor (R19) -------------------------------
-- Precedência: override digitado > média da Chamada do Dia na janela recente.
-- Retorna NULL quando a pessoa nunca foi medida (o chamador decide extrapolar).
CREATE OR REPLACE FUNCTION public.employee_productivity(
  p_employee_id uuid,
  p_sector text,
  p_window_days integer DEFAULT 30
)
RETURNS TABLE (pairs_per_day numeric, fonte text, dias integer)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_override numeric;
  v_avg      numeric;
  v_dias     integer;
BEGIN
  SELECT productivity_override INTO v_override
    FROM employee_sector_allocation
   WHERE employee_id = p_employee_id
     AND public.capacity_sector_key(sector) = public.capacity_sector_key(p_sector);

  IF v_override IS NOT NULL THEN
    RETURN QUERY SELECT v_override, 'informado'::text, 0;
    RETURN;
  END IF;

  -- Média da Chamada do Dia: dias COM lançamento na janela (dia sem lançamento
  -- não é dia de produção zero — é dia sem registro).
  SELECT round(avg(f.total), 2), count(DISTINCT f.dia)::integer
    INTO v_avg, v_dias
    FROM ficha_montadores f
   WHERE f.montador_id = p_employee_id
     AND public.capacity_sector_key(f.setor) = public.capacity_sector_key(p_sector)
     AND coalesce(f.total, 0) > 0
     AND f.dia >= (public.br_today() - p_window_days);

  IF coalesce(v_avg, 0) > 0 THEN
    RETURN QUERY SELECT v_avg, 'chamada'::text, v_dias;
  ELSE
    -- Sem lançamento na janela: tenta a média histórica completa antes de desistir.
    SELECT round(avg(f.total), 2), count(DISTINCT f.dia)::integer
      INTO v_avg, v_dias
      FROM ficha_montadores f
     WHERE f.montador_id = p_employee_id
       AND public.capacity_sector_key(f.setor) = public.capacity_sector_key(p_sector)
       AND coalesce(f.total, 0) > 0;
    IF coalesce(v_avg, 0) > 0 THEN
      RETURN QUERY SELECT v_avg, 'chamada_historico'::text, v_dias;
    ELSE
      RETURN QUERY SELECT NULL::numeric, 'nao_medido'::text, 0;
    END IF;
  END IF;
END;
$$;

-- 4) Capacidade medida do setor (R20/R23/R24/R26) ------------------------------
-- pares/dia = Σ (produtividade × fração)
-- min-pessoa/par = Σ (jornada × fração) ÷ Σ pares   ← média harmônica ponderada,
--   NÃO a média aritmética dos min/par individuais (erra sempre para mais).
-- Cobertura parcial extrapola pela média dos medidos e marca 'parcial' (R26):
-- somar só os medidos daria um número plausível e silencioso — pior que zero.
CREATE OR REPLACE FUNCTION public.sector_measured_capacity(
  p_sector text,
  p_window_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_rec        record;
  v_prod       record;
  v_members    jsonb := '[]'::jsonb;
  v_sum_pairs  numeric := 0;
  v_sum_journey numeric := 0;
  v_total      integer := 0;
  v_medidos    integer := 0;
  v_media      numeric;
  v_cobertura  text;
BEGIN
  -- 1ª passada: quem tem medição, para calcular a média dos medidos (R23).
  SELECT round(avg(p.pairs_per_day), 2), count(*)::integer
    INTO v_media, v_medidos
    FROM employees e
    CROSS JOIN LATERAL public.employee_productivity(e.id, p_sector, p_window_days) p
   WHERE e.active
     AND coalesce(e.payment_type, 'mensalista') <> 'producao'
     AND public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
     AND p.pairs_per_day IS NOT NULL;

  FOR v_rec IN
    SELECT e.id, e.name,
           coalesce(a.allocation_fraction, 1) AS fracao,
           public.employee_journey_minutes(e.id) AS jornada
      FROM employees e
      LEFT JOIN employee_sector_allocation a
             ON a.employee_id = e.id
            AND public.capacity_sector_key(a.sector) = public.capacity_sector_key(p_sector)
     WHERE e.active
       AND coalesce(e.payment_type, 'mensalista') <> 'producao'
       AND public.capacity_sector_key(e.department) = public.capacity_sector_key(p_sector)
     ORDER BY e.name
  LOOP
    v_total := v_total + 1;
    SELECT * INTO v_prod FROM public.employee_productivity(v_rec.id, p_sector, p_window_days);

    -- R23: não medido entra pela média dos colegas medidos, marcado estimativa.
    IF v_prod.pairs_per_day IS NULL AND v_media IS NOT NULL THEN
      v_prod.pairs_per_day := v_media;
      v_prod.fonte := 'estimado_media';
    END IF;

    IF v_prod.pairs_per_day IS NOT NULL THEN
      v_sum_pairs   := v_sum_pairs + v_prod.pairs_per_day * v_rec.fracao;
      v_sum_journey := v_sum_journey + v_rec.jornada * v_rec.fracao;
    END IF;

    v_members := v_members || jsonb_build_object(
      'employee_id',   v_rec.id,
      'nome',          v_rec.name,
      'fracao',        v_rec.fracao,
      'jornada_min',   v_rec.jornada,
      'pares_dia',     v_prod.pairs_per_day,
      'fonte',         v_prod.fonte,
      'dias_medidos',  v_prod.dias
    );
  END LOOP;

  v_cobertura := CASE
    WHEN v_total = 0 THEN 'sem_pessoas'
    WHEN v_medidos = 0 THEN 'nenhum'
    WHEN v_medidos < v_total THEN 'parcial'
    ELSE 'total' END;

  RETURN jsonb_build_object(
    'sector',              public.capacity_sector_label(public.capacity_sector_key(p_sector)),
    'pessoas_total',       v_total,
    'pessoas_medidas',     v_medidos,
    'cobertura',           v_cobertura,
    'media_medidos',       v_media,
    -- Sem ninguém medido não há capacidade — o setor fica "não dimensionado"
    -- (R23 → R7), nunca zero.
    'pairs_per_day',       CASE WHEN v_medidos = 0 OR v_sum_pairs <= 0 THEN NULL
                                ELSE round(v_sum_pairs, 2) END,
    'min_person_per_pair', CASE WHEN v_medidos = 0 OR v_sum_pairs <= 0 THEN NULL
                                ELSE round(v_sum_journey / v_sum_pairs, 4) END,
    'jornada_total_min',   round(v_sum_journey, 2),
    'membros',             v_members
  );
END;
$$;

-- 5) Distribuição proporcional (R22) -------------------------------------------
-- Reparte um total de pares entre as pessoas do setor na proporção do rendimento
-- individual. O arredondamento não pode criar nem perder par: a sobra vai para
-- quem tem maior rendimento (maior resto primeiro).
CREATE OR REPLACE FUNCTION public.distribute_sector_pairs(
  p_sector text,
  p_total_pairs numeric,
  p_window_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_cap    jsonb;
  v_base   numeric;
  v_rows   jsonb := '[]'::jsonb;
  v_rec    record;
  v_aloc   integer;
  v_soma   integer := 0;
  v_sobra  integer;
BEGIN
  IF p_total_pairs IS NULL OR p_total_pairs <= 0 THEN
    RAISE EXCEPTION 'Total de pares inválido';
  END IF;

  v_cap := public.sector_measured_capacity(p_sector, p_window_days);
  v_base := (v_cap->>'pairs_per_day')::numeric;

  IF v_base IS NULL OR v_base <= 0 THEN
    RETURN jsonb_build_object('erro', 'setor sem produtividade medida', 'capacidade', v_cap);
  END IF;

  -- Piso proporcional + ordenação por resto decrescente para distribuir a sobra.
  FOR v_rec IN
    SELECT (m->>'employee_id')::uuid AS id,
           m->>'nome' AS nome,
           (m->>'pares_dia')::numeric * (m->>'fracao')::numeric AS contrib
      FROM jsonb_array_elements(v_cap->'membros') m
     WHERE m->>'pares_dia' IS NOT NULL
     ORDER BY ((m->>'pares_dia')::numeric * (m->>'fracao')::numeric) DESC
  LOOP
    v_aloc := floor(p_total_pairs * v_rec.contrib / v_base);
    v_soma := v_soma + v_aloc;
    v_rows := v_rows || jsonb_build_object(
      'employee_id', v_rec.id,
      'nome',        v_rec.nome,
      'proporcao',   round(v_rec.contrib / v_base, 4),
      'pares',       v_aloc
    );
  END LOOP;

  -- Sobra do arredondamento vai para o maior rendimento (primeiro da ordenação).
  v_sobra := floor(p_total_pairs)::integer - v_soma;
  IF v_sobra > 0 AND jsonb_array_length(v_rows) > 0 THEN
    v_rows := jsonb_set(v_rows, '{0,pares}',
                to_jsonb(((v_rows->0->>'pares')::integer) + v_sobra));
  END IF;

  RETURN jsonb_build_object(
    'sector',      v_cap->>'sector',
    'total_pares', floor(p_total_pairs)::integer,
    'base_setor',  v_base,
    'cobertura',   v_cap->>'cobertura',
    'distribuicao', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.employee_productivity(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sector_measured_capacity(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.distribute_sector_pairs(text, numeric, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.employee_journey_minutes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.employee_productivity(uuid, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sector_measured_capacity(text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.distribute_sector_pairs(text, numeric, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.employee_journey_minutes(uuid) TO authenticated, service_role;
