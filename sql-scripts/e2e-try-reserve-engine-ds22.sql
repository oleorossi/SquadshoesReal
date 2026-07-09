-- ============================================================================
-- E2E: try_reserve_materials deriva demanda do motor unificado (DS22)
-- Alvo: migration 20260910150000 (aplicada). Receita da auditoria
-- specs/auditoria-componentes-por-cor.md, versão SEM risco de restauração:
--
--   TRANSAÇÃO ÚNICA COM ROLLBACK GARANTIDO — o bloco termina SEMPRE em
--   RAISE EXCEPTION carregando o relatório completo. Nada persiste: OPs de
--   teste, reservas, OCs auto-geradas, top-ups de estoque e audit_logs são
--   todos desfeitos pelo abort. O "erro" no final é PROPOSITAL: leia o
--   relatório na mensagem da exceção (procure por "E2E VERDE" / "E2E FALHOU").
--
-- Uso: workflow supabase-db-exec.yml com strict=false, ou MCP / SQL Editor.
-- ============================================================================
DO $e2e$
DECLARE
  c_sheet   constant uuid := '03c31427-5bca-4a9c-b01b-2f7c62aa5219'; -- DS22
  c_jwt_sub constant text := '49371f4d-641f-466d-be26-686ef57743ec'; -- usuário aprovado
  v_perola uuid; v_turq uuid; v_marrom uuid; v_napa_ow uuid; v_napa_cap uuid;
  v_size text; v_grade jsonb; v_op1 uuid; v_op2 uuid;
  v_res jsonb; v_sole uuid;
  v_n numeric; v_c int;
  rep text := ''; fails int := 0;
