-- Perfis tributários por NCM — paridade Tutor32, fiscal #2.
--
-- Hoje o CFOP é só global na `companies` e o NCM mora em `technical_sheets.ncm`.
-- Esta migration cria um registry de tributação POR NCM (CST/CSOSN, CFOP interno/
-- externo, alíquotas ICMS/IPI/PIS/COFINS, MVA/alíquota ST) que serve de base pra
-- pré-preenchimento da emissão e estimativa de carga tributária. View de cobertura
-- mostra quais NCMs em uso têm/não têm perfil.

CREATE TABLE IF NOT EXISTS public.fiscal_tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ncm text NOT NULL,
  description text NOT NULL DEFAULT '',
  origem text NOT NULL DEFAULT '0',          -- origem da mercadoria (0-8)
  cst_icms text NOT NULL DEFAULT '',          -- CST (regime normal) ou CSOSN (Simples)
  aliquota_icms numeric NOT NULL DEFAULT 0,
  cst_ipi text NOT NULL DEFAULT '',
  aliquota_ipi numeric NOT NULL DEFAULT 0,
  cst_pis text NOT NULL DEFAULT '',
  aliquota_pis numeric NOT NULL DEFAULT 0,
  cst_cofins text NOT NULL DEFAULT '',
  aliquota_cofins numeric NOT NULL DEFAULT 0,
  cfop_interno text NOT NULL DEFAULT '',      -- operação dentro da UF
  cfop_externo text NOT NULL DEFAULT '',      -- operação interestadual
  mva_st numeric,                             -- % margem de valor agregado (ST) — nullable
  aliquota_icms_st numeric,                   -- alíquota ICMS-ST — nullable
  active boolean NOT NULL DEFAULT true,
  notes text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Um perfil ATIVO por NCM (inativos podem coexistir como histórico).
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_tax_profiles_active_ncm
  ON public.fiscal_tax_profiles(ncm) WHERE active;

ALTER TABLE public.fiscal_tax_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view fiscal_tax_profiles" ON public.fiscal_tax_profiles;
CREATE POLICY "Auth users can view fiscal_tax_profiles" ON public.fiscal_tax_profiles FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert fiscal_tax_profiles" ON public.fiscal_tax_profiles;
CREATE POLICY "Auth users can insert fiscal_tax_profiles" ON public.fiscal_tax_profiles FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update fiscal_tax_profiles" ON public.fiscal_tax_profiles;
CREATE POLICY "Auth users can update fiscal_tax_profiles" ON public.fiscal_tax_profiles FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete fiscal_tax_profiles" ON public.fiscal_tax_profiles;
CREATE POLICY "Auth users can delete fiscal_tax_profiles" ON public.fiscal_tax_profiles FOR DELETE TO authenticated USING (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION public.set_updated_at() RETURNS trigger AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_fiscal_tax_profiles_updated_at ON public.fiscal_tax_profiles;
CREATE TRIGGER trg_fiscal_tax_profiles_updated_at
  BEFORE UPDATE ON public.fiscal_tax_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Cobertura: NCMs em uso nas fichas técnicas × existência de perfil ativo.
CREATE OR REPLACE VIEW public.v_ncm_coverage AS
SELECT
  t.ncm,
  count(*) AS sheets_using,
  EXISTS (SELECT 1 FROM public.fiscal_tax_profiles fp WHERE fp.ncm = t.ncm AND fp.active) AS has_profile
FROM public.technical_sheets t
WHERE t.ncm IS NOT NULL AND t.ncm <> ''
GROUP BY t.ncm;
