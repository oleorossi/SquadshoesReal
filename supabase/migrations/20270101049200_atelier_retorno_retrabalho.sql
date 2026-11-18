-- Retorno de retrabalho não gera conta e não soma de novo nos pares do job.
-- A conclusão da OS não pode bloquear a atualização da própria linha.
-- Na OS-00384, o par b66baad8 vira retorno do retrabalho 92d23217 e a conta de R$5 sai.

ALTER TABLE public.service_order_returns
  DROP CONSTRAINT IF EXISTS service_order_returns_adjustment_kind_ck;
ALTER TABLE public.service_order_returns
  ADD CONSTRAINT service_order_returns_adjustment_kind_ck
  CHECK (adjustment_kind IS NULL OR adjustment_kind IN ('reversal', 'scrap', 'rework_return'));

CREATE OR REPLACE FUNCTION public.tg_ap_per_service_order_return()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_so public.service_orders%ROWTYPE;
  v_contractor uuid;
  v_amount numeric;
  v_days integer;
  v_due date;
  v_base date;
  v_cname text;
  v_supplier_id uuid;
  v_has_supplier_col boolean;
BEGIN
  IF NEW.reverses_return_id IS NOT NULL
     OR COALESCE(NEW.adjustment_kind, '') IN ('reversal', 'rework_return') THEN
    UPDATE public.accounts_payable
       SET status = 'cancelled',
           notes = concat_ws(' ', notes, 'Este retorno não gera título.'),
           updated_at = now()
     WHERE reference_type = 'service_order_return'
       AND reference_id = NEW.id
       AND lower(btrim(status)) IN ('pending', 'pendente', 'open', 'aberto');
    RETURN NEW;
  END IF;

  SELECT * INTO v_so FROM public.service_orders WHERE id = NEW.service_order_id;
  IF NOT FOUND OR NOT COALESCE(v_so.dispatch_tracked, false) OR COALESCE(NEW.qty_good, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  v_contractor := COALESCE(NEW.contractor_id, v_so.contractor_id);
  SELECT COALESCE(payment_days, 30), COALESCE(NULLIF(trade_name, ''), name)
    INTO v_days, v_cname FROM public.contractors WHERE id = v_contractor;
  v_days := COALESCE(v_days, 30);
  IF v_days >= 999 THEN RETURN NEW; END IF;

  v_amount := NEW.qty_good * COALESCE(v_so.unit_price, 0);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  v_base := COALESCE(NEW.returned_at::date, CURRENT_DATE);
  v_due := v_base + v_days;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'contractors' AND column_name = 'supplier_id'
  ) INTO v_has_supplier_col;
  IF v_has_supplier_col THEN
    EXECUTE 'SELECT supplier_id FROM public.contractors WHERE id = $1'
      INTO v_supplier_id USING v_contractor;
  END IF;

  INSERT INTO public.accounts_payable (
    description, supplier_id, category, due_date, amount, status,
    reference_id, reference_type, notes
  ) VALUES (
    'OS ' || COALESCE(v_so.order_number, v_so.id::text) || ' — '
      || COALESCE(NULLIF(v_cname, ''), 'prestador') || ' (' || NEW.qty_good || ' pares aceitos)',
    v_supplier_id, 'service', v_due, v_amount, 'pending', NEW.id, 'service_order_return',
    'Gerado pela conferência de ' || v_base::text || ': '
      || NEW.qty_good || ' pares bons × ' || COALESCE(v_so.unit_price, 0)::text
      || '. Vencimento em ' || v_days || ' dias.'
  ) ON CONFLICT (reference_id) WHERE reference_type = 'service_order_return' DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ap_per_so_return ON public.service_order_returns;
CREATE TRIGGER trg_ap_per_so_return
  AFTER INSERT OR UPDATE ON public.service_order_returns
  FOR EACH ROW EXECUTE FUNCTION public.tg_ap_per_service_order_return();

