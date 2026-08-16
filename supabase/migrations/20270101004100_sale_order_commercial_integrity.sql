-- Auditoria Pedido de Venda — integridade comercial
-- Data: 2026-08-16
--
-- Fecha três lacunas encontradas no fluxo referência → material → preço:
--   1. tabela vencida/inativa já é ignorada no front; datas inválidas deixam de
--      entrar no cadastro;
--   2. a mesma regra de preço não pode existir duas vezes com grafia de cor
--      diferente, nem ter preço/faixa inválidos;
--   3. item novo de referência com variantes precisa apontar uma variante ATIVA
--      da própria referência. Histórico incoerente permanece editável quando a
--      identidade comercial não está sendo alterada.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_lists_valid_period_ck'
      AND conrelid = 'public.price_lists'::regclass
  ) THEN
    ALTER TABLE public.price_lists
      ADD CONSTRAINT price_lists_valid_period_ck
      CHECK (valid_to IS NULL OR valid_to >= valid_from) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.price_lists VALIDATE CONSTRAINT price_lists_valid_period_ck;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_list_items_positive_price_ck'
      AND conrelid = 'public.price_list_items'::regclass
  ) THEN
    ALTER TABLE public.price_list_items
      ADD CONSTRAINT price_list_items_positive_price_ck
      CHECK (unit_price > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'price_list_items_min_quantity_ck'
      AND conrelid = 'public.price_list_items'::regclass
  ) THEN
    ALTER TABLE public.price_list_items
      ADD CONSTRAINT price_list_items_min_quantity_ck
      CHECK (min_quantity >= 1) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.price_list_items VALIDATE CONSTRAINT price_list_items_positive_price_ck;
ALTER TABLE public.price_list_items VALIDATE CONSTRAINT price_list_items_min_quantity_ck;

CREATE OR REPLACE FUNCTION public.normalize_price_list_rule()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.color := NULLIF(upper(trim(COALESCE(NEW.color, ''))), '');
  NEW.min_quantity := COALESCE(NEW.min_quantity, 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_price_list_rule ON public.price_list_items;
CREATE TRIGGER trg_normalize_price_list_rule
BEFORE INSERT OR UPDATE OF color, min_quantity
ON public.price_list_items
FOR EACH ROW EXECUTE FUNCTION public.normalize_price_list_rule();

-- A auditoria prévia confirmou zero grupos duplicados. O índice usa a mesma
-- normalização do resolver do PV, portanto PRETO, " preto " e Preto são a
-- mesma regra comercial.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_list_rule_identity
  ON public.price_list_items (
    price_list_id,
    reference_id,
    upper(trim(COALESCE(color, ''))),
    min_quantity
  );

CREATE OR REPLACE FUNCTION public.enforce_sale_order_item_material_variant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_variant_reference_id uuid;
  v_variant_active boolean;
BEGIN
  -- Não reabre histórico só porque outro campo do item foi editado.
  IF TG_OP = 'UPDATE'
     AND NEW.reference_id IS NOT DISTINCT FROM OLD.reference_id
     AND NEW.material_variant_id IS NOT DISTINCT FROM OLD.material_variant_id THEN
    RETURN NEW;
  END IF;

  IF NEW.material_variant_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.reference_material_variants rmv
      WHERE rmv.reference_id = NEW.reference_id
        AND rmv.active
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'Selecione a variação de material desta referência antes de salvar o item.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT rmv.reference_id, rmv.active
    INTO v_variant_reference_id, v_variant_active
  FROM public.reference_material_variants rmv
  WHERE rmv.id = NEW.material_variant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Variação de material não encontrada.';
  END IF;
  IF v_variant_reference_id IS DISTINCT FROM NEW.reference_id THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A variação de material pertence a outra referência.';
  END IF;
  IF NOT v_variant_active THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'A variação de material selecionada está inativa.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sale_order_item_material_variant ON public.sale_order_items;
CREATE TRIGGER trg_enforce_sale_order_item_material_variant
BEFORE INSERT OR UPDATE OF reference_id, material_variant_id
ON public.sale_order_items
FOR EACH ROW EXECUTE FUNCTION public.enforce_sale_order_item_material_variant();

COMMENT ON FUNCTION public.enforce_sale_order_item_material_variant() IS
  'Impede novo item de PV sem identidade de material e variante cruzada/inativa; preserva histórico não alterado.';
