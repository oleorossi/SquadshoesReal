-- OS de corte de cabedal passa a DEBITAR a napa do cabedal (spec §4.1)
-- =====================================================================
-- Antes: o botão "Gerar OS" do modal de Consumo de Materiais criava a
-- service_orders com quantity = pares e NÃO movimentava material nenhum. A
-- terceirizada levava a napa embora e o estoque continuava mostrando material
-- que fisicamente não estava mais na fábrica.
--
-- Decisão do dono (spec §4.1):
--   • ficha COM cabedal preenchido  → a OS debita a napa do cabedal, na
--     metragem do consumo daquele lote;
--   • modelo SÓ DE TIRAS (cabedal vazio) → sem débito de cabedal (o
--     comportamento atual já está certo nesse caso).
--
-- A metragem vem do motor de consumo que já existe
-- (calculate_order_consumption → ..._by_grade); esta migration NÃO inventa
-- cálculo novo, só filtra o componente 'Cabedal' das linhas devolvidas.
--
-- Por que criar a OS DENTRO da função em vez de debitar depois do insert:
-- atomicidade. Insert e débito na MESMA transação eliminam o estado meio-termo
-- "OS criada e material não debitado" (que a UI passaria a exibir como
-- "OS já gerada", escondendo o furo pra sempre).
--
-- Idempotência — três camadas:
--   1. pg_advisory_xact_lock por (PV, referência, cor): duas abas clicando
--      juntas serializam, a segunda enxerga a OS da primeira já commitada;
--   2. marcador estável [cc:<reference_id>:<cor normalizada>] no fim da
--      description: a checagem de OS existente não depende do nº de pares
--      (que muda quando o PV é editado) nem do texto livre;
--   3. marcador [os:<uuid da OS>] em stock_movements — mesmo padrão de
--      tg_debit_service_order_base, e é o que o estorno de cancelamento lê.
--
-- Estoque insuficiente: DEBITA O QUE TEM e avisa (não impede a OS). É o padrão
-- da casa para débito dirigido por OS — tg_debit_service_order_base faz
-- exatamente isso (LEAST(necessário, disponível) + RAISE WARNING + movimento
-- registrado com o valor clampado). debit_strap_stock/debit_packaging_for_order
-- levantam exceção porque rodam na liberação da OP, onde travar é o objetivo;
-- aqui travar só impediria a fábrica de emitir a OS por causa de um saldo mal
-- cadastrado — e o motivo de existir desta feature é justamente que o saldo
-- está errado. A falta volta no retorno da função e o app mostra o aviso.
--
-- ÚNICO caso que impede a OS: consumo com conversion_warning. Quando o material
-- de área não tem largura de bobina em component_sheets, get_material_conversion_info
-- devolve dm2_per_unit = 1 e avisa "Resultado pode estar 100x errado" — debitar
-- esse número zeraria a napa. Melhor não criar a OS e mandar cadastrar a largura.

