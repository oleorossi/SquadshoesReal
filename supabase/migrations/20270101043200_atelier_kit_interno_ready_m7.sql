-- Ateliê: kit = todos os itens da ficha (escolha por setor); pronto = fatura − 7d;
-- OS do prestador devolve qtds debitadas no corte; setting ready_before_billing_days.

-- ─── 1. Agenda: dias antes da semana de faturamento ─────────────────────────
ALTER TABLE public.atelier_settings
  ADD COLUMN IF NOT EXISTS ready_before_billing_days int NOT NULL DEFAULT 7
    CHECK (ready_before_billing_days BETWEEN 0 AND 90);

COMMENT ON COLUMN public.atelier_settings.ready_before_billing_days IS
  'Dias de calendário antes do início da semana de faturamento em que o material do Ateliê deve estar pronto (corte → prestador → volta). Default 7.';

UPDATE public.atelier_settings
   SET ready_before_billing_days = 7
 WHERE id = 1 AND ready_before_billing_days IS DISTINCT FROM 7;

-- ─── 2. Candidatos do kit = TODOS os itens da ficha (escolha manual por setor) ─
CREATE OR REPLACE FUNCTION public.atelier_sheet_kit_candidates(
  p_reference_id uuid,
  p_sector text
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  unit text,
  component text,
  quantity_per_unit numeric,
  sector text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Decisão do dono: em Costura/Aviamento/Corte listar todos os SKUs da ficha;
  -- o cadastro marca quais entram no kit daquele setor (nada pré-marcado na UI).
  SELECT DISTINCT ON (sm.product_id)
         sm.product_id,
         p.name,
         p.unit,
         COALESCE(NULLIF(btrim(sm.part_name), ''), COALESCE(sm.sector, 'BOM')) AS component,
         sm.quantity_per_unit,
         sm.sector
    FROM public.sheet_materials sm
    JOIN public.products p ON p.id = sm.product_id
   WHERE sm.sheet_id = p_reference_id
     AND sm.product_id IS NOT NULL
     AND COALESCE(sm.is_active, true)
     AND COALESCE(sm.include_in_consumption, true)
     AND p_sector IN ('corte_cabedal', 'costura_cabedal', 'aviamento')
   ORDER BY sm.product_id, sm.quantity_per_unit DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_sheet_kit_candidates(uuid, text)
  TO authenticated, service_role;

-- ─── 3. Snapshot de kit na OS (envio ao prestador) ───────────────────────────
ALTER TABLE public.cabedal_prep_jobs
  ADD COLUMN IF NOT EXISTS sent_kit_lines jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.cabedal_prep_jobs.sent_kit_lines IS
  'Linhas do kit debitadas no corte, congeladas no envio à OS do prestador (product, qty, unit).';

CREATE OR REPLACE FUNCTION public.atelier_mark_job_sent(
  p_job_id uuid,
  p_contractor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_num text;
  v_kit jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.execution_mode = 'internal' THEN
    RAISE EXCEPTION 'Este job é interno — use Em realização / Concluído' USING ERRCODE = '22023';
  END IF;
  IF v_job.pipeline_status NOT IN ('cut', 'sent_to_contractor') THEN
    RAISE EXCEPTION 'Corte o lote antes do envio (status=%)', v_job.pipeline_status
      USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_contractor_id, v_job.contractor_id) IS NULL THEN
    RAISE EXCEPTION 'Escolha o prestador' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'product_id', d.product_id,
             'product_name', p.name,
             'unit', p.unit,
             'component', d.component,
             'quantity', d.quantity,
             'required_qty', d.required_qty,
             'pending_qty', d.pending_qty
           )
           ORDER BY p.name
         ), '[]'::jsonb)
    INTO v_kit
    FROM public.cabedal_prep_stock_debits d
    JOIN public.products p ON p.id = d.product_id
   WHERE d.lot_id = v_job.lot_id
     AND COALESCE(d.quantity, 0) > 0;

  v_num := COALESCE(v_job.atelier_service_number, public.next_atelier_service_number());

  UPDATE public.cabedal_prep_jobs
     SET pipeline_status = 'sent_to_contractor',
         execution_mode = 'contractor',
         sent_at = COALESCE(sent_at, now()),
         contractor_id = COALESCE(p_contractor_id, contractor_id),
         atelier_service_number = v_num,
         sent_kit_lines = v_kit,
         updated_at = now()
   WHERE id = p_job_id;

  RETURN jsonb_build_object(
    'ok', true,
    'atelier_service_number', v_num,
    'kit_lines', v_kit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_mark_job_sent(uuid, uuid) TO authenticated, service_role;

-- ─── 4. Pronto = início da semana de faturamento − N dias (default 7) ────────
-- Substitui ready_date = billing_start − (assembly_days+1) na materialize viva.
DO $fix$
DECLARE
  v_def text;
  v_old text := $o$v_cap := NULLIF(r.assembly_capacity_per_day, 0);
    IF v_cap IS NOT NULL AND r.pairs > 0 THEN
      v_assembly_days := GREATEST(1, CEIL(r.pairs / v_cap)::int);
      v_lead := v_assembly_days + 1;
    ELSE
      v_assembly_days := NULL;
      v_lead := NULL;
    END IF;
    v_ready := CASE WHEN v_billing_start IS NOT NULL AND v_lead IS NOT NULL
                    THEN v_billing_start - v_lead END;$o$;
  v_new text := $n$v_cap := NULLIF(r.assembly_capacity_per_day, 0);
    IF v_cap IS NOT NULL AND r.pairs > 0 THEN
      v_assembly_days := GREATEST(1, CEIL(r.pairs / v_cap)::int);
    ELSE
      v_assembly_days := NULL;
    END IF;
    -- Pronto no Ateliê = início da semana de faturamento − ready_before_billing_days (default 7).
    v_lead := COALESCE(
      (SELECT s.ready_before_billing_days FROM public.atelier_settings s WHERE s.id = 1),
      7
    );
    v_ready := CASE WHEN v_billing_start IS NOT NULL
                    THEN v_billing_start - v_lead END;$n$;
BEGIN
  SELECT pg_get_functiondef('public.materialize_cabedal_prep_demands(uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'materialize_cabedal_prep_demands(uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'ready_before_billing_days') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'materialize_cabedal_prep_demands: âncora de ready_date não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix$;

-- ─── 5. list_atelier_lots: expor sent_kit_lines nos jobs ─────────────────────
DO $fix$
DECLARE
  v_def text;
  v_old text := $o$'atelier_service_number', j.atelier_service_number, 'target_end', j.target_end,
                    'execution_mode', j.execution_mode$o$;
  v_new text := $n$'atelier_service_number', j.atelier_service_number, 'target_end', j.target_end,
                    'execution_mode', j.execution_mode,
                    'sent_kit_lines', COALESCE(j.sent_kit_lines, '[]'::jsonb)$n$;
BEGIN
  SELECT pg_get_functiondef('public.list_atelier_lots()'::regprocedure) INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots() não encontrada';
  END IF;
  IF strpos(v_def, 'sent_kit_lines') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'list_atelier_lots: âncora de jobs jsonb não encontrada';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$fix$;

-- ─── 6. Settings RPC aceita ready_before_billing_days ────────────────────────
DROP FUNCTION IF EXISTS public.atelier_update_settings(integer, integer);

CREATE OR REPLACE FUNCTION public.atelier_update_settings(
  p_costura_offset_days int DEFAULT NULL,
  p_aviamento_offset_days int DEFAULT NULL,
  p_ready_before_billing_days int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.atelier_settings%ROWTYPE;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.atelier_settings
     SET costura_offset_days = COALESCE(p_costura_offset_days, costura_offset_days),
         aviamento_offset_days = COALESCE(p_aviamento_offset_days, aviamento_offset_days),
         ready_before_billing_days = COALESCE(p_ready_before_billing_days, ready_before_billing_days),
         updated_at = now()
   WHERE id = 1
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    INSERT INTO public.atelier_settings (id, costura_offset_days, aviamento_offset_days, ready_before_billing_days)
    VALUES (
      1,
      COALESCE(p_costura_offset_days, 5),
      COALESCE(p_aviamento_offset_days, 5),
      COALESCE(p_ready_before_billing_days, 7)
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'costura_offset_days', v_row.costura_offset_days,
    'aviamento_offset_days', v_row.aviamento_offset_days,
    'ready_before_billing_days', v_row.ready_before_billing_days,
    'updated_at', v_row.updated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.atelier_update_settings(integer, integer, integer)
  TO authenticated, service_role;

-- ─── 7. OC de falta: purchase_by / promised = ready_date do Ateliê (fatura−7d) ─
-- A compra não segue a OP/onda: o material precisa chegar a tempo do corte →
-- prestador → volta, com meta = cabedal_prep_demands.ready_date.
DO $fix$
DECLARE
  v_def text;
  v_old_vars text := $o$  v_total numeric;
BEGIN
  SELECT so.status INTO v_status$o$;
  v_new_vars text := $n$  v_total numeric;
  v_need_by date;
BEGIN
  SELECT MIN(d.ready_date)
    INTO v_need_by
    FROM public.cabedal_prep_demands d
   WHERE d.sale_order_id = p_sale_order_id
     AND d.status IN ('open', 'planned', 'stale')
     AND d.ready_date IS NOT NULL;

  SELECT so.status INTO v_status$n$;
  v_old_insert text := $o$    INSERT INTO public.purchase_orders(
      supplier_id, supplier_name, notes, total_value, auto_generated,
      status, approval_status, source_type, source_pv_ids,
      linked_sale_order_ids, idempotency_key
    ) VALUES (
      v_supplier_id,
      v_supplier_name,
      'OC preparação de cabedal · PV ' || p_sale_order_id::text,
      v_total,
      true,
      CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
      'pendente_aprovacao',
      'cabedal_prep',
      ARRAY[p_sale_order_id],
      ARRAY[p_sale_order_id],
      v_idem
    ) RETURNING id INTO v_po_id;$o$;
  v_new_insert text := $n$    INSERT INTO public.purchase_orders(
      supplier_id, supplier_name, notes, total_value, auto_generated,
      status, approval_status, source_type, source_pv_ids,
      linked_sale_order_ids, idempotency_key,
      purchase_by_date, promised_date
    ) VALUES (
      v_supplier_id,
      v_supplier_name,
      'OC Ateliê (kit) · meta pronto ' || COALESCE(v_need_by::text, '?') ||
        ' · PV ' || p_sale_order_id::text,
      v_total,
      true,
      CASE WHEN v_supplier_id IS NULL THEN 'draft' ELSE 'suggested' END,
      'pendente_aprovacao',
      'cabedal_prep',
      ARRAY[p_sale_order_id],
      ARRAY[p_sale_order_id],
      v_idem,
      v_need_by,
      v_need_by
    ) RETURNING id INTO v_po_id;$n$;
  v_old_reuse text := $o$    IF v_po_id IS NOT NULL THEN
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;$o$;
  v_new_reuse text := $n$    IF v_po_id IS NOT NULL THEN
      -- Reuso: puxa a meta se a data do Ateliê ficou mais cedo.
      IF v_need_by IS NOT NULL THEN
        UPDATE public.purchase_orders po
           SET purchase_by_date = CASE
                 WHEN po.purchase_by_date IS NULL THEN v_need_by
                 ELSE LEAST(po.purchase_by_date, v_need_by)
               END,
               promised_date = CASE
                 WHEN po.promised_date IS NULL THEN v_need_by
                 ELSE LEAST(po.promised_date, v_need_by)
               END,
               updated_at = now()
         WHERE po.id = v_po_id
           AND (
             po.purchase_by_date IS NULL OR po.purchase_by_date > v_need_by
             OR po.promised_date IS NULL OR po.promised_date > v_need_by
           );
      END IF;
      v_reused := v_reused + 1;
      CONTINUE;
    END IF;$n$;
BEGIN
  SELECT pg_get_functiondef('public.process_cabedal_prep_purchase_shortages_po(uuid)'::regprocedure)
    INTO v_def;
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'process_cabedal_prep_purchase_shortages_po(uuid) não encontrada';
  END IF;
  IF strpos(v_def, 'meta pronto') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old_vars) = 0 OR strpos(v_def, v_old_insert) = 0 OR strpos(v_def, v_old_reuse) = 0 THEN
    RAISE EXCEPTION 'process_cabedal_prep_purchase_shortages_po: âncora de purchase_by/ready não encontrada';
  END IF;
  v_def := replace(v_def, v_old_vars, v_new_vars);
  v_def := replace(v_def, v_old_reuse, v_new_reuse);
  v_def := replace(v_def, v_old_insert, v_new_insert);
  EXECUTE v_def;
END
$fix$;
