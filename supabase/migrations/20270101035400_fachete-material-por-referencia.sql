-- Fachete: o MATERIAL passa a ser escolhido por REFERÊNCIA (ficha técnica).
--
-- Pedido do dono (11/10/2026, tela Solados → Consumos → Fachete): "toda
-- referência que tiver esse solado selecionado deverá ter preenchido o
-- material utilizado, e ele deve contar no débito de consumo".
--
-- Antes: o grupo do fachete vinha só de products.fachete_material_group_id do
-- SOLADO e, na falta, caía calado no lining_material da ficha. Medido hoje:
-- o único solado fachetado (180 SALTO BLOCO, PRETO e CARAMELO) não tem grupo
-- de fachete, então ST15/ST17 debitavam a forração da ficha (NAPA SOFT) sem
-- ninguém ter escolhido isso.
--
-- Agora a precedência do grupo do fachete em calculate_order_consumption_by_grade é:
--   1. material principal da variante, quando a ficha liga variant_drives_fachete
--      (inalterado — resolve_fachete_material_for_variant)
--   2. technical_sheets.fachete_material  ← NOVO: escolha explícita da referência
--   3. products.fachete_material_group_id do solado (padrão do modelo)
--   4. lining_material da ficha (legado, só pra não zerar o débito)
-- Espelhado no motor TS (orderConsumption.ts). A coluna fachete_material já
-- existia (texto, nome do grupo — mesmo padrão de lining_material) e já era
-- lida pelos gatilhos de custo sujo; só o motor de consumo a ignorava.
--
-- Débito: a linha 'Fachete' sai com debit_mode='soft' (reserva) e é baixada
-- na finalização da OP por settle_open_reservations_for_order — o mesmo
-- caminho de forro/palmilha. Nada muda nesse trajeto.
--
-- Patch via pg_get_functiondef (como 035000/035300) — não redefine o corpo.

DO $$
DECLARE
  v_fn regprocedure := 'public.calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)'::regprocedure;
  v_src text;
  v_old constant text :=
    E'  v_fachete_group := NULL;\n'
    || E'  IF v_is_fachetado AND v_sole_product_id IS NOT NULL THEN\n'
    || E'    SELECT pg2.name INTO v_fachete_group\n';
  v_new constant text :=
    E'  v_fachete_group := NULL;\n'
    || E'  -- fachete_material_por_referencia_20270101035400: a escolha da FICHA vence o grupo do solado.\n'
    || E'  IF v_is_fachetado THEN\n'
    || E'    v_fachete_group := NULLIF(btrim(COALESCE(v_sheet.fachete_material, '''')), '''');\n'
    || E'  END IF;\n'
    || E'  IF v_is_fachetado AND v_fachete_group IS NULL AND v_sole_product_id IS NOT NULL THEN\n'
    || E'    SELECT pg2.name INTO v_fachete_group\n';
BEGIN
  v_src := pg_get_functiondef(v_fn);

  IF position('fachete_material_por_referencia_20270101035400' IN v_src) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(v_old IN v_src) = 0 THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade: âncora do fachete não encontrada — corpo mudou, revisar o patch';
  END IF;
  IF (length(v_src) - length(replace(v_src, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade: âncora do fachete ambígua';
  END IF;

  EXECUTE replace(v_src, v_old, v_new);
END $$;

COMMENT ON COLUMN public.technical_sheets.fachete_material IS
  'Nome do grupo de material do fachete (forração do salto) desta referência. '
  'Vence products.fachete_material_group_id do solado; perde só para a variante '
  'quando variant_drives_fachete = true. Consumo (dm²/par) continua sendo do solado.';