CREATE OR REPLACE FUNCTION public.create_upper_cut_service_order(
  p_sale_order_id uuid,
  p_reference_id  uuid,
  p_color         text,
  p_contractor_id uuid,
  p_pairs         integer,
  p_description   text,
  p_order_number  text,
  p_unit_price    numeric DEFAULT 0,
  p_service_date  date    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $function$
DECLARE
  v_os_id      uuid := gen_random_uuid();
  v_color_norm text := lower(btrim(unaccent(COALESCE(p_color, ''))));
  v_tag        text;
  v_lock_key   bigint;
  v_existing   text;
  v_item       RECORD;
  v_line       jsonb;
  v_agg        jsonb := '{}'::jsonb;   -- product_id -> {required, unit, name, color}
  v_key        text;
  v_required   numeric;
  v_unit       text;
  v_prod       RECORD;
  v_debit      numeric;
  v_debited    jsonb := '[]'::jsonb;
  v_shortfall  jsonb := '[]'::jsonb;
  v_unresolved jsonb := '[]'::jsonb;
  v_sent       jsonb := '[]'::jsonb;
  v_blocked    text;
  v_desc       text;
  v_units      text[] := ARRAY[]::text[];
  v_names      text[] := ARRAY[]::text[];
  v_total      numeric := 0;
  v_number     text;
  v_note       text;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Unauthorized: user not approved';
  END IF;

  IF p_sale_order_id IS NULL OR p_reference_id IS NULL OR p_contractor_id IS NULL THEN
    RAISE EXCEPTION 'OS de corte de cabedal precisa de pedido de venda, referência e prestadora.';
  END IF;
  IF COALESCE(p_pairs, 0) <= 0 THEN
    RAISE EXCEPTION 'OS de corte de cabedal sem pares — nada a produzir.';
  END IF;
  IF COALESCE(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'OS de corte de cabedal sem descrição.';
  END IF;

  v_tag  := '[cc:' || p_reference_id::text || ':' || v_color_norm || ']';
  v_desc := btrim(p_description) || ' ' || v_tag;

  -- (1) Serializa cliques concorrentes no MESMO grupo (PV + ref + cor).
  v_lock_key := ('x' || substr(md5('upper_cut:' || p_sale_order_id::text || ':'
                || p_reference_id::text || ':' || v_color_norm), 1, 16))::bit(64)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- (2) OS já existe pra este PV + setor + ref + cor? Só cancelamento libera
  -- gerar de novo (e o cancelamento estorna o débito — ver trigger abaixo).
  SELECT so.order_number INTO v_existing
    FROM public.service_orders so
   WHERE so.sale_order_id = p_sale_order_id
     AND so.target_sector = 'corte_cabedal'
     AND lower(COALESCE(so.status, '')) NOT IN ('cancelado', 'cancelled', 'cancelada')
     AND strpos(COALESCE(so.description, ''), v_tag) > 0
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_exists',
      'order_number', v_existing,
      'debited', '[]'::jsonb, 'shortfall', '[]'::jsonb, 'unresolved', '[]'::jsonb);
  END IF;

  -- (3) Consumo pelo motor CANÔNICO, item a item (cada item do PV pode apontar
  -- uma variante de material diferente ⇒ napa de origem diferente).
  FOR v_item IN
    SELECT soi.quantity, soi.color, soi.material_variant_id
      FROM public.sale_order_items soi
     WHERE soi.sale_order_id = p_sale_order_id
       AND soi.reference_id  = p_reference_id
       AND lower(btrim(unaccent(COALESCE(soi.color, '')))) = v_color_norm
       AND COALESCE(soi.quantity, 0) > 0
  LOOP
    FOR v_line IN
      SELECT value FROM jsonb_array_elements(
        public.calculate_order_consumption(
          p_reference_id, v_item.quantity::numeric, v_item.color, NULL, v_item.material_variant_id))
    LOOP
      -- Só o cabedal. Forração, palmilha, solado e BOM continuam saindo na
      -- liberação da OP — esta OS é só o corte do cabedal.
      CONTINUE WHEN (v_line ->> 'component') IS DISTINCT FROM 'Cabedal';

      IF (v_line ->> 'product_id') IS NULL THEN
        -- Linha de diagnóstico do motor (material não resolve produto).
        v_unresolved := v_unresolved || jsonb_build_object(
          'product_name', v_line ->> 'product_name',
          'warning',      v_line ->> 'consumption_warning');
        CONTINUE;
      END IF;

      IF NULLIF(btrim(COALESCE(v_line ->> 'conversion_warning', '')), '') IS NOT NULL THEN
        v_blocked := v_line ->> 'conversion_warning';
        CONTINUE;
      END IF;

      v_required := COALESCE((v_line ->> 'required')::numeric, 0);
      CONTINUE WHEN v_required <= 0;

      v_key := v_line ->> 'product_id';
      v_agg := jsonb_set(v_agg, ARRAY[v_key], jsonb_build_object(
        'required', COALESCE((v_agg #>> ARRAY[v_key, 'required'])::numeric, 0) + v_required,
        'unit',     COALESCE(v_agg #>> ARRAY[v_key, 'unit'],  v_line ->> 'unit'),
        'name',     COALESCE(v_agg #>> ARRAY[v_key, 'name'],  v_line ->> 'product_name'),
        'color',    COALESCE(v_agg #>> ARRAY[v_key, 'color'], v_line ->> 'color')));
    END LOOP;
  END LOOP;

  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'Não dá pra debitar a napa do cabedal com segurança: % — a OS NÃO foi criada. Cadastre a largura da bobina em Materiais → Ficha de Componente → Dimensões e gere de novo.', v_blocked;
  END IF;

  -- (4) Resumo do material enviado (vai pro recibo/remessa da OS).
  FOR v_key IN SELECT jsonb_object_keys(v_agg) LOOP
    v_required := (v_agg #>> ARRAY[v_key, 'required'])::numeric;
    v_unit     := v_agg #>> ARRAY[v_key, 'unit'];
    v_sent := v_sent || jsonb_build_object(
      'product_id', v_key,
      'material',   v_agg #>> ARRAY[v_key, 'name'],
      'color',      COALESCE(NULLIF(v_agg #>> ARRAY[v_key, 'color'], ''), p_color),
      'meters',     round(v_required, 4),
      'unit',       v_unit,
      'origem',     'consumo de cabedal do lote');
    v_names := array_append(v_names, v_agg #>> ARRAY[v_key, 'name']);
    v_units := array_append(v_units, COALESCE(v_unit, ''));
    v_total := v_total + v_required;
  END LOOP;

  -- (5) Cria a OS. material_color fica NULL de propósito: ele entra na chave do
  -- índice único uq_service_order_per_pv_sector_material e preenchê-lo agora
  -- faria as OS novas deixarem de colidir com as antigas do mesmo PV+ref+cor.
  INSERT INTO public.service_orders (
    id, contractor_id, order_number, description, service_date, target_sector,
    sale_order_id, linked_sale_order_ids, quantity, unit_price, total_value, status,
    materials_sent, material_name, material_meters
  ) VALUES (
    v_os_id, p_contractor_id, COALESCE(NULLIF(btrim(p_order_number), ''), ''), v_desc,
    COALESCE(p_service_date, CURRENT_DATE), 'corte_cabedal',
    p_sale_order_id, ARRAY[p_sale_order_id], p_pairs,
    COALESCE(p_unit_price, 0),
    CASE WHEN COALESCE(p_unit_price, 0) > 0 THEN p_unit_price * p_pairs ELSE 0 END,
    'Pendente',
    CASE WHEN jsonb_array_length(v_sent) > 0 THEN v_sent ELSE NULL END,
    CASE WHEN array_length(v_names, 1) > 0 THEN array_to_string(v_names, ' + ') ELSE NULL END,
    -- Só soma metragem quando TODAS as linhas estão na mesma unidade; somar
    -- m com dm² daria um número que não quer dizer nada.
    CASE WHEN array_length(v_names, 1) > 0
              AND (SELECT count(DISTINCT t.u) FROM unnest(v_units) AS t(u)) = 1
         THEN round(v_total, 4) END
  )
  RETURNING order_number INTO v_number;

  -- (6) Débito. Clampa no disponível (padrão tg_debit_service_order_base) e
  -- registra o valor CLAMPADO no ledger — movimento e products.quantity nunca
  -- divergem.
  FOR v_key IN SELECT jsonb_object_keys(v_agg) LOOP
    v_required := (v_agg #>> ARRAY[v_key, 'required'])::numeric;
    v_unit     := COALESCE(v_agg #>> ARRAY[v_key, 'unit'], '');

    SELECT p.id, p.name, COALESCE(p.quantity, 0) AS quantity
      INTO v_prod
      FROM public.products p
     WHERE p.id = v_key::uuid
     FOR UPDATE;
    CONTINUE WHEN NOT FOUND;

    v_debit := LEAST(v_required, GREATEST(0, v_prod.quantity));

    IF v_prod.quantity < v_required THEN
      v_shortfall := v_shortfall || jsonb_build_object(
        'product_id', v_key, 'product_name', v_prod.name,
        'required',  round(v_required, 4),
        'available', round(GREATEST(0, v_prod.quantity), 4),
        'debited',   round(v_debit, 4),
        'unit',      v_unit);
      RAISE WARNING '[corte_cabedal] OS %: estoque insuficiente de "%" — disponível %, necessário % (debitando %)',
        v_number, v_prod.name, v_prod.quantity, v_required, v_debit;
    END IF;

    CONTINUE WHEN v_debit <= 0;

    UPDATE public.products
       SET quantity = GREATEST(0, quantity - v_debit), updated_at = now()
     WHERE id = v_prod.id;

    INSERT INTO public.stock_movements (
      product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
    ) VALUES (
      v_prod.id, 'out', v_debit, v_prod.quantity, GREATEST(0, v_prod.quantity - v_debit),
      'Debito Corte Cabedal ' || COALESCE(v_number, '?') || ' — napa "' || v_prod.name || '"'
        || CASE WHEN COALESCE(btrim(p_color), '') <> '' THEN ' (' || btrim(p_color) || ')' ELSE '' END
        || ' · ' || round(v_debit, 4) || ' ' || v_unit || ' para ' || p_pairs || ' pares'
        || CASE WHEN v_debit < v_required
                THEN ' (parcial de ' || round(v_required, 4) || ')' ELSE '' END
        || ' [os:' || v_os_id::text || ']',
      NULL   -- stock_movements.order_id referencia orders (OP); esta OS não tem OP
    );

    v_debited := v_debited || jsonb_build_object(
      'product_id', v_key, 'product_name', v_prod.name,
      'quantity', round(v_debit, 4), 'unit', v_unit);
  END LOOP;

  -- (7) Falta registrada na própria OS — o operador vê o furo no papel.
  IF jsonb_array_length(v_shortfall) > 0 THEN
    SELECT string_agg('⚠ Estoque insuficiente de ' || (s ->> 'product_name')
                      || ': necessário ' || (s ->> 'required') || ' ' || COALESCE(s ->> 'unit', '')
                      || ', debitado ' || (s ->> 'debited') || '.', E'\n')
      INTO v_note
      FROM jsonb_array_elements(v_shortfall) AS s;
    UPDATE public.service_orders
       SET notes = COALESCE(NULLIF(notes, '') || E'\n', '') || v_note
     WHERE id = v_os_id;
  END IF;

  RETURN jsonb_build_object(
    'status',            'created',
    'service_order_id',  v_os_id,
    'order_number',      v_number,
    'debited',           v_debited,
    'shortfall',         v_shortfall,
    'unresolved',        v_unresolved,
    -- sem linha de cabedal = modelo só de tiras (spec §4.1): OS criada, nada a debitar
    'upper_material',    jsonb_array_length(v_sent) > 0);
END;
$function$;

COMMENT ON FUNCTION public.create_upper_cut_service_order(uuid, uuid, text, uuid, integer, text, text, numeric, date)
IS 'Cria a OS de corte de cabedal e debita a napa do cabedal na MESMA transação (spec §4.1). Metragem pelo motor calculate_order_consumption, componente Cabedal. Idempotente por (PV, referência, cor) via advisory lock + marcador [cc:...] na descrição. Estoque curto debita o disponível e avisa; largura de bobina faltando (conversion_warning) impede a criação.';

REVOKE ALL ON FUNCTION public.create_upper_cut_service_order(uuid, uuid, text, uuid, integer, text, text, numeric, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_upper_cut_service_order(uuid, uuid, text, uuid, integer, text, text, numeric, date) TO authenticated;


-- Cancelar a OS devolve a napa ao estoque
-- ---------------------------------------
-- O trigger de estorno já sabia desfazer débito de OS artesanal lendo o
-- marcador [os:<id>] do ledger — o corpo serve inteiro pro corte de cabedal.
-- Só o portão de entrada exigia artisanal_recipe_id; sem esta abertura, cancelar
-- uma OS de corte deixaria a napa debitada pra sempre.
CREATE OR REPLACE FUNCTION public.tg_revert_service_order_base_on_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mov  RECORD;
  v_prev numeric;
BEGIN
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada')
     AND lower(COALESCE(OLD.status, '')) NOT IN ('cancelado','cancelled','rejeitada')
     AND (NEW.artisanal_recipe_id IS NOT NULL
          OR NEW.target_sector = 'corte_cabedal') THEN

    -- F4-2/F5-01: devolve EXATAMENTE o que o ledger debitou (net por produto).
    -- Sem gate em artisanal_output_meters: mesmo que os metros tenham sido
    -- editados/zerados depois do débito, o que manda é o movimento registrado.
    FOR v_mov IN
      SELECT sm.product_id,
             SUM(CASE WHEN sm.movement_type = 'out' THEN sm.quantity ELSE -sm.quantity END) AS net
        FROM public.stock_movements sm
       WHERE sm.product_id IS NOT NULL
         AND (
           (sm.movement_type = 'out'
             AND (sm.description LIKE '%[os:' || NEW.id || ']%'
                  OR (NEW.order_number IS NOT NULL
                      AND sm.description LIKE 'OS Artesanal ' || NEW.order_number || ' — base%')))
           OR
           (sm.movement_type = 'in'
             AND (sm.description LIKE 'Estorno OS%[os:' || NEW.id || ']%'
                  OR (NEW.order_number IS NOT NULL
                      AND sm.description LIKE 'Estorno OS ' || NEW.order_number || ' cancelada — base%')))
         )
       GROUP BY sm.product_id
      HAVING SUM(CASE WHEN sm.movement_type = 'out' THEN sm.quantity ELSE -sm.quantity END) > 0
    LOOP
      SELECT quantity INTO v_prev
        FROM public.products
       WHERE id = v_mov.product_id
       FOR UPDATE;
      IF NOT FOUND THEN
        CONTINUE;
      END IF;

      UPDATE public.products
         SET quantity = quantity + v_mov.net, updated_at = now()
       WHERE id = v_mov.product_id;

      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock, description, order_id
      ) VALUES (
        v_mov.product_id, 'in', v_mov.net, v_prev, v_prev + v_mov.net,
        'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada — base [os:' || NEW.id || ']',
        NULL
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;
