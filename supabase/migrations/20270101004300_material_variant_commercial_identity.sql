-- Identidade comercial de variantes de material e código de cor do fornecedor
-- Decisão normativa: specs/identidade-variantes-e-tiras-compradas.md
--
-- Esta migration é deliberadamente conservadora com histórico:
--   * não renomeia SKU existente;
--   * aborta com diagnóstico quando a unicidade/obrigatoriedade não pode ser
--     aplicada;
--   * congela no item do PV a identidade comercial usada na confirmação;
--   * rejeita BOM específico ligado a variante de outra ficha, sem inferir
--     remapeamento.

-- =============================================================================
-- 1. Código da cor no catálogo do fornecedor — produto físico exato
-- =============================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_color_code text;

COMMENT ON COLUMN public.products.supplier_color_code IS
  'Código da cor no catálogo do fornecedor indicado em products.supplier_id. '
  'Pertence ao produto físico exato (grupo + cor + fornecedor) e não substitui '
  'products.color, products.sku nem o SKU comercial da variante da referência.';

CREATE OR REPLACE FUNCTION public.mark_product_supplier_color_code_explicit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- UPDATE OF dispara pela presença da coluna no SET, mesmo quando A/001 vira
  -- B/001. Essa informação não pode ser inferida comparando OLD/NEW. O
  -- marcador existe só nesta transação e é amarrado ao produto da linha.
  PERFORM set_config(
    'app.product_supplier_color_code_explicit_id',
    NEW.id::text,
    true
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_product_supplier_color_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_code_was_explicit boolean := false;
BEGIN
  v_code_was_explicit := TG_OP = 'UPDATE'
    AND COALESCE(
      current_setting('app.product_supplier_color_code_explicit_id', true)
        = NEW.id::text,
      false
    );

  -- Defesa server-side: trocar o fornecedor sem mandar um código realmente
  -- novo nunca carrega silenciosamente o código do catálogo anterior.
  IF TG_OP = 'UPDATE'
     AND NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
     AND NOT v_code_was_explicit THEN
    NEW.supplier_color_code := NULL;
  END IF;
  NEW.supplier_color_code := NULLIF(btrim(COALESCE(NEW.supplier_color_code, '')), '');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_product_supplier_color_code_explicit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('app.product_supplier_color_code_explicit_id', true)
       = NEW.id::text THEN
    PERFORM set_config(
      'app.product_supplier_color_code_explicit_id',
      '',
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_product_supplier_color_code ON public.products;
DROP TRIGGER IF EXISTS trg_aa_mark_product_supplier_color_code_explicit ON public.products;
CREATE TRIGGER trg_aa_mark_product_supplier_color_code_explicit
BEFORE UPDATE OF supplier_color_code
ON public.products
FOR EACH ROW EXECUTE FUNCTION public.mark_product_supplier_color_code_explicit();

DROP TRIGGER IF EXISTS trg_mm_normalize_product_supplier_color_code ON public.products;
CREATE TRIGGER trg_mm_normalize_product_supplier_color_code
BEFORE INSERT OR UPDATE OF supplier_color_code, supplier_id
ON public.products
FOR EACH ROW EXECUTE FUNCTION public.normalize_product_supplier_color_code();

DROP TRIGGER IF EXISTS trg_zz_reset_product_supplier_color_code_explicit ON public.products;
CREATE TRIGGER trg_zz_reset_product_supplier_color_code_explicit
BEFORE INSERT OR UPDATE
ON public.products
FOR EACH ROW EXECUTE FUNCTION public.reset_product_supplier_color_code_explicit();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_supplier_color_code_trimmed_ck'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_supplier_color_code_trimmed_ck
      CHECK (
        supplier_color_code IS NULL
        OR (supplier_color_code <> '' AND supplier_color_code = btrim(supplier_color_code))
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_supplier_color_code_requires_supplier_ck'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_supplier_color_code_requires_supplier_ck
      CHECK (supplier_color_code IS NULL OR supplier_id IS NOT NULL);
  END IF;

END;
$$;

-- Não há índice UNIQUE: o mesmo código pode ser reutilizado por outro
-- fornecedor ou por outra família do mesmo fornecedor.

-- =============================================================================
-- 2. SKU comercial obrigatório/único da variante
-- =============================================================================

DO $$
DECLARE
  v_details text;
BEGIN
  SELECT string_agg(
           format(
             'variante=%s referencia=%s nome="%s" sku="%s"',
             q.id,
             COALESCE(q.reference_code, q.reference_id::text),
             q.material_name,
             COALESCE(q.sku, '<NULL>')
           ),
           E'\n'
         )
    INTO v_details
  FROM (
    SELECT rmv.id, rmv.reference_id, ts.code AS reference_code,
           rmv.material_name, rmv.sku
    FROM public.reference_material_variants rmv
    LEFT JOIN public.technical_sheets ts ON ts.id = rmv.reference_id
    WHERE rmv.active
      AND NULLIF(btrim(COALESCE(rmv.sku, '')), '') IS NULL
    ORDER BY ts.code NULLS LAST, rmv.reference_id, rmv.display_order, rmv.id
    LIMIT 100
  ) q;

  IF v_details IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Não é possível exigir SKU nas variantes ativas: existem variantes sem SKU.',
      DETAIL = v_details,
      HINT = 'Cadastre um SKU comercial explícito em cada variante listada e reaplique a migration. Nenhum SKU será inventado automaticamente.';
  END IF;
END;
$$;

DO $$
DECLARE
  v_details text;
BEGIN
  SELECT string_agg(
           format(
             'variante=%s referencia=%s nome="%s" tamanho_sku=%s',
             q.id,
             COALESCE(q.reference_code, q.reference_id::text),
             q.material_name,
             char_length(btrim(q.sku))
           ),
           E'\n'
         )
    INTO v_details
  FROM (
    SELECT rmv.id, rmv.reference_id, ts.code AS reference_code,
           rmv.material_name, rmv.sku
    FROM public.reference_material_variants rmv
    LEFT JOIN public.technical_sheets ts ON ts.id = rmv.reference_id
    WHERE char_length(btrim(COALESCE(rmv.sku, ''))) > 80
    ORDER BY ts.code NULLS LAST, rmv.reference_id, rmv.display_order, rmv.id
    LIMIT 100
  ) q;

  IF v_details IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22001',
      MESSAGE = 'Não é possível limitar o SKU das variantes: existem SKUs com mais de 80 caracteres.',
      DETAIL = v_details,
      HINT = 'Encurte explicitamente os SKUs listados e reaplique a migration. Nenhum SKU será truncado automaticamente.';
  END IF;
END;
$$;

DO $$
DECLARE
  v_details text;
BEGIN
  SELECT string_agg(
           format('sku_normalizado="%s" variantes=[%s]', d.normalized_sku, d.variants),
           E'\n'
         )
    INTO v_details
  FROM (
    SELECT lower(btrim(rmv.sku)) AS normalized_sku,
           string_agg(
             format(
               '%s/%s/%s',
               COALESCE(ts.code, rmv.reference_id::text),
               rmv.material_name,
               rmv.id
             ),
             ', ' ORDER BY COALESCE(ts.code, rmv.reference_id::text), rmv.material_name, rmv.id
           ) AS variants
    FROM public.reference_material_variants rmv
    LEFT JOIN public.technical_sheets ts ON ts.id = rmv.reference_id
    WHERE NULLIF(btrim(COALESCE(rmv.sku, '')), '') IS NOT NULL
    GROUP BY lower(btrim(rmv.sku))
    HAVING count(*) > 1
    ORDER BY lower(btrim(rmv.sku))
    LIMIT 100
  ) d;

  IF v_details IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Não é possível criar a unicidade global de SKU das variantes: há duplicidades normalizadas.',
      DETAIL = v_details,
      HINT = 'Revise os SKUs listados. Espaços nas extremidades e diferença de caixa não distinguem SKU; nenhum histórico será renomeado automaticamente.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_reference_material_variant_sku()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.sku := NULLIF(btrim(COALESCE(NEW.sku, '')), '');
  IF char_length(COALESCE(NEW.sku, '')) > 80 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22001',
      MESSAGE = 'O SKU comercial da variante deve ter no máximo 80 caracteres.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_reference_material_variant_sku
  ON public.reference_material_variants;
CREATE TRIGGER trg_normalize_reference_material_variant_sku
BEFORE INSERT OR UPDATE OF sku
ON public.reference_material_variants
FOR EACH ROW EXECUTE FUNCTION public.normalize_reference_material_variant_sku();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reference_material_variants_active_sku_ck'
      AND conrelid = 'public.reference_material_variants'::regclass
  ) THEN
    ALTER TABLE public.reference_material_variants
      ADD CONSTRAINT reference_material_variants_active_sku_ck
      CHECK (NOT active OR NULLIF(btrim(COALESCE(sku, '')), '') IS NOT NULL);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reference_material_variants_sku_length_ck'
      AND conrelid = 'public.reference_material_variants'::regclass
  ) THEN
    ALTER TABLE public.reference_material_variants
      ADD CONSTRAINT reference_material_variants_sku_length_ck
      CHECK (sku IS NULL OR char_length(sku) <= 80);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_reference_material_variants_normalized_sku
  ON public.reference_material_variants (lower(btrim(sku)))
  WHERE NULLIF(btrim(COALESCE(sku, '')), '') IS NOT NULL;

COMMENT ON COLUMN public.reference_material_variants.sku IS
  'SKU comercial da variante da referência. Obrigatório quando active=true e '
  'único globalmente por lower(btrim(sku)), com no máximo 80 caracteres; '
  'a área/consumo continua herdada da ficha.';

-- Variantes são catálogo técnico (mesma classe de products/technical_sheets):
-- aprovados podem ler; somente os papéis canônicos de gestão do catálogo podem
-- criar, alterar ou excluir. As policies antigas deixavam qualquer aprovado
-- trocar SKU/NCM/preço fiscal.
ALTER TABLE public.reference_material_variants ENABLE ROW LEVEL SECURITY;

-- Remover nominalmente cada policy permissiva já usada pelo histórico antes
-- de instalar a allow-list atual. Policies RLS são permissivas por padrão: uma
-- policy antiga sobrevivente faria OR com a nova e reabriria a escrita.
DROP POLICY IF EXISTS "authenticated_rw_ref_mat_variants"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_select_ref_mat_variants"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_insert_ref_mat_variants"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_update_ref_mat_variants"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_delete_ref_mat_variants"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_select"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_insert"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_update"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS "approved_delete"
  ON public.reference_material_variants;
DROP POLICY IF EXISTS reference_material_variants_select_approved
  ON public.reference_material_variants;
DROP POLICY IF EXISTS reference_material_variants_catalog_write
  ON public.reference_material_variants;

CREATE POLICY reference_material_variants_select_approved
  ON public.reference_material_variants
  FOR SELECT TO authenticated
  USING ((SELECT public.is_approved_user()));

CREATE POLICY reference_material_variants_catalog_write
  ON public.reference_material_variants
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_approved_user())
    AND (SELECT public.user_has_any_role(
      ARRAY['admin'::text, 'gerente'::text]
    ))
  )
  WITH CHECK (
    (SELECT public.is_approved_user())
    AND (SELECT public.user_has_any_role(
      ARRAY['admin'::text, 'gerente'::text]
    ))
  );

