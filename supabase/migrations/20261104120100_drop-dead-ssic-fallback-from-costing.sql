-- ============================================================================
-- calculate_order_consumption_by_grade: remove o fallback MORTO para
-- `sole_standard_items_consumption`.
--
-- Por que é morto (medido em 03/08/2026, produção):
--   · a tabela tem 42 linhas, todas de UM solado (SOLADO 01, 2 SKUs de cor),
--     cobrindo 3 materiais: COLA PVC, COLA ADESIVO HOTMELT, COLA FORTE;
--   · última escrita em 07/06/2026 — a UI que a alimentava (SoleStandardItemsPanel)
--     foi aposentada e removida no commit que acompanha esta migration;
--   · os 3 materiais JÁ estão em `sole_group_standard_items` como linhas ITEM do
--     grupo SOLADO 01 (migrados em 02/08/2026, com a nota de migração na coluna
--     `notes`);
--   · o próprio ramo tem um `NOT EXISTS` que se suprime quando o material já
--     existe no cadastro novo — e isso é verdade para os 3. Conferido:
--       select distinct standard_item_id, exists(...) → true, true, true.
--
-- Logo: remover o ramo NÃO muda nenhum número de custeio. O que muda é a
-- dependência — a função deixa de ler uma tabela órfã (`standard_item_id`
-- aponta pra `sole_standard_materials`, que tem 0 linhas) e passa a ter uma
-- fonte só: `sole_group_standard_items`.
--
-- Os 42 registros FICAM no banco como histórico, por decisão do dono. Só o
-- caminho de leitura sai.
--
-- Método: a função tem ~48 KB. Recopiá-la inteira aqui tornaria a mudança
-- impossível de revisar e arriscaria arrastar deriva de outras partes do corpo.
-- Em vez disso, recortamos o bloco EXATO e falhamos alto se ele não bater —
-- migration que não encontra o alvo aborta em vez de virar no-op silencioso.
-- ============================================================================

DO $migration$
DECLARE
  v_def  text;
  v_new  text;
  v_dead text := E'        UNION ALL\n'
                 '        SELECT ssic.standard_item_id AS pid, ssic.consumption AS cons, ssic.unit AS unit\n'
                 '          FROM sole_standard_items_consumption ssic\n'
                 '         WHERE ssic.sole_product_id = v_sole_product_id AND ssic.size = v_size AND ssic.consumption > 0\n'
                 '           AND NOT EXISTS (\n'
                 '                 SELECT 1 FROM sole_group_standard_items sg2\n'
                 '                   JOIN products ps2 ON ps2.id = v_sole_product_id\n'
                 '                  WHERE sg2.sole_group_id = ps2.group_id\n'
                 '                    AND sg2.role IS NULL\n'
                 '                    AND sg2.material_product_id = ssic.standard_item_id)';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'calculate_order_consumption_by_grade'
     AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade não existe — abortando';
  END IF;

  IF position(v_dead in v_def) = 0 THEN
    RAISE EXCEPTION
      'O ramo morto de sole_standard_items_consumption não bateu literalmente. '
      'A função foi reescrita desde 03/08/2026 — reveja o corpo à mão antes de aplicar.';
  END IF;

  v_new := replace(v_def, v_dead, '');

  -- Cinto e suspensório: se sobrar qualquer menção à tabela, o recorte foi parcial.
  IF position('sole_standard_items_consumption' in v_new) > 0 THEN
    RAISE EXCEPTION 'Ainda há referência a sole_standard_items_consumption após o recorte — abortando';
  END IF;

  EXECUTE v_new;

  RAISE NOTICE 'calculate_order_consumption_by_grade: fallback morto removido (% bytes → % bytes)',
    length(v_def), length(v_new);
END
$migration$;

COMMENT ON TABLE public.sole_standard_items_consumption IS
  'APOSENTADA em 07/06/2026, sem leitor desde 03/08/2026. Consumo de solado é '
  'sole_group_standard_items (por MODELO), editado em Solados → Consumo Padrão. '
  'As 42 linhas ficam como histórico; não escrever aqui.';
