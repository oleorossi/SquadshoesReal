-- E2E ficha(12 setores) → PV → estoque → PCP. ROLLBACK via RAISE EXCEPTION.
-- workflow supabase-db-exec.yml strict=false
DO $e2e$
DECLARE
  c_sp120 uuid := '55a258a9-2578-4a29-ad5b-9b6fa0c168bf';
  c_i50   uuid := 'b85ac021-dfad-4f97-868d-1105c3451728';
  c_sec jsonb := '["Corte Fibra","Corte Forração","Corte Cabedal","Costura Palmilha","Costura Cabedal","Aviamento","Silk","Colagem","Montagem","Solagem","Acabamento","Expedição"]'::jsonb;
  c_warn text[] := ARRAY['limite_setor_anterior','material_nao_reservado','acima_do_total'];
  v_uid text; v_client uuid; v_color_sp text; v_color_i50 text;
  v_straps_sp jsonb; v_straps_i50 jsonb; v_size_sp text; v_size_i50 text;
  v_grade_sp jsonb; v_grade_i50 jsonb; v_qty int := 12;
  v_created jsonb; v_so uuid; v_promo jsonb; v_op_sp uuid; v_op_i50 uuid;
  v_point jsonb; v_n numeric; v_c int; v_stage text; v_price numeric;
  v_sole uuid; v_res_n int; v_ok boolean; fails int := 0; rep text := '';