DO $$
DECLARE
  v_unexpected_policies text;
BEGIN
  SELECT string_agg(p.policyname::text, ', ' ORDER BY p.policyname::text)
    INTO v_unexpected_policies
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename = 'reference_material_variants'
    AND p.policyname::text <> ALL (ARRAY[
      'reference_material_variants_select_approved',
      'reference_material_variants_catalog_write'
    ]::text[]);

  IF v_unexpected_policies IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Policies RLS inesperadas em reference_material_variants.',
      DETAIL = v_unexpected_policies,
      HINT = 'Revise e remova explicitamente cada policy fora da allow-list; não mantenha writers genéricos por compatibilidade.';
  END IF;
END;
$$;

-- ACL mínima: RLS decide quais autenticados podem escrever. anon/PUBLIC não
-- recebem acesso à tabela; service_role preserva a porta administrativa usada
-- por migrations e funções de backend.
REVOKE ALL ON TABLE public.reference_material_variants
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.reference_material_variants TO authenticated;
GRANT ALL ON TABLE public.reference_material_variants TO service_role;

-- =============================================================================
-- 3. Variante específica só pode pertencer à própria ficha/referência
-- =============================================================================

DO $$
DECLARE
  v_details text;
BEGIN
  SELECT string_agg(
           format(
             'sheet_material=%s ficha_bom=%s variante=%s ficha_variante=%s',
             q.sheet_material_id,
             q.sheet_id,
             q.material_variant_id,
             q.variant_reference_id
           ),
           E'\n'
         )
    INTO v_details
  FROM (
    SELECT sm.id AS sheet_material_id, sm.sheet_id, sm.material_variant_id,
           rmv.reference_id AS variant_reference_id
    FROM public.sheet_materials sm
    JOIN public.reference_material_variants rmv ON rmv.id = sm.material_variant_id
    WHERE sm.sheet_id IS DISTINCT FROM rmv.reference_id
    ORDER BY sm.sheet_id, sm.id
    LIMIT 100
  ) q;

  IF v_details IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Há linhas de BOM específicas ligadas a variante de outra ficha.',
      DETAIL = v_details,
      HINT = 'Revise cada vínculo cruzado antes de reaplicar. A migration não remapeia nem move BOM automaticamente.';
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reference_material_variants_id_reference_id_key'
      AND conrelid = 'public.reference_material_variants'::regclass
  ) THEN
    ALTER TABLE public.reference_material_variants
      ADD CONSTRAINT reference_material_variants_id_reference_id_key
      UNIQUE (id, reference_id);
  END IF;
END;
$$;

DO $$
DECLARE
  v_details text;
BEGIN
  SELECT string_agg(
           format(
             'item=%s pv=%s status=%s referencia_item=%s variante=%s referencia_variante=%s',
             q.sale_order_item_id,
             COALESCE(q.order_number, q.sale_order_id::text),
             COALESCE(q.order_status, '<desconhecido>'),
             COALESCE(q.item_reference_id::text, '<NULL>'),
             q.material_variant_id,
             COALESCE(q.variant_reference_id::text, '<inexistente>')
           ),
           E'\n'
         )
    INTO v_details
  FROM (
    SELECT soi.id AS sale_order_item_id,
           soi.sale_order_id,
           so.order_number,
           so.status AS order_status,
           soi.reference_id AS item_reference_id,
           soi.material_variant_id,
           rmv.reference_id AS variant_reference_id
    FROM public.sale_order_items soi
    LEFT JOIN public.sale_orders so ON so.id = soi.sale_order_id
    LEFT JOIN public.reference_material_variants rmv
      ON rmv.id = soi.material_variant_id
    WHERE soi.material_variant_id IS NOT NULL
      AND (
        rmv.id IS NULL
        OR soi.reference_id IS DISTINCT FROM rmv.reference_id
      )
    ORDER BY so.order_number NULLS LAST, soi.sale_order_id, soi.id
    LIMIT 100
  ) q;

  IF v_details IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Não é possível amarrar a variante do item à referência: há itens de PV com vínculo cruzado ou órfão.',
      DETAIL = v_details,
      HINT = 'Revise cada item listado contra o pedido original. A migration não troca referência nem variante e não reescreve histórico.';
  END IF;
END;
$$;

ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_material_variant_id_fkey;
ALTER TABLE public.sale_order_items
  DROP CONSTRAINT IF EXISTS sale_order_items_material_variant_same_reference_fkey;

ALTER TABLE public.sale_order_items
  ADD CONSTRAINT sale_order_items_material_variant_same_reference_fkey
  FOREIGN KEY (material_variant_id, reference_id)
  REFERENCES public.reference_material_variants(id, reference_id)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT sale_order_items_material_variant_same_reference_fkey
  ON public.sale_order_items IS
  'A variante selecionada no item do PV deve pertencer à mesma referência; exclusão é restrita para preservar histórico.';

ALTER TABLE public.sheet_materials
  DROP CONSTRAINT IF EXISTS sheet_materials_material_variant_id_fkey;

ALTER TABLE public.sheet_materials
  ADD CONSTRAINT sheet_materials_material_variant_same_sheet_fkey
  FOREIGN KEY (material_variant_id, sheet_id)
  REFERENCES public.reference_material_variants(id, reference_id)
  ON DELETE RESTRICT;

COMMENT ON CONSTRAINT sheet_materials_material_variant_same_sheet_fkey
  ON public.sheet_materials IS
  'Linha específica de BOM só pode apontar variante pertencente à mesma ficha; NULL permanece linha compartilhada.';

-- =============================================================================
-- 4. Snapshot comercial server-side no item do PV
-- =============================================================================

ALTER TABLE public.sale_order_items
  ADD COLUMN IF NOT EXISTS material_variant_commercial_snapshot jsonb;

COMMENT ON COLUMN public.sale_order_items.material_variant_commercial_snapshot IS
  'Snapshot comercial imutável da variante escolhida: id, nome, SKU, GTIN, NCM, '
  'descrição, cor, preço contratual e proveniência. sale_order_items.unit_price '
  'continua sendo a fonte autoritativa do preço contratado.';

