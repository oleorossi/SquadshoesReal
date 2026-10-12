-- ═══════════════════════════════════════════════════════════════════════════
-- EMPENHO DO PV — napa direta deixa de ser censurada por ser base de tira
-- ═══════════════════════════════════════════════════════════════════════════
-- Sintoma (PV-00195, medido em 11/10/2026): o motor de consumo devolve 3 linhas
-- "Forração Palmilha" de 14,0583 m (NAPA SOFT OFF WHITE, GLOW METALIC COBRE,
-- GLOW METALIC CHAMPAGNE), mas nenhuma delas tem reserva viva. As últimas foram
-- canceladas com a nota " · recompute sem demanda".
--
-- Causa: `sale_order_material_demand_lines` montava `v_strap` com
-- base_product_id + finished_product_id + purchase_product_id de toda demanda
-- de tira corrente do PV (só 'cancelled' ficava de fora, então 'suspended'
-- contava) e descartava QUALQUER linha de consumo cujo SKU casasse — comparando
-- identidade de produto, sem olhar o componente. Nesses 3 itens a napa-base da
-- tira é o MESMO SKU da forração da palmilha, então a forração sumia junto.
-- Depois, `commit_sale_order_material_demand` cancelava a pv_commitment aberta
-- desses produtos, e `hybrid_debit_stock_for_order` recriava a da OP corrente a
-- cada resync — um flip-flop que terminava em zero empenho e zero falta.
--
-- Por que a exclusão inteira sai, em vez de isentar certos componentes:
--
--  1. Medido no banco inteiro: 112 linhas descartadas por essa regra, TODAS por
--     `base_product_id`, e todas são napa direta (111 Forração Palmilha + 1
--     Cabedal). Por `finished_product_id` o casamento é ZERO — nenhuma linha de
--     consumo jamais bateu com SKU de tira acabada. A regra tem 112 falsos
--     positivos e nenhum verdadeiro positivo.
--  2. Ela nunca foi necessária: `calculate_order_consumption_by_grade` não
--     emite a parcela de tira (a fronteira está escrita no corpo de
--     `compute_materials_per_pv`). Não há linha de tira para esta função filtrar.
--  3. Isentar por NOME de componente seria frágil: o motor emite 9 rótulos, e
--     uma lista de permissão deixaria BOM, Componente Direto e Palmilha ainda
--     censurados — silenciosamente, como hoje.
--  4. Compatibilidade com a virada de tira (20270101037200, ainda não aplicada):
--     lá o PV passa a debitar o SKU da tira pronta. Manter a exclusão por
--     `finished_product_id` passaria a censurar exatamente a linha que a virada
--     quer empenhar.
--
-- O que NÃO muda, de propósito:
--  · A exclusão do Solado (`v_comp = 'Solado'` / primary_sole / variant_sole)
--    continua: solado tem caminho próprio por numeração.
--  · A napa da tira continua FORA do empenho do PV (decisão do dono, 11/10/2026:
--    tira é material de estoque e a napa dela é assunto do Ateliê). Esta
--    migration não a reintroduz — ela só impede que a tira apague a napa direta
--    do mesmo SKU. As reservas de tira seguem marcadas por
--    `sale_order_strap_demand_id` / `strap_variant_id` / `source` começando em
--    'strap_engine_', que é por onde os outros pontos já as reconhecem.
--  · Não há risco de empenhar a mesma napa duas vezes: `allocate_reservation_partial`
--    faz `LEAST(v_want, GREATEST(v_phys - v_others, 0))`, e `v_others` soma as
--    demais reservas vivas do produto. Verificado com fixture no PV-00195.
--
-- ⚠ Com estoque físico 0 (caso do PV-00195) o resultado correto é
--   `quantity_reserved = 0` e `quantity_short = 14,0583` — pendência VISÍVEL,
--   não reserva. Não é sinal de que a correção falhou.
--
-- O corpo abaixo é cópia do corpo VIVO (pg_get_functiondef em 11/10/2026) com
-- `v_strap` e o `IF v_pid = ANY (v_strap)` removidos. Nenhuma outra linha mudou.

CREATE OR REPLACE FUNCTION public.sale_order_material_demand_lines(p_sale_order_id uuid)
 RETURNS TABLE(product_id uuid, required numeric, component text, source text, sale_order_item_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_grade jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_pid uuid;
  v_req numeric;
  v_comp text;
  v_src text;
BEGIN
  FOR v_item IN
    SELECT *
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id IS NOT NULL
       AND soi.production_excluded_at IS NULL
  LOOP
    SELECT COALESCE(
             jsonb_object_agg(
               g.key,
               (
                 COALESCE(NULLIF(g.value, '')::numeric, 0)
                 * GREATEST(COALESCE(v_item.fichas, 1), 1)
               )::numeric
             ),
             '{}'::jsonb
           )
      INTO v_grade
      FROM jsonb_each_text(COALESCE(v_item.grade, '{}'::jsonb)) g
     WHERE COALESCE(NULLIF(g.value, '')::numeric, 0) > 0;

    IF v_grade IS NULL OR v_grade = '{}'::jsonb THEN
      v_grade := COALESCE(v_item.grade, '{}'::jsonb);
    END IF;

    IF v_grade IS NOT NULL AND v_grade <> '{}'::jsonb THEN
      v_lines := public.calculate_order_consumption_by_grade(
        v_item.reference_id,
        v_grade,
        v_item.color,
        v_item.material_variant_id
      );
    ELSE
      v_lines := public.calculate_order_consumption(
        v_item.reference_id,
        COALESCE(v_item.quantity, 0),
        v_item.color,
        NULL,
        v_item.material_variant_id
      );
    END IF;

    IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' THEN
      CONTINUE;
    END IF;

    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      IF (v_line ->> 'matched_by') = 'color_mismatch' THEN
        CONTINUE;
      END IF;
      v_pid := NULLIF(v_line ->> 'product_id', '')::uuid;
      IF v_pid IS NULL THEN
        CONTINUE;
      END IF;
      v_comp := COALESCE(v_line ->> 'component', '');
      v_src := COALESCE(v_line ->> 'source', '');
      IF v_comp = 'Solado' OR v_src IN ('primary_sole', 'variant_sole') THEN
        CONTINUE;
      END IF;
      v_req := COALESCE(NULLIF(v_line ->> 'required', '')::numeric, 0);
      IF v_req <= 0 THEN
        CONTINUE;
      END IF;

      product_id := v_pid;
      required := v_req;
      component := v_comp;
      source := v_src;
      sale_order_item_id := v_item.id;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.sale_order_material_demand_lines(uuid) IS
  'Explode o consumo do PV em linhas de demanda de material. Exclui apenas o '
  'Solado (caminho próprio por numeração). NÃO excluir linha por o SKU ser '
  'base/compra de uma demanda de tira: isso apagava a napa direta (cabedal, '
  'forração, forração de palmilha, fachete) quando a tira usa o mesmo SKU — '
  '112 falsos positivos e zero verdadeiros no banco (mig 20270101037300).';
