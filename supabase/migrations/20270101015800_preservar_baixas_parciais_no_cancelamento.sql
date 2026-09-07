-- Caixa confirmado e imutavel no cancelamento fiscal
--
-- Tres writers legados cancelavam a AR olhando apenas o status. A conciliacao
-- bancaria grava `parcial` (pt-BR), enquanto um dos writers conhecia apenas
-- `partial`; alem disso, uma baixa concorrente podia deixar amount_received > 0
-- ainda com status pending. Em ambos os casos o documento fiscal podia ser
-- cancelado, mas a evidencia do dinheiro recebido era reclassificada como
-- cancelled.
--
-- Esta migration nao altera dados. Ela centraliza a decisao e troca somente os
-- predicados dos tres writers vivos. O cancelamento da NF/PV continua ocorrendo;
-- apenas titulos sem qualquer caixa registrado podem virar cancelled.

CREATE OR REPLACE FUNCTION private.ar_has_recorded_receipt(
  p_status text,
  p_amount_received numeric
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $function$
  SELECT
    pg_catalog.lower(pg_catalog.btrim(COALESCE(p_status, ''))) IN (
      'received', 'recebido', 'partial', 'parcial'
    )
    OR COALESCE(p_amount_received, 0) > 0
$function$;

REVOKE ALL ON FUNCTION private.ar_has_recorded_receipt(text, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION private.ar_has_recorded_receipt(text, numeric) IS
  'Verdadeiro quando uma AR possui baixa total/parcial por status ou valor; usada para impedir cancelamento de caixa confirmado.';

-- A implementacao fiscal e extensa e ja foi congelada pela fronteira 126.
-- Substituimos somente o predicado vulneravel, falhando a migration se a
-- definicao anterior divergir: assim nenhuma mudanca fiscal/logistica e copiada
-- ou escondida neste patch financeiro estreito.
DO $patch_complete_cancellation$
DECLARE
  v_definition text;
  v_old_occurrences integer;
  v_new_occurrences integer;
  v_old text := $old$AND ar.status NOT IN ('received', 'cancelled');$old$;
  v_new text := $new$AND pg_catalog.lower(pg_catalog.btrim(COALESCE(ar.status, '')))
         NOT IN ('cancelled', 'cancelado')
       AND NOT private.ar_has_recorded_receipt(ar.status, ar.amount_received);$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(
             'public.complete_nfe_cancellation_command_impl_126(uuid,text,text)'
           )
         )
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION
      'complete_nfe_cancellation_command_impl_126(uuid,text,text) ausente';
  END IF;
  v_old_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  v_new_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
  ) / pg_catalog.length(v_new);
  IF v_old_occurrences = 0 AND v_new_occurrences = 1 THEN
      RETURN;
  END IF;
  IF v_old_occurrences <> 1 OR v_new_occurrences <> 0 THEN
    RAISE EXCEPTION
      'Patch 15800 complete cancellation encontrou % anchors antigos e % novos',
      v_old_occurrences, v_new_occurrences;
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch_complete_cancellation$;

DO $patch_untracked_cancel$
DECLARE
  v_definition text;
  v_old_occurrences integer;
  v_new_occurrences integer;
  v_old text := $old$AND status NOT IN ('received','cancelled');$old$;
  v_new text := $new$AND pg_catalog.lower(pg_catalog.btrim(COALESCE(status, '')))
        NOT IN ('cancelled', 'cancelado')
      AND NOT private.ar_has_recorded_receipt(status, amount_received);$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(
             'public.tg_reverse_revenue_on_untracked_cancel()'
           )
         )
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'tg_reverse_revenue_on_untracked_cancel() ausente';
  END IF;
  v_old_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  v_new_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
  ) / pg_catalog.length(v_new);
  IF v_old_occurrences = 0 AND v_new_occurrences = 1 THEN
      RETURN;
  END IF;
  IF v_old_occurrences <> 1 OR v_new_occurrences <> 0 THEN
    RAISE EXCEPTION
      'Patch 15800 untracked cancel encontrou % anchors antigos e % novos',
      v_old_occurrences, v_new_occurrences;
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch_untracked_cancel$;

DO $patch_revert_invoiced$
DECLARE
  v_definition text;
  v_old_occurrences integer;
  v_new_occurrences integer;
  v_old text := $old$WHERE sale_order_id = p_sale_order_id AND status IN ('pending','partial');$old$;
  v_new text := $new$WHERE sale_order_id = p_sale_order_id
     AND pg_catalog.lower(pg_catalog.btrim(COALESCE(status, '')))
           IN ('pending', 'pendente', 'partial', 'parcial')
     AND NOT private.ar_has_recorded_receipt(status, amount_received);$new$;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(
           pg_catalog.to_regprocedure(
             'public.revert_invoiced_sale_order_internal_108(uuid,text)'
           )
         )
    INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'revert_invoiced_sale_order_internal_108(uuid,text) ausente';
  END IF;
  v_old_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.length(v_old);
  v_new_occurrences := (
    pg_catalog.length(v_definition)
    - pg_catalog.length(pg_catalog.replace(v_definition, v_new, ''))
  ) / pg_catalog.length(v_new);
  IF v_old_occurrences = 0 AND v_new_occurrences = 1 THEN
      RETURN;
  END IF;
  IF v_old_occurrences <> 1 OR v_new_occurrences <> 0 THEN
    RAISE EXCEPTION
      'Patch 15800 revert invoiced encontrou % anchors antigos e % novos',
      v_old_occurrences, v_new_occurrences;
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_old, v_new);
END;
$patch_revert_invoiced$;
