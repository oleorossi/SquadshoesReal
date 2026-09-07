-- =============================================================================
-- OC generica: snapshot fisico, estados recebiveis e trava financeira apos AP
-- =============================================================================
-- Escopo deliberadamente estreito:
--   * novas linhas de produto congelam unidade de estoque, unidade de compra e
--     o fator FISICO efetivo da linha para estoque;
--   * linhas historicas com a tupla toda NULL continuam no fallback vivo,
--     explicitamente identificado na resposta do command;
--   * nenhum cadastro ou item historico e preenchido por esta migration;
--   * recebimento, receipt/hash, CAS, parcialidade e WAC continuam na fronteira
--     transacional criada em 12100;
--   * o momento de criacao/cancelamento da conta a pagar nao muda aqui.

DO $preflight_157$
BEGIN
  IF pg_catalog.to_regnamespace('private') IS NULL THEN
    RAISE EXCEPTION 'Preflight 15700: schema private ausente';
  END IF;
  IF pg_catalog.to_regprocedure(
       'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.purchase_order_receipt_factor_121(text,text,text,numeric,numeric,text,text)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.tg_block_invalid_purchase_order_receipt()'
     ) IS NULL THEN
    RAISE EXCEPTION 'Preflight 15700: fronteira de OC 12100 ausente';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns column_info
     WHERE column_info.table_schema = 'public'
       AND column_info.table_name = 'purchase_order_items'
       AND column_info.column_name IN (
         'stock_unit_snapshot',
         'purchase_unit_snapshot',
         'conversion_rate_snapshot'
       )
     GROUP BY column_info.table_schema, column_info.table_name
    HAVING pg_catalog.count(*) = 3
  ) THEN
    RAISE EXCEPTION 'Preflight 15700: colunas de snapshot da linha ausentes';
  END IF;
END;
$preflight_157$;