CREATE OR REPLACE FUNCTION public.build_material_variant_commercial_snapshot(
  p_material_variant_id uuid,
  p_reference_id uuid,
  p_color text,
  p_unit_price numeric,
  p_capture_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_variant public.reference_material_variants%ROWTYPE;
  v_reference_name text;
  v_reference_ncm text;
  v_effective_ncm text;
  v_effective_description text;
BEGIN
  IF p_capture_reason NOT IN (
    'item_insert',
    'variant_changed',
    'header_confirmation',
    'migration_backfill_requires_review'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Motivo inválido para captura do snapshot comercial.';
  END IF;

  SELECT *
    INTO v_variant
  FROM public.reference_material_variants
  WHERE id = p_material_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'Variação de material não encontrada para congelar a identidade comercial.';
  END IF;

  -- Backfill legado preserva o melhor dado disponível e marca unknown para
  -- revisão. Toda captura comercial nova, sobretudo a confirmação do PV,
  -- exige a variante vendável da própria referência com SKU explícito.
  IF p_capture_reason <> 'migration_backfill_requires_review' THEN
    IF v_variant.reference_id IS DISTINCT FROM p_reference_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A variação de material pertence a outra referência.';
    END IF;
    IF NOT COALESCE(v_variant.active, false) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A variação de material selecionada está inativa.';
    END IF;
    IF NULLIF(btrim(COALESCE(v_variant.sku, '')), '') IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'A variação de material selecionada não possui SKU comercial.';
    END IF;
  END IF;

  SELECT ts.name, ts.ncm
    INTO v_reference_name, v_reference_ncm
  FROM public.technical_sheets ts
  WHERE ts.id = p_reference_id;

  -- NCM/descrição são os valores EFETIVOS da regra fiscal vigente na
  -- captura. Assim a NF nunca precisa consultar a ficha viva após confirmação.
  v_effective_ncm := COALESCE(
    NULLIF(btrim(COALESCE(v_variant.ncm, '')), ''),
    NULLIF(btrim(COALESCE(v_reference_ncm, '')), '')
  );
  v_effective_description := COALESCE(
    NULLIF(btrim(COALESCE(v_variant.description_override, '')), ''),
    NULLIF(
      btrim(concat_ws(
        ' - ',
        NULLIF(btrim(COALESCE(v_reference_name, '')), ''),
        NULLIF(btrim(COALESCE(v_variant.material_name, '')), ''),
        NULLIF(btrim(COALESCE(p_color, '')), '')
      )),
      ''
    ),
    v_variant.material_name
  );

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'material_variant_id', v_variant.id,
    'material_name', v_variant.material_name,
    'sku', NULLIF(btrim(COALESCE(v_variant.sku, '')), ''),
    'gtin', NULLIF(btrim(COALESCE(v_variant.barcode, '')), ''),
    'ncm', v_effective_ncm,
    'description', v_effective_description,
    'color', NULLIF(btrim(COALESCE(p_color, '')), ''),
    'unit_price', p_unit_price,
    'provenance', jsonb_strip_nulls(jsonb_build_object(
      'identity_source', 'reference_material_variants',
      'ncm_source', CASE
        WHEN NULLIF(btrim(COALESCE(v_variant.ncm, '')), '') IS NOT NULL
          THEN 'reference_material_variants.ncm'
        ELSE 'technical_sheets.ncm'
      END,
      'description_source', CASE
        WHEN NULLIF(btrim(COALESCE(v_variant.description_override, '')), '') IS NOT NULL
          THEN 'reference_material_variants.description_override'
        ELSE 'technical_sheets.name+reference_material_variants.material_name+sale_order_items.color'
      END,
      'price_source', 'sale_order_items.unit_price',
      'variant_updated_at', v_variant.updated_at,
      'captured_at', clock_timestamp(),
      'capture_reason', p_capture_reason
    ))
  ));
END;
$$;

-- Congela o melhor dado historicamente disponível no instante da implantação.
-- O fallback vigente de ficha é guardado, mas a proveniência declara que ele
-- não prova o valor usado na venda histórica.
--
-- O UPDATE de snapshot não pode parecer uma edição operacional: os cinco
-- triggers amplos vivos criariam/recalculariam OP, custo, reserva, total e job
-- de tira mesmo sem mudança comercial. A migration já segura lock de DDL;
-- desabilitamos nominalmente só esses cinco durante o backfill e os reativamos
-- ainda na mesma transação. Qualquer erro faz rollback também desse estado.
ALTER TABLE public.sale_order_items DISABLE TRIGGER trg_sync_sale_order_total;
ALTER TABLE public.sale_order_items DISABLE TRIGGER trg_mark_so_costs_dirty_from_item;
ALTER TABLE public.sale_order_items DISABLE TRIGGER trg_mark_reservations_outdated_from_item;
ALTER TABLE public.sale_order_items DISABLE TRIGGER trg_sync_orders_from_sale_order_item;
ALTER TABLE public.sale_order_items DISABLE TRIGGER trg_enqueue_strap_demands_on_item_change;

WITH legacy_snapshots AS (
  SELECT soi.id,
         public.build_material_variant_commercial_snapshot(
           soi.material_variant_id,
           soi.reference_id,
           soi.color,
           soi.unit_price,
           'migration_backfill_requires_review'
         ) AS snapshot
  FROM public.sale_order_items soi
  WHERE soi.material_variant_id IS NOT NULL
    AND soi.material_variant_commercial_snapshot IS NULL
)
UPDATE public.sale_order_items soi
SET material_variant_commercial_snapshot =
  (legacy.snapshot - 'provenance')
  || jsonb_build_object(
       'provenance',
       (legacy.snapshot -> 'provenance')
       || jsonb_build_object(
            'identity_source', 'legacy_current_catalog',
            'capture_reason', 'migration_backfill_requires_review',
            'historical_truth', 'unknown'
          )
     )
FROM legacy_snapshots legacy
WHERE legacy.id = soi.id;

ALTER TABLE public.sale_order_items ENABLE TRIGGER trg_sync_sale_order_total;
ALTER TABLE public.sale_order_items ENABLE TRIGGER trg_mark_so_costs_dirty_from_item;
ALTER TABLE public.sale_order_items ENABLE TRIGGER trg_mark_reservations_outdated_from_item;
ALTER TABLE public.sale_order_items ENABLE TRIGGER trg_sync_orders_from_sale_order_item;
ALTER TABLE public.sale_order_items ENABLE TRIGGER trg_enqueue_strap_demands_on_item_change;