-- Atualizar quantidade da linha que já é desta OS não é "mover" a linha.
DO $patch_line_move$
DECLARE
  v_def text;
  v_old text := $old$          IF public.normalize_service_order_status(v_lock.status)
               IN ('Concluído', 'Cancelado') THEN
            RAISE EXCEPTION
              'Linha não pode ser movida para OS concluída/cancelada.';
          END IF;$old$;
  v_new text := $new$          IF OLD.service_order_id IS DISTINCT FROM NEW.service_order_id
             AND public.normalize_service_order_status(v_lock.status)
               IN ('Concluído', 'Cancelado') THEN
            RAISE EXCEPTION
              'Linha não pode ser movida para OS concluída/cancelada.';
          END IF;$new$;
BEGIN
  SELECT pg_get_functiondef('public.tg_guard_service_order_item_identity()'::regprocedure) INTO v_def;
  IF strpos(v_def, 'OLD.service_order_id IS DISTINCT FROM NEW.service_order_id') > 0
     AND strpos(v_def, 'Linha não pode ser movida para OS concluída/cancelada.') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'não achei a trava que recusa atualizar a linha da OS concluída';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch_line_move$;

DO $patch_post_rework$
DECLARE
  v_def text;
  v_old_amount text := 'v_amount := ROUND(v_good * COALESCE(v_price, 0), 2);';
  v_new_amount text := $amt$IF v_receipt.rework_resolution_id IS NOT NULL THEN
    v_amount := 0;
  ELSE
    v_amount := ROUND(v_good * COALESCE(v_price, 0), 2);
  END IF;$amt$;
  v_old_ins text := $ins$    qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    defect_notes, created_by, atelier_job_receipt_id
  ) VALUES (
    v_os, v_contractor, COALESCE(v_receipt.created_at, now()),
    v_good, v_defect, 0, v_loss,$ins$;
  v_new_ins text := $ins2$    qty_good, qty_defect, qty_defect_scrapped, qty_loss,
    defect_notes, created_by, atelier_job_receipt_id, adjustment_kind
  ) VALUES (
    v_os, v_contractor, COALESCE(v_receipt.created_at, now()),
    v_good, v_defect, 0, v_loss,$ins2$;
BEGIN
  SELECT pg_get_functiondef('public.atelier_post_receipt_return(uuid)'::regprocedure) INTO v_def;
  IF strpos(v_def, 'rework_resolution_id IS NOT NULL THEN') = 0 THEN
    IF strpos(v_def, v_old_amount) = 0 THEN
      RAISE EXCEPTION 'não achei o valor da conferência do Ateliê';
    END IF;
    v_def := replace(v_def, v_old_amount, v_new_amount);
  END IF;
  IF strpos(v_def, 'adjustment_kind') = 0 THEN
    IF strpos(v_def, v_old_ins) = 0 THEN
      RAISE EXCEPTION 'não achei o insert do retorno da conferência';
    END IF;
    v_def := replace(v_def, v_old_ins, v_new_ins);
    v_def := replace(
      v_def,
      'v_receipt.created_by, v_receipt.id',
      'v_receipt.created_by, v_receipt.id, CASE WHEN v_receipt.rework_resolution_id IS NOT NULL THEN ''rework_return'' ELSE NULL END'
    );
  END IF;
  EXECUTE v_def;
END
$patch_post_rework$;

DROP FUNCTION IF EXISTS public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric, uuid);

