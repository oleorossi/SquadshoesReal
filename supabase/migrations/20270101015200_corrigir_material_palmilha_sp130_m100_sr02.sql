-- Corrige o cadastro de material da palmilha de SP130, M100 e SR02.
--
-- O readiness removido em 20270101015100 era o falso positivo de CABEDAL em
-- modelos somente de tiras. Depois dele, o PV-00168 expôs a pendência real que
-- já estava escondida atrás do primeiro erro: as três fichas têm consumo de
-- palmilha (4,4343 dm²/par + grade 34–40), Corte Fibra/Costura Palmilha e solado
-- 01 tradicional, mas `insole_material` vazio. Nesse estado o motor emite
-- "Palmilha sem material" com required=0: a placa some de consumo, reserva,
-- débito, custeio e compra.
--
-- SP124 é o gêmeo técnico vivo: mesmo solado, mesmas flags e a mesma geometria
-- de consumo, usando o grupo PALMILHA. O resolver canônico desse grupo é
-- intencionalmente agnóstico à cor da venda e encontra PLACA 1.0 EVA 3.0
-- (BRANCA). Portanto isto corrige DADO, não afrouxa readiness nem cria fallback.
--
-- Escopo deliberado: somente os IDs publicados de SP130, M100 e SR02. SR02 é
-- o terceiro cadastro vivo com a mesma geometria e a mesma lacuna; ele e M100
-- já aparecem em OPs do PV-00162. A migration corrige a fonte e deixa os
-- triggers normais marcarem custos/reservas como desatualizados, mas não cria
-- reserva nem débito retroativo — reconciliação de OP em produção é outra
-- operação e exige decisão própria.

BEGIN;

DO $preflight$
DECLARE
  v_target_count integer;
  v_unexpected text;
  v_unresolved_colors text;
  v_expected_per_size constant jsonb :=
    '{"34":3.84,"35":3.94,"36":4.28,"37":4.54,"38":4.68,"39":4.76,"40":5}'::jsonb;
  v_expected_sole constant uuid :=
    '7056af4c-fa67-40d6-9394-0f29c7b37c0a'::uuid;
  v_expected_plate constant uuid :=
    'caa8afb2-edd9-49b3-ae08-cc43c74f20a3'::uuid;