BEGIN
  SELECT p.id::text INTO v_uid
    FROM profiles p JOIN user_roles ur ON ur.user_id = p.id
   WHERE COALESCE(p.approved,false) AND ur.role::text IN ('admin','gerente','comercial')
   ORDER BY CASE ur.role::text WHEN 'admin' THEN 0 WHEN 'gerente' THEN 1 ELSE 2 END LIMIT 1;
  IF v_uid IS NULL THEN
    SELECT id::text INTO v_uid FROM profiles WHERE COALESCE(approved,false) LIMIT 1;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_uid, true);

  SELECT id INTO v_client FROM clients ORDER BY created_at DESC LIMIT 1;

  SELECT soi.color INTO v_color_sp FROM sale_order_items soi
   WHERE soi.reference_id = c_sp120 AND COALESCE(soi.color,'') <> ''
   ORDER BY soi.created_at DESC LIMIT 1;
  IF v_color_sp IS NULL THEN v_color_sp := 'PRETO'; END IF;
  SELECT soi.color INTO v_color_i50 FROM sale_order_items soi
   WHERE soi.reference_id = c_i50 AND COALESCE(soi.color,'') <> ''
   ORDER BY soi.created_at DESC LIMIT 1;
  IF v_color_i50 IS NULL THEN v_color_i50 := v_color_sp; END IF;

  SELECT COALESCE(jsonb_agg(CASE WHEN COALESCE(s->>'color','')='' THEN s||jsonb_build_object('color', v_color_sp) ELSE s END),'[]'::jsonb)
    INTO v_straps_sp FROM technical_sheets ts,
         LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ts.strap_colors)='array' THEN ts.strap_colors ELSE '[]'::jsonb END) s
   WHERE ts.id = c_sp120;
  SELECT COALESCE(jsonb_agg(CASE WHEN COALESCE(s->>'color','')='' THEN s||jsonb_build_object('color', v_color_i50) ELSE s END),'[]'::jsonb)
    INTO v_straps_i50 FROM technical_sheets ts,
         LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(ts.strap_colors)='array' THEN ts.strap_colors ELSE '[]'::jsonb END) s
   WHERE ts.id = c_i50;

  SELECT g.key INTO v_size_sp FROM sale_order_items soi, LATERAL jsonb_each_text(COALESCE(soi.grade,'{}'::jsonb)) g
   WHERE soi.reference_id = c_sp120 AND COALESCE(NULLIF(g.value,''),'0')::numeric > 0
   ORDER BY soi.created_at DESC LIMIT 1;
  IF v_size_sp IS NULL THEN v_size_sp := '35'; END IF;
  v_grade_sp := jsonb_build_object(v_size_sp, v_qty);
  SELECT g.key INTO v_size_i50 FROM sale_order_items soi, LATERAL jsonb_each_text(COALESCE(soi.grade,'{}'::jsonb)) g
   WHERE soi.reference_id = c_i50 AND COALESCE(NULLIF(g.value,''),'0')::numeric > 0
   ORDER BY soi.created_at DESC LIMIT 1;
  IF v_size_i50 IS NULL THEN v_size_i50 := '25'; END IF;
  v_grade_i50 := jsonb_build_object(v_size_i50, v_qty);
  SELECT COALESCE(NULLIF(sale_price,0),1) INTO v_price FROM technical_sheets WHERE id = c_sp120;

  UPDATE technical_sheets SET production_sectors = c_sec WHERE id IN (c_sp120, c_i50);
  IF (SELECT jsonb_array_length(production_sectors) FROM technical_sheets WHERE id = c_sp120) = 12 THEN
    rep := rep || 'OK 1 12 setores canônicos na ficha' || E'\n';
  ELSE
    fails := fails+1; rep := rep || 'FAIL 1 setores' || E'\n';
  END IF;
  rep := rep || format('SP120 cor=%s tam=%s tiras=%s | I50 cor=%s tam=%s tiras=%s'||E'\n',
    v_color_sp, v_size_sp, jsonb_array_length(v_straps_sp), v_color_i50, v_size_i50, jsonb_array_length(v_straps_i50));

  SELECT rsc.sole_product_id INTO v_sole FROM resolve_sole_color(c_sp120, v_color_sp) rsc;
  IF v_sole IS NOT NULL THEN
    rep := rep || format('OK 1b solado ficha/cor=%s'||E'\n', v_sole);
  ELSE
    fails := fails+1; rep := rep || 'FAIL 1b resolve_sole_color NULL' || E'\n';
  END IF;

  BEGIN
    v_created := create_sale_order_atomic(
      jsonb_build_object('client_id', v_client, 'status', 'Rascunho',
        'notes', 'E2E rollback', 'packaging_mode', 'individual_amarrado',
        'nfe_required', false, 'order_type', 'carteira', 'total', v_price*v_qty*2),
      jsonb_build_array(
        jsonb_build_object('reference_id', c_sp120, 'color', v_color_sp, 'quantity', v_qty,
          'unit_price', v_price, 'grade', v_grade_sp, 'fichas', 1, 'strap_colors', v_straps_sp, 'observation', 'E2E SP120'),
        jsonb_build_object('reference_id', c_i50, 'color', v_color_i50, 'quantity', v_qty,
          'unit_price', v_price, 'grade', v_grade_i50, 'fichas', 1, 'strap_colors', v_straps_i50, 'observation', 'E2E I50')
      ),
      gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL\nFAIL 2 create_sale_order_atomic: %\n%', SQLERRM, rep;
  END;
  v_so := (v_created->>'order_id')::uuid;
  SELECT count(*) INTO v_c FROM sale_order_items WHERE sale_order_id = v_so;
  IF v_so IS NOT NULL AND v_c = 2 THEN
    rep := rep || format('OK 2 PV %s com 2 itens'||E'\n', v_so);
  ELSE
    fails := fails+1; rep := rep || format('FAIL 2 PV=%s itens=%s'||E'\n', v_so, v_c);
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL\n%', rep;
  END IF;

  BEGIN
    v_promo := promote_sale_order_to_production(v_so, 'Aprovado');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL\nFAIL 3 promote: %\n%', SQLERRM, rep;
  END;
  rep := rep || format('promote: %s'||E'\n', left(v_promo::text, 500));

  SELECT o.id INTO v_op_sp FROM orders o JOIN sale_order_items soi ON soi.id = o.sale_order_item_id
   WHERE o.sale_order_id = v_so AND soi.reference_id = c_sp120 AND o.status NOT IN ('Cancelada','Rascunho') LIMIT 1;
  SELECT o.id INTO v_op_i50 FROM orders o JOIN sale_order_items soi ON soi.id = o.sale_order_item_id
   WHERE o.sale_order_id = v_so AND soi.reference_id = c_i50 AND o.status NOT IN ('Cancelada','Rascunho') LIMIT 1;
  IF v_op_sp IS NULL OR v_op_i50 IS NULL THEN
    fails := fails+1; rep := rep || format('FAIL 3 OPs SP120=%s I50=%s'||E'\n', v_op_sp, v_op_i50);
    RAISE EXCEPTION E'ROLLBACK PROPOSITAL\n%', rep;
  END IF;
  rep := rep || format('OK 3 OPs SP120=%s I50=%s'||E'\n', v_op_sp, v_op_i50);

  SELECT count(*) INTO v_c FROM order_stages WHERE order_id = v_op_sp;
  IF v_c = 12 THEN rep := rep || 'OK 3b 12 estágios'||E'\n';
  ELSE fails := fails+1; rep := rep || format('FAIL 3b %s estágios: %s'||E'\n', v_c,
    (SELECT string_agg(stage_name,', ' ORDER BY stage_order) FROM order_stages WHERE order_id=v_op_sp)); END IF;

  SELECT count(*) INTO v_res_n FROM material_reservations WHERE order_id = v_op_sp;
  IF v_res_n > 0 THEN rep := rep || format('OK 3c reservas=%s'||E'\n', v_res_n);
  ELSE fails := fails+1; rep := rep || 'FAIL 3c sem reservas'||E'\n'; END IF;

  SELECT count(*), COALESCE(SUM(quantity_reserved),0) INTO v_c, v_n
    FROM material_reservations
   WHERE order_id = v_op_sp AND metadata->>'kind' IN ('sole_grade','sole_pending_grade');
  IF v_c >= 1 AND v_n > 0 THEN
    rep := rep || format('OK 3d solado reservas=%s qty=%s kind=%s'||E'\n', v_c, v_n,
      (SELECT string_agg(DISTINCT metadata->>'kind',',') FROM material_reservations WHERE order_id=v_op_sp AND metadata->>'kind' LIKE 'sole%'));
  ELSE
    fails := fails+1; rep := rep || format('FAIL 3d solado count=%s qty=%s'||E'\n', v_c, v_n);
  END IF;

  SELECT count(*) INTO v_c FROM material_reservations mr JOIN products p ON p.id=mr.product_id
   WHERE mr.order_id=v_op_sp AND (mr.metadata->>'kind' ILIKE '%strap%' OR lower(COALESCE(p.category,'')) LIKE '%tira%');
  IF jsonb_array_length(v_straps_sp) > 0 AND v_c = 0 THEN
    fails := fails+1; rep := rep || 'FAIL 3e tiras da ficha sem reserva'||E'\n';
  ELSE
    rep := rep || format('OK 3e reservas tira=%s linhas ficha=%s'||E'\n', v_c, jsonb_array_length(v_straps_sp));
  END IF;
  rep := rep || format('reservas: %s'||E'\n',
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('p', left(p.name,36), 'q', mr.quantity_reserved, 'st', mr.status, 'k', mr.metadata->>'kind')), '[]'::jsonb)
       FROM material_reservations mr JOIN products p ON p.id=mr.product_id WHERE mr.order_id=v_op_sp)::text);

  BEGIN
    PERFORM promote_sale_order_to_production(v_so, 'Em Produção');
  EXCEPTION WHEN OTHERS THEN
    fails := fails+1; rep := rep || format('FAIL 4 promote EP: %s'||E'\n', SQLERRM);
  END;
  IF EXISTS (SELECT 1 FROM orders WHERE id=v_op_sp AND status='Em Produção') THEN
    rep := rep || 'OK 4 OP em produção'||E'\n';
  ELSE
    fails := fails+1; rep := rep || format('FAIL 4 status=%s'||E'\n', (SELECT status FROM orders WHERE id=v_op_sp));
  END IF;

  FOREACH v_stage IN ARRAY ARRAY['Corte Fibra','Corte Forração','Corte Cabedal','Costura Palmilha','Costura Cabedal','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento','Expedição']
  LOOP
    BEGIN
      v_point := apontar_producao_setor(v_op_sp, v_stage, v_qty, NULL, 'E2E full', true, c_warn);
      v_ok := COALESCE((v_point->>'success')::boolean,false);
      IF v_ok AND COALESCE((v_point->>'quantity_processed')::int,0)=v_qty THEN
        rep := rep || format('OK 5 %s'||E'\n', v_stage);
      ELSE
        fails := fails+1; rep := rep || format('FAIL 5 %s %s'||E'\n', v_stage, left(v_point::text,220));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      fails := fails+1; rep := rep || format('FAIL 5 %s EXC %s'||E'\n', v_stage, SQLERRM);
    END;
  END LOOP;
  SELECT count(*) FILTER (WHERE status='concluido' AND quantity_processed>=v_qty) INTO v_c FROM order_stages WHERE order_id=v_op_sp;
  IF v_c=12 THEN rep := rep || 'OK 5z 12/12 concluídos'||E'\n';
  ELSE fails := fails+1; rep := rep || format('FAIL 5z %s/12 %s'||E'\n', v_c,
    (SELECT jsonb_agg(jsonb_build_object('s',stage_name,'st',status,'q',quantity_processed) ORDER BY stage_order) FROM order_stages WHERE order_id=v_op_sp)::text); END IF;

  FOREACH v_stage IN ARRAY ARRAY['Corte Fibra','Corte Forração','Corte Cabedal','Costura Palmilha','Costura Cabedal','Aviamento']
  LOOP
    BEGIN
      v_point := apontar_producao_setor(v_op_i50, v_stage, 4, NULL, 'E2E partial', true, c_warn);
      IF COALESCE((v_point->>'success')::boolean,false) THEN rep := rep || format('OK 6 %s=4'||E'\n', v_stage);
      ELSE fails := fails+1; rep := rep || format('FAIL 6 %s %s'||E'\n', v_stage, left(v_point::text,180)); END IF;
    EXCEPTION WHEN OTHERS THEN
      fails := fails+1; rep := rep || format('FAIL 6 %s EXC %s'||E'\n', v_stage, SQLERRM);
    END;
  END LOOP;
  FOREACH v_stage IN ARRAY ARRAY['Silk','Colagem']
  LOOP
    BEGIN
      v_point := apontar_producao_setor(v_op_i50, v_stage, 0, NULL, 'E2E skip', true, c_warn);
      IF COALESCE((v_point->>'success')::boolean,false) AND COALESCE((v_point->>'quantity_processed')::int,-1)=0 THEN
        rep := rep || format('OK 6b skip %s'||E'\n', v_stage);
      ELSE fails := fails+1; rep := rep || format('FAIL 6b skip %s %s'||E'\n', v_stage, left(v_point::text,180)); END IF;
    EXCEPTION WHEN OTHERS THEN
      fails := fails+1; rep := rep || format('FAIL 6b skip %s EXC %s'||E'\n', v_stage, SQLERRM);
    END;
  END LOOP;

  BEGIN
    v_point := apontar_producao_setor(v_op_i50, 'Montagem', 12, NULL, 'E2E after skip', false, NULL);
    IF COALESCE((v_point->>'needs_confirmation')::boolean,false) AND v_point::text ILIKE '%limite_setor_anterior%' THEN
      rep := rep || 'OK 6c Montagem 12 bloqueada (inbound real)'||E'\n';
    ELSIF COALESCE((v_point->>'success')::boolean,false) AND COALESCE((v_point->>'quantity_processed')::int,0)>=12 THEN
      fails := fails+1; rep := rep || 'FAIL 6c skip Colagem ainda entrega total da OP'||E'\n';
    ELSE
      rep := rep || format('OK 6c Montagem não passou 12: %s'||E'\n', left(v_point::text,200));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    rep := rep || format('OK 6c Montagem recusou 12 (%s)'||E'\n', SQLERRM);
  END;
  BEGIN
    v_point := apontar_producao_setor(v_op_i50, 'Montagem', 4, NULL, 'E2E inbound 4', true, c_warn);
    IF COALESCE((v_point->>'success')::boolean,false) AND COALESCE((v_point->>'quantity_processed')::int,0)=4 THEN
      rep := rep || 'OK 6d Montagem 4 (inbound)'||E'\n';
    ELSE fails := fails+1; rep := rep || format('FAIL 6d Montagem 4 %s'||E'\n', left(v_point::text,200)); END IF;
  EXCEPTION WHEN OTHERS THEN
    fails := fails+1; rep := rep || format('FAIL 6d EXC %s'||E'\n', SQLERRM);
  END;

  IF fails=0 THEN rep := E'\n===== E2E VERDE =====\n'||rep;
  ELSE rep := format(E'\n===== E2E FALHOU (%s) =====\n', fails)||rep; END IF;
  RAISE EXCEPTION E'ROLLBACK PROPOSITAL — nada persistiu.\n%', rep;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'ROLLBACK PROPOSITAL%' THEN RAISE; END IF;
  RAISE EXCEPTION E'ROLLBACK PROPOSITAL — nada persistiu.\nFAIL UNCAUGHT: %\n%', SQLERRM, rep;
END;
$e2e$;