-- A taxa aqui e o fator efetivo `quantidade da linha -> quantidade em estoque`.
-- Isso congela inclusive a conversao linear->area, cuja origem viva e largura,
-- sem voltar a usar conversion_rate para um conceito ao qual ela nao pertence.
CREATE OR REPLACE FUNCTION private.purchase_order_snapshot_receipt_factor_157(
  p_item_unit text,
  p_stock_unit_snapshot text,
  p_purchase_unit_snapshot text,
  p_effective_factor_snapshot numeric,
  p_product_name text
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item_unit text := public.po_norm_unit(p_item_unit);
  v_stock_unit text := public.po_norm_unit(p_stock_unit_snapshot);
  v_purchase_unit text := public.po_norm_unit(p_purchase_unit_snapshot);
BEGIN
  IF NULLIF(pg_catalog.btrim(COALESCE(p_stock_unit_snapshot, '')), '') IS NULL
     OR NULLIF(pg_catalog.btrim(COALESCE(p_purchase_unit_snapshot, '')), '') IS NULL
     OR p_effective_factor_snapshot IS NULL
     OR p_effective_factor_snapshot <= 0
     OR p_effective_factor_snapshot::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION
      '%: snapshot de conversao da OC esta incompleto ou invalido',
      COALESCE(NULLIF(p_product_name, ''), 'Produto')
      USING ERRCODE = '22023';
  END IF;
  IF v_item_unit IS DISTINCT FROM v_stock_unit
     AND v_item_unit IS DISTINCT FROM v_purchase_unit THEN
    RAISE EXCEPTION
      '%: unidade da linha "%" nao pertence ao snapshot (compra "%", estoque "%")',
      COALESCE(NULLIF(p_product_name, ''), 'Produto'),
      p_item_unit, p_purchase_unit_snapshot, p_stock_unit_snapshot
      USING ERRCODE = '22023';
  END IF;
  IF v_item_unit = v_stock_unit THEN
    IF p_effective_factor_snapshot IS DISTINCT FROM 1::numeric THEN
      RAISE EXCEPTION
        '%: linha em unidade de estoque exige fator congelado igual a 1',
        COALESCE(NULLIF(p_product_name, ''), 'Produto')
        USING ERRCODE = '22023';
    END IF;
    RETURN 1;
  END IF;
  RETURN p_effective_factor_snapshot;
END;
$function$;

REVOKE ALL ON FUNCTION private.purchase_order_snapshot_receipt_factor_157(
  text,text,text,numeric,text
) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS generic_conversion_snapshot_version smallint;

-- O guard antigo de transicao da OC comparava a unidade da linha somente com
-- o cadastro vivo. Para snapshot v1, a unidade de compra congelada e a fonte
-- correta; ainda exigimos que a unidade-base atual seja a mesma que recebera o
-- saldo. Linhas legadas/strap continuam exatamente na validacao viva anterior,
-- e embalagens seguem fora deste JOIN.
CREATE OR REPLACE FUNCTION public.tg_block_invalid_purchase_order_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IN ('receiving', 'received')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND EXISTS (
       SELECT 1
         FROM public.purchase_order_items item
         JOIN public.products product ON product.id = item.product_id
        WHERE item.purchase_order_id = NEW.id
          AND (
            product.is_artisanal IS TRUE
            OR (
              item.generic_conversion_snapshot_version = 1
              AND (
                public.po_norm_unit(COALESCE(product.unit, 'un'))
                  IS DISTINCT FROM
                    public.po_norm_unit(item.stock_unit_snapshot)
                OR public.po_norm_unit(COALESCE(item.unit, '')) NOT IN (
                  public.po_norm_unit(item.stock_unit_snapshot),
                  public.po_norm_unit(item.purchase_unit_snapshot)
                )
              )
            )
            OR (
              item.generic_conversion_snapshot_version IS DISTINCT FROM 1
              AND public.po_norm_unit(COALESCE(item.unit, '')) NOT IN (
                public.po_norm_unit(COALESCE(product.unit, 'un')),
                public.po_norm_unit(COALESCE(
                  NULLIF(pg_catalog.btrim(product.purchase_unit), ''),
                  NULLIF(pg_catalog.btrim(product.purchase_order_unit), ''),
                  NULLIF(pg_catalog.btrim(product.unit), ''),
                  'un'
                ))
              )
            )
          )
     ) THEN
    RAISE EXCEPTION
      'OC possui item artesanal ou unidade invalida; corrija as linhas antes de iniciar o recebimento.';
  END IF;
  RETURN NEW;
END;
$function$;

-- Toda INSERT futura de produto em OC generica recebe snapshot server-side.
-- UPDATE nao cria snapshot em linha antiga: a ausencia integral continua sendo
-- o discriminador explicito do fallback legado. Para linha ja congelada, os
-- campos e a unidade sao imutaveis; alteracao de quantidade so e aceita se o
-- cadastro vivo ainda normalizaria o delta pela mesma tupla fisica.
CREATE OR REPLACE FUNCTION private.tg_generic_po_item_conversion_snapshot_157()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_source_type text;
  v_product public.products%ROWTYPE;
  v_stock_unit text;
  v_purchase_unit text;
  v_effective_factor numeric;
  v_old_snapshot_count integer;
  v_new_snapshot_count integer;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id THEN
    RAISE EXCEPTION 'Item de OC nao pode trocar de ordem de compra'
      USING ERRCODE = '55000';
  END IF;

  SELECT purchase_order.source_type
    INTO v_source_type
    FROM public.purchase_orders purchase_order
   WHERE purchase_order.id = NEW.purchase_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OC % nao encontrada para congelar conversao', NEW.purchase_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF v_source_type = 'strap_demand' THEN
    RETURN NEW;
  END IF;

  -- Uma linha generica nao pode atravessar silenciosamente a fronteira
  -- produto/caixa. Alem de preservar a identidade congelada, isso impede que
  -- um UPDATE com product_id NULL contorne as validacoes abaixo.
  IF TG_OP = 'UPDATE'
     AND NEW.product_id IS DISTINCT FROM OLD.product_id THEN
    RAISE EXCEPTION 'Produto da linha da OC e imutavel'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT product.*
      INTO v_product
      FROM public.products product
     WHERE product.id = NEW.product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % nao encontrado para congelar conversao', NEW.product_id
        USING ERRCODE = 'P0002';
    END IF;
    v_stock_unit := COALESCE(
      NULLIF(pg_catalog.btrim(v_product.unit), ''),
      'un'
    );
    -- po_normalize_line usa purchase_unit como rotulo e purchase_order_unit
    -- como fallback. O snapshot guarda exatamente o rotulo aceito na linha.
    v_purchase_unit := COALESCE(
      NULLIF(pg_catalog.btrim(v_product.purchase_unit), ''),
      NULLIF(pg_catalog.btrim(v_product.purchase_order_unit), ''),
      v_stock_unit
    );
    v_effective_factor := public.purchase_order_receipt_factor_121(
      NEW.unit,
      v_stock_unit,
      v_purchase_unit,
      v_product.conversion_rate,
      v_product.dimensions_width,
      v_product.dimensions_unit,
      v_product.name
    );
    IF v_effective_factor IS NULL
       OR v_effective_factor <= 0
       OR v_effective_factor::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Conversao fisica do produto % nao e finita/positiva',
        NEW.product_id USING ERRCODE = '22023';
    END IF;
    NEW.stock_unit_snapshot := v_stock_unit;
    NEW.purchase_unit_snapshot := v_purchase_unit;
    NEW.conversion_rate_snapshot := v_effective_factor;
    NEW.generic_conversion_snapshot_version := 1;
    RETURN NEW;
  END IF;

  v_old_snapshot_count := pg_catalog.num_nonnulls(
    OLD.stock_unit_snapshot,
    OLD.purchase_unit_snapshot,
    OLD.conversion_rate_snapshot
  );
  v_new_snapshot_count := pg_catalog.num_nonnulls(
    NEW.stock_unit_snapshot,
    NEW.purchase_unit_snapshot,
    NEW.conversion_rate_snapshot
  );
  IF OLD.generic_conversion_snapshot_version IS NULL
     AND v_old_snapshot_count = 0 THEN
    IF NEW.generic_conversion_snapshot_version IS NOT NULL
       OR v_new_snapshot_count <> 0 THEN
      RAISE EXCEPTION
        'Snapshot de linha legada nao pode ser preenchido implicitamente'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
      RAISE EXCEPTION
        'Item legado sem conversao congelada: crie nova OC para alterar a quantidade'
        USING ERRCODE = '55000';
    END IF;
    IF NEW.unit IS DISTINCT FROM OLD.unit THEN
      RAISE EXCEPTION
        'Item legado sem conversao congelada: crie nova OC para alterar a unidade'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.generic_conversion_snapshot_version IS DISTINCT FROM 1::smallint
     OR NEW.generic_conversion_snapshot_version IS DISTINCT FROM 1::smallint
     OR v_old_snapshot_count <> 3 OR v_new_snapshot_count <> 3 THEN
    RAISE EXCEPTION 'Snapshot parcial de conversao na linha da OC'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.product_id IS DISTINCT FROM OLD.product_id
     OR NEW.unit IS DISTINCT FROM OLD.unit
     OR NEW.stock_unit_snapshot IS DISTINCT FROM OLD.stock_unit_snapshot
     OR NEW.purchase_unit_snapshot IS DISTINCT FROM OLD.purchase_unit_snapshot
     OR NEW.conversion_rate_snapshot IS DISTINCT FROM OLD.conversion_rate_snapshot
     OR NEW.generic_conversion_snapshot_version IS DISTINCT FROM
          OLD.generic_conversion_snapshot_version THEN
    RAISE EXCEPTION 'Identidade/unidade/snapshot da linha da OC sao imutaveis'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.quantity IS DISTINCT FROM OLD.quantity THEN
    SELECT product.*
      INTO v_product
      FROM public.products product
     WHERE product.id = NEW.product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto % nao encontrado ao alterar quantidade', NEW.product_id
        USING ERRCODE = 'P0002';
    END IF;
    v_stock_unit := COALESCE(
      NULLIF(pg_catalog.btrim(v_product.unit), ''),
      'un'
    );
    v_purchase_unit := COALESCE(
      NULLIF(pg_catalog.btrim(v_product.purchase_unit), ''),
      NULLIF(pg_catalog.btrim(v_product.purchase_order_unit), ''),
      v_stock_unit
    );
    IF public.po_norm_unit(v_stock_unit) IS DISTINCT FROM
         public.po_norm_unit(OLD.stock_unit_snapshot)
       OR public.po_norm_unit(NEW.unit) IS DISTINCT FROM
         public.po_norm_unit(OLD.unit)
       OR (
         public.po_norm_unit(NEW.unit) IS DISTINCT FROM
           public.po_norm_unit(OLD.stock_unit_snapshot)
         AND public.po_norm_unit(v_purchase_unit) IS DISTINCT FROM
           public.po_norm_unit(OLD.purchase_unit_snapshot)
       ) THEN
      RAISE EXCEPTION
        'Cadastro fisico do produto mudou; nao e seguro acumular na linha congelada'
        USING ERRCODE = '55000';
    END IF;
    v_effective_factor := public.purchase_order_receipt_factor_121(
      NEW.unit,
      v_stock_unit,
      v_purchase_unit,
      v_product.conversion_rate,
      v_product.dimensions_width,
      v_product.dimensions_unit,
      v_product.name
    );
    IF v_effective_factor IS DISTINCT FROM OLD.conversion_rate_snapshot THEN
      RAISE EXCEPTION
        'Conversao do produto mudou; nao e seguro acumular na linha congelada'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.tg_generic_po_item_conversion_snapshot_157()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.purchase_order_items
  DROP CONSTRAINT IF EXISTS purchase_order_items_conversion_snapshot_tuple_157_ck;
ALTER TABLE public.purchase_order_items
  ADD CONSTRAINT purchase_order_items_conversion_snapshot_tuple_157_ck CHECK (
    generic_conversion_snapshot_version IS NULL
    OR (
      generic_conversion_snapshot_version = 1
      AND product_id IS NOT NULL
      AND
      pg_catalog.num_nonnulls(
        stock_unit_snapshot,
        purchase_unit_snapshot,
        conversion_rate_snapshot
      ) = 3
      AND NULLIF(pg_catalog.btrim(stock_unit_snapshot), '') IS NOT NULL
      AND NULLIF(pg_catalog.btrim(purchase_unit_snapshot), '') IS NOT NULL
      AND conversion_rate_snapshot > 0
      AND conversion_rate_snapshot::text NOT IN ('NaN', 'Infinity', '-Infinity')
    )
  ) NOT VALID;
ALTER TABLE public.purchase_order_items
  VALIDATE CONSTRAINT purchase_order_items_conversion_snapshot_tuple_157_ck;

DROP TRIGGER IF EXISTS trg_generic_po_item_conversion_snapshot_insert_157
  ON public.purchase_order_items;
CREATE TRIGGER trg_generic_po_item_conversion_snapshot_insert_157
  BEFORE INSERT ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_generic_po_item_conversion_snapshot_157();

DROP TRIGGER IF EXISTS trg_generic_po_item_conversion_snapshot_update_157
  ON public.purchase_order_items;
CREATE TRIGGER trg_generic_po_item_conversion_snapshot_update_157
  BEFORE UPDATE OF purchase_order_id, product_id, unit, quantity,
    stock_unit_snapshot, purchase_unit_snapshot, conversion_rate_snapshot,
    generic_conversion_snapshot_version
  ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_generic_po_item_conversion_snapshot_157();

CREATE INDEX IF NOT EXISTS accounts_payable_purchase_order_id_157_idx
  ON public.accounts_payable (purchase_order_id)
  WHERE purchase_order_id IS NOT NULL;

COMMENT ON COLUMN public.purchase_order_items.conversion_rate_snapshot IS
  'Snapshot de conversao. Em OC generica nova: fator fisico efetivo da unidade '
  'da linha para a unidade de estoque; em strap_demand preserva o contrato artesanal.';
COMMENT ON COLUMN public.purchase_order_items.generic_conversion_snapshot_version IS
  'Versao do snapshot fisico de OC generica. NULL identifica linha historica/fora '
  'da fronteira; 1 exige a tupla integral e usa seu fator efetivo no recebimento.';

-- Patch estreito da fronteira 12100. Cada anchor deve existir exatamente uma
-- vez; qualquer drift futuro aborta a migration antes de publicar meia regra.
DO $patch_purchase_order_command_157$
DECLARE
  v_function regprocedure :=
    'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(
    'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure
  );
  v_patched text;
  v_occurrences integer;
  v_old text;
  v_new text;