CREATE OR REPLACE FUNCTION public.capture_sale_order_item_material_variant_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sale_order_status text;
  v_contract_editable boolean := false;
  v_contract_changed boolean := false;
  v_header_confirmation_capture boolean := false;
  v_explicit_legacy_review boolean := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.sale_order_id IS DISTINCT FROM OLD.sale_order_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O vínculo sale_order_id do item do PV é imutável.',
      HINT = 'Crie um novo item no PV de destino; não mova uma linha existente entre pedidos.';
  END IF;

  SELECT so.status
    INTO v_sale_order_status
  FROM public.sale_orders so
  WHERE so.id = NEW.sale_order_id;

  v_contract_editable := COALESCE(v_sale_order_status, '') IN ('Rascunho', 'Pendente');
  v_header_confirmation_capture := TG_OP = 'UPDATE'
    AND pg_trigger_depth() > 1
    AND current_setting('app.material_variant_snapshot_confirmation_order_id', true)
        = NEW.sale_order_id::text;
  v_explicit_legacy_review := TG_OP = 'UPDATE'
    AND current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text;

  -- Única porta para substituir um backfill requires_review em PV já
  -- confirmado. A RPC autenticada abaixo monta o JSON; este trigger garante
  -- que ela não aproveita a exceção para mudar nenhum fato contratual.
  IF v_explicit_legacy_review THEN
    IF NEW.reference_id IS DISTINCT FROM OLD.reference_id
       OR NEW.material_variant_id IS DISTINCT FROM OLD.material_variant_id
       OR NEW.color IS DISTINCT FROM OLD.color
       OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
       OR OLD.material_variant_commercial_snapshot #>> '{provenance,historical_truth}'
            IS DISTINCT FROM 'unknown'
       OR NEW.material_variant_commercial_snapshot #>> '{provenance,historical_truth}'
            IS DISTINCT FROM 'reviewed'
       OR NEW.material_variant_commercial_snapshot #>> '{provenance,identity_source}'
            IS DISTINCT FROM 'explicit_commercial_review'
       OR NEW.material_variant_commercial_snapshot ->> 'material_variant_id'
            IS DISTINCT FROM NEW.material_variant_id::text
       OR NEW.material_variant_commercial_snapshot #>> '{provenance,reviewed_by}'
            IS DISTINCT FROM auth.uid()::text
       OR COALESCE(char_length(NULLIF(btrim(COALESCE(
            NEW.material_variant_commercial_snapshot #>> '{provenance,review_reason}',
            ''
          )), '')), 0) < 15
       OR NEW.material_variant_commercial_snapshot #> '{provenance,previous_provenance}'
            IS DISTINCT FROM OLD.material_variant_commercial_snapshot -> 'provenance' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Revisão comercial inválida: somente o snapshot legado unknown pode ser atestado.';
    END IF;
    RETURN NEW;
  END IF;

  -- Depois da confirmação do cabeçalho, identidade/cor/preço são contratuais.
  -- Writers ainda podem atualizar quantidade devolvida e outros campos
  -- operacionais, mas não reescrever os termos que NF/devolução/etiqueta usam.
  IF TG_OP = 'UPDATE' AND NOT v_contract_editable THEN
    IF NEW.reference_id IS DISTINCT FROM OLD.reference_id
       OR NEW.material_variant_id IS DISTINCT FROM OLD.material_variant_id
       OR NEW.color IS DISTINCT FROM OLD.color
       OR NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = format(
          'Identidade comercial do item está congelada: o PV está em status "%s".',
          COALESCE(v_sale_order_status, '<desconhecido>')
        ),
        HINT = 'Altere os termos somente enquanto o PV estiver em Rascunho/Pendente ou faça uma revisão comercial explícita do pedido.';
    END IF;
    NEW.material_variant_commercial_snapshot := OLD.material_variant_commercial_snapshot;
    RETURN NEW;
  END IF;

  IF NEW.material_variant_id IS NULL THEN
    NEW.material_variant_commercial_snapshot := NULL;
    RETURN NEW;
  END IF;

  -- Chamado exclusivamente pelo BEFORE trigger do cabeçalho enquanto o status
  -- persistido ainda é editável. Reconstrói do catálogo vigente no instante
  -- exato da confirmação; não confia no JSON recebido do cliente.
  IF v_header_confirmation_capture THEN
    NEW.material_variant_commercial_snapshot :=
      public.build_material_variant_commercial_snapshot(
        NEW.material_variant_id,
        NEW.reference_id,
        NEW.color,
        NEW.unit_price,
        'header_confirmation'
      );
    RETURN NEW;
  END IF;

  -- Mesma variante/referência: identidade permanece congelada. Cor e preço são
  -- termos do próprio item e só mudam quando esses campos contratuais mudam.
  -- Qualquer tentativa de editar diretamente o JSON é descartada aqui.
  IF TG_OP = 'UPDATE'
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND OLD.material_variant_commercial_snapshot IS NOT NULL THEN
    v_contract_changed := NEW.color IS DISTINCT FROM OLD.color
                          OR NEW.unit_price IS DISTINCT FROM OLD.unit_price;
    NEW.material_variant_commercial_snapshot :=
      OLD.material_variant_commercial_snapshot
      || jsonb_build_object(
           'color', NULLIF(btrim(COALESCE(NEW.color, '')), ''),
           'unit_price', NEW.unit_price
         );
    IF v_contract_changed THEN
      NEW.material_variant_commercial_snapshot :=
        NEW.material_variant_commercial_snapshot
        || jsonb_build_object('contract_updated_at', clock_timestamp());
    END IF;
    RETURN NEW;
  END IF;

  NEW.material_variant_commercial_snapshot :=
    public.build_material_variant_commercial_snapshot(
      NEW.material_variant_id,
      NEW.reference_id,
      NEW.color,
      NEW.unit_price,
      CASE WHEN TG_OP = 'INSERT' THEN 'item_insert' ELSE 'variant_changed' END
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_capture_sale_order_item_material_variant_snapshot
  ON public.sale_order_items;
CREATE TRIGGER trg_capture_sale_order_item_material_variant_snapshot
BEFORE INSERT OR UPDATE
ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.capture_sale_order_item_material_variant_snapshot();

CREATE OR REPLACE FUNCTION public.review_legacy_material_variant_commercial_snapshot(
  p_sale_order_item_id uuid,
  p_expected_snapshot jsonb,
  p_attested_identity jsonb,
  p_reason text,
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item public.sale_order_items%ROWTYPE;
  v_order_number text;
  v_order_status text;
  v_material_name text;
  v_sku text;
  v_gtin text;
  v_ncm text;
  v_description text;
  v_reason text;
  v_proposed_snapshot jsonb;
  v_previous_review_item_id text;
BEGIN
  IF NOT COALESCE(public.is_approved_user(), false)
     OR NOT COALESCE(
       public.user_has_any_role(ARRAY['admin', 'gerente', 'comercial']),
       false
     ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Somente Comercial/Gerência pode atestar snapshot comercial legado.';
  END IF;

  v_reason := NULLIF(btrim(COALESCE(p_reason, '')), '');
  IF v_reason IS NULL OR char_length(v_reason) < 15 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Informe motivo de revisão com pelo menos 15 caracteres.';
  END IF;
  IF jsonb_typeof(p_attested_identity) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'p_attested_identity deve ser um objeto JSON.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_attested_identity) AS supplied(key)
    WHERE supplied.key NOT IN ('material_name', 'sku', 'gtin', 'ncm', 'description')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'p_attested_identity aceita somente material_name, sku, gtin, ncm e description.',
      HINT = 'Cor, preço e material_variant_id são sempre derivados do item pelo servidor.';
  END IF;

  SELECT soi.*
    INTO v_item
  FROM public.sale_order_items soi
  WHERE soi.id = p_sale_order_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Item do PV não encontrado.';
  END IF;

  SELECT so.order_number, so.status
    INTO v_order_number, v_order_status
  FROM public.sale_orders so
  WHERE so.id = v_item.sale_order_id;

  IF v_item.material_variant_id IS NULL
     OR v_item.material_variant_commercial_snapshot IS NULL
     OR v_item.material_variant_commercial_snapshot #>> '{provenance,historical_truth}'
          IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'O item não possui snapshot legado requires_review pendente.';
  END IF;
  IF p_expected_snapshot IS DISTINCT FROM v_item.material_variant_commercial_snapshot THEN
    RAISE EXCEPTION USING
      ERRCODE = '40001',
      MESSAGE = 'Snapshot alterado por outra revisão; recarregue o preview antes de aplicar.';
  END IF;

  v_material_name := NULLIF(btrim(COALESCE(p_attested_identity ->> 'material_name', '')), '');
  v_sku := NULLIF(btrim(COALESCE(p_attested_identity ->> 'sku', '')), '');
  v_gtin := NULLIF(btrim(COALESCE(p_attested_identity ->> 'gtin', '')), '');
  v_ncm := NULLIF(btrim(COALESCE(p_attested_identity ->> 'ncm', '')), '');
  v_description := NULLIF(btrim(COALESCE(p_attested_identity ->> 'description', '')), '');
  IF v_material_name IS NULL OR v_sku IS NULL OR v_description IS NULL
     OR v_ncm IS NULL OR v_ncm !~ '^[0-9]{8}$' THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Ateste material_name, sku, description e NCM com 8 dígitos.';
  END IF;
  IF char_length(v_sku) > 80 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22001',
      MESSAGE = 'O SKU atestado deve ter no máximo 80 caracteres.',
      HINT = 'Revise a evidência comercial; o snapshot legado não será truncado automaticamente.';
  END IF;

  -- Cor, preço e variant_id são fatos do item bloqueados pelo servidor; a
  -- revisão só atesta a identidade historicamente conferida.
  v_proposed_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'version', 1,
    'material_variant_id', v_item.material_variant_id,
    'material_name', v_material_name,
    'sku', v_sku,
    'gtin', v_gtin,
    'ncm', v_ncm,
    'description', v_description,
    'color', NULLIF(btrim(COALESCE(v_item.color, '')), ''),
    'unit_price', v_item.unit_price,
    'provenance', jsonb_strip_nulls(jsonb_build_object(
      'identity_source', 'explicit_commercial_review',
      'historical_truth', 'reviewed',
      'reviewed_by', auth.uid(),
      'reviewed_at', clock_timestamp(),
      'review_reason', v_reason,
      'previous_provenance', v_item.material_variant_commercial_snapshot -> 'provenance'
    ))
  ));

  IF COALESCE(p_apply, false) THEN
    v_previous_review_item_id := current_setting(
      'app.material_variant_snapshot_review_item_id',
      true
    );
    PERFORM set_config(
      'app.material_variant_snapshot_review_item_id',
      v_item.id::text,
      true
    );
    UPDATE public.sale_order_items
       SET material_variant_commercial_snapshot = v_proposed_snapshot
     WHERE id = v_item.id;
    PERFORM set_config(
      'app.material_variant_snapshot_review_item_id',
      COALESCE(v_previous_review_item_id, ''),
      true
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', COALESCE(p_apply, false),
    'sale_order_item_id', v_item.id,
    'sale_order_id', v_item.sale_order_id,
    'order_number', v_order_number,
    'order_status', v_order_status,
    'before', v_item.material_variant_commercial_snapshot,
    'proposed', v_proposed_snapshot,
    'next_step', CASE
      WHEN COALESCE(p_apply, false)
        THEN 'Repetir a operação fiscal originalmente bloqueada.'
      ELSE 'Conferir proposed e repetir esta RPC com os mesmos expected/attested/reason e p_apply=true.'
    END
  );
END;
$$;

COMMENT ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(uuid, jsonb, jsonb, text, boolean) IS
  'Operação administrativa sem UI: primeiro use p_apply=false para preview; '
  'depois repita expected/attested/reason com p_apply=true. Faz CAS e registra '
  'auditoria da identidade histórica; não consulta catálogo vivo nem altera '
  'variante, cor ou preço do item.';

CREATE OR REPLACE FUNCTION public.capture_material_variant_snapshots_on_sale_order_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_previous_refresh_order_id text;
  v_invalid_variants text;
  v_invalid_snapshot_items text;
BEGIN
  IF COALESCE(OLD.status, '') IN ('Rascunho', 'Pendente')
     AND NULLIF(btrim(COALESCE(NEW.status, '')), '') IS NOT NULL
     AND NEW.status NOT IN ('Rascunho', 'Pendente', 'Cancelado', 'Cancelada') THEN
    SELECT string_agg(
             format(
               'item=%s referencia=%s variante=%s motivo=%s',
               q.sale_order_item_id,
               COALESCE(q.reference_id::text, '<NULL>'),
               COALESCE(q.material_variant_id::text, '<NULL>'),
               q.reason
             ),
             E'\n'
           )
      INTO v_invalid_variants
    FROM (
      SELECT soi.id AS sale_order_item_id,
             soi.reference_id,
             soi.material_variant_id,
             CASE
               WHEN soi.material_variant_id IS NULL
                 THEN 'referência possui variante ativa, mas o item não selecionou uma'
               WHEN rmv.id IS NULL
                 THEN 'variante inexistente'
               WHEN rmv.reference_id IS DISTINCT FROM soi.reference_id
                 THEN 'variante pertence a outra referência'
               WHEN NOT COALESCE(rmv.active, false)
                 THEN 'variante inativa'
               WHEN NULLIF(btrim(COALESCE(rmv.sku, '')), '') IS NULL
                 THEN 'variante sem SKU comercial'
             END AS reason
      FROM public.sale_order_items soi
      LEFT JOIN public.reference_material_variants rmv
        ON rmv.id = soi.material_variant_id
      WHERE soi.sale_order_id = NEW.id
        AND (
          (
            soi.material_variant_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM public.reference_material_variants candidate
              WHERE candidate.reference_id = soi.reference_id
                AND candidate.active
            )
          )
          OR (
            soi.material_variant_id IS NOT NULL
            AND (
              rmv.id IS NULL
              OR rmv.reference_id IS DISTINCT FROM soi.reference_id
              OR NOT COALESCE(rmv.active, false)
              OR NULLIF(btrim(COALESCE(rmv.sku, '')), '') IS NULL
            )
          )
        )
      ORDER BY soi.id
      LIMIT 100
    ) q;

    IF v_invalid_variants IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'O PV não pode ser confirmado: há itens sem variante comercial válida.',
        DETAIL = v_invalid_variants,
        HINT = 'Em Rascunho/Pendente, selecione uma variante ativa da própria referência com SKU cadastrado.';
    END IF;

    -- O marcador é local à transação e combinado com trigger depth. O UPDATE
    -- nomeia exclusivamente a coluna de snapshot; o BEFORE trigger do item a
    -- reconstrói pelo builder canônico e os cinco AFTER triggers genéricos
    -- vivos abaixo ignoram somente esta escrita interna estreita.
    v_previous_refresh_order_id := current_setting(
      'app.material_variant_snapshot_confirmation_order_id',
      true
    );
    PERFORM set_config(
      'app.material_variant_snapshot_confirmation_order_id',
      NEW.id::text,
      true
    );

    UPDATE public.sale_order_items soi
       SET material_variant_commercial_snapshot = soi.material_variant_commercial_snapshot
     WHERE soi.sale_order_id = NEW.id
       AND soi.material_variant_id IS NOT NULL;

    -- Defesa final: a confirmação só termina quando todo snapshot de variante
    -- possui o SKU que será usado por NF/devolução/etiqueta.
    SELECT string_agg(soi.id::text, ', ' ORDER BY soi.id)
      INTO v_invalid_snapshot_items
    FROM public.sale_order_items soi
    WHERE soi.sale_order_id = NEW.id
      AND soi.material_variant_id IS NOT NULL
      AND NULLIF(btrim(COALESCE(
            soi.material_variant_commercial_snapshot ->> 'sku',
            ''
          )), '') IS NULL;

    IF v_invalid_snapshot_items IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'O PV não pode ser confirmado: o snapshot comercial final ficou sem SKU.',
        DETAIL = format('Itens: %s', v_invalid_snapshot_items);
    END IF;

    PERFORM set_config(
      'app.material_variant_snapshot_confirmation_order_id',
      COALESCE(v_previous_refresh_order_id, ''),
      true
    );
  END IF;
  RETURN NEW;
