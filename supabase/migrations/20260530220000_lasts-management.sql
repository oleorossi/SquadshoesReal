-- Item #7 do roadmap (auditoria 30/05). Last (forma) management como entidade.
-- Antes: forma era conceito implícito em technical_sheets. Sem catálogo, custo,
-- propriedade nem ciclo de vida. ERP-calçado top trata forma como entidade
-- primária — agora Squad também.

CREATE TABLE IF NOT EXISTS public.lasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  size_range_min int,
  size_range_max int,
  toe_shape text,
  heel_type text,
  heel_height_mm numeric,
  material text,
  unit_cost numeric,
  owner_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'dev',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lasts_owner_idx ON public.lasts(owner_client_id) WHERE owner_client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lasts_status_idx ON public.lasts(status);

ALTER TABLE public.lasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lasts_select ON public.lasts;
CREATE POLICY lasts_select ON public.lasts
  FOR SELECT TO authenticated USING (is_approved_user());

DROP POLICY IF EXISTS lasts_write ON public.lasts;
CREATE POLICY lasts_write ON public.lasts
  FOR ALL TO authenticated
  USING (user_has_any_role(ARRAY['admin','gerente']))
  WITH CHECK (user_has_any_role(ARRAY['admin','gerente']));

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS last_id uuid
    REFERENCES public.lasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS technical_sheets_last_idx
  ON public.technical_sheets(last_id) WHERE last_id IS NOT NULL;

CREATE OR REPLACE VIEW public.v_lasts_with_usage AS
SELECT
  l.*,
  c.razao_social AS owner_name,
  c.cnpj AS owner_cnpj,
  (SELECT COUNT(*) FROM public.technical_sheets ts WHERE ts.last_id = l.id) AS sheets_using
FROM public.lasts l
LEFT JOIN public.clients c ON c.id = l.owner_client_id
ORDER BY l.status, l.code;

ALTER VIEW public.v_lasts_with_usage SET (security_invoker = on);
GRANT SELECT ON public.v_lasts_with_usage TO authenticated;
