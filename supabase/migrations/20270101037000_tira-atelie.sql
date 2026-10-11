-- tira_atelie_20270101037000
--
-- specs/tira-material-de-estoque.md R16/R17/R18/R20: a FALTA de tira de origem
-- Fábrica ou Prestador aparece na aba "Tiras" do Ateliê, por PV.
--
--   Fábrica   → "Produzido": baixa a napa, dá entrada na tira (custo = napa ÷ metros)
--               e a quitação genérica (trg_cover_commitments_on_stock_in) cobre a falta.
--   Prestador → "Gerar OC da napa e OS": OC da napa (pendente, entrega no prestador) +
--               OS de mão de obra (Pendente). Nenhuma das duas mexe no estoque.
--               "Recebido": entra a tira (custo = (napa + mão de obra) ÷ metros); a napa
--               da OC, quando a OC está aprovada/enviada, entra pelo comando oficial e sai
--               na hora como consumida pelo prestador — o estoque da fábrica nunca fica
--               com napa que está no prestador. O que não veio segue como falta.
--   Sem rendimento (grupo × napa) → as ações recusam; o Ateliê pede o número (R18).
--
-- Aditiva: antes da virada nenhuma reserva tem `strap_origin`, então as listas vêm
-- vazias. A falta nasce na virada (motor genérico com tira).

-- ── Trabalhos de tira do Ateliê ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.strap_atelier_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id),
  origin text NOT NULL CHECK (origin IN ('fabrica', 'prestador')),
  strap_m numeric NOT NULL CHECK (strap_m > 0),
  napa_product_id uuid REFERENCES public.products(id),
  napa_m numeric CHECK (napa_m IS NULL OR napa_m >= 0),
  napa_unit_cost numeric,
  yield_m_per_m numeric,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  labor_cost_per_m numeric,
  purchase_order_id uuid REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  service_order_id uuid REFERENCES public.service_orders(id) ON DELETE SET NULL,
  received_m numeric NOT NULL DEFAULT 0 CHECK (received_m >= 0),
  napa_settled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'recebido_parcial', 'concluido', 'cancelado')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_strap_atelier_jobs_open
  ON public.strap_atelier_jobs (sale_order_id, product_id)
  WHERE status IN ('aberto', 'recebido_parcial');

COMMENT ON TABLE public.strap_atelier_jobs IS
  'Ateliê → aba Tiras: produção de tira para a falta de um PV. Fábrica nasce concluída ("Produzido"); Prestador nasce aberta com OC da napa + OS e fecha nos "Recebido".';

ALTER TABLE public.strap_atelier_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS strap_atelier_jobs_select ON public.strap_atelier_jobs;
CREATE POLICY strap_atelier_jobs_select ON public.strap_atelier_jobs
  FOR SELECT TO authenticated USING (public.is_approved_user());
GRANT SELECT ON public.strap_atelier_jobs TO authenticated;