END;
$$;

-- O refresh acima e a revisão explícita alteram exclusivamente o snapshot.
-- Mesmo assim, triggers declarados como "AFTER ... OR UPDATE" disparam pela
-- operação, não pela diferença de valores. Separamos a perna UPDATE de TODOS
-- os cinco triggers genéricos vivos. A guarda só ignora a escrita quando:
--   * excluir o snapshot torna OLD e NEW idênticos; e
--   * o marcador transacional casa exatamente com este PV/item; e
--   * no refresh de confirmação, pg_trigger_depth() prova a origem aninhada.
-- INSERT/DELETE e qualquer UPDATE normal preservam o comportamento anterior.

DROP TRIGGER IF EXISTS trg_sync_sale_order_total ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_sync_sale_order_total_on_update ON public.sale_order_items;
CREATE TRIGGER trg_sync_sale_order_total
AFTER INSERT OR DELETE ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_sale_order_total();
CREATE TRIGGER trg_sync_sale_order_total_on_update
AFTER UPDATE ON public.sale_order_items
FOR EACH ROW
WHEN (NOT (
  (to_jsonb(OLD) - 'material_variant_commercial_snapshot')
    IS NOT DISTINCT FROM
  (to_jsonb(NEW) - 'material_variant_commercial_snapshot')
  AND (
    (
      pg_trigger_depth() > 0
      AND COALESCE(
        current_setting('app.material_variant_snapshot_confirmation_order_id', true)
          = NEW.sale_order_id::text,
        false
      )
    )
    OR COALESCE(
      current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text,
      false
    )
  )
))
EXECUTE FUNCTION public.fn_sync_sale_order_total();

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_item ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_item_on_update ON public.sale_order_items;
CREATE TRIGGER trg_mark_so_costs_dirty_from_item
AFTER INSERT OR DELETE ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_item();
CREATE TRIGGER trg_mark_so_costs_dirty_from_item_on_update
AFTER UPDATE ON public.sale_order_items
FOR EACH ROW
WHEN (NOT (
  (to_jsonb(OLD) - 'material_variant_commercial_snapshot')
    IS NOT DISTINCT FROM
  (to_jsonb(NEW) - 'material_variant_commercial_snapshot')
  AND (
    (
      pg_trigger_depth() > 0
      AND COALESCE(
        current_setting('app.material_variant_snapshot_confirmation_order_id', true)
          = NEW.sale_order_id::text,
        false
      )
    )
    OR COALESCE(
      current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text,
      false
    )
  )
))
EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_item();

DROP TRIGGER IF EXISTS trg_mark_reservations_outdated_from_item ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_mark_reservations_outdated_from_item_on_update ON public.sale_order_items;
CREATE TRIGGER trg_mark_reservations_outdated_from_item
AFTER INSERT OR DELETE ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.tg_mark_reservations_outdated_from_item();
CREATE TRIGGER trg_mark_reservations_outdated_from_item_on_update
AFTER UPDATE ON public.sale_order_items
FOR EACH ROW
WHEN (NOT (
  (to_jsonb(OLD) - 'material_variant_commercial_snapshot')
    IS NOT DISTINCT FROM
  (to_jsonb(NEW) - 'material_variant_commercial_snapshot')
  AND (
    (
      pg_trigger_depth() > 0
      AND COALESCE(
        current_setting('app.material_variant_snapshot_confirmation_order_id', true)
          = NEW.sale_order_id::text,
        false
      )
    )
    OR COALESCE(
      current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text,
      false
    )
  )
))
EXECUTE FUNCTION public.tg_mark_reservations_outdated_from_item();

DROP TRIGGER IF EXISTS trg_sync_orders_from_sale_order_item ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_sync_orders_from_sale_order_item_on_update ON public.sale_order_items;
CREATE TRIGGER trg_sync_orders_from_sale_order_item
AFTER INSERT ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_orders_from_sale_order_item();
CREATE TRIGGER trg_sync_orders_from_sale_order_item_on_update
AFTER UPDATE ON public.sale_order_items
FOR EACH ROW
WHEN (NOT (
  (to_jsonb(OLD) - 'material_variant_commercial_snapshot')
    IS NOT DISTINCT FROM
  (to_jsonb(NEW) - 'material_variant_commercial_snapshot')
  AND (
    (
      pg_trigger_depth() > 0
      AND COALESCE(
        current_setting('app.material_variant_snapshot_confirmation_order_id', true)
          = NEW.sale_order_id::text,
        false
      )
    )
    OR COALESCE(
      current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text,
      false
    )
  )
))
EXECUTE FUNCTION public.tg_sync_orders_from_sale_order_item();

DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_item_change ON public.sale_order_items;
DROP TRIGGER IF EXISTS trg_enqueue_strap_demands_on_item_change_on_update ON public.sale_order_items;
CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_item_change
AFTER INSERT OR DELETE ON public.sale_order_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_item_change();
CREATE CONSTRAINT TRIGGER trg_enqueue_strap_demands_on_item_change_on_update
AFTER UPDATE ON public.sale_order_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
WHEN (NOT (
  (to_jsonb(OLD) - 'material_variant_commercial_snapshot')
    IS NOT DISTINCT FROM
  (to_jsonb(NEW) - 'material_variant_commercial_snapshot')
  AND (
    (
      pg_trigger_depth() > 0
      AND COALESCE(
        current_setting('app.material_variant_snapshot_confirmation_order_id', true)
          = NEW.sale_order_id::text,
        false
      )
    )
    OR COALESCE(
      current_setting('app.material_variant_snapshot_review_item_id', true)
        = NEW.id::text,
      false
    )
  )
))
EXECUTE FUNCTION public.tg_enqueue_strap_demands_on_item_change();

DROP TRIGGER IF EXISTS trg_aa_capture_material_variant_snapshots_on_confirmation
  ON public.sale_orders;
CREATE TRIGGER trg_aa_capture_material_variant_snapshots_on_confirmation
BEFORE UPDATE OF status
ON public.sale_orders
FOR EACH ROW EXECUTE FUNCTION public.capture_material_variant_snapshots_on_sale_order_confirmation();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sale_order_items_material_variant_snapshot_ck'
      AND conrelid = 'public.sale_order_items'::regclass
  ) THEN
    ALTER TABLE public.sale_order_items
      ADD CONSTRAINT sale_order_items_material_variant_snapshot_ck
      CHECK (
        (material_variant_id IS NULL AND material_variant_commercial_snapshot IS NULL)
        OR (
          material_variant_id IS NOT NULL
          AND material_variant_commercial_snapshot IS NOT NULL
          AND material_variant_commercial_snapshot ? 'material_variant_id'
          AND material_variant_commercial_snapshot ? 'unit_price'
          AND material_variant_commercial_snapshot ->> 'material_variant_id' = material_variant_id::text
          AND NULLIF(btrim(COALESCE(material_variant_commercial_snapshot ->> 'material_name', '')), '') IS NOT NULL
          AND NULLIF(btrim(COALESCE(material_variant_commercial_snapshot ->> 'description', '')), '') IS NOT NULL
          AND char_length(btrim(COALESCE(
                material_variant_commercial_snapshot ->> 'sku',
                ''
              ))) <= 80
          AND (
            COALESCE(
              material_variant_commercial_snapshot #>> '{provenance,historical_truth}' = 'unknown',
              false
            )
            OR NULLIF(btrim(COALESCE(
              material_variant_commercial_snapshot ->> 'sku',
              ''
            )), '') IS NOT NULL
          )
          AND (material_variant_commercial_snapshot ->> 'unit_price')::numeric = unit_price
          AND NULLIF(btrim(COALESCE(material_variant_commercial_snapshot ->> 'color', '')), '')
              IS NOT DISTINCT FROM NULLIF(btrim(COALESCE(color, '')), '')
        )
      );
  END IF;
END;
$$;

-- =============================================================================
-- 6. Registro distribuído da identidade de produto no ClickNotas
-- =============================================================================

-- O ClickNotas não oferece idempotency-key no POST /produtos. Um cache em
-- memória do isolate também não coordena duas edges nem dois PVs. Este registro
-- faz a serialização no Postgres ANTES do POST externo. Para variante, a chave
-- é o SKU normalizado (globalmente único); technical_name é write-once e não
-- muda se uma descrição futura do snapshot mudar.
CREATE TABLE IF NOT EXISTS public.clicknotas_product_identity_registry (
  identity_kind text NOT NULL,
  identity_key text NOT NULL,
  technical_name text NOT NULL,
  state text NOT NULL DEFAULT 'resolving',
  owner_token uuid,
  correlation_id text,
  lease_generation bigint NOT NULL DEFAULT 1,
  lease_until timestamptz,
  provider_id text,
  attempt_count integer NOT NULL DEFAULT 1,
  post_attempt_count integer NOT NULL DEFAULT 0,
  reconciliation_count integer NOT NULL DEFAULT 0,
  last_error text,
  post_started_at timestamptz,
  last_manual_reset_reason text,
  last_manual_reset_at timestamptz,
  last_manual_reset_correlation text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ready_at timestamptz,
  CONSTRAINT clicknotas_product_identity_registry_pkey
    PRIMARY KEY (identity_kind, identity_key),
  CONSTRAINT clicknotas_product_identity_registry_kind_ck
    CHECK (identity_kind IN ('material_variant_sku', 'technical_name')),
  CONSTRAINT clicknotas_product_identity_registry_key_ck
    CHECK (
      identity_key = lower(btrim(identity_key))
      AND NULLIF(identity_key, '') IS NOT NULL
      AND char_length(identity_key) <= 200
    ),
  CONSTRAINT clicknotas_product_identity_registry_name_ck
    CHECK (
      technical_name = btrim(technical_name)
      AND NULLIF(technical_name, '') IS NOT NULL
      AND char_length(technical_name) <= 120
    ),
  CONSTRAINT clicknotas_product_identity_registry_correlation_ck
    CHECK (correlation_id IS NULL OR char_length(correlation_id) <= 200),
  CONSTRAINT clicknotas_product_identity_registry_attempt_ck
    CHECK (
      attempt_count > 0
      AND post_attempt_count >= 0
      AND reconciliation_count >= 0
      AND lease_generation > 0
    ),
  CONSTRAINT clicknotas_product_identity_registry_state_ck
    CHECK (
      (
        state IN ('resolving', 'posting')
        AND provider_id IS NULL
        AND owner_token IS NOT NULL
        AND lease_until IS NOT NULL
      )
      OR (
        state = 'ready'
        AND NULLIF(btrim(COALESCE(provider_id, '')), '') IS NOT NULL
        AND owner_token IS NULL
        AND lease_until IS NULL
      )
      OR (
        state IN ('retryable', 'reconcile_required', 'conflict')
        AND provider_id IS NULL
        AND owner_token IS NULL
        AND lease_until IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_clicknotas_product_identity_provider_id
  ON public.clicknotas_product_identity_registry (provider_id)
  WHERE provider_id IS NOT NULL;

COMMENT ON TABLE public.clicknotas_product_identity_registry IS
  'Claim distribuído server-only para criar/reusar produto ClickNotas uma única vez por identidade. '
  'Para variante, identity_key é o SKU normalizado; technical_name é imutável após o primeiro claim. '
  'posting expirado exige reconciliação e nunca autoriza novo POST cego.';

ALTER TABLE public.clicknotas_product_identity_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.clicknotas_product_identity_registry
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_clicknotas_product_identity(
  p_identity_kind text,
  p_identity_value text,
  p_technical_name text,
  p_owner_token uuid,
  p_correlation_id text,
  p_lease_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_identity_kind, '')));
  v_key text := lower(btrim(COALESCE(p_identity_value, '')));
  v_name text := btrim(COALESCE(p_technical_name, ''));
  v_correlation text := NULLIF(btrim(COALESCE(p_correlation_id, '')), '');
  v_lease_seconds integer := greatest(60, least(COALESCE(p_lease_seconds, 120), 300));
  v_now timestamptz := clock_timestamp();
  v_row public.clicknotas_product_identity_registry%ROWTYPE;
BEGIN
  IF v_kind NOT IN ('material_variant_sku', 'technical_name') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'identity_kind inválido para claim ClickNotas.';
  END IF;
  IF v_key IS NULL OR v_key = '' OR char_length(v_key) > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'identity_value inválido para claim ClickNotas.';
  END IF;
  IF v_kind = 'material_variant_sku' AND char_length(v_key) > 80 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22001',
      MESSAGE = 'SKU da identidade ClickNotas deve ter no máximo 80 caracteres.';
  END IF;
  IF v_name = '' OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'technical_name inválido para claim ClickNotas.';
  END IF;
  IF p_owner_token IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'owner_token é obrigatório para claim ClickNotas.';
  END IF;
  IF v_correlation IS NULL OR char_length(v_correlation) > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'correlation_id é obrigatório e deve ter no máximo 200 caracteres.';
  END IF;

  INSERT INTO public.clicknotas_product_identity_registry (
    identity_kind,
    identity_key,
    technical_name,
    state,
    owner_token,
    correlation_id,
    lease_generation,
    lease_until,
    attempt_count,
    created_at,
    updated_at
  ) VALUES (
    v_kind,
    v_key,
    v_name,
    'resolving',
    p_owner_token,
    v_correlation,
    1,
    v_now + make_interval(secs => v_lease_seconds),
    1,
    v_now,
    v_now
  )
  ON CONFLICT (identity_kind, identity_key) DO NOTHING;

  SELECT registry.*
    INTO v_row
  FROM public.clicknotas_product_identity_registry registry
  WHERE registry.identity_kind = v_kind
    AND registry.identity_key = v_key
  FOR UPDATE;

  IF v_row.state = 'ready' THEN
    RETURN jsonb_build_object(
      'outcome', 'ready',
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation,
      'attempt_count', v_row.attempt_count
    );
  END IF;

  IF v_row.state = 'conflict' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'conflict',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'attempt_count', v_row.attempt_count,
      'last_error', v_row.last_error
    ));
  END IF;

  IF v_row.state = 'reconcile_required' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'reconcile_required',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'attempt_count', v_row.attempt_count,
      'reconciliation_count', v_row.reconciliation_count,
      'last_error', v_row.last_error
    ));
  END IF;

  IF v_row.state = 'posting' THEN
    IF v_row.lease_until > v_now THEN
      RETURN jsonb_strip_nulls(jsonb_build_object(
        'outcome', 'busy',
        'state', v_row.state,
        'technical_name', v_row.technical_name,
        'retry_after_ms', greatest(
          100,
          ceil(extract(epoch FROM (v_row.lease_until - v_now)) * 1000)::integer
        ),
        'lease_generation', v_row.lease_generation,
        'attempt_count', v_row.attempt_count,
        'last_error', v_row.last_error
      ));
    END IF;

    -- Depois de begin_post o efeito externo pode ter acontecido. Lease vencido
    -- nunca volta a resolving automaticamente: exige GET de reconciliação.
    UPDATE public.clicknotas_product_identity_registry
       SET state = 'reconcile_required',
           owner_token = NULL,
           lease_until = v_now + interval '30 seconds',
           last_error = COALESCE(
             last_error,
             'Lease posting expirou; reconciliar por technical_name antes de qualquer novo POST.'
           ),
           updated_at = v_now
     WHERE identity_kind = v_kind
       AND identity_key = v_key
     RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'outcome', 'reconcile_required',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'attempt_count', v_row.attempt_count,
      'reconciliation_count', v_row.reconciliation_count,
      'last_error', v_row.last_error
    );
  END IF;

  IF v_row.state = 'resolving'
     AND v_row.owner_token = p_owner_token THEN
    UPDATE public.clicknotas_product_identity_registry
       SET lease_until = v_now + make_interval(secs => v_lease_seconds),
           correlation_id = v_correlation,
           updated_at = v_now
     WHERE identity_kind = v_kind
       AND identity_key = v_key
     RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'outcome', 'acquired',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'lease_until', v_row.lease_until,
      'attempt_count', v_row.attempt_count
    );
  END IF;

  IF v_row.state IN ('resolving', 'retryable')
     AND v_row.lease_until > v_now THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'busy',
      'state', v_row.state,
      'technical_name', v_row.technical_name,
      'retry_after_ms', greatest(
        100,
        ceil(extract(epoch FROM (v_row.lease_until - v_now)) * 1000)::integer
      ),
      'lease_generation', v_row.lease_generation,
      'attempt_count', v_row.attempt_count,
      'last_error', v_row.last_error
    ));
  END IF;

  -- Somente resolving expirado ou retryable com backoff concluído podem ser
  -- retomados. posting expirado foi desviado para reconciliação acima.
  UPDATE public.clicknotas_product_identity_registry
     SET state = 'resolving',
         owner_token = p_owner_token,
         correlation_id = v_correlation,
         lease_generation = lease_generation + 1,
         lease_until = v_now + make_interval(secs => v_lease_seconds),
         attempt_count = attempt_count + 1,
         updated_at = v_now
   WHERE identity_kind = v_kind
     AND identity_key = v_key
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'outcome', 'acquired',
    'technical_name', v_row.technical_name,
    'lease_generation', v_row.lease_generation,
    'lease_until', v_row.lease_until,
    'attempt_count', v_row.attempt_count,
    'recovered_after', COALESCE(v_row.last_error, 'expired_lease')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_clicknotas_product_post(
  p_identity_kind text,
  p_identity_value text,
  p_owner_token uuid,
  p_lease_generation bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_identity_kind, '')));
  v_key text := lower(btrim(COALESCE(p_identity_value, '')));
  v_row public.clicknotas_product_identity_registry%ROWTYPE;
