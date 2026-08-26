-- Desativa o designer livre e torna os dois padrões L42PRO imutáveis para
-- usuários da aplicação. Registros legados são preservados para auditoria.

BEGIN;

ALTER TABLE public.label_templates
  ADD COLUMN IF NOT EXISTS system_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.label_templates'::regclass
      AND conname = 'label_templates_system_key_check'
  ) THEN
    ALTER TABLE public.label_templates
      ADD CONSTRAINT label_templates_system_key_check
      CHECK (
        system_key IS NULL
        OR system_key IN ('external_box_l42pro', 'individual_package_l42pro')
      );
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_label_templates_system_key
  ON public.label_templates (system_key)
  WHERE system_key IS NOT NULL;

-- Não apagar modelos antigos: o FK de print_jobs pode precisar deles em
-- históricos de outros ambientes. Eles apenas deixam de ser elegíveis.
UPDATE public.label_templates
SET is_active = false
WHERE system_key IS NULL
  AND is_active IS DISTINCT FROM false;

INSERT INTO public.label_templates (
  system_key,
  name,
  type,
  width_mm,
  height_mm,
  layout_config,
  is_active
)
VALUES
  (
    'external_box_l42pro',
    'Caixa externa · L42PRO 50×30',
    'thermal',
    50,
    30,
    jsonb_build_object(
      'schema_version', 2,
      'locked', true,
      'builder_key', 'external_box',
      -- Manter o schema legado torna a migration segura durante a janela
      -- migration -> frontend e em eventual rollback do deploy.
      'category', 'thermal',
      'type', 'thermal',
      'print_settings', jsonb_build_object(
        'dpi', 203,
        'color_mode', 'monochrome',
        'copies_default', 1
      ),
      'required_fields', jsonb_build_array('reference', 'color', 'material'),
      'fields', jsonb_build_array(
        jsonb_build_object(
          'id', 'reference',
          'name', 'Referência',
          'type', 'dynamic_text',
          'position', jsonb_build_object('x', 1.8, 'y', 5.5, 'width', 46.4, 'height', 7),
          'styling', jsonb_build_object(
            'font_size', 16,
            'font_weight', 'bold',
            'text_align', 'left',
            'text_transform', 'uppercase'
          ),
          'data_source', 'product_name'
        ),
        jsonb_build_object(
          'id', 'color',
          'name', 'Cor',
          'type', 'dynamic_text',
          'position', jsonb_build_object('x', 1.8, 'y', 13.6, 'width', 46.4, 'height', 5.5),
          'styling', jsonb_build_object(
            'font_size', 10.5,
            'font_weight', 'bold',
            'text_align', 'left',
            'text_transform', 'uppercase'
          ),
          'data_source', 'color'
        ),
        jsonb_build_object(
          'id', 'material',
          'name', 'Material',
          'type', 'dynamic_text',
          'position', jsonb_build_object('x', 1.8, 'y', 20.2, 'width', 46.4, 'height', 5.5),
          'styling', jsonb_build_object(
            'font_size', 10,
            'font_weight', 'normal',
            'text_align', 'left',
            'text_transform', 'uppercase'
          ),
          'data_source', 'custom'
        )
      ),
      'geometry', jsonb_build_object(
        'label_width_mm', 50,
        'label_height_mm', 30,
        'safe_width_mm', 48,
        'safe_height_mm', 28,
        'columns', 2,
        'column_gap_mm', 6,
        'page_width_mm', 106,
        'page_height_mm', 30
      )
    ),
    true
  ),
  (
    'individual_package_l42pro',
    'Embalagem individual · L42PRO 50×30',
    'thermal',
    50,
    30,
    jsonb_build_object(
      'schema_version', 2,
      'locked', true,
      'builder_key', 'individual_package',
      'category', 'thermal',
      'type', 'thermal',
      'print_settings', jsonb_build_object(
        'dpi', 203,
        'color_mode', 'monochrome',
        'copies_default', 1
      ),
      'required_fields', jsonb_build_array('reference', 'color', 'material'),
      'fields', jsonb_build_array(
        jsonb_build_object(
          'id', 'reference',
          'name', 'Referência',
          'type', 'dynamic_text',
          'position', jsonb_build_object('x', 1.8, 'y', 5.7, 'width', 46.4, 'height', 7),
          'styling', jsonb_build_object(
            'font_size', 15.5,
            'font_weight', 'bold',
            'text_align', 'center',
            'text_transform', 'uppercase'
          ),
          'data_source', 'product_name'
        ),
        jsonb_build_object(
          'id', 'color',
          'name', 'Cor',
          'type', 'dynamic_text',
          'position', jsonb_build_object('x', 1.8, 'y', 13.7, 'width', 46.4, 'height', 5.5),
          'styling', jsonb_build_object(
            'font_size', 10.5,
            'font_weight', 'bold',
            'text_align', 'center',
            'text_transform', 'uppercase'
          ),
          'data_source', 'color'
        ),
        jsonb_build_object(
          'id', 'material',
          'name', 'Material',
          'type', 'dynamic_text',
          'position', jsonb_build_object('x', 1.8, 'y', 20.2, 'width', 46.4, 'height', 5.5),
          'styling', jsonb_build_object(
            'font_size', 9.5,
            'font_weight', 'normal',
            'text_align', 'center',
            'text_transform', 'uppercase'
          ),
          'data_source', 'custom'
        )
      ),
      'geometry', jsonb_build_object(
        'label_width_mm', 50,
        'label_height_mm', 30,
        'safe_width_mm', 48,
        'safe_height_mm', 28,
        'columns', 2,
        'column_gap_mm', 6,
        'page_width_mm', 106,
        'page_height_mm', 30
      )
    ),
    true
  )