CREATE OR REPLACE FUNCTION public.register_atelier_job_receipt(
  p_job_id uuid,
  p_pairs numeric,
  p_note text DEFAULT NULL,
  p_defect numeric DEFAULT 0,
  p_loss numeric DEFAULT 0,
  p_part_id uuid DEFAULT NULL,
  p_rework_pairs integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.cabedal_prep_jobs%ROWTYPE;
  v_part public.atelier_job_parts%ROWTYPE;
  v_open numeric;
  v_cap numeric;
  v_id uuid;
  v_good integer;
  v_paid integer;
  v_defect integer;
  v_loss integer;
  v_rework integer;
  v_part_count int;
  v_res uuid;
  v_res_left integer;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  v_good := public.atelier_whole_pairs(p_pairs, 'Pares bons');
  v_defect := public.atelier_whole_pairs(COALESCE(p_defect, 0), 'Pares com defeito');
  v_loss := public.atelier_whole_pairs(COALESCE(p_loss, 0), 'Pares perdidos');
  v_rework := public.atelier_whole_pairs(COALESCE(p_rework_pairs, 0), 'Retorno do retrabalho');
  IF v_rework > v_good THEN
    RAISE EXCEPTION 'O retorno do retrabalho não pode passar dos pares bons' USING ERRCODE = '22023';
  END IF;
  IF v_good <= 0 THEN
    RAISE EXCEPTION 'Informe ao menos 1 par bom, inteiro' USING ERRCODE = '22023';
  END IF;
  v_paid := v_good - v_rework;
  SELECT * INTO v_job FROM public.cabedal_prep_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_job.sector NOT IN ('costura_cabedal', 'aviamento') THEN
    RAISE EXCEPTION 'Só Costura e Aviamento recebem conferência' USING ERRCODE = '22023';
  END IF;
  IF p_part_id IS NULL THEN
    SELECT COUNT(*) INTO v_part_count
      FROM public.atelier_job_parts
     WHERE job_id = p_job_id AND received_pairs + 1e-9 < pairs;
    IF v_part_count = 1 THEN
      SELECT id INTO p_part_id
        FROM public.atelier_job_parts
       WHERE job_id = p_job_id AND received_pairs + 1e-9 < pairs
       LIMIT 1;
    ELSIF v_part_count > 1 THEN
      RAISE EXCEPTION 'Escolha a parte do prestador para conferir' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_part_id IS NOT NULL THEN
    SELECT * INTO v_part FROM public.atelier_job_parts WHERE id = p_part_id AND job_id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parte do envio não encontrada' USING ERRCODE = 'P0002';
    END IF;
    SELECT COALESCE(SUM(r.pairs + COALESCE(r.qty_defect, 0) + COALESCE(r.qty_loss, 0)), 0)
      INTO v_open
      FROM public.atelier_job_receipts r
     WHERE r.part_id = p_part_id
       AND r.reversed_at IS NULL
       AND r.rework_resolution_id IS NULL;
    v_cap := v_part.pairs;
  ELSE
    v_open := public.atelier_job_open_received(p_job_id);
    v_cap := v_job.pairs;
  END IF;
  IF v_open + v_paid + v_defect + v_loss > v_cap + 1e-9 THEN
    RAISE EXCEPTION 'Excede a parte: já há % de % pares. Faltam %.',
      v_open, v_cap, GREATEST(v_cap - v_open, 0)
      USING ERRCODE = '22023';
  END IF;

  IF v_rework > 0 THEN
    SELECT d.id,
           d.pairs - COALESCE((
             SELECT SUM(back.pairs)::int
               FROM public.atelier_job_receipts back
              WHERE back.rework_resolution_id = d.id
                AND back.reversed_at IS NULL
           ), 0)
      INTO v_res, v_res_left
      FROM public.atelier_defect_resolutions d
      JOIN public.atelier_job_receipts src ON src.id = d.receipt_id
     WHERE src.job_id = p_job_id
       AND src.reversed_at IS NULL
       AND d.kind = 'rework'
       AND d.pairs > COALESCE((
             SELECT SUM(back.pairs)::int
               FROM public.atelier_job_receipts back
              WHERE back.rework_resolution_id = d.id
                AND back.reversed_at IS NULL
           ), 0)
     ORDER BY d.created_at
     LIMIT 1;
    IF v_res IS NULL OR v_rework > v_res_left THEN
      RAISE EXCEPTION 'Não há retrabalho em aberto para esses pares' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.atelier_job_receipts (
      job_id, part_id, pairs, qty_defect, qty_loss, note, created_by, rework_resolution_id
    ) VALUES (
      p_job_id, p_part_id, v_rework, 0, 0, 'Retorno do retrabalho', auth.uid(), v_res
    );
  END IF;

  IF v_paid > 0 OR v_defect > 0 OR v_loss > 0 THEN
    INSERT INTO public.atelier_job_receipts (job_id, part_id, pairs, qty_defect, qty_loss, note, created_by)
    VALUES (
      p_job_id, p_part_id, v_paid, v_defect, v_loss,
      NULLIF(btrim(COALESCE(p_note, '')), ''), auth.uid()
    )
    RETURNING id INTO v_id;
  END IF;

  PERFORM public.atelier_apply_received_total(p_job_id);
  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id', v_id,
    'part_id', p_part_id,
    'rework_pairs', v_rework,
    'received_pairs', public.atelier_job_open_received(p_job_id),
    'pairs', v_cap
  );