BEGIN
  SELECT registry.*
    INTO v_row
  FROM public.clicknotas_product_identity_registry registry
  WHERE registry.identity_kind = v_kind
    AND registry.identity_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Claim ClickNotas não encontrado antes do POST.';
  END IF;

  IF v_row.state = 'posting'
     AND v_row.owner_token = p_owner_token
     AND v_row.lease_generation = p_lease_generation THEN
    RETURN jsonb_build_object(
      'outcome', 'posting',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'post_attempt_count', v_row.post_attempt_count
    );
  END IF;

  IF v_row.state IS DISTINCT FROM 'resolving'
     OR v_row.owner_token IS DISTINCT FROM p_owner_token
     OR v_row.lease_generation IS DISTINCT FROM p_lease_generation THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'lost',
      'state', v_row.state,
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation
    ));
  END IF;

  UPDATE public.clicknotas_product_identity_registry
     SET state = 'posting',
         post_attempt_count = post_attempt_count + 1,
         post_started_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE identity_kind = v_kind
     AND identity_key = v_key
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'outcome', 'posting',
    'technical_name', v_row.technical_name,
    'lease_generation', v_row.lease_generation,
    'post_attempt_count', v_row.post_attempt_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_clicknotas_product_identity(
  p_identity_kind text,
  p_identity_value text,
  p_owner_token uuid,
  p_lease_generation bigint,
  p_provider_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_identity_kind, '')));
  v_key text := lower(btrim(COALESCE(p_identity_value, '')));
  v_provider_id text := NULLIF(btrim(COALESCE(p_provider_id, '')), '');
  v_row public.clicknotas_product_identity_registry%ROWTYPE;
BEGIN
  IF v_provider_id IS NULL OR char_length(v_provider_id) > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'provider_id inválido para concluir identidade ClickNotas.';
  END IF;

  SELECT registry.*
    INTO v_row
  FROM public.clicknotas_product_identity_registry registry
  WHERE registry.identity_kind = v_kind
    AND registry.identity_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Claim ClickNotas não encontrado para conclusão.';
  END IF;

  IF v_row.state = 'ready' THEN
    IF v_row.provider_id IS DISTINCT FROM v_provider_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Identidade ClickNotas já concluída com provider_id diferente.';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'ready',
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation
    );
  END IF;

  IF v_row.state NOT IN ('resolving', 'posting')
     OR v_row.owner_token IS DISTINCT FROM p_owner_token
     OR v_row.lease_generation IS DISTINCT FROM p_lease_generation THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'lost',
      'state', v_row.state,
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation
    ));
  END IF;

  UPDATE public.clicknotas_product_identity_registry
     SET state = 'ready',
         provider_id = v_provider_id,
         owner_token = NULL,
         lease_until = NULL,
         last_error = NULL,
         ready_at = clock_timestamp(),
         updated_at = clock_timestamp()
   WHERE identity_kind = v_kind
     AND identity_key = v_key
   RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'outcome', 'ready',
    'technical_name', v_row.technical_name,
    'provider_id', v_row.provider_id,
    'lease_generation', v_row.lease_generation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_clicknotas_product_identity_outcome(
  p_identity_kind text,
  p_identity_value text,
  p_owner_token uuid,
  p_lease_generation bigint,
  p_outcome text,
  p_error text,
  p_retry_seconds integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_identity_kind, '')));
  v_key text := lower(btrim(COALESCE(p_identity_value, '')));
  v_outcome text := lower(btrim(COALESCE(p_outcome, '')));
  v_error text := left(NULLIF(btrim(COALESCE(p_error, '')), ''), 2000);
  v_retry_seconds integer := greatest(5, least(COALESCE(p_retry_seconds, 30), 300));
  v_row public.clicknotas_product_identity_registry%ROWTYPE;
