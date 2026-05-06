
-- 1. Create centralized colors table
CREATE TABLE public.colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cor_id text UNIQUE NOT NULL DEFAULT '',
  nome text NOT NULL DEFAULT '',
  referencia_hex text DEFAULT '',
  referencia_pantone text DEFAULT '',
  imagem_swatch text DEFAULT '',
  acabamento_disponivel jsonb DEFAULT '[]'::jsonb,
  materiais_compativeis jsonb DEFAULT '[]'::jsonb,
  estoque_por_material jsonb DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.colors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth users can view colors" ON public.colors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Approved users can insert colors" ON public.colors FOR INSERT TO authenticated WITH CHECK (is_approved_user());
CREATE POLICY "Approved users can update colors" ON public.colors FOR UPDATE TO authenticated USING (is_approved_user());
CREATE POLICY "Approved users can delete colors" ON public.colors FOR DELETE TO authenticated USING (is_approved_user());

-- 2. Add new fields to technical_sheets
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS cor_predominante_id uuid REFERENCES public.colors(id),
  ADD COLUMN IF NOT EXISTS cor_palmilha_id uuid REFERENCES public.colors(id),
  ADD COLUMN IF NOT EXISTS cor_tiras_id uuid REFERENCES public.colors(id),
  ADD COLUMN IF NOT EXISTS cor_solado_id uuid REFERENCES public.colors(id),
  ADD COLUMN IF NOT EXISTS acabamento_tiras text DEFAULT '',
  ADD COLUMN IF NOT EXISTS material_solado_tipo text DEFAULT '',
  ADD COLUMN IF NOT EXISTS obs_harmonizacao text DEFAULT '',
  ADD COLUMN IF NOT EXISTS status_ficha text NOT NULL DEFAULT 'rascunho',
  ADD COLUMN IF NOT EXISTS qtd_prevista integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS data_ultima_revisao date,
  ADD COLUMN IF NOT EXISTS responsavel_revisao text DEFAULT '';

-- 3. Migrate existing colors from various sources
INSERT INTO public.colors (cor_id, nome, status)
SELECT DISTINCT
  'C-' || lpad(row_number() OVER (ORDER BY color_name)::text, 3, '0') || '-' || upper(left(regexp_replace(color_name, '[^a-zA-Z]', '', 'g'), 3)),
  color_name,
  'ativo'
FROM (
  -- Colors from technical_sheets.colors field
  SELECT DISTINCT trim(unnest(string_to_array(colors, ','))) AS color_name
  FROM public.technical_sheets
  WHERE colors IS NOT NULL AND colors != ''
  UNION
  -- Colors from products.color field
  SELECT DISTINCT trim(color) AS color_name
  FROM public.products
  WHERE color IS NOT NULL AND trim(color) != ''
  UNION
  -- Colors from group_supplier_materials.color field
  SELECT DISTINCT trim(color) AS color_name
  FROM public.group_supplier_materials
  WHERE color IS NOT NULL AND trim(color) != ''
  UNION
  -- Colors from reference_materials.color field
  SELECT DISTINCT trim(color) AS color_name
  FROM public.reference_materials
  WHERE color IS NOT NULL AND trim(color) != ''
) sub
WHERE color_name IS NOT NULL AND color_name != ''
ON CONFLICT (cor_id) DO NOTHING;
