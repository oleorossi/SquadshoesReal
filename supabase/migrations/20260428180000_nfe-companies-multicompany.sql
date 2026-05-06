-- Multi-company NF-e support
-- Creates 'companies' table for multiple CNPJs and links nfe_emitidas to a company.

CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  inscricao_estadual text NOT NULL DEFAULT '',
  razao_social text NOT NULL,
  nome_fantasia text NOT NULL DEFAULT '',
  logradouro text NOT NULL DEFAULT '',
  numero text NOT NULL DEFAULT '',
  complemento text NOT NULL DEFAULT '',
  bairro text NOT NULL DEFAULT '',
  cidade text NOT NULL DEFAULT '',
  uf text NOT NULL DEFAULT '',
  cep text NOT NULL DEFAULT '',
  codigo_municipio text NOT NULL DEFAULT '',
  regime_tributario text NOT NULL DEFAULT '1',
  serie_nfe integer NOT NULL DEFAULT 1,
  ambiente text NOT NULL DEFAULT 'homologacao',
  certificate_path text DEFAULT '',
  natureza_operacao text NOT NULL DEFAULT 'Venda de Mercadoria',
  cfop text NOT NULL DEFAULT '5102',
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can manage companies" ON public.companies;
CREATE POLICY "Auth users can manage companies" ON public.companies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Add company link to nfe_emitidas (nullable for backwards compat with fiscal_config flow)
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cnpj_emitente text DEFAULT '';

-- Add cancel support fields
ALTER TABLE public.nfe_emitidas
  ADD COLUMN IF NOT EXISTS justificativa_cancelamento text DEFAULT '',
  ADD COLUMN IF NOT EXISTS data_cancelamento timestamptz;

-- Trigger to keep updated_at fresh on companies
DROP FUNCTION IF EXISTS public.set_companies_updated_at() CASCADE;
CREATE OR REPLACE FUNCTION public.set_companies_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_companies_updated_at();
