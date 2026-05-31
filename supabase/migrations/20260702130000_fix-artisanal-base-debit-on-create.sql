-- =============================================================================
-- TIRAS ARTESANAIS — débito da matriz (NAPA) na CRIAÇÃO da OS
-- =============================================================================
-- Modelo canônico decidido: a matéria-prima base sai do estoque quando a OS
-- artesanal é CRIADA (envio ao terceirizado). A tira (produto final) entra no
-- estoque na CONCLUSÃO da OS (fluxo do frontend produceArtisanalOutput, que
-- deixa de debitar a base — ver src/pages/Contractors.tsx).
--
-- Esta migration corrige e REATIVA o débito server-side, que estava com o
-- trigger desativado por causa de um bug de FK:
--
--   🔴 FK: o INSERT em stock_movements gravava order_id = service_order.id, mas
--      stock_movements.order_id tem FK -> orders. Toda criação de OS artesanal
--      abortava com 23503 (por isso o trigger foi desligado). Fix: order_id = NULL
--      (rastreio segue pela descrição 'OS Artesanal <nº> — base "..."').
--
--   🟠 Idempotência: não redebita se já existe o movimento de base desta OS.
--
--   🟡 Match de cor com unaccent (Café = Cafe), alinhando com debit_strap_stock.
--
-- O estorno no cancelamento (tg_revert_service_order_base_on_cancel) recebe o
-- mesmo fix de FK e passa a só estornar quando houve débito de base lançado —
-- assim NÃO credita NAPA das 24 OSs antigas (criadas sem trigger, nunca debitadas).
-- =============================================================================

-- ─── Débito da base na criação ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_debit_service_order_base()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_recipe      RECORD;
  v_product_id  uuid;
  v_product_qty numeric;
  v_required    numeric;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL OR COALESCE(NEW.artisanal_output_meters, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('cancelado','cancelled','rejeitada') THEN
    RETURN NEW;
  END IF;

  -- Idempotência: se já há débito de base lançado pra esta OS, não repete.
  IF EXISTS (
    SELECT 1 FROM public.stock_movements
     WHERE movement_type = 'out'
       AND description LIKE 'OS Artesanal ' || COALESCE(NEW.order_number, '?') || ' — base%'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
  IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Quantidade necessária do base = output_meters / yield_per_meter
  v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

  -- Match: products.name = recipe.base_product_name + cor (unaccent), prioriza cor exata.
  SELECT p.id, p.quantity INTO v_product_id, v_product_qty
    FROM public.products p
   WHERE p.active = true
     AND lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name)))
     AND (NEW.artisanal_base_color IS NULL
          OR NEW.artisanal_base_color = ''
          OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color))))
   ORDER BY (NEW.artisanal_base_color IS NOT NULL
             AND lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color)))) DESC NULLS LAST
   LIMIT 1
   FOR UPDATE;

  IF v_product_id IS NULL THEN
    RAISE WARNING 'OS %: produto base "%" (cor %) não encontrado — não debitando estoque',
      NEW.order_number, v_recipe.base_product_name, COALESCE(NEW.artisanal_base_color, '');
    RETURN NEW;
  END IF;

  IF v_product_qty < v_required THEN
    RAISE WARNING 'OS %: estoque insuficiente de "%" (%) — disponível %, necessário %',
      NEW.order_number, v_recipe.base_product_name, COALESCE(NEW.artisanal_base_color, ''),
      v_product_qty, v_required;
  END IF;

  UPDATE public.products
     SET quantity   = GREATEST(0, quantity - v_required),
         updated_at = now()
   WHERE id = v_product_id;

  INSERT INTO public.stock_movements (
    product_id, movement_type, quantity, previous_stock, new_stock,
    description, order_id
  ) VALUES (
    v_product_id, 'out', v_required, v_product_qty,
    GREATEST(0, v_product_qty - v_required),
    'OS Artesanal ' || COALESCE(NEW.order_number, '?') ||
      ' — base "' || v_recipe.base_product_name || '"' ||
      CASE WHEN NEW.artisanal_base_color IS NOT NULL AND NEW.artisanal_base_color <> ''
           THEN ' (' || NEW.artisanal_base_color || ')' ELSE '' END,
    NULL  -- FK fix: stock_movements.order_id -> orders (não service_orders)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_debit_service_order_base ON public.service_orders;
CREATE TRIGGER trg_debit_service_order_base
  AFTER INSERT ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_debit_service_order_base();


-- ─── Estorno da base ao cancelar ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_revert_service_order_base_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_recipe     RECORD;
  v_product_id uuid;
  v_required   numeric;
BEGIN
  IF NEW.status IN ('cancelado','cancelled','rejeitada')
     AND OLD.status NOT IN ('cancelado','cancelled','rejeitada')
     AND NEW.artisanal_recipe_id IS NOT NULL
     AND COALESCE(NEW.artisanal_output_meters, 0) > 0 THEN

    SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
    IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
      RETURN NEW;
    END IF;

    -- Só estorna se houve débito de base lançado pra esta OS. Protege as OSs
    -- antigas (nunca debitadas) de receberem crédito de NAPA que nunca saiu.
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements
       WHERE movement_type = 'out'
         AND description LIKE 'OS Artesanal ' || COALESCE(NEW.order_number, '?') || ' — base%'
    ) THEN
      RETURN NEW;
    END IF;

    v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

    SELECT p.id INTO v_product_id
      FROM public.products p
     WHERE p.active = true
       AND lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name)))
       AND (NEW.artisanal_base_color IS NULL
            OR NEW.artisanal_base_color = ''
            OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color))))
     LIMIT 1;

    IF v_product_id IS NOT NULL THEN
      UPDATE public.products
         SET quantity   = quantity + v_required,
             updated_at = now()
       WHERE id = v_product_id;

      INSERT INTO public.stock_movements (
        product_id, movement_type, quantity, previous_stock, new_stock,
        description, order_id
      )
      SELECT id, 'in', v_required,
             quantity - v_required, quantity,
             'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada — base',
             NULL  -- FK fix: order_id -> orders
        FROM public.products WHERE id = v_product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_revert_service_order_base_on_cancel ON public.service_orders;
CREATE TRIGGER trg_revert_service_order_base_on_cancel
  AFTER UPDATE OF status ON public.service_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_revert_service_order_base_on_cancel();