BEGIN
  IF v_outcome NOT IN ('retryable', 'reconcile_required', 'conflict') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Outcome inválido para registrar identidade ClickNotas.';
  END IF;

  UPDATE public.clicknotas_product_identity_registry
     SET state = v_outcome,
         owner_token = NULL,
         lease_until = clock_timestamp() + make_interval(secs => v_retry_seconds),
         last_error = COALESCE(v_error, 'Falha sem detalhe ao provisionar produto ClickNotas.'),
         updated_at = clock_timestamp()
   WHERE identity_kind = v_kind
     AND identity_key = v_key
     AND (
       (v_outcome = 'retryable' AND state IN ('resolving', 'posting'))
       OR (v_outcome = 'reconcile_required' AND state = 'posting')
       OR (v_outcome = 'conflict' AND state = 'resolving')
     )
     AND owner_token = p_owner_token
     AND lease_generation = p_lease_generation
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    SELECT registry.*
      INTO v_row
    FROM public.clicknotas_product_identity_registry registry
    WHERE registry.identity_kind = v_kind
      AND registry.identity_key = v_key;
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'ignored',
      'state', v_row.state,
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation
    ));
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'recorded',
    'state', v_row.state,
    'technical_name', v_row.technical_name,
    'retry_after_ms', v_retry_seconds * 1000,
    'lease_generation', v_row.lease_generation,
    'last_error', v_row.last_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_clicknotas_product_identity(
  p_identity_kind text,
  p_identity_value text,
  p_observation text,
  p_provider_id text,
  p_error text,
  p_correlation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_identity_kind, '')));
  v_key text := lower(btrim(COALESCE(p_identity_value, '')));
  v_observation text := lower(btrim(COALESCE(p_observation, '')));
  v_provider_id text := NULLIF(btrim(COALESCE(p_provider_id, '')), '');
  v_error text := left(NULLIF(btrim(COALESCE(p_error, '')), ''), 2000);
  v_correlation text := NULLIF(btrim(COALESCE(p_correlation_id, '')), '');
  v_row public.clicknotas_product_identity_registry%ROWTYPE;
BEGIN
  IF v_observation NOT IN ('found', 'not_found', 'conflict') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Observação inválida para reconciliar identidade ClickNotas.';
  END IF;
  IF v_observation = 'found'
     AND (v_provider_id IS NULL OR char_length(v_provider_id) > 200) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'provider_id é obrigatório quando a reconciliação encontra o produto.';
  END IF;
  IF v_correlation IS NULL OR char_length(v_correlation) > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'correlation_id inválido para reconciliação ClickNotas.';
  END IF;

  SELECT registry.*
    INTO v_row
  FROM public.clicknotas_product_identity_registry registry
  WHERE registry.identity_kind = v_kind
    AND registry.identity_key = v_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Identidade ClickNotas não encontrada para reconciliação.';
  END IF;
  IF v_row.state = 'ready' THEN
    IF v_observation = 'found'
       AND v_row.provider_id IS DISTINCT FROM v_provider_id THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Reconciliação encontrou provider_id diferente do registro ready.';
    END IF;
    RETURN jsonb_build_object(
      'outcome', 'ready',
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation
    );
  END IF;
  IF v_row.state = 'conflict' THEN
    RETURN jsonb_strip_nulls(jsonb_build_object(
      'outcome', 'conflict',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'last_error', v_row.last_error
    ));
  END IF;
  IF v_row.state IS DISTINCT FROM 'reconcile_required' THEN
    RETURN jsonb_build_object(
      'outcome', 'ignored',
      'state', v_row.state,
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation
    );
  END IF;

  IF v_observation = 'found' THEN
    UPDATE public.clicknotas_product_identity_registry
       SET state = 'ready',
           provider_id = v_provider_id,
           lease_until = NULL,
           last_error = NULL,
           correlation_id = v_correlation,
           reconciliation_count = reconciliation_count + 1,
           ready_at = clock_timestamp(),
           updated_at = clock_timestamp()
     WHERE identity_kind = v_kind
       AND identity_key = v_key
     RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'outcome', 'ready',
      'technical_name', v_row.technical_name,
      'provider_id', v_row.provider_id,
      'lease_generation', v_row.lease_generation
    );
  END IF;

  IF v_observation = 'conflict' THEN
    UPDATE public.clicknotas_product_identity_registry
       SET state = 'conflict',
           lease_until = clock_timestamp() + interval '5 minutes',
           last_error = COALESCE(v_error, 'Reconciliação encontrou produtos ClickNotas duplicados.'),
           correlation_id = v_correlation,
           reconciliation_count = reconciliation_count + 1,
           updated_at = clock_timestamp()
     WHERE identity_kind = v_kind
       AND identity_key = v_key
     RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'outcome', 'conflict',
      'technical_name', v_row.technical_name,
      'lease_generation', v_row.lease_generation,
      'last_error', v_row.last_error
    );
  END IF;

  UPDATE public.clicknotas_product_identity_registry
     SET lease_until = clock_timestamp() + interval '30 seconds',
         last_error = COALESCE(
           v_error,
           'Reconciliação não encontrou produto; novo POST exige verificação administrativa explícita.'
         ),
         correlation_id = v_correlation,
         reconciliation_count = reconciliation_count + 1,
         updated_at = clock_timestamp()
   WHERE identity_kind = v_kind
     AND identity_key = v_key
   RETURNING * INTO v_row;
  RETURN jsonb_build_object(
    'outcome', 'reconcile_required',
    'technical_name', v_row.technical_name,
    'lease_generation', v_row.lease_generation,
    'retry_after_ms', 30000,
    'last_error', v_row.last_error
  );
END;
$$;

-- Porta administrativa server-only para o caso fail-closed em que uma pessoa
-- comprovou no provedor que o POST nunca criou produto. As edges normais não
-- chamam este reset automaticamente.
CREATE OR REPLACE FUNCTION public.reset_clicknotas_product_identity_after_verified_absence(
  p_identity_kind text,
  p_identity_value text,
  p_reason text,
  p_correlation_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_kind text := lower(btrim(COALESCE(p_identity_kind, '')));
  v_key text := lower(btrim(COALESCE(p_identity_value, '')));
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_correlation text := NULLIF(btrim(COALESCE(p_correlation_id, '')), '');
  v_row public.clicknotas_product_identity_registry%ROWTYPE;
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) < 15 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Reset ClickNotas exige motivo de verificação com pelo menos 15 caracteres.';
  END IF;
  IF v_correlation IS NULL OR char_length(v_correlation) > 200 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'correlation_id inválido para reset ClickNotas.';
  END IF;

  UPDATE public.clicknotas_product_identity_registry
     SET state = 'retryable',
         owner_token = NULL,
         lease_until = clock_timestamp(),
         last_error = 'Ausência externa atestada manualmente: ' || left(v_reason, 1800),
         last_manual_reset_reason = left(v_reason, 2000),
         last_manual_reset_at = clock_timestamp(),
         last_manual_reset_correlation = v_correlation,
         correlation_id = v_correlation,
         updated_at = clock_timestamp()
   WHERE identity_kind = v_kind
     AND identity_key = v_key
     AND state = 'reconcile_required'
   RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Somente identidade reconcile_required pode ser liberada após ausência verificada.';
  END IF;
  RETURN jsonb_build_object(
    'outcome', 'retryable',
    'technical_name', v_row.technical_name,
    'lease_generation', v_row.lease_generation,
    'last_manual_reset_at', v_row.last_manual_reset_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_clicknotas_product_identity(text, text, text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_clicknotas_product_post(text, text, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_clicknotas_product_identity(text, text, uuid, bigint, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_clicknotas_product_identity_outcome(text, text, uuid, bigint, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_clicknotas_product_identity(text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_clicknotas_product_identity_after_verified_absence(text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_clicknotas_product_identity(text, text, text, uuid, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_clicknotas_product_post(text, text, uuid, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_clicknotas_product_identity(text, text, uuid, bigint, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_clicknotas_product_identity_outcome(text, text, uuid, bigint, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_clicknotas_product_identity(text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_clicknotas_product_identity_after_verified_absence(text, text, text, text)
  TO service_role;

COMMENT ON FUNCTION public.capture_sale_order_item_material_variant_snapshot() IS
  'Captura identidade comercial no INSERT/troca de variante; preserva identidade '
  'congelada após confirmação do PV; impede mover item entre PVs; em '
  'Rascunho/Pendente sincroniza termos explícitos e a confirmação do cabeçalho '
  'reconstrói a identidade efetiva pelo catálogo vigente.';

-- Helpers são exclusivamente portas de trigger. Revogar EXECUTE impede que um
-- cliente tente chamá-los como RPC sem afetar sua execução pelo próprio trigger.
REVOKE ALL ON FUNCTION public.normalize_product_supplier_color_code()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_product_supplier_color_code_explicit()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_product_supplier_color_code_explicit()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_reference_material_variant_sku()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_material_variant_commercial_snapshot(uuid, uuid, text, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_sale_order_item_material_variant_snapshot()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_material_variant_snapshots_on_sale_order_confirmation()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(uuid, jsonb, jsonb, text, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_legacy_material_variant_commercial_snapshot(uuid, jsonb, jsonb, text, boolean)
  TO authenticated;
