-- ════════════════════════════════════════════════════════════════════════════
-- Cor nas linhas de COMPONENTE DIRETO e ITEM PADRÃO (SOLADO)
-- ════════════════════════════════════════════════════════════════════════════
-- Problema: `calculate_order_consumption_by_grade` monta as linhas de
-- 'Componente Direto' (technical_sheet_component_colors E direct_components) com
-- um jsonb_build_object que NÃO tem a chave 'color'. A linha de
-- 'Item padrão (solado)' tem, mas hardcoded em ''. Resultado: todo componente
-- avulso — binóculo, ABS, rebite, fivela — chega sem cor em quem lê esse JSON.
--
-- Sintoma (PV-00147): "Binóculo 10mm" e "Binóculo 10mm Strass" são OURO LIGHT no
-- cadastro, mas apareciam com cor "—" na Ordem de Compra enviada ao fornecedor —
-- justamente o dado que evita o fornecedor separar o acabamento errado.
--
-- O motor TS canônico (`src/lib/orderConsumption.ts`) SEMPRE resolveu essa cor
-- (`prod.color || '—'` no caminho de direct components). Quem estava fora de
-- paridade era o SQL. Esta migration fecha a divergência.
--
-- Quem lê `line->>'color'`: `compute_materials_per_pv` (canal Compras por Pedido)
-- e `get_wave_material_needs` (MRP/ondas) — ambos só AGRUPAM por
-- (product_id, color). Como o product_id continua sendo a chave de identidade, a
-- cor preenchida não redireciona nada; só passa a descrever a linha corretamente.
-- Nenhuma função de DÉBITO ou RESERVA lê essa chave (try_reserve_materials,
-- hybrid_debit_stock_for_order, record_order_consumption e calculate_order_cost*
-- apenas ESCREVEM cor em metadados, a partir de p_color) — verificado por
-- varredura em pg_get_functiondef antes desta migration.
--
-- Efeito colateral BOM: antes, um mesmo produto que entrasse por direct_components
-- (color '') e por outro caminho (color preenchida) virava DUAS linhas no
-- agrupamento (product_id, color). Agora converge numa só.
--
-- ── Por que patch de texto e não CREATE OR REPLACE completo ──────────────────
-- O corpo da função tem ~32 mil caracteres e concentra regras críticas (solado,
-- fachete, palmilha pronta, supressão de forro-cabedal, variantes). Retranscrever
-- tudo pra mudar 7 trechos é o tipo de coisa em que um erro de transcrição passa
-- despercebido. Aqui a função é lida do catálogo, recebe substituições EXATAS e é
-- reexecutada — cada substituição falha alto se o trecho esperado não existir
-- mais. Idempotente: se já tem `v_std_color`, sai sem fazer nada.
-- ════════════════════════════════════════════════════════════════════════════

DO $mig$
DECLARE
  v_def    text;
  v_new    text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'calculate_order_consumption_by_grade';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_order_consumption_by_grade nao existe — migration fora de ordem';
  END IF;

  IF position('v_std_color text;' IN v_def) > 0 THEN
    RAISE NOTICE 'Cor em Componente Direto ja aplicada — nada a fazer.';
    RETURN;
  END IF;

  v_new := v_def;

  -- (1) declara a variável que carrega a cor do item padrão de solado
  v_before := v_new;
  v_new := replace(v_new,
    '  v_prod_unit text; v_std_unit text; v_converted numeric;',
    '  v_prod_unit text; v_std_unit text; v_converted numeric; v_std_color text;');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 1/7 (DECLARE v_std_color) nao casou'; END IF;

  -- (2) item padrão (solado): busca a cor junto do resto do cadastro
  v_before := v_new;
  v_new := replace(v_new,
    '    SELECT name, quantity, category, unit INTO v_acc_name, v_acc_avail, v_row_cat_norm, v_prod_unit FROM products WHERE id = v_key::uuid;',
    '    SELECT name, quantity, category, unit, color INTO v_acc_name, v_acc_avail, v_row_cat_norm, v_prod_unit, v_std_color FROM products WHERE id = v_key::uuid;');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 2/7 (SELECT item padrao) nao casou'; END IF;

  -- (3) item padrão (solado): emite a cor real no lugar do '' hardcoded
  v_before := v_new;
  v_new := replace(v_new,
    E'        ''color'', '''', ''consumption_per_unit'', ROUND(COALESCE(v_converted, v_acc_required) / NULLIF(v_total_qty, 0), 4),',
    E'        ''color'', COALESCE(v_std_color, ''''), ''consumption_per_unit'', ROUND(COALESCE(v_converted, v_acc_required) / NULLIF(v_total_qty, 0), 4),');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 3/7 (color do item padrao) nao casou'; END IF;

  -- (4) componentes POR COR (technical_sheet_component_colors): traz p.color
  v_before := v_new;
  v_new := replace(v_new,
    E'             p.category AS category, p.unit AS unit\n        FROM technical_sheet_component_colors tcc',
    E'             p.category AS category, p.unit AS unit, p.color AS color\n        FROM technical_sheet_component_colors tcc');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 4/7 (SELECT component_colors) nao casou'; END IF;

  -- (5) componentes POR COR: emite a cor na linha
  v_before := v_new;
  v_new := replace(v_new,
    E'        ''component'', ''Componente Direto'', ''product_id'', v_row.pid, ''product_name'', v_row.pname,\n        ''consumption_per_unit'', v_row.qpu, ''required'', v_required,',
    E'        ''component'', ''Componente Direto'', ''product_id'', v_row.pid, ''product_name'', v_row.pname,\n        ''color'', COALESCE(v_row.color, ''''),\n        ''consumption_per_unit'', v_row.qpu, ''required'', v_required,');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 5/7 (color component_colors) nao casou'; END IF;

  -- (6) direct_components (fallback sem lista por cor): traz p.color
  v_before := v_new;
  v_new := replace(v_new,
    E'                 p.category AS category, p.unit AS unit\n            INTO v_row FROM products p WHERE p.id = v_pid;',
    E'                 p.category AS category, p.unit AS unit, p.color AS color\n            INTO v_row FROM products p WHERE p.id = v_pid;');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 6/7 (SELECT direct_components) nao casou'; END IF;

  -- (7) direct_components: emite a cor na linha
  v_before := v_new;
  v_new := replace(v_new,
    E'              ''component'', ''Componente Direto'', ''product_id'', v_pid, ''product_name'', v_row.name,\n              ''consumption_per_unit'', (v_item ->> ''quantity'')::numeric, ''required'', v_required,',
    E'              ''component'', ''Componente Direto'', ''product_id'', v_pid, ''product_name'', v_row.name,\n              ''color'', COALESCE(v_row.color, ''''),\n              ''consumption_per_unit'', (v_item ->> ''quantity'')::numeric, ''required'', v_required,');
  IF v_new = v_before THEN RAISE EXCEPTION 'patch 7/7 (color direct_components) nao casou'; END IF;

  EXECUTE v_new;
  RAISE NOTICE 'calculate_order_consumption_by_grade: cor adicionada em Componente Direto e Item padrao (solado).';
END
$mig$;
