
-- Storage bucket for certificates (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('certificates', 'certificates', false);

-- RLS for certificates bucket - only authenticated users
DROP POLICY IF EXISTS "Auth users can upload certificates" ON storage.objects;
CREATE POLICY "Auth users can upload certificates" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'certificates');
DROP POLICY IF EXISTS "Auth users can read certificates" ON storage.objects;
CREATE POLICY "Auth users can read certificates" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'certificates');
DROP POLICY IF EXISTS "Auth users can delete certificates" ON storage.objects;
CREATE POLICY "Auth users can delete certificates" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'certificates');

-- Fiscal configuration table
CREATE TABLE public.fiscal_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL DEFAULT '',
  inscricao_estadual text NOT NULL DEFAULT '',
  razao_social text NOT NULL DEFAULT '',
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
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fiscal_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view fiscal_config" ON public.fiscal_config;
CREATE POLICY "Auth users can view fiscal_config" ON public.fiscal_config FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert fiscal_config" ON public.fiscal_config;
CREATE POLICY "Auth users can insert fiscal_config" ON public.fiscal_config FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update fiscal_config" ON public.fiscal_config;
CREATE POLICY "Auth users can update fiscal_config" ON public.fiscal_config FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete fiscal_config" ON public.fiscal_config;
CREATE POLICY "Auth users can delete fiscal_config" ON public.fiscal_config FOR DELETE TO authenticated USING (true);

-- NF-e emitidas table
CREATE TABLE public.nfe_emitidas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_order_id uuid REFERENCES public.sale_orders(id) ON DELETE SET NULL,
  ref_nfe text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'processando',
  numero text DEFAULT '',
  serie text DEFAULT '',
  chave_acesso text DEFAULT '',
  xml_url text DEFAULT '',
  danfe_url text DEFAULT '',
  valor_total numeric NOT NULL DEFAULT 0,
  data_emissao timestamptz DEFAULT now(),
  motivo_rejeicao text DEFAULT '',
  protocolo text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nfe_emitidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Auth users can view nfe_emitidas" ON public.nfe_emitidas;
CREATE POLICY "Auth users can view nfe_emitidas" ON public.nfe_emitidas FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can insert nfe_emitidas" ON public.nfe_emitidas;
CREATE POLICY "Auth users can insert nfe_emitidas" ON public.nfe_emitidas FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "Auth users can update nfe_emitidas" ON public.nfe_emitidas;
CREATE POLICY "Auth users can update nfe_emitidas" ON public.nfe_emitidas FOR UPDATE TO authenticated USING (true);
DROP POLICY IF EXISTS "Auth users can delete nfe_emitidas" ON public.nfe_emitidas;
CREATE POLICY "Auth users can delete nfe_emitidas" ON public.nfe_emitidas FOR DELETE TO authenticated USING (true);