END;
$$;

REVOKE ALL ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_atelier_job_receipt(uuid, numeric, text, numeric, numeric, uuid, integer)
  TO authenticated, service_role;

DO $patch_period$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.atelier_period_report(date,date)'::regprocedure) INTO v_def;
  IF strpos(v_def, 'rework_resolution_id IS NULL THEN pairs * unit_price') = 0 THEN
    v_def := replace(
      v_def,
      'SUM(CASE WHEN side = ''contractor'' THEN pairs * unit_price ELSE 0 END) AS cost',
      'SUM(CASE WHEN side = ''contractor'' AND rework_resolution_id IS NULL THEN pairs * unit_price ELSE 0 END) AS cost'
    );
    v_def := replace(
      v_def,
      'COALESCE(r.qty_loss, 0) AS qty_loss, r.created_at',
      'COALESCE(r.qty_loss, 0) AS qty_loss, r.rework_resolution_id, r.created_at'
    );
  END IF;
  IF strpos(v_def, 'rr.rework_resolution_id IS NULL') = 0 THEN
    v_def := replace(
      v_def,
      'GREATEST(p.pairs - p.received_pairs, 0)::numeric AS pending',
      $pend$GREATEST(p.pairs - COALESCE((
             SELECT SUM(rr.pairs + COALESCE(rr.qty_defect, 0) + COALESCE(rr.qty_loss, 0))
               FROM public.atelier_job_receipts rr
              WHERE rr.reversed_at IS NULL
                AND rr.rework_resolution_id IS NULL
                AND (
                  rr.part_id = p.id
                  OR (
                    rr.part_id IS NULL
                    AND rr.job_id = p.job_id
                    AND (SELECT COUNT(*) FROM public.atelier_job_parts px WHERE px.job_id = p.job_id) = 1
                  )
                )
           ), 0), 0)::numeric AS pending$pend$
    );
  END IF;
  IF strpos(v_def, 'rework_resolution_id IS NULL THEN pairs * unit_price') = 0
     OR strpos(v_def, 'rr.rework_resolution_id IS NULL') = 0 THEN
    RAISE EXCEPTION 'não achei o custo ou o saldo do relatório do Ateliê';
  END IF;
  EXECUTE v_def;
END
$patch_period$;

-- OS-00384: o par b66baad8 é o retorno do retrabalho 92d23217. A conta de R$5 sai.
UPDATE public.atelier_job_receipts rec
   SET part_id = p.id
  FROM public.cabedal_prep_jobs j
  JOIN public.atelier_job_parts p ON p.job_id = j.id
 WHERE j.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6'
   AND rec.job_id = j.id
   AND rec.part_id IS NULL
   AND (
     SELECT COUNT(*) FROM public.atelier_job_parts p2 WHERE p2.job_id = j.id
   ) = 1;

UPDATE public.atelier_job_receipts rec
   SET rework_resolution_id = d.id
  FROM public.service_order_returns ret
  JOIN public.atelier_defect_resolutions d
    ON d.kind = 'rework'
   AND d.id::text LIKE '92d23217%'
   AND d.receipt_id::text LIKE 'c6876cfe%'
 WHERE ret.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6'
   AND ret.id::text LIKE 'b66baad8%'
   AND rec.id = ret.atelier_job_receipt_id
   AND rec.rework_resolution_id IS NULL;

-- O retorno já gravado é imutável. A reclassificação fica no recibo
-- (rework_resolution_id), que é o que o card, o custo e o saldo do job leem.
-- A conta pending de R$5 sai. Não se edita service_order_returns.
DELETE FROM public.accounts_payable ap
 USING public.service_order_returns ret
 WHERE ret.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6'
   AND ret.id::text LIKE 'b66baad8%'
   AND ap.reference_type = 'service_order_return'
   AND ap.reference_id = ret.id
   AND lower(btrim(ap.status)) = 'pending'
   AND ap.amount = 5
   AND COALESCE(ap.amount_paid, 0) = 0;

SELECT public.atelier_apply_received_total(j.id)
  FROM public.cabedal_prep_jobs j
 WHERE j.service_order_id = 'bed7d9f9-50cb-45ca-802e-c35240457aa6';
