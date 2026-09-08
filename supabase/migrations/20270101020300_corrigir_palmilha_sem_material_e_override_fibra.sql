-- Corrige fichas publicadas com consumo de palmilha/fibra sem Material da
-- Palmilha, e remove mapas `insole_consumption_per_size` obsoletos quando o
-- solado dirige o consumo (doutrina: quantidade por numeração mora no Consumo
-- Padrão do solado; mapa na ficha congela e esconde edições posteriores).
--
-- Sintoma na conferência §02: "Palmilha sem material" com required=0 + total
-- de PLACA EVA que não bate com o dm²/par do solado.
--
-- Não inventa dm². Não reconcilia reservas/débitos de OPs já abertas.

BEGIN;

DO $preflight$
DECLARE
  v_plate uuid;
  v_unresolved text;
BEGIN
  -- Grupo PALMILHA precisa resolver a placa genérica nas cores vivas do print.
  SELECT resolved.product_id
    INTO v_plate
    FROM public.resolve_insole_material_for_variant(
      NULL, 'PALMILHA', 'OFF WHITE', 0
    ) resolved
   LIMIT 1;

  IF v_plate IS NULL THEN
    RAISE EXCEPTION
      'Preflight palmilha: grupo PALMILHA nao resolve produto para OFF WHITE';
  END IF;

  SELECT string_agg(color, ', ' ORDER BY color)
    INTO v_unresolved
    FROM unnest(ARRAY['CHAMPAGNE', 'COBRE', 'OFF WHITE', 'ROSADO']) color
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.resolve_insole_material_for_variant(
         NULL, 'PALMILHA', color, 0
       ) resolved
      WHERE resolved.product_id IS NOT NULL
   );
  IF v_unresolved IS NOT NULL THEN
    RAISE EXCEPTION
      'Preflight palmilha: grupo PALMILHA nao resolve produto em %',
      v_unresolved;
  END IF;
END
$preflight$;

-- 1) Material da palmilha ausente com consumo (escalar, mapa ou solado dirige).
UPDATE public.technical_sheets ts
   SET insole_material = 'PALMILHA',
       updated_at = now()
 WHERE COALESCE(btrim(ts.insole_material), '') = ''
   AND NOT COALESCE(ts.insole_ready_made, false)
   AND COALESCE(ts.status_ficha, '') = 'publicada'
   AND (
     COALESCE(ts.insole_consumption, 0) > 0
     OR (
       ts.insole_consumption_per_size IS NOT NULL
       AND ts.insole_consumption_per_size <> '{}'::jsonb
     )
     OR COALESCE(ts.sole_drives_consumption, false)
   );

-- 2) Fichas do solado INFANTIL: limpa mapa congelado de palmilha na ficha.
--    Quantidade por numeração mora no Consumo Padrão (mig 20270101000100:
--    4,28 / 4,56). Mapas na ficha escondem essa régua (precedência: ficha
--    vence solado). Escopo deliberado = grupo INFANTIL; fichas adultas com
--    override explícito (ex. SP130 34–40) ficam intactas.
UPDATE public.technical_sheets ts
   SET insole_consumption_per_size = '{}'::jsonb,
       updated_at = now()
 WHERE COALESCE(ts.sole_drives_consumption, false)
   AND NOT COALESCE(ts.insole_ready_made, false)
   AND ts.insole_consumption_per_size IS NOT NULL
   AND ts.insole_consumption_per_size <> '{}'::jsonb
   AND (
     ts.sole_group_id = '5902f5eb-668a-421e-a0b6-ce0ace9f1a6c'::uuid
     OR EXISTS (
       SELECT 1
         FROM public.products sole
        WHERE sole.id = ts.primary_sole_id
          AND sole.group_id = '5902f5eb-668a-421e-a0b6-ce0ace9f1a6c'::uuid
     )
   );

DO $post$
DECLARE
  v_still_missing integer;
  v_still_override integer;
BEGIN
  SELECT count(*)::integer
    INTO v_still_missing
    FROM public.technical_sheets ts
    JOIN public.v_technical_sheets_audit audit ON audit.id = ts.id
   WHERE audit.missing_insole_material
     AND COALESCE(ts.status_ficha, '') = 'publicada'
     AND NOT COALESCE(ts.insole_ready_made, false)
     AND (
       COALESCE(ts.insole_consumption, 0) > 0
       OR COALESCE(ts.sole_drives_consumption, false)
     );

  IF v_still_missing > 0 THEN
    RAISE EXCEPTION
      'Pos-condicao: ainda ha % fichas publicadas com missing_insole_material',
      v_still_missing;
  END IF;

  SELECT count(*)::integer
    INTO v_still_override
    FROM public.technical_sheets ts
   WHERE COALESCE(ts.sole_drives_consumption, false)
     AND NOT COALESCE(ts.insole_ready_made, false)
     AND ts.insole_consumption_per_size IS NOT NULL
     AND ts.insole_consumption_per_size <> '{}'::jsonb
     AND (
       ts.sole_group_id = '5902f5eb-668a-421e-a0b6-ce0ace9f1a6c'::uuid
       OR EXISTS (
         SELECT 1
           FROM public.products sole
          WHERE sole.id = ts.primary_sole_id
            AND sole.group_id = '5902f5eb-668a-421e-a0b6-ce0ace9f1a6c'::uuid
       )
     );

  IF v_still_override > 0 THEN
    RAISE EXCEPTION
      'Pos-condicao: ainda ha % fichas INFANTIL com mapa de palmilha sob sole_drives',
      v_still_override;
  END IF;
END
$post$;

COMMIT;