BEGIN
  v_patched := v_definition;

  v_old := $old$  v_factor numeric;
  v_expected_received numeric;$old$;
  v_new := $new$  v_factor numeric;
  v_conversion_snapshot_source text;
  v_receipt_stock_unit text;
  v_expected_received numeric;$new$;
  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch 15700 declaration encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_old, v_new);

  v_old := $old$      v_patch := CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'header_patch') = 'object'
        THEN v_payload -> 'header_patch' ELSE '{}'::jsonb END;$old$;
  v_new := $new$      v_patch := CASE WHEN pg_catalog.jsonb_typeof(v_payload -> 'header_patch') = 'object'
        THEN v_payload -> 'header_patch' ELSE '{}'::jsonb END;
      -- AP existente congela somente os campos que definem credor/valor.
      -- Notes, datas, vinculos operacionais, status de fluxo e grade continuam
      -- editaveis; cancel/receive mantem suas semanticas proprias.
      IF EXISTS (
        SELECT 1
          FROM public.accounts_payable payable
         WHERE payable.purchase_order_id = v_po.id
            OR (
              payable.reference_type = 'purchase_order'
              AND payable.reference_id = v_po.id
            )
            OR COALESCE(payable.notes, '') LIKE '%[OC#' || v_po.id::text || ']%'
      ) AND (
        (v_command = 'append' AND NOT v_skip_append)
        OR (
          v_patch ? 'supplier_id'
          AND NULLIF(v_patch ->> 'supplier_id', '')::uuid
            IS DISTINCT FROM v_po.supplier_id
        )
        OR (
          v_patch ? 'supplier_name'
          AND (v_patch ->> 'supplier_name') IS DISTINCT FROM v_po.supplier_name
        )
        OR (
          v_command = 'edit'
          AND EXISTS (
            SELECT 1
              FROM pg_catalog.jsonb_array_elements(
                CASE
                  WHEN pg_catalog.jsonb_typeof(v_payload -> 'items') = 'array'
                    THEN v_payload -> 'items'
                  ELSE '[]'::jsonb
                END
              ) changed_item(value)
              JOIN public.purchase_order_items current_item
                ON current_item.purchase_order_id = v_po.id
               AND current_item.id =
                 NULLIF(changed_item.value ->> 'item_id', '')::uuid
             WHERE (
               changed_item.value ? 'quantity'
               AND (changed_item.value ->> 'quantity')::numeric
                 IS DISTINCT FROM current_item.quantity
             ) OR (
               changed_item.value ? 'unit_price'
               AND (changed_item.value ->> 'unit_price')::numeric
                 IS DISTINCT FROM current_item.unit_price
             )
          )
        )
      ) THEN
        RAISE EXCEPTION
          'OC com conta a pagar nao permite alterar fornecedor, quantidade ou preco'
          USING ERRCODE = '55000';
      END IF;$new$;
  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch 15700 AP guard encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_old, v_new);

  v_old := $old$    IF v_po.status IN ('received', 'receiving', 'cancelled', 'suspended') THEN
      RAISE EXCEPTION 'OC em estado % nao pode ser recebida', v_po.status
        USING ERRCODE = '55000';
    END IF;$old$;
  v_new := $new$    IF v_po.status NOT IN ('approved', 'sent', 'parcial') THEN
      RAISE EXCEPTION 'OC em estado % nao pode ser recebida', v_po.status
        USING ERRCODE = '55000';
    END IF;$new$;
  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch 15700 status gate encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_old, v_new);

  v_old := $old$        v_factor := 1;
        v_grade := NULL;$old$;
  v_new := $new$        v_factor := 1;
        v_conversion_snapshot_source := 'box_native';
        v_receipt_stock_unit := v_item_row.unit;
        v_grade := NULL;$new$;
  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch 15700 box source encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_old, v_new);

  v_old := $old$        v_factor := public.purchase_order_receipt_factor_121(
          v_item_row.unit,
          v_product.unit,
          v_product.purchase_unit,
          v_product.conversion_rate,
          v_product.dimensions_width,
          v_product.dimensions_unit,
          v_product.name
        );$old$;
  v_new := $new$        IF v_item_row.generic_conversion_snapshot_version = 1
           AND pg_catalog.num_nonnulls(
             v_item_row.stock_unit_snapshot,
             v_item_row.purchase_unit_snapshot,
             v_item_row.conversion_rate_snapshot
           ) = 3 THEN
          -- A unidade-base atual ainda e o recipiente fisico do saldo. Se ela
          -- mudou, nao existe conversao autorizada entre o saldo antigo e o novo.
          IF public.po_norm_unit(v_product.unit) IS DISTINCT FROM
               public.po_norm_unit(v_item_row.stock_unit_snapshot) THEN
            RAISE EXCEPTION
              'Unidade-base do produto mudou desde a OC; recebimento exige revisao'
              USING ERRCODE = '55000';
          END IF;
          v_factor := private.purchase_order_snapshot_receipt_factor_157(
            v_item_row.unit,
            v_item_row.stock_unit_snapshot,
            v_item_row.purchase_unit_snapshot,
            v_item_row.conversion_rate_snapshot,
            v_product.name
          );
          v_conversion_snapshot_source := 'item_snapshot';
          v_receipt_stock_unit := v_item_row.stock_unit_snapshot;
        ELSIF v_item_row.generic_conversion_snapshot_version IS NULL
           AND pg_catalog.num_nonnulls(
             v_item_row.stock_unit_snapshot,
             v_item_row.purchase_unit_snapshot,
             v_item_row.conversion_rate_snapshot
           ) = 0 THEN
          -- Compatibilidade explicita e atomica: a tupla TODA vem do produto
          -- vivo. Nunca mistura um campo historico com outro atual.
          v_factor := public.purchase_order_receipt_factor_121(
            v_item_row.unit,
            v_product.unit,
            COALESCE(
              NULLIF(pg_catalog.btrim(v_product.purchase_unit), ''),
              NULLIF(pg_catalog.btrim(v_product.purchase_order_unit), ''),
              v_product.unit
            ),
            v_product.conversion_rate,
            v_product.dimensions_width,
            v_product.dimensions_unit,
            v_product.name
          );
          IF v_factor IS NULL
             OR v_factor <= 0
             OR v_factor::text IN ('NaN', 'Infinity', '-Infinity') THEN
            RAISE EXCEPTION
              'Conversao viva da linha legada nao e finita/positiva'
              USING ERRCODE = '22023';
          END IF;
          v_conversion_snapshot_source := 'legacy_live_product';
          v_receipt_stock_unit := v_product.unit;
        ELSE
          RAISE EXCEPTION 'Snapshot parcial de conversao no item %', v_item_row.id
            USING ERRCODE = '22023';
        END IF;$new$;
  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch 15700 receipt factor encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_old, v_new);

  v_old := $old$          'purchase_quantity', v_receive_qty,
          'stock_quantity', v_received_stock,
          'movement_id', v_movement_id$old$;
  v_new := $new$          'purchase_quantity', v_receive_qty,
          'stock_quantity', v_received_stock,
          'conversion_source', v_conversion_snapshot_source,
          'conversion_snapshot_version',
            v_item_row.generic_conversion_snapshot_version,
          'conversion_factor', v_factor,
          'stock_unit', v_receipt_stock_unit,
          'movement_id', v_movement_id$new$;
  v_occurrences := (
    pg_catalog.length(v_patched)
    - pg_catalog.length(pg_catalog.replace(v_patched, v_old, ''))
  ) / pg_catalog.length(v_old);
  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION 'Patch 15700 response metadata encontrou % anchors', v_occurrences;
  END IF;
  v_patched := pg_catalog.replace(v_patched, v_old, v_new);

  EXECUTE v_patched;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  IF position(
       'v_po.status NOT IN (''approved'', ''sent'', ''parcial'')'
       IN v_definition
     ) = 0
     OR position('legacy_live_product' IN v_definition) = 0
     OR position('item_snapshot' IN v_definition) = 0
     OR position('conversion_source' IN v_definition) = 0
     OR position('OC com conta a pagar nao permite alterar' IN v_definition) = 0
     OR position(
       'private.purchase_order_snapshot_receipt_factor_157'
       IN v_definition
     ) = 0 THEN
    RAISE EXCEPTION 'Pos-condicao do command 15700 falhou';
  END IF;