BEGIN
  SELECT count(*)
    INTO v_target_count
    FROM public.technical_sheets ts
   WHERE (ts.id, ts.name) IN (
     ('d5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid, 'SP130'),
     ('ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid, 'M100'),
     ('30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid, 'SR02')
   );
  -- Um banco limpo de teste não tem o catálogo operacional. A migration não
  -- fabrica fichas; partial fixture, porém, é drift e precisa falhar fechado.
  IF v_target_count = 0 THEN
    RAISE NOTICE
      'SP130/M100/SR02 ausentes; backfill operacional ignorado';
    RETURN;
  ELSIF v_target_count <> 3 THEN
    RAISE EXCEPTION
      'Preflight palmilha SP130/M100/SR02: esperava 3 fichas exatas, encontrou %',
      v_target_count;
  END IF;

  SELECT string_agg(ts.name, ', ' ORDER BY ts.name)
    INTO v_unexpected
    FROM public.technical_sheets ts
   WHERE ts.id IN (
     'd5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid,
     'ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid,
     '30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid
   )
     AND (
       ts.status_ficha IS DISTINCT FROM 'publicada'
       OR COALESCE(ts.insole_ready_made, false)
       OR NOT COALESCE(ts.sole_drives_consumption, false)
       OR ts.primary_sole_id IS DISTINCT FROM v_expected_sole
       OR ts.insole_consumption IS DISTINCT FROM 4.4343
       OR COALESCE(ts.insole_consumption_per_size, '{}'::jsonb)
            IS DISTINCT FROM v_expected_per_size
       OR COALESCE(NULLIF(btrim(ts.insole_material), ''), 'PALMILHA')
            <> 'PALMILHA'
     );
  IF v_unexpected IS NOT NULL THEN
    RAISE EXCEPTION
      'Preflight palmilha recusado: cadastro técnico divergiu em %',
      v_unexpected;
  END IF;

  -- Prova que o modelo usado como referência continua tecnicamente idêntico.
  IF NOT EXISTS (
    SELECT 1
      FROM public.technical_sheets template
     WHERE template.id = '5ceed0d3-d1c7-48fd-80bd-b8508e50b5df'::uuid
       AND template.name = 'SP124'
       AND btrim(template.insole_material) = 'PALMILHA'
       AND template.primary_sole_id = v_expected_sole
       AND template.insole_consumption = 4.4343
       AND COALESCE(template.insole_consumption_per_size, '{}'::jsonb)
             = v_expected_per_size
  ) THEN
    RAISE EXCEPTION
      'Preflight palmilha recusado: template vivo SP124 não confirma o grupo';
  END IF;

  -- As cores vivas precisam resolver a mesma placa genérica. NOT EXISTS é
  -- intencional: se o resolver devolver zero linhas, a cor deve falhar.
  SELECT string_agg(color, ', ' ORDER BY color)
    INTO v_unresolved_colors
    FROM unnest(ARRAY[
      'NEW WHISKY', 'TÂMARA', 'CHAMPAGNE', 'OFF WHITE', 'ROSADO'
    ]) color
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.resolve_insole_material_for_variant(
         NULL, 'PALMILHA', color, 0
       ) resolved
      WHERE resolved.product_id = v_expected_plate
   );
  IF v_unresolved_colors IS NOT NULL THEN
    RAISE EXCEPTION
      'Preflight palmilha recusado: grupo PALMILHA não resolveu a placa em %',
      v_unresolved_colors;
  END IF;
END
$preflight$;

UPDATE public.technical_sheets
   SET insole_material = 'PALMILHA'
 WHERE id IN (
   'd5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid,
   'ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid,
   '30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid
 )
   AND COALESCE(btrim(insole_material), '') = ''
   AND NOT COALESCE(insole_ready_made, false)
   AND COALESCE(insole_consumption, 0) > 0;

DO $postconditions$
DECLARE
  v_target_count integer;
  v_bad_audit text;
  v_bad_consumption text;
  v_expected_plate constant uuid :=
    'caa8afb2-edd9-49b3-ae08-cc43c74f20a3'::uuid;
BEGIN
  SELECT count(*)
    INTO v_target_count
    FROM public.technical_sheets ts
   WHERE ts.id IN (
     'd5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid,
     'ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid,
     '30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid
   );
  IF v_target_count = 0 THEN
    RAISE NOTICE
      'SP130/M100/SR02 ausentes; pós-condições operacionais ignoradas';
    RETURN;
  ELSIF v_target_count <> 3 THEN
    RAISE EXCEPTION
      'Pós-condição palmilha: esperava 3 fichas exatas, encontrou %',
      v_target_count;
  END IF;

  SELECT string_agg(ts.name, ', ' ORDER BY ts.name)
    INTO v_bad_audit
    FROM public.technical_sheets ts
    JOIN public.v_technical_sheets_audit audit ON audit.id = ts.id
   WHERE ts.id IN (
     'd5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid,
     'ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid,
     '30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid
   )
     AND (
       btrim(ts.insole_material) <> 'PALMILHA'
       OR audit.missing_insole_material
       OR audit.missing_insole_consumption
     );
  IF v_bad_audit IS NOT NULL THEN
    RAISE EXCEPTION
      'Pós-condição palmilha: readiness continua inválido em %',
      v_bad_audit;
  END IF;

  WITH fixtures(sheet_id, name, color, variant_id) AS (
    VALUES
      (
        'd5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid,
        'SP130/TÂMARA', 'TÂMARA', NULL::uuid
      ),
      (
        'd5079aa8-b4c0-4c04-a8b6-b684f7523928'::uuid,
        'SP130/CHAMPAGNE', 'CHAMPAGNE',
        '53d056b5-3e55-4256-acb1-700c5dde863c'::uuid
      ),
      (
        'ca3615f3-2a46-4d8d-938c-2dcddd96801a'::uuid,
        'M100/NEW WHISKY', 'NEW WHISKY', NULL::uuid
      ),
      (
        '30a08111-a84c-4050-9b58-2d1e084d0a0c'::uuid,
        'SR02/OFF WHITE', 'OFF WHITE', NULL::uuid
      )
  )
  SELECT string_agg(f.name, ', ' ORDER BY f.name)
    INTO v_bad_consumption
    FROM fixtures f
   WHERE NOT EXISTS (
     SELECT 1
       FROM jsonb_array_elements(
         public.calculate_order_consumption_by_grade(
           f.sheet_id, '{"34":1}'::jsonb, f.color, f.variant_id
         )
       ) line(value)
      WHERE line.value ->> 'component' = 'Palmilha'
        AND (line.value ->> 'product_id')::uuid = v_expected_plate
        AND (line.value ->> 'required')::numeric > 0
        AND line.value ->> 'unit' = 'dm²'
   );
  IF v_bad_consumption IS NOT NULL THEN
    RAISE EXCEPTION
      'Pós-condição palmilha: motor não emitiu placa resolvida em %',
      v_bad_consumption;
  END IF;
END
$postconditions$;

COMMIT;