-- ── Napa-base do SKU de tira (para produzir) ────────────────────────────────
-- SKU com napa na chave usa a dele; SKU antigo sem napa (R7a) usa a napa que o PV
-- resolveu para a tira.
CREATE OR REPLACE FUNCTION private.strap_product_napa_group(p_product_id uuid, p_sale_order_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT coalesce(
    (SELECT p.strap_base_group_id FROM public.products p WHERE p.id = p_product_id),
    (SELECT nullif(src.value ->> 'base_group_id', '')::uuid
       FROM public.sale_order_items i
       CROSS JOIN LATERAL jsonb_each(coalesce(i.strap_sourcing, '{}'::jsonb)) src
      WHERE i.sale_order_id = p_sale_order_id
        AND src.value ->> 'product_id' = p_product_id::text
        AND coalesce(src.value ->> 'base_group_id', '') <> ''
      LIMIT 1)
  );
$function$;

REVOKE ALL ON FUNCTION private.strap_product_napa_group(uuid, uuid) FROM PUBLIC;

-- Produto de napa da mesma cor da tira, no grupo da napa-base. Mais estoque vence.
CREATE OR REPLACE FUNCTION private.strap_napa_product_for(p_strap_product_id uuid, p_napa_group_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT napa.id
    FROM public.products strap
    JOIN public.products napa
      ON napa.group_id = p_napa_group_id
     AND napa.active
     AND public.resolve_strap_canonical_color_id(napa.color)
         = public.resolve_strap_canonical_color_id(strap.color)
   WHERE strap.id = p_strap_product_id
   ORDER BY napa.quantity DESC NULLS LAST, napa.created_at, napa.id
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION private.strap_napa_product_for(uuid, uuid) FROM PUBLIC;

-- ── Lista da aba Tiras ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_atelier_strap_shortages()
 RETURNS TABLE(
   sale_order_id uuid,
   order_number text,
   client_name text,
   product_id uuid,
   product_name text,
   group_id uuid,
   group_name text,
   origin text,
   color text,
   napa_group_id uuid,
   napa_group_name text,
   needed_m numeric,
   reserved_m numeric,
   shortage_m numeric,
   in_progress_m numeric,
   to_produce_m numeric,
   yield_m_per_m numeric,
   labor_cost_per_m numeric,
   default_contractor_id uuid,
   default_contractor_name text,
   napa_product_id uuid,
   napa_product_name text,
   napa_stock_m numeric,
   napa_unit_price numeric,
   napa_supplier_name text
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH res AS (
    SELECT coalesce(mr.sale_order_id, o.sale_order_id) AS sale_order_id,
           mr.product_id,
           min(mr.metadata ->> 'strap_origin') AS origin,
           sum(greatest(coalesce(mr.quantity_reserved, 0) - coalesce(mr.quantity_consumed, 0), 0)) AS reserved_m,
           sum(coalesce(mr.quantity_short, 0)) AS shortage_m
      FROM public.material_reservations mr
      LEFT JOIN public.orders o ON o.id = mr.order_id
      JOIN public.products p ON p.id = mr.product_id
      JOIN public.product_groups g ON g.id = p.group_id AND coalesce(g.is_artisanal_strap, false)
     WHERE mr.status IN ('reserved', 'partially_consumed')
       AND mr.metadata ->> 'strap_origin' IN ('fabrica', 'prestador')
       AND public.material_reservation_is_pv_managed(mr)
     GROUP BY 1, 2
  ), jobs AS (
    SELECT j.sale_order_id, j.product_id,
           sum(greatest(j.strap_m - j.received_m, 0)) AS in_progress_m
      FROM public.strap_atelier_jobs j
     WHERE j.status IN ('aberto', 'recebido_parcial')
     GROUP BY 1, 2
  ), base AS (
    SELECT r.*, coalesce(j.in_progress_m, 0) AS in_progress_m,
           private.strap_product_napa_group(r.product_id, r.sale_order_id) AS napa_group_id
      FROM res r
      LEFT JOIN jobs j ON j.sale_order_id = r.sale_order_id AND j.product_id = r.product_id
     WHERE r.shortage_m > 0 OR coalesce(j.in_progress_m, 0) > 0
  )
  SELECT b.sale_order_id,
         so.order_number,
         coalesce(nullif(c.nome_fantasia, ''), c.razao_social),
         b.product_id,
         p.name,
         g.id,
         g.name,
         b.origin,
         p.color,
         b.napa_group_id,
         ng.name,
         round(b.reserved_m + b.shortage_m, 4),
         round(b.reserved_m, 4),
         round(b.shortage_m, 4),
         round(b.in_progress_m, 4),
         round(greatest(b.shortage_m - b.in_progress_m, 0), 4),
         y.yield_m_per_m,
         g.strap_labor_cost_per_m,
         g.strap_default_contractor_id,
         ct.name,
         np.id,
         np.name,
         np.quantity,
         coalesce(nullif(np.purchase_price, 0), np.unit_price),
         sup.name
    FROM base b
    JOIN public.sale_orders so ON so.id = b.sale_order_id
    LEFT JOIN public.clients c ON c.id = so.client_id
    JOIN public.products p ON p.id = b.product_id
    JOIN public.product_groups g ON g.id = p.group_id
    LEFT JOIN public.product_groups ng ON ng.id = b.napa_group_id
    LEFT JOIN public.strap_group_napa_yields y
      ON y.strap_group_id = g.id AND y.napa_group_id = b.napa_group_id
    LEFT JOIN public.contractors ct ON ct.id = g.strap_default_contractor_id
    LEFT JOIN public.products np
      ON np.id = private.strap_napa_product_for(b.product_id, b.napa_group_id)
    LEFT JOIN public.suppliers sup ON sup.id = coalesce(np.supplier_id, np.preferred_supplier_id)
   WHERE public.is_approved_user()
     AND so.deleted_at IS NULL
   ORDER BY so.order_number, g.name, p.name;
$function$;

REVOKE ALL ON FUNCTION public.list_atelier_strap_shortages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_strap_shortages() TO authenticated;

-- Trabalhos de prestador em aberto (para "Recebido").
CREATE OR REPLACE FUNCTION public.list_atelier_strap_jobs(p_include_closed boolean DEFAULT false)
 RETURNS TABLE(
   id uuid, sale_order_id uuid, order_number text, product_id uuid, product_name text,
   origin text, strap_m numeric, received_m numeric, pending_m numeric,
   napa_product_name text, napa_m numeric, contractor_name text, labor_cost_per_m numeric,
   purchase_order_id uuid, purchase_order_number text, purchase_order_status text,
   service_order_id uuid, service_order_number text,
   napa_settled boolean, status text, created_at timestamptz
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT j.id, j.sale_order_id, so.order_number, j.product_id, p.name,
         j.origin, j.strap_m, j.received_m, greatest(j.strap_m - j.received_m, 0),
         np.name, j.napa_m, ct.name, j.labor_cost_per_m,
         j.purchase_order_id, po.order_number, po.status,
         j.service_order_id, sv.order_number,
         j.napa_settled, j.status, j.created_at
    FROM public.strap_atelier_jobs j
    JOIN public.products p ON p.id = j.product_id
    LEFT JOIN public.sale_orders so ON so.id = j.sale_order_id
    LEFT JOIN public.products np ON np.id = j.napa_product_id
    LEFT JOIN public.contractors ct ON ct.id = j.contractor_id
    LEFT JOIN public.purchase_orders po ON po.id = j.purchase_order_id
    LEFT JOIN public.service_orders sv ON sv.id = j.service_order_id
   WHERE public.is_approved_user()
     AND (p_include_closed OR j.status IN ('aberto', 'recebido_parcial'))
   ORDER BY j.created_at DESC;
$function$;

REVOKE ALL ON FUNCTION public.list_atelier_strap_jobs(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_atelier_strap_jobs(boolean) TO authenticated;

-- ── Movimento de estoque com custo médio ────────────────────────────────────
-- Entrada (p_qty > 0) recalcula o custo médio ponderado (mesma fórmula do
-- recebimento de OC); saída (p_qty < 0) nunca deixa o físico negativo.
CREATE OR REPLACE FUNCTION private.strap_atelier_stock_move(
  p_product_id uuid,
  p_qty numeric,
  p_unit_cost numeric,
  p_description text,
  p_order_id uuid DEFAULT NULL
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_prev numeric;
  v_price numeric;
  v_name text;
  v_new numeric;
  v_new_price numeric;
  v_movement_id uuid;
BEGIN
  SELECT coalesce(p.quantity, 0), coalesce(p.unit_price, 0), p.name
    INTO v_prev, v_price, v_name
    FROM public.products p WHERE p.id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto % não existe', p_product_id;
  END IF;
  v_new := v_prev + p_qty;
  IF v_new < 0 THEN
    RAISE EXCEPTION '% insuficiente: disponível % m, necessário % m',
      v_name, round(v_prev, 2), round(-p_qty, 2);
  END IF;
  v_new_price := CASE
    WHEN p_qty > 0 AND p_unit_cost IS NOT NULL AND v_new > 0
      THEN (greatest(v_prev, 0) * v_price + p_qty * p_unit_cost) / v_new
    ELSE v_price
  END;
  UPDATE public.products
     SET quantity = v_new,
         current_stock = v_new,
         unit_price = round(v_new_price, 6),
         updated_at = now()
   WHERE id = p_product_id;
  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock,
    description, order_id, user_id, user_email
  ) VALUES (
    p_product_id, CASE WHEN p_qty >= 0 THEN 'in' ELSE 'out' END, abs(p_qty), v_prev, v_new,
    p_description, p_order_id, auth.uid(), coalesce(auth.jwt() ->> 'email', '')
  ) RETURNING id INTO v_movement_id;
  -- Saída pode deixar empenho acima do físico: devolve o excedente à falta.
  IF p_qty < 0 THEN
    PERFORM public.reallocate_product_commitments(p_product_id, v_movement_id);
  END IF;
  RETURN v_movement_id;
END;
$function$;

REVOKE ALL ON FUNCTION private.strap_atelier_stock_move(uuid, numeric, numeric, text, uuid) FROM PUBLIC;

-- ── Fábrica: "Produzido" ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_atelier_strap_produced(
  p_sale_order_id uuid,
  p_product_id uuid,
  p_strap_m numeric,
  p_napa_product_id uuid,
  p_napa_m numeric
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_strap public.products%ROWTYPE;
  v_napa public.products%ROWTYPE;
  v_order_number text;
  v_unit_cost numeric;
  v_job_id uuid;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao', 'almoxarifado']) THEN
    RAISE EXCEPTION 'Somente Produção/Almoxarifado/Gerência registra tira produzida'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_strap_m, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe os metros de tira produzidos';
  END IF;
  IF coalesce(p_napa_m, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe os metros de napa usados';
  END IF;
  SELECT * INTO v_strap FROM public.products WHERE id = p_product_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.product_groups g
     WHERE g.id = v_strap.group_id AND coalesce(g.is_artisanal_strap, false)
  ) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  SELECT * INTO v_napa FROM public.products WHERE id = p_napa_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Napa informada não existe';
  END IF;
  SELECT so.order_number INTO v_order_number FROM public.sale_orders so WHERE so.id = p_sale_order_id;

  v_unit_cost := coalesce(v_napa.unit_price, 0) * p_napa_m / p_strap_m;

  PERFORM private.strap_atelier_stock_move(
    v_napa.id, -p_napa_m, NULL,
    'Ateliê: napa usada na tira ' || v_strap.name || coalesce(' — ' || v_order_number, '')
  );
  PERFORM private.strap_atelier_stock_move(
    v_strap.id, p_strap_m, v_unit_cost,
    'Ateliê: tira produzida' || coalesce(' para ' || v_order_number, '')
  );

  INSERT INTO public.strap_atelier_jobs (
    sale_order_id, product_id, origin, strap_m, napa_product_id, napa_m,
    napa_unit_cost, yield_m_per_m, received_m, napa_settled, status, created_by
  ) VALUES (
    p_sale_order_id, p_product_id, 'fabrica', p_strap_m, v_napa.id, p_napa_m,
    v_napa.unit_price, round(p_strap_m / p_napa_m, 4), p_strap_m, true, 'concluido', auth.uid()
  ) RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'ok', true, 'job_id', v_job_id,
    'strap', v_strap.name, 'strap_m', p_strap_m,
    'napa', v_napa.name, 'napa_m', p_napa_m,
    'unit_cost', round(v_unit_cost, 4)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_atelier_strap_produced(uuid, uuid, numeric, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_atelier_strap_produced(uuid, uuid, numeric, uuid, numeric) TO authenticated;

-- ── Prestador: "Gerar OC da napa e OS" ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_atelier_strap_purchase_and_service(
  p_sale_order_id uuid,
  p_product_id uuid,
  p_strap_m numeric,
  p_napa_product_id uuid DEFAULT NULL,
  p_contractor_id uuid DEFAULT NULL,
  p_labor_cost_per_m numeric DEFAULT NULL
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_strap public.products%ROWTYPE;
  v_group public.product_groups%ROWTYPE;
  v_napa public.products%ROWTYPE;
  v_napa_group uuid;
  v_yield numeric;
  v_napa_m numeric;
  v_price numeric;
  v_supplier_id uuid;
  v_supplier_name text;
  v_contractor public.contractors%ROWTYPE;
  v_labor numeric;
  v_order_number text;
  v_job_id uuid := gen_random_uuid();
  v_po jsonb;
  v_po_id uuid;
  v_so_id uuid;
  v_qty integer;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Gerar OC e OS exige Administração ou Gerência'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_strap_m, 0) <= 0 THEN
    RAISE EXCEPTION 'Informe os metros de tira a encomendar';
  END IF;
  SELECT * INTO v_strap FROM public.products WHERE id = p_product_id;
  SELECT * INTO v_group FROM public.product_groups WHERE id = v_strap.group_id;
  IF v_strap.id IS NULL OR NOT coalesce(v_group.is_artisanal_strap, false) THEN
    RAISE EXCEPTION 'O produto informado não é uma tira';
  END IF;
  SELECT so.order_number INTO v_order_number FROM public.sale_orders so WHERE so.id = p_sale_order_id;

  v_napa_group := private.strap_product_napa_group(p_product_id, p_sale_order_id);
  IF v_napa_group IS NULL THEN
    RAISE EXCEPTION 'Não sei de que napa é a tira % — confira a napa da tira no PV', v_strap.name;
  END IF;
  SELECT y.yield_m_per_m INTO v_yield
    FROM public.strap_group_napa_yields y
   WHERE y.strap_group_id = v_group.id AND y.napa_group_id = v_napa_group;
  IF v_yield IS NULL THEN
    RAISE EXCEPTION 'Informe o rendimento de % na napa antes de gerar a OC', v_group.name;
  END IF;
  SELECT * INTO v_napa FROM public.products
   WHERE id = coalesce(p_napa_product_id, private.strap_napa_product_for(p_product_id, v_napa_group));
  IF v_napa.id IS NULL THEN
    RAISE EXCEPTION 'Não há napa da cor % no estoque para a tira %', v_strap.color, v_strap.name;
  END IF;
  v_supplier_id := coalesce(v_napa.supplier_id, v_napa.preferred_supplier_id);
  SELECT s.name INTO v_supplier_name FROM public.suppliers s WHERE s.id = v_supplier_id;
  IF v_supplier_name IS NULL THEN
    RAISE EXCEPTION 'A napa % não tem fornecedor cadastrado', v_napa.name;
  END IF;
  v_price := coalesce(nullif(v_napa.purchase_price, 0), nullif(v_napa.unit_price, 0));
  IF v_price IS NULL THEN
    RAISE EXCEPTION 'A napa % não tem preço de compra cadastrado', v_napa.name;
  END IF;
  SELECT * INTO v_contractor FROM public.contractors
   WHERE id = coalesce(p_contractor_id, v_group.strap_default_contractor_id);
  IF v_contractor.id IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador da tira (o grupo % não tem prestador padrão)', v_group.name;
  END IF;
  v_labor := coalesce(p_labor_cost_per_m, v_group.strap_labor_cost_per_m, 0);
  v_napa_m := ceil(p_strap_m / v_yield * 100) / 100;

  v_po := public.execute_purchase_order_command(
    'create',
    jsonb_build_object(
      'header', jsonb_build_object(
        'supplier_id', v_supplier_id,
        'supplier_name', v_supplier_name,
        'status', 'pending',
        'source_type', 'manual',
        'idempotency_key', 'strap-atelier:' || v_job_id::text,
        'linked_sale_order_ids', CASE WHEN p_sale_order_id IS NULL THEN '[]'::jsonb
                                      ELSE jsonb_build_array(p_sale_order_id) END,
        'source_pv_ids', CASE WHEN p_sale_order_id IS NULL THEN '[]'::jsonb
                              ELSE jsonb_build_array(p_sale_order_id) END,
        'notes', 'Napa para ' || round(p_strap_m, 2) || ' m de ' || v_strap.name
                 || coalesce(' (' || v_order_number || ')', '')
                 || '. ENTREGAR NO PRESTADOR: ' || v_contractor.name
                 || coalesce(' — ' || nullif(v_contractor.address, ''), '')
                 || '. Não dar entrada no estoque da fábrica: o Ateliê registra ao receber a tira.'
      ),
      'items', jsonb_build_array(jsonb_build_object(
        'product_id', v_napa.id,
        'quantity', v_napa_m,
        'unit', v_napa.unit,
        'unit_price', v_price,
        'color', v_napa.color
      ))
    ),
    gen_random_uuid()
  );
  v_po_id := nullif(v_po ->> 'purchase_order_id', '')::uuid;

  v_qty := greatest(ceil(p_strap_m)::integer, 1);
  INSERT INTO public.service_orders (
    contractor_id, description, quantity, unit_price, total_value, status, notes,
    material_name, material_meters, material_color, sale_order_id, service_order_domain
  ) VALUES (
    v_contractor.id,
    'Tira ' || v_strap.name || coalesce(' — ' || v_order_number, ''),
    v_qty,
    v_labor,
    round(v_qty * v_labor, 2),
    'Pendente',
    'Mão de obra de tira: ' || round(p_strap_m, 2) || ' m × R$ ' || round(v_labor, 4) || '/m. '
      || 'Napa: ' || v_napa_m || ' m de ' || v_napa.name || ' (OC do Ateliê).',
    v_napa.name,
    v_napa_m,
    v_napa.color,
    p_sale_order_id,
    'generic'
  ) RETURNING id INTO v_so_id;

  INSERT INTO public.strap_atelier_jobs (
    id, sale_order_id, product_id, origin, strap_m, napa_product_id, napa_m, napa_unit_cost,
    yield_m_per_m, contractor_id, labor_cost_per_m, purchase_order_id, service_order_id,
    status, created_by
  ) VALUES (
    v_job_id, p_sale_order_id, p_product_id, 'prestador', p_strap_m, v_napa.id, v_napa_m, v_price,
    v_yield, v_contractor.id, v_labor, v_po_id, v_so_id,
    'aberto', auth.uid()
  );

  RETURN jsonb_build_object(
    'ok', true, 'job_id', v_job_id,
    'purchase_order_id', v_po_id,
    'purchase_order_number', v_po -> 'purchase_order' ->> 'order_number',
    'service_order_id', v_so_id,
    'napa', v_napa.name, 'napa_m', v_napa_m,
    'contractor', v_contractor.name
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_atelier_strap_purchase_and_service(uuid, uuid, numeric, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_atelier_strap_purchase_and_service(uuid, uuid, numeric, uuid, uuid, numeric) TO authenticated;

-- ── Prestador: "Recebido" ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_atelier_strap_received(
  p_job_id uuid,
  p_received_m numeric,
  p_close boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_job public.strap_atelier_jobs%ROWTYPE;
  v_strap public.products%ROWTYPE;
  v_po public.purchase_orders%ROWTYPE;
  v_po_item public.purchase_order_items%ROWTYPE;
  v_order_number text;
  v_unit_cost numeric;
  v_received_total numeric;
  v_napa_warning text;
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente', 'producao', 'almoxarifado']) THEN
    RAISE EXCEPTION 'Somente Produção/Almoxarifado/Gerência registra tira recebida'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_job FROM public.strap_atelier_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.origin <> 'prestador' THEN
    RAISE EXCEPTION 'Trabalho de tira de prestador não encontrado';
  END IF;
  IF v_job.status NOT IN ('aberto', 'recebido_parcial') THEN
    RAISE EXCEPTION 'Este trabalho de tira já foi encerrado';
  END IF;
  IF coalesce(p_received_m, 0) < 0 OR (coalesce(p_received_m, 0) = 0 AND NOT p_close) THEN
    RAISE EXCEPTION 'Informe os metros de tira recebidos';
  END IF;
  SELECT * INTO v_strap FROM public.products WHERE id = v_job.product_id;
  SELECT so.order_number INTO v_order_number FROM public.sale_orders so WHERE so.id = v_job.sale_order_id;

  -- Custo planejado por metro: napa da OC + mão de obra, sobre os metros encomendados.
  v_unit_cost := (coalesce(v_job.napa_m, 0) * coalesce(v_job.napa_unit_cost, 0)) / v_job.strap_m
                 + coalesce(v_job.labor_cost_per_m, 0);

  -- Napa da OC: entra pelo comando oficial (gera contas a pagar) e sai como
  -- consumida pelo prestador. Uma vez por trabalho.
  IF NOT v_job.napa_settled AND v_job.purchase_order_id IS NOT NULL AND coalesce(v_job.napa_m, 0) > 0 THEN
    SELECT * INTO v_po FROM public.purchase_orders WHERE id = v_job.purchase_order_id;
    SELECT * INTO v_po_item FROM public.purchase_order_items
     WHERE purchase_order_id = v_job.purchase_order_id AND product_id = v_job.napa_product_id
     LIMIT 1;
    IF v_po.id IS NULL OR v_po.status = 'cancelled' THEN
      v_napa_warning := 'OC da napa cancelada ou inexistente — napa não baixada.';
    ELSIF coalesce(v_po_item.received_quantity, 0) >= coalesce(v_po_item.quantity, 0) - 0.0001 THEN
      -- Compras já deu entrada: só baixa o que foi para o prestador.
      PERFORM private.strap_atelier_stock_move(
        v_job.napa_product_id, -coalesce(v_po_item.received_quantity, v_job.napa_m), NULL,
        'Ateliê: napa consumida pelo prestador na tira ' || v_strap.name
          || coalesce(' — ' || v_order_number, '')
      );
      UPDATE public.strap_atelier_jobs SET napa_settled = true WHERE id = v_job.id;
    ELSIF v_po.status IN ('approved', 'sent', 'parcial') THEN
      PERFORM public.execute_purchase_order_command(
        'receive',
        jsonb_build_object('receive_all', true),
        gen_random_uuid(),
        v_po.id,
        NULL
      );
      PERFORM private.strap_atelier_stock_move(
        v_job.napa_product_id, -(v_po_item.quantity), NULL,
        'Ateliê: napa consumida pelo prestador na tira ' || v_strap.name
          || coalesce(' — ' || v_order_number, '')
      );
      UPDATE public.strap_atelier_jobs SET napa_settled = true WHERE id = v_job.id;
    ELSE
      v_napa_warning := 'A OC da napa ainda não foi aprovada/enviada — a napa será baixada no próximo recebimento.';
    END IF;
  END IF;

  IF coalesce(p_received_m, 0) > 0 THEN
    PERFORM private.strap_atelier_stock_move(
      v_strap.id, p_received_m, v_unit_cost,
      'Ateliê: tira recebida do prestador' || coalesce(' para ' || v_order_number, '')
    );
  END IF;

  v_received_total := v_job.received_m + coalesce(p_received_m, 0);
  UPDATE public.strap_atelier_jobs
     SET received_m = v_received_total,
         status = CASE WHEN p_close OR v_received_total >= v_job.strap_m - 0.0001
                       THEN 'concluido' ELSE 'recebido_parcial' END,
         updated_at = now()
   WHERE id = v_job.id;

  RETURN jsonb_build_object(
    'ok', true,
    'received_m', p_received_m,
    'received_total_m', v_received_total,
    'pending_m', greatest(v_job.strap_m - v_received_total, 0),
    'unit_cost', round(v_unit_cost, 4),
    'closed', p_close OR v_received_total >= v_job.strap_m - 0.0001,
    'napa_warning', v_napa_warning
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_atelier_strap_received(uuid, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_atelier_strap_received(uuid, numeric, boolean) TO authenticated;

-- Cancelar um trabalho de prestador ainda sem recebimento (OC/OS ficam para
-- o dono cancelar nas telas delas — nada de cancelamento em cascata escondido).
CREATE OR REPLACE FUNCTION public.cancel_atelier_strap_job(p_job_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NOT public.is_approved_user()
     OR NOT public.user_has_any_role(ARRAY['admin', 'gerente']) THEN
    RAISE EXCEPTION 'Cancelar trabalho de tira exige Administração ou Gerência'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.strap_atelier_jobs
     SET status = 'cancelado', updated_at = now()
   WHERE id = p_job_id AND status = 'aberto' AND received_m = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Só dá para cancelar trabalho aberto e sem recebimento';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_atelier_strap_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_atelier_strap_job(uuid) TO authenticated;