BEGIN
  -- is_approved_user() lê auth.uid() do claim; is_local=true → morre no rollback
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c_jwt_sub)::text, true);

  -- SKUs do teste (ids parciais da receita resolvidos por prefixo)
  SELECT id INTO v_perola   FROM products WHERE id = 'a5588550-7c46-47c0-9389-0684cd1101f0';
  SELECT id INTO v_turq     FROM products WHERE id::text LIKE '5c7fe145%' LIMIT 1;
  SELECT id INTO v_marrom   FROM products WHERE id::text LIKE '85dbb27a%' LIMIT 1;
  SELECT id INTO v_napa_ow  FROM products WHERE id::text LIKE '84ba12fe%' LIMIT 1;
  SELECT id INTO v_napa_cap FROM products WHERE id::text LIKE '1d3bc95c%' LIMIT 1;
  IF v_perola IS NULL OR v_turq IS NULL OR v_marrom IS NULL OR v_napa_ow IS NULL OR v_napa_cap IS NULL THEN
    RAISE EXCEPTION 'E2E ABORTADO: SKUs da receita não encontrados (perola=%, turq=%, marrom=%, napa_ow=%, napa_cap=%)',
      v_perola, v_turq, v_marrom, v_napa_ow, v_napa_cap;
  END IF;

  -- Grade de 12 pares num tamanho que EXISTE no per-size da ficha
  SELECT kv.key INTO v_size
    FROM technical_sheets ts,
         jsonb_each_text(COALESCE(ts.lining_consumption_per_size, '{}'::jsonb)) kv
   WHERE ts.id = c_sheet
     AND kv.value ~ '^[0-9]+(\.[0-9]+)?$' AND kv.value::numeric > 0
   ORDER BY kv.key LIMIT 1;
  IF v_size IS NULL THEN
    RAISE EXCEPTION 'E2E ABORTADO: DS22 sem lining_consumption_per_size > 0 (pré-condição)';
  END IF;
  v_grade := jsonb_build_object(v_size, 12);
  rep := rep || format(E'grade de teste: %s\n', v_grade::text);

  -- Top-up temporário (SKUs têm reserved_stock >> quantity em produção;
  -- sem isso a reserva sai 0 e a prova positiva é impossível). Rollback desfaz.
  UPDATE products SET quantity = 99999
   WHERE id IN (v_perola, v_turq, v_marrom, v_napa_ow, v_napa_cap);

  -- ═══ CASO 1: cor CONFIGURADA (OFF WHITE → lista por cor) ═══
  INSERT INTO orders (reference_id, quantity, color, grade, status, notes)
  VALUES (c_sheet, 12, 'OFF WHITE', v_grade, 'Reservado', 'TESTE E2E try_reserve — rollback automático')
  RETURNING id INTO v_op1;

  v_res := public.try_reserve_materials(v_op1, c_sheet, 12, 'OFF WHITE');
  rep := rep || format(E'\n[OFF WHITE] status=%s reservas=%s ocs=%s\n',
    v_res->>'status', jsonb_array_length(v_res->'reservations'), jsonb_array_length(v_res->'purchase_orders'));

  -- 1a. componente da COR (REDONDO PEROLA) = 96 un
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op1 AND product_id = v_perola;
  IF round(v_n,4) = 96 THEN rep := rep || 'OK  1a REDONDO PEROLA = 96' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1a REDONDO PEROLA esperado 96, veio %s\n', v_n); END IF;

  -- 1b. componentes do PADRÃO (ABS) NÃO reservados na cor configurada
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op1 AND product_id IN (v_turq, v_marrom);
  IF round(v_n,4) = 0 THEN rep := rep || 'OK  1b ABS padrão = 0' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1b ABS padrão esperado 0, veio %s\n', v_n); END IF;

  -- 1c. NAPA per-size reservada (bug antigo: ZERO; inflado sem conversão: ~60 dm²)
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op1 AND product_id = v_napa_ow;
  IF v_n > 0.2 AND v_n < 5 THEN rep := rep || format(E'OK  1c NAPA OFF WHITE = %s m (esperado ~1,03)\n', round(v_n,4));
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1c NAPA OFF WHITE fora da banda (0,2–5 m): %s\n', v_n); END IF;

  -- 1d. solado: exatamente 1 reserva pendente de 12 pares, do solado RESOLVIDO
  SELECT rsc.sole_product_id INTO v_sole FROM resolve_sole_color(c_sheet, 'OFF WHITE') rsc;
  SELECT count(*), COALESCE(SUM(quantity_reserved),0) INTO v_c, v_n
    FROM material_reservations
   WHERE order_id = v_op1 AND metadata->>'kind' = 'sole_pending_grade' AND product_id = v_sole;
  IF v_c = 1 AND round(v_n,4) = 12 THEN rep := rep || 'OK  1d solado resolvido: 1 reserva pendente de 12' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1d solado pendente esperado 1×12, veio %s×%s\n', v_c, v_n); END IF;

  -- 1e. ZERO reservas em qualquer OUTRO produto-solado (o bug reservava 5 do BOM)
  SELECT count(*) INTO v_c
    FROM material_reservations mr JOIN products p ON p.id = mr.product_id
   WHERE mr.order_id = v_op1 AND mr.product_id <> v_sole
     AND (LOWER(COALESCE(p.category,'')) LIKE '%solado%' OR p.sole_classification IS NOT NULL);
  IF v_c = 0 THEN rep := rep || 'OK  1e zero solados do BOM reservados' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1e %s reservas de solado extra (bug do BOM voltou?)\n', v_c); END IF;

  -- 1f. interop: hybrid faz idempotent_skip; debit_sole(force_soft) troca a
  --     pendência por sole_grade SEM duplicar
  v_res := public.hybrid_debit_stock_for_order(c_sheet, 12, 'OFF WHITE', v_op1, v_grade, true);
  IF COALESCE((v_res->>'idempotent_skip')::boolean, false) THEN rep := rep || 'OK  1f hybrid_debit idempotent_skip (comportamento documentado)' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1f hybrid_debit não deu idempotent_skip: %s\n', v_res::text); END IF;
  PERFORM public.debit_sole_stock_by_grade(c_sheet, v_op1, 'OFF WHITE', v_grade, true);
  SELECT count(*) INTO v_c FROM material_reservations
   WHERE order_id = v_op1 AND product_id = v_sole AND status = 'reserved';
  IF v_c = 1 THEN rep := rep || 'OK  1f debit_sole(force_soft) manteve 1 reserva de solado (sem duplicar)' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 1f reservas de solado após debit_sole: %s (esperado 1)\n', v_c); END IF;

  -- ═══ CASO 2: cor SEM configuração (CAPUCCINO → fallback pro padrão) ═══
  INSERT INTO orders (reference_id, quantity, color, grade, status, notes)
  VALUES (c_sheet, 12, 'CAPUCCINO', v_grade, 'Reservado', 'TESTE E2E try_reserve — rollback automático')
  RETURNING id INTO v_op2;

  v_res := public.try_reserve_materials(v_op2, c_sheet, 12, 'CAPUCCINO');
  rep := rep || format(E'\n[CAPUCCINO] status=%s reservas=%s ocs=%s\n',
    v_res->>'status', jsonb_array_length(v_res->'reservations'), jsonb_array_length(v_res->'purchase_orders'));

  -- 2a. padrão: ABS TURQUEZA 96 + ABS MARROM 96
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op2 AND product_id = v_turq;
  IF round(v_n,4) = 96 THEN rep := rep || 'OK  2a ABS TURQUEZA = 96' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 2a ABS TURQUEZA esperado 96, veio %s\n', v_n); END IF;
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op2 AND product_id = v_marrom;
  IF round(v_n,4) = 96 THEN rep := rep || 'OK  2a ABS MARROM = 96' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 2a ABS MARROM esperado 96, veio %s\n', v_n); END IF;

  -- 2b. lista por cor de OUTRA cor não vaza
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op2 AND product_id = v_perola;
  IF round(v_n,4) = 0 THEN rep := rep || 'OK  2b REDONDO PEROLA = 0 no fallback' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 2b PEROLA esperado 0 no fallback, veio %s\n', v_n); END IF;

  -- 2c. NAPA CAPUCCINO per-size reservada
  SELECT COALESCE(SUM(quantity_reserved),0) INTO v_n FROM material_reservations WHERE order_id = v_op2 AND product_id = v_napa_cap;
  IF v_n > 0.2 AND v_n < 5 THEN rep := rep || format(E'OK  2c NAPA CAPUCCINO = %s m (esperado ~1,03)\n', round(v_n,4));
  ELSE fails := fails+1; rep := rep || format(E'FAIL 2c NAPA CAPUCCINO fora da banda (0,2–5 m): %s\n', v_n); END IF;

  -- 2d. 1 reserva pendente de solado, zero extras
  SELECT count(*) INTO v_c FROM material_reservations WHERE order_id = v_op2 AND metadata->>'kind' = 'sole_pending_grade';
  IF v_c = 1 THEN rep := rep || 'OK  2d 1 reserva pendente de solado' || E'\n';
  ELSE fails := fails+1; rep := rep || format(E'FAIL 2d reservas pendentes de solado: %s (esperado 1)\n', v_c); END IF;

  IF fails = 0 THEN
    rep := E'\n===== E2E VERDE (todas as checagens passaram) =====\n' || rep;
  ELSE
    rep := format(E'\n===== E2E FALHOU (%s checagens) =====\n', fails) || rep;
  END IF;
  RAISE EXCEPTION E'ROLLBACK PROPOSITAL DO E2E — nada persistiu.\n%', rep;
END;
$e2e$;
