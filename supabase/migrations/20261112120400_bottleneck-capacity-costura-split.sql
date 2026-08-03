-- get_sheet_bottleneck_capacity: destrava o ramo MORTO da Costura
--
-- Problema (auditoria 2026-08-03): a função só considerava a costura quando
-- `production_sectors` continha o rótulo legado "Costura". A Costura foi dividida
-- em dois setores físicos nas migs 20261001120000 / 20261015120000 e HOJE nenhuma
-- das 53 fichas usa mais esse rótulo — todas usam "Costura Palmilha" (47) e/ou
-- "Costura Cabedal" (16). Ou seja: o ramo nunca dispara e a costura ficou
-- invisível pro cálculo de gargalo que dimensiona o `split_order_into_lots`.
--
-- Impacto hoje: ZERO. Simulado nas 53 fichas com os dados de 03/08/2026 — o
-- mínimo não muda em nenhuma (a costura nunca é o menor valor com a capacidade
-- atualmente cadastrada), e `production_lots` está vazia (nenhum lote já criado).
-- Isto é blindagem: no dia em que a costura virar o gargalo real, ela passa a
-- contar em vez de ser ignorada em silêncio.
--
-- Cadeia de resolução por setor (idêntica à do motor de ondas):
--   ficha.<split> > ficha.<legado> > categoria.<split> > categoria.<legado>
-- O rótulo legado "Costura" segue aceito para não quebrar ficha antiga.

CREATE OR REPLACE FUNCTION public.get_sheet_bottleneck_capacity(p_sheet_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ts record;
  v_sectors jsonb;
  v_min int := 1000000;
  v_cap int;
  v_dlt_sewing int; v_dlt_cutting int; v_dlt_costura int; v_dlt_mesa int;
  v_dlt_silk int; v_dlt_gluing int; v_dlt_assembly int; v_dlt_finishing int;
  v_dlt_soling int;
  v_dlt_costura_cabedal int; v_dlt_costura_palmilha int;
BEGIN
  SELECT * INTO v_ts FROM public.technical_sheets WHERE id = p_sheet_id;
  IF NOT FOUND THEN RETURN 100; END IF;

  -- Fallback por categoria (mesma cadeia ficha > default_lead_times do motor de ondas)
  SELECT dlt.sewing_capacity_per_day, dlt.cutting_capacity_per_day,
         dlt.costura_capacity_per_day::int, dlt.mesa_daily_capacity,
         dlt.silk_capacity_per_day::int, dlt.gluing_capacity_per_day::int,
         dlt.assembly_capacity_per_day, dlt.finishing_capacity_per_day,
         dlt.soling_capacity_per_day::int,
         dlt.costura_cabedal_capacity_per_day, dlt.costura_palmilha_capacity_per_day
    INTO v_dlt_sewing, v_dlt_cutting, v_dlt_costura, v_dlt_mesa,
         v_dlt_silk, v_dlt_gluing, v_dlt_assembly, v_dlt_finishing,
         v_dlt_soling,
         v_dlt_costura_cabedal, v_dlt_costura_palmilha
    FROM public.default_lead_times dlt
   WHERE dlt.shoe_category = v_ts.shoe_category;

  v_sectors := COALESCE(v_ts.production_sectors, '[]'::jsonb);

  IF v_sectors @> '["Corte Palmilha"]'::jsonb OR v_sectors @> '["Corte"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.sewing_capacity_per_day, 0), NULLIF(v_dlt_sewing, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Corte Forracao"]'::jsonb OR v_sectors @> '["Corte Forração"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.cutting_capacity_per_day, 0), NULLIF(v_dlt_cutting, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  -- Costura legada (rótulo "Costura", pré-divisão) — mantido p/ ficha antiga.
  IF v_sectors @> '["Costura"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.costura_capacity_per_day, 0)::int, NULLIF(v_dlt_costura, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  -- Costura dividida (rótulos vivos desde 20261001120000).
  IF v_sectors @> '["Costura Cabedal"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.costura_cabedal_capacity_per_day, 0),
                      NULLIF(v_ts.costura_capacity_per_day, 0)::int,
                      NULLIF(v_dlt_costura_cabedal, 0),
                      NULLIF(v_dlt_costura, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Costura Palmilha"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.costura_palmilha_capacity_per_day, 0),
                      NULLIF(v_ts.costura_capacity_per_day, 0)::int,
                      NULLIF(v_dlt_costura_palmilha, 0),
                      NULLIF(v_dlt_costura, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Mesa"]'::jsonb OR v_sectors @> '["Aviamento"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.mesa_daily_capacity, 0), NULLIF(v_dlt_mesa, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Silk"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.silk_capacity_per_day, 0)::int, NULLIF(v_dlt_silk, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  IF v_sectors @> '["Colagem"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.gluing_capacity_per_day, 0)::int, NULLIF(v_dlt_gluing, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;
  v_cap := COALESCE(NULLIF(v_ts.assembly_capacity_per_day, 0), NULLIF(v_dlt_assembly, 0), 1000000);
  IF v_cap < v_min THEN v_min := v_cap; END IF;
  v_cap := COALESCE(NULLIF(v_ts.finishing_capacity_per_day, 0), NULLIF(v_dlt_finishing, 0), 1000000);
  IF v_cap < v_min THEN v_min := v_cap; END IF;
  IF v_sectors @> '["Solagem"]'::jsonb THEN
    v_cap := COALESCE(NULLIF(v_ts.soling_capacity_per_day, 0)::int, NULLIF(v_dlt_soling, 0), 1000000);
    IF v_cap < v_min THEN v_min := v_cap; END IF;
  END IF;

  IF v_min = 1000000 THEN RETURN 100; END IF;
  RETURN GREATEST(v_min, 1);
END;
$function$;
