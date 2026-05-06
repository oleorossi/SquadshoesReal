
-- ===================== EQUIPAMENTOS =====================
CREATE TABLE IF NOT EXISTS public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  sector text,
  manufacturer text,
  model text,
  serial_number text,
  acquisition_date date,
  status text NOT NULL DEFAULT 'ativo',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view equipment" ON public.equipment;
CREATE POLICY "Auth users can view equipment" ON public.equipment FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert equipment" ON public.equipment;
CREATE POLICY "Auth users can insert equipment" ON public.equipment FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update equipment" ON public.equipment;
CREATE POLICY "Auth users can update equipment" ON public.equipment FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete equipment" ON public.equipment;
CREATE POLICY "Auth users can delete equipment" ON public.equipment FOR DELETE TO authenticated USING (true);

-- ===================== PLANOS DE MANUTENÇÃO =====================
CREATE TABLE IF NOT EXISTS public.maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  description text NOT NULL,
  frequency_days integer NOT NULL DEFAULT 30,
  last_performed_at timestamptz,
  next_due_at timestamptz,
  responsible text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view maintenance_plans" ON public.maintenance_plans;
CREATE POLICY "Auth users can view maintenance_plans" ON public.maintenance_plans FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert maintenance_plans" ON public.maintenance_plans;
CREATE POLICY "Auth users can insert maintenance_plans" ON public.maintenance_plans FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update maintenance_plans" ON public.maintenance_plans;
CREATE POLICY "Auth users can update maintenance_plans" ON public.maintenance_plans FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete maintenance_plans" ON public.maintenance_plans;
CREATE POLICY "Auth users can delete maintenance_plans" ON public.maintenance_plans FOR DELETE TO authenticated USING (true);

-- ===================== REGISTRO DE MANUTENÇÕES =====================
CREATE TABLE IF NOT EXISTS public.maintenance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment(id) ON DELETE CASCADE,
  plan_id uuid REFERENCES public.maintenance_plans(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'preventiva',
  description text NOT NULL,
  cost numeric DEFAULT 0,
  performed_by text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth users can view maintenance_logs" ON public.maintenance_logs;
CREATE POLICY "Auth users can view maintenance_logs" ON public.maintenance_logs FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert maintenance_logs" ON public.maintenance_logs;
CREATE POLICY "Auth users can insert maintenance_logs" ON public.maintenance_logs FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update maintenance_logs" ON public.maintenance_logs;
CREATE POLICY "Auth users can update maintenance_logs" ON public.maintenance_logs FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete maintenance_logs" ON public.maintenance_logs;
CREATE POLICY "Auth users can delete maintenance_logs" ON public.maintenance_logs FOR DELETE TO authenticated USING (true);

-- Trigger para atualizar next_due_at ao registrar manutenção preventiva
DROP FUNCTION IF EXISTS public.update_maintenance_plan_on_log() CASCADE;
CREATE OR REPLACE FUNCTION public.update_maintenance_plan_on_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL AND NEW.type = 'preventiva' THEN
    UPDATE maintenance_plans
    SET last_performed_at = NEW.performed_at,
        next_due_at = NEW.performed_at + (frequency_days || ' days')::interval,
        updated_at = now()
    WHERE id = NEW.plan_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_update_plan_on_log
AFTER INSERT ON public.maintenance_logs
FOR EACH ROW
EXECUTE FUNCTION public.update_maintenance_plan_on_log();
