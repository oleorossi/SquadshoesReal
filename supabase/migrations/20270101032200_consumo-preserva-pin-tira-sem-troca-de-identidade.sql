-- Consumo: não apagar o pin da tira (Comprar pronto / variante / receita)
-- quando a ficha mudou só consumo, rótulo ou apresentação.
-- Spec: specs/tiras-redesenho.md → R-Consumo / R-PV.
--
-- Em PV Rascunho/Pendente, calculate_consumption_report_batch aplica a
-- estrutura da ficha por cima da linha do item (overlay de 20270101029200) e
-- removia strap_variant_id / recipe_id / finished_product_id do
-- strap_sourcing de TODA linha com drift. Mas o drift inclui consumo,
-- consumption_per_size, label, group_name — mudanças que não trocam a
-- identidade da tira. Resultado: a tira "Comprar pronto" (pin gravado por
-- 20270101031900) virava "Origem pendente"/"Tira sem cadastro" na tela de
-- consumo só porque o dono ajustou os cm/par na ficha.
--
-- Agora o pin só cai quando a IDENTIDADE muda (medida, tipo, base de
-- identidade, grupo de identidade, política/grupo de material) — o caso
-- original do comentário (TIRA CHATA → ELÁSTICO FORRADO).
--
-- Patch por substituição de texto do corpo vivo (mesmo padrão de 24000/28500);
-- falha alto se o trecho esperado não existir.

DO $migration$
DECLARE
  v_def text;
  v_old text := $old$        IF v_strap_sourcing ? v_line_id THEN
          v_strap_sourcing := pg_catalog.jsonb_set(
            v_strap_sourcing,
            ARRAY[v_line_id],
            (v_strap_sourcing -> v_line_id)
              - 'strap_variant_id'
              - 'recipe_id'
              - 'finished_product_id'
          );
        END IF;$old$;
  v_new text := $new$        -- Pin só cai quando a identidade da tira mudou (20270101032200).
        IF v_strap_sourcing ? v_line_id
           AND NOT EXISTS (
             SELECT 1
               FROM pg_catalog.jsonb_array_elements(
                      CASE
                        WHEN pg_catalog.jsonb_typeof(v_scope.strap_colors) = 'array'
                          THEN v_scope.strap_colors
                        ELSE '[]'::jsonb
                      END
                    ) orig(value)
              WHERE NULLIF(pg_catalog.btrim(orig.value ->> 'technical_strap_line_id'), '') = v_line_id
                AND NULLIF(pg_catalog.btrim(orig.value ->> 'measure_id'), '')
                      IS NOT DISTINCT FROM NULLIF(pg_catalog.btrim(v_line ->> 'measure_id'), '')
                AND NULLIF(pg_catalog.btrim(orig.value ->> 'strap_type_id'), '')
                      IS NOT DISTINCT FROM NULLIF(pg_catalog.btrim(v_line ->> 'strap_type_id'), '')
                AND COALESCE(NULLIF(pg_catalog.btrim(orig.value ->> 'identity_basis'), ''), 'reference_base')
                      IS NOT DISTINCT FROM COALESCE(NULLIF(pg_catalog.btrim(v_line ->> 'identity_basis'), ''), 'reference_base')
                AND NULLIF(pg_catalog.btrim(orig.value ->> 'identity_group_id'), '')
                      IS NOT DISTINCT FROM NULLIF(pg_catalog.btrim(v_line ->> 'identity_group_id'), '')
                AND COALESCE(NULLIF(pg_catalog.btrim(orig.value ->> 'material_mode'), ''), 'follow_reference')
                      IS NOT DISTINCT FROM COALESCE(NULLIF(pg_catalog.btrim(v_line ->> 'material_mode'), ''), 'follow_reference')
                AND NULLIF(pg_catalog.btrim(orig.value ->> 'material_group_id'), '')
                      IS NOT DISTINCT FROM NULLIF(pg_catalog.btrim(v_line ->> 'material_group_id'), '')
           ) THEN
          v_strap_sourcing := pg_catalog.jsonb_set(
            v_strap_sourcing,
            ARRAY[v_line_id],
            (v_strap_sourcing -> v_line_id)
              - 'strap_variant_id'
              - 'recipe_id'
              - 'finished_product_id'
          );
        END IF;$new$;
BEGIN
  v_def := pg_catalog.pg_get_functiondef(
    'public.calculate_consumption_report_batch(uuid[],uuid[])'::regprocedure
  );
  IF position('20270101032200' in v_def) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION 'calculate_consumption_report_batch: trecho do strip de pins não encontrado — corpo mudou, revise o patch';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;
