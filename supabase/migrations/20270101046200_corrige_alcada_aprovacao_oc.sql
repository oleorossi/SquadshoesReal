-- Já aplicada no cknb (15/11/2026) via MCP com o carimbo de calendário 20261115125438 (corrige_alcada_aprovacao_oc).
-- Idempotente: pode ser reexecutada pelo workflow de migrations sem efeito adicional
-- (CREATE OR REPLACE, DROP TRIGGER IF EXISTS, GRANT/REVOKE determinísticos).
-- Corrige o gatilho de alçada de OC:
--  * sem alçada cadastrada grava 'dispensado' (valor aceito pelo CHECK purchase_orders_approval_status_check),
--    em vez de 'nao_requer' (que violava o CHECK e travava toda aprovação);
--  * user_roles.role é app_role: compara como texto (antes: operator does not exist: app_role = text).
CREATE OR REPLACE FUNCTION public.tg_enforce_po_alcada()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier public.purchase_approval_tiers;
  v_uid uuid := auth.uid();
  v_allowed boolean;
BEGIN
  IF NEW.status = 'approved' AND COALESCE(OLD.status, '') <> 'approved' THEN
    SELECT * INTO v_tier FROM public.po_alcada_tier(NEW.total_value);

    IF v_tier.id IS NULL THEN
      NEW.approval_status := 'dispensado';
    ELSE
      IF v_uid IS NULL THEN
        v_allowed := true;
      ELSE
        v_allowed := EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id = v_uid
            AND ur.role::text IN (v_tier.required_role::text, 'admin')
        );
      END IF;

      IF NOT v_allowed THEN
        RAISE EXCEPTION 'Aprovação bloqueada: OC de % exige perfil "%" (alçada "%").',
          to_char(COALESCE(NEW.total_value,0), 'FM999G999G990D00'), v_tier.required_role, v_tier.name;
      END IF;

      NEW.approval_status := 'aprovado';
      INSERT INTO public.purchase_order_approvals
        (purchase_order_id, required_role, approved_by, approved_at, status, tier_name, total_value)
      VALUES (NEW.id, v_tier.required_role, v_uid, now(), 'aprovado', v_tier.name, NEW.total_value);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.tg_enforce_po_alcada() FROM PUBLIC, anon, authenticated;
