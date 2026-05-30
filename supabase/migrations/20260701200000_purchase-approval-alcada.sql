-- Aprovação por alçada (Compras) — paridade Tutor32, compras #2.
--
-- Hoje a OC vai de 'pending' → 'approved' por um update genérico, sem gate por valor.
-- Adiciona faixas de alçada (purchase_approval_tiers) e um trigger que, ao marcar a
-- OC como 'approved', exige que o aprovador tenha o perfil da faixa do valor.
-- PERMISSIVO quando: não há tiers configurados, ou auth.uid() é nulo (fluxos de
-- sistema/automação) — só bloqueia usuário interativo sem alçada. Registra auditoria.

CREATE TABLE IF NOT EXISTS public.purchase_approval_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  min_value numeric NOT NULL DEFAULT 0,
  max_value numeric,                        -- NULL = sem teto
  required_role text NOT NULL DEFAULT 'gerente',  -- perfil mínimo (ou admin)
  active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- purchase_order_approvals já existe (sistema de aprovação planejado): id,
-- purchase_order_id, required_role, approved_by, approved_at, status, rejection_reason,
-- created_at. Criamos só se não existir (setups limpos) e adicionamos colunas extras.
CREATE TABLE IF NOT EXISTS public.purchase_order_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  required_role text NOT NULL DEFAULT 'gerente',
  approved_by uuid,                         -- auth.uid() do aprovador (null = sistema)
  approved_at timestamptz,
  status text NOT NULL DEFAULT 'aprovado',
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.purchase_order_approvals ADD COLUMN IF NOT EXISTS tier_name text;
ALTER TABLE public.purchase_order_approvals ADD COLUMN IF NOT EXISTS total_value numeric;

ALTER TABLE public.purchase_approval_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read tiers" ON public.purchase_approval_tiers;
CREATE POLICY "auth read tiers" ON public.purchase_approval_tiers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth write tiers" ON public.purchase_approval_tiers;
CREATE POLICY "auth write tiers" ON public.purchase_approval_tiers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth read po approvals" ON public.purchase_order_approvals;
CREATE POLICY "auth read po approvals" ON public.purchase_order_approvals FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth insert po approvals" ON public.purchase_order_approvals;
CREATE POLICY "auth insert po approvals" ON public.purchase_order_approvals FOR INSERT TO authenticated WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_purchase_approval_tiers_updated_at ON public.purchase_approval_tiers;
CREATE TRIGGER trg_purchase_approval_tiers_updated_at
  BEFORE UPDATE ON public.purchase_approval_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Faixa aplicável a um valor (a de maior min_value que cobre o valor)
CREATE OR REPLACE FUNCTION public.po_alcada_tier(p_total numeric)
RETURNS public.purchase_approval_tiers
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT * FROM public.purchase_approval_tiers
  WHERE active AND min_value <= COALESCE(p_total, 0)
    AND (max_value IS NULL OR COALESCE(p_total, 0) <= max_value)
  ORDER BY min_value DESC
  LIMIT 1;
$$;

-- Enforcement na transição para 'approved'
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

    -- Sem faixa aplicável → não requer alçada
    IF v_tier.id IS NULL THEN
      NEW.approval_status := 'nao_requer';
    ELSE
      -- Contexto de sistema (sem usuário) não é bloqueado
      IF v_uid IS NULL THEN
        v_allowed := true;
      ELSE
        v_allowed := EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_id = v_uid AND role IN (v_tier.required_role, 'admin')
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

DROP TRIGGER IF EXISTS trg_enforce_po_alcada ON public.purchase_orders;
CREATE TRIGGER trg_enforce_po_alcada
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_enforce_po_alcada();