ON CONFLICT (system_key) WHERE system_key IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name,
  type = EXCLUDED.type,
  width_mm = EXCLUDED.width_mm,
  height_mm = EXCLUDED.height_mm,
  layout_config = EXCLUDED.layout_config,
  is_active = true;

DROP POLICY IF EXISTS "Approved users can insert label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Approved users can update label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Approved users can delete label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Approved users can view templates" ON public.label_templates;
DROP POLICY IF EXISTS "Auth users can view label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Public read templates" ON public.label_templates;
DROP POLICY IF EXISTS "Public read label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Anyone can view label_templates" ON public.label_templates;
DROP POLICY IF EXISTS "Approved users can view standard label templates" ON public.label_templates;

ALTER TABLE public.label_templates ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.label_templates FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.label_templates
  FROM authenticated;
GRANT SELECT ON TABLE public.label_templates TO authenticated;

CREATE POLICY "Approved users can view standard label templates"
  ON public.label_templates
  FOR SELECT
  TO authenticated
  -- A leitura inclui registros legados para que joins do histórico continuem
  -- exibindo o nome do modelo. A UI nova só oferece os dois oficiais ativos.
  USING ((SELECT public.is_approved_user()));

DO $$
DECLARE
  v_standard_count integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'label_templates'
      AND cmd IN ('SELECT', 'ALL')
      AND policyname <> 'Approved users can view standard label templates'
  ) THEN
    RAISE EXCEPTION 'Política de leitura concorrente encontrada em label_templates';
  END IF;

  SELECT count(*)
  INTO v_standard_count
  FROM public.label_templates
  WHERE system_key IN ('external_box_l42pro', 'individual_package_l42pro')
    AND is_active IS TRUE
    AND width_mm = 50
    AND height_mm = 30
    AND layout_config->'geometry'->>'columns' = '2'
    AND layout_config->'geometry'->>'column_gap_mm' = '6'
    AND layout_config->'geometry'->>'page_width_mm' = '106'
    AND jsonb_typeof(layout_config->'fields') = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(layout_config->'fields') AS field(value)
      WHERE jsonb_typeof(field.value) <> 'object'
        OR field.value->'position' IS NULL
        OR field.value->'styling' IS NULL
    );

  IF v_standard_count <> 2 THEN
    RAISE EXCEPTION 'label_templates: esperados 2 padrões L42PRO válidos, encontrados %', v_standard_count;
  END IF;

  IF has_table_privilege('anon', 'public.label_templates', 'SELECT')
     OR has_table_privilege('authenticated', 'public.label_templates', 'INSERT')
     OR has_table_privilege('authenticated', 'public.label_templates', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.label_templates', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.label_templates', 'SELECT') THEN
    RAISE EXCEPTION 'label_templates: privilégios finais divergentes do contrato somente leitura';
  END IF;
END;
$$;

COMMENT ON COLUMN public.label_templates.system_key IS
  'Identificador imutável dos dois padrões oficiais L42PRO; NULL identifica modelo legado inativo.';

COMMIT;
