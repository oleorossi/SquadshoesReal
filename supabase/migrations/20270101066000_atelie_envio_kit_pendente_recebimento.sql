-- Envio com ressalva quando o kit não fechou (napa/componente pendente, estoque 0)
-- e mensagem clara do que falta. Não debita estoque inexistente e não cria OS.

ALTER TABLE public.atelier_lots
  ADD COLUMN IF NOT EXISTS open_kit_send_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_kit_send_by uuid,
  ADD COLUMN IF NOT EXISTS open_kit_send_note text;

COMMENT ON COLUMN public.atelier_lots.open_kit_send_at IS
  'Operador confirmou envio com kit pendente. O estoque que falta não é debitado.';

CREATE OR REPLACE FUNCTION public.atelier_kit_pending_lines(p_lot_id uuid)
RETURNS TABLE(
  product_id uuid,
  product_name text,
  color text,
  unit text,
  component text,
  required_qty numeric,
  quantity numeric,
  pending_qty numeric,
  available_qty numeric,
  sector text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT
    s.product_id,
    p.name,
    p.color,
    p.unit,
    s.component,
    s.required_qty,
    s.quantity,
    s.pending_qty,
    GREATEST(COALESCE(p.quantity, 0), 0),
    s.sector
  FROM public.cabedal_prep_stock_debits s
  JOIN public.products p ON p.id = s.product_id
  WHERE s.lot_id = p_lot_id
    AND COALESCE(s.pending_qty, 0) > 0.0000001
  ORDER BY p.name, p.color, s.component;
$fn$;

REVOKE ALL ON FUNCTION public.atelier_kit_pending_lines(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_kit_pending_lines(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_kit_pending_lines(uuid) IS
  'Linhas do kit com pending_qty > 0 (napa do corte ou componente da liberação), com estoque atual.';

CREATE OR REPLACE FUNCTION public.atelier_kit_pending_message(p_lot_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT COALESCE(
    string_agg(
      trim(both ' ' FROM concat_ws(' ',
        line.product_name,
        NULLIF(line.color, ''),
        '(' || line.component || ')',
        'faltam',
        trim(to_char(line.pending_qty, 'FM999999990.99')),
        COALESCE(line.unit, ''),
        '(estoque ' || trim(to_char(line.available_qty, 'FM999999990.99'))
          || COALESCE(' ' || line.unit, '') || ')'
      )),
      '; '
    ),
    'corte ou componente pendente'
  )
  FROM public.atelier_kit_pending_lines(p_lot_id) AS line;
$fn$;

REVOKE ALL ON FUNCTION public.atelier_kit_pending_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_kit_pending_message(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_kit_send_block_message(p_lot_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT 'O kit ainda não fechou: '
    || public.atelier_kit_pending_message(p_lot_id)
    || '. Confirme o envio com ressalva na tela para avançar sem debitar o estoque que falta.';
$fn$;

REVOKE ALL ON FUNCTION public.atelier_kit_send_block_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_kit_send_block_message(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atelier_kit_allows_send(p_lot_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF p_lot_id IS NULL THEN
    RETURN false;
  END IF;
  IF public.atelier_lot_kit_is_closed(p_lot_id) THEN
    RETURN true;
  END IF;
  RETURN EXISTS (
    SELECT 1
      FROM public.atelier_lots
     WHERE id = p_lot_id
       AND open_kit_send_at IS NOT NULL
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.atelier_kit_allows_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_kit_allows_send(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_kit_allows_send(uuid) IS
  'Libera o envio se o kit fechou ou se o operador confirmou a ressalva. Não altera estoque.';

CREATE OR REPLACE FUNCTION public.atelier_confirm_open_kit_send(p_lot_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_lot public.atelier_lots%ROWTYPE;
  v_msg text;
  v_closed boolean;
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Usuário não aprovado' USING ERRCODE = '42501';
  END IF;
  IF p_lot_id IS NULL THEN
    RAISE EXCEPTION 'Informe o lote' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lot FROM public.atelier_lots WHERE id = p_lot_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote do Ateliê não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_lot.status IS DISTINCT FROM 'cut' THEN
    RAISE EXCEPTION 'Lote % precisa estar cortado para autorizar o envio com ressalva', v_lot.lot_number
      USING ERRCODE = '22023';
  END IF;

  v_closed := public.atelier_lot_kit_is_closed(p_lot_id);
  IF v_closed THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_closed', true,
      'lot_number', v_lot.lot_number,
      'kit_closed', true
    );
  END IF;

  v_msg := public.atelier_kit_pending_message(p_lot_id);

  UPDATE public.atelier_lots
     SET open_kit_send_at = COALESCE(open_kit_send_at, now()),
         open_kit_send_by = COALESCE(open_kit_send_by, auth.uid()),
         open_kit_send_note = v_msg,
         updated_at = now()
   WHERE id = p_lot_id;

  RETURN jsonb_build_object(
    'ok', true,
    'already_closed', false,
    'lot_number', v_lot.lot_number,
    'kit_closed', false,
    'note', v_msg,
    'confirmed_at', (SELECT open_kit_send_at FROM public.atelier_lots WHERE id = p_lot_id)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.atelier_confirm_open_kit_send(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.atelier_confirm_open_kit_send(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.atelier_confirm_open_kit_send(uuid) IS
  'Autoriza o envio do lote com kit pendente, sem debitar estoque e sem criar OS. A OS nasce no envio normal.';

-- Débitos da fila passam a expor cor e estoque atual, para o cartão dizer o que falta.
DO $patch_lots$
DECLARE
  v_def text;
  v_new text;
  v_old text := $o$'quantity', s.quantity, 'pending_qty', s.pending_qty$o$;
  v_add text := $n$'quantity', s.quantity, 'pending_qty', s.pending_qty, 'color', p.color, 'available_qty', GREATEST(COALESCE(p.quantity, 0), 0)$n$;
  v_closed_old text := $o$'kit_closed', public.atelier_lot_kit_is_closed(l.id)$o$;
  v_closed_ro text := $o$'kit_closed', public.atelier_lot_kit_closed_readonly(l.id)$o$;
  v_override text := $n$, 'open_kit_send_at', l.open_kit_send_at$n$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'list_atelier_lots' AND pg_get_function_identity_arguments(p.oid) = '';
  IF v_def IS NULL THEN
    RAISE EXCEPTION 'list_atelier_lots não encontrada';
  END IF;
  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'list_atelier_lots sem o bloco de débitos esperado';
  END IF;
  v_new := replace(v_def, v_old, v_add);
  IF strpos(v_new, '''open_kit_send_at''') = 0 THEN
    IF strpos(v_new, v_closed_ro) > 0 THEN
      v_new := replace(v_new, v_closed_ro, v_closed_ro || v_override);
    ELSIF strpos(v_new, v_closed_old) > 0 THEN
      v_new := replace(v_new, v_closed_old, v_closed_old || v_override);
    ELSE
      RAISE EXCEPTION 'list_atelier_lots sem kit_closed para expor open_kit_send_at';
    END IF;
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN
    EXECUTE v_new;
  END IF;
END;
$patch_lots$;

-- Portão de envio: fecha o kit OU ressalva confirmada. A mensagem cita o que falta.
DO $patch_send$
DECLARE
  r record;
  def text;
  new_def text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('atelier_send_split', 'atelier_send_shipment', 'atelier_send_remessa')
  LOOP
    def := pg_get_functiondef(r.oid);
    new_def := def;
    new_def := replace(new_def, 'NOT public.atelier_lot_kit_is_closed(v_job.lot_id)', 'NOT public.atelier_kit_allows_send(v_job.lot_id)');
    new_def := replace(new_def, 'NOT public.atelier_lot_kit_is_closed(j.lot_id)', 'NOT public.atelier_kit_allows_send(j.lot_id)');
    IF r.proname = 'atelier_send_remessa' THEN
      new_def := replace(new_def,
        $e$RAISE EXCEPTION 'O kit ainda não fechou. O envio espera isso' USING ERRCODE = '22023'$e$,
        $e$RAISE EXCEPTION '%', public.atelier_kit_send_block_message(p_lot_id) USING ERRCODE = '22023'$e$);
    ELSIF r.proname = 'atelier_send_shipment' THEN
      new_def := replace(new_def,
        $e$RAISE EXCEPTION 'O kit ainda não fechou. O botão de envio espera isso'$e$,
        $e$RAISE EXCEPTION '%', public.atelier_kit_send_block_message(v_job.lot_id)$e$);
    ELSE
      new_def := replace(new_def,
        $e$RAISE EXCEPTION 'O kit ainda não fechou. O envio espera isso' USING ERRCODE = '22023'$e$,
        $e$RAISE EXCEPTION '%', public.atelier_kit_send_block_message(v_job.lot_id) USING ERRCODE = '22023'$e$);
    END IF;
    IF new_def IS NOT DISTINCT FROM def THEN
      RAISE EXCEPTION 'Não achei o portão de kit em %(%)', r.proname, r.args;
    END IF;
    EXECUTE new_def;
  END LOOP;
END;
$patch_send$;

-- Lançar por cor: o motivo do bloqueio passa a citar o material que falta.
DO $patch_launch$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_old text := $o$WHEN j.lot_id IS NOT NULL AND NOT public.atelier_lot_kit_is_closed(j.lot_id) THEN 'O kit ainda não fechou.'$o$;
  v_repl text := $n$WHEN j.lot_id IS NOT NULL AND NOT public.atelier_kit_allows_send(j.lot_id) THEN public.atelier_kit_send_block_message(j.lot_id)$n$;
  v_can_old text := $o$AND (j.lot_id IS NULL OR public.atelier_lot_kit_is_closed(j.lot_id))$o$;
  v_can_new text := $n$AND (j.lot_id IS NULL OR public.atelier_kit_allows_send(j.lot_id))$n$;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'list_atelier_order_launch'
   LIMIT 1;
  IF v_oid IS NULL THEN
    RETURN;
  END IF;
  v_def := pg_get_functiondef(v_oid);
  v_new := v_def;
  IF strpos(v_new, v_old) > 0 THEN
    v_new := replace(v_new, v_old, v_repl);
  END IF;
  IF strpos(v_new, v_can_old) > 0 THEN
    v_new := replace(v_new, v_can_old, v_can_new);
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN
    EXECUTE v_new;
  END IF;
END;
$patch_launch$;
