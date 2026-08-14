-- Consumos físicos confirmados pelo dono — 14/08/2026
--
-- Fonte única: `sole_group_standard_items` (por MODELO de solado). As linhas
-- em `sole_technical_specs` são apenas o espelho por SKU/cor e são preenchidas
-- pelo trigger ao criar uma nova numeração.
--
-- INFANTIL, tamanhos 25–27: 4,28 dm²/par
-- INFANTIL, tamanhos 28–33: 4,56 dm²/par
-- Os mesmos valores foram aprovados tanto para a placa quanto para a forração
-- da palmilha. 180 SALTO BLOCO: fachete de 2,53 dm²/par em todas as numerações.

DO $migration$
DECLARE
  v_infantil_group uuid := '5902f5eb-668a-421e-a0b6-ce0ace9f1a6c';
  v_salto_bloco_group uuid := '9e1db20b-49dc-43a1-933e-63bdabc67dde';
  v_infantil_sizes jsonb := jsonb_build_object(
    '25', 4.28, '26', 4.28, '27', 4.28,
    '28', 4.56, '29', 4.56, '30', 4.56,
    '31', 4.56, '32', 4.56, '33', 4.56
  );
  v_updated integer;
BEGIN
  -- O mapa é mesclado para preservar a régua adulta 34–40 já validada.
  UPDATE public.sole_group_standard_items
     SET consumption_per_size = consumption_per_size || v_infantil_sizes,
         notes = 'Consumo infantil 25–33 confirmado em 14/08/2026; mantém régua 34–40 existente.'
   WHERE sole_group_id = v_infantil_group
     AND role = 'placa_palmilha';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Esperada uma linha placa_palmilha no grupo INFANTIL; encontradas %.', v_updated;
  END IF;

  UPDATE public.sole_group_standard_items
     SET consumption_per_size = consumption_per_size || v_infantil_sizes,
         notes = 'Forração infantil 25–33 confirmada em 14/08/2026; mantém régua 34–40 existente.'
   WHERE sole_group_id = v_infantil_group
     AND role = 'forracao_palmilha';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Esperada uma linha forracao_palmilha no grupo INFANTIL; encontradas %.', v_updated;
  END IF;

  INSERT INTO public.sole_group_standard_items (
    sole_group_id, role, consumption_per_pair, consumption_per_size, unit, notes, display_order
  ) VALUES (
    v_salto_bloco_group, 'fachete', 2.53, '{}'::jsonb, 'dm²',
    'Consumo físico confirmado em 14/08/2026.', 3
  )
  ON CONFLICT (sole_group_id, role) WHERE role IS NOT NULL
  DO UPDATE SET
    consumption_per_pair = EXCLUDED.consumption_per_pair,
    consumption_per_size = EXCLUDED.consumption_per_size,
    unit = EXCLUDED.unit,
    notes = EXCLUDED.notes,
    display_order = EXCLUDED.display_order;

  -- A grade é por SKU de cor; INSERIR só as novas numerações faz o trigger
  -- derivar ambos os consumos do MODELO, sem quebrar a trava do espelho.
  INSERT INTO public.sole_technical_specs (sole_id, size)
  SELECT p.id, s.size
    FROM public.products p
    CROSS JOIN (VALUES (25), (26), (27), (28), (29), (30), (31), (32), (33)) AS s(size)
   WHERE p.group_id = v_infantil_group
     AND p.active = true
  ON CONFLICT (sole_id, size) DO NOTHING;
END;
$migration$;