END;
$patch_purchase_order_command_157$;

-- CREATE OR REPLACE dinamico nao pode afrouxar ACL/search_path nem deixar a
-- protecao estrutural invalida.
DO $assert_157$
DECLARE
  v_command regprocedure :=
    'public.execute_purchase_order_command(text,jsonb,uuid,uuid,timestamptz)'::regprocedure;
  v_status_guard regprocedure :=
    'public.tg_block_invalid_purchase_order_receipt()'::regprocedure;
  v_status_guard_definition text := pg_catalog.pg_get_functiondef(
    'public.tg_block_invalid_purchase_order_receipt()'::regprocedure
  );
  v_failed_contracts text;
BEGIN
  IF position('generic_conversion_snapshot_version = 1'
       IN v_status_guard_definition) = 0
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc procedure
        WHERE procedure.oid = v_status_guard
          AND procedure.prosecdef
          AND procedure.proconfig @> ARRAY['search_path=""']::text[]
     ) THEN
    RAISE EXCEPTION 'Guard de status da OC nao honra snapshot v1';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc procedure
     WHERE procedure.oid = v_command
       AND procedure.prosecdef
       AND procedure.proconfig @> ARRAY['search_path=""']::text[]
  )
     OR pg_catalog.has_function_privilege('anon', v_command, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', v_command, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', v_command, 'EXECUTE') THEN
    RAISE EXCEPTION 'ACL/search_path do command de OC regrediu em 15700';
  END IF;
  IF pg_catalog.has_function_privilege(
       'authenticated',
       'private.purchase_order_snapshot_receipt_factor_157(text,text,text,numeric,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon',
       'private.purchase_order_snapshot_receipt_factor_157(text,text,text,numeric,text)',
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated',
       'private.tg_generic_po_item_conversion_snapshot_157()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Helper/trigger privado de snapshot ganhou EXECUTE indevido';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint constraint_info
     WHERE constraint_info.conrelid = 'public.purchase_order_items'::regclass
       AND constraint_info.conname =
         'purchase_order_items_conversion_snapshot_tuple_157_ck'
       AND constraint_info.convalidated
  )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger trigger_info
        WHERE trigger_info.tgrelid = 'public.purchase_order_items'::regclass
          AND trigger_info.tgname =
            'trg_generic_po_item_conversion_snapshot_insert_157'
          AND NOT trigger_info.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger trigger_info
        WHERE trigger_info.tgrelid = 'public.purchase_order_items'::regclass
          AND trigger_info.tgname =
            'trg_generic_po_item_conversion_snapshot_update_157'
          AND NOT trigger_info.tgisinternal
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger trigger_info
        WHERE trigger_info.tgrelid = 'public.purchase_orders'::regclass
          AND trigger_info.tgname = 'trg_block_invalid_purchase_order_receipt'
          AND trigger_info.tgfoid = v_status_guard
          AND NOT trigger_info.tgisinternal
     ) THEN
    RAISE EXCEPTION 'Constraint/triggers de snapshot 15700 ausentes';
  END IF;

  SELECT pg_catalog.string_agg(test.case_name, ', ' ORDER BY test.case_name)
    INTO v_failed_contracts
    FROM public.run_purchase_order_command_boundary_contract_tests() test
   WHERE NOT test.ok;
  IF v_failed_contracts IS NOT NULL THEN
    RAISE EXCEPTION 'Contratos da fronteira 12100 regrediram: %',
      v_failed_contracts;
  END IF;
END;
$assert_157$;
