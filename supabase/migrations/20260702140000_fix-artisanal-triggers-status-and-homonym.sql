-- =============================================================================
-- TIRAS ARTESANAIS — correções da auditoria nos triggers de débito/estorno
-- =============================================================================
-- Achados (todos confirmados nos dados de produção):
--
--   🔴 STATUS: os triggers comparavam status com 'cancelado'/'cancelled' (minúsculo
--      inglês), mas o sistema usa 'Cancelado'/'Concluído'/'Pendente' (capitalizado
--      PT). Resultado: o ESTORNO nunca disparava ao cancelar → a NAPA debitada na
--      criação vazava (o frontend já não re-credita, confia no trigger). Fix:
--      comparar com lower(status).
--
--   🟠 HOMÔNIMO: quando o grupo era resolvido mas não tinha a cor, o código caía no
--      fallback por nome de produto, que casa produtos homônimos em OUTROS grupos
--      (ex.: existe "NAPA SOFT" dentro do grupo NAPA SUDANI). Fix: se o grupo foi
--      resolvido, casar SOMENTE por group_id; fallback por nome só quando o grupo
--      não existe (base_product_name não é um grupo cadastrado).
--
--   🟠 DUPLO ESTORNO: reabrir e cancelar de novo (Pendente→Cancelado→Pendente→
--      Cancelado) re-creditava a base a cada cancelamento. Fix: não estornar se já
--      existe um movimento de estorno 'in' para a OS.
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
  v_group_id    uuid;
  v_product_id  uuid;
  v_product_qty numeric;
  v_required    numeric;
BEGIN
  IF NEW.artisanal_recipe_id IS NULL OR COALESCE(NEW.artisanal_output_meters, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- status capitalizado/PT: normaliza antes de comparar
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada') THEN
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

  v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

  -- base_product_name é o NOME DO GRUPO selecionado na receita.
  SELECT id INTO v_group_id
    FROM public.product_groups
   WHERE lower(trim(unaccent(name))) = lower(trim(unaccent(v_recipe.base_product_name)))
   LIMIT 1;

  IF v_group_id IS NOT NULL THEN
    -- Match por grupo + cor. Sem fallback por nome quando o grupo existe (senão
    -- vaza pra produto homônimo de outro grupo).
    SELECT p.id, p.quantity INTO v_product_id, v_product_qty
      FROM public.products p
     WHERE p.active = true
       AND p.group_id = v_group_id
       AND (NEW.artisanal_base_color IS NULL
            OR NEW.artisanal_base_color = ''
            OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color))))
     ORDER BY p.quantity DESC NULLS LAST
     LIMIT 1
     FOR UPDATE;
  ELSE
    -- Grupo não cadastrado com esse nome → fallback legado por nome do produto.
    SELECT p.id, p.quantity INTO v_product_id, v_product_qty
      FROM public.products p
     WHERE p.active = true
       AND lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name)))
       AND (NEW.artisanal_base_color IS NULL
            OR NEW.artisanal_base_color = ''
            OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color))))
     ORDER BY p.quantity DESC NULLS LAST
     LIMIT 1
     FOR UPDATE;
  END IF;

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
    NULL
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
  v_group_id   uuid;
  v_product_id uuid;
  v_required   numeric;
BEGIN
  IF lower(COALESCE(NEW.status, '')) IN ('cancelado','cancelled','rejeitada')
     AND lower(COALESCE(OLD.status, '')) NOT IN ('cancelado','cancelled','rejeitada')
     AND NEW.artisanal_recipe_id IS NOT NULL
     AND COALESCE(NEW.artisanal_output_meters, 0) > 0 THEN

    SELECT * INTO v_recipe FROM public.artisanal_recipes WHERE id = NEW.artisanal_recipe_id;
    IF v_recipe IS NULL OR COALESCE(v_recipe.yield_per_meter, 1) <= 0 THEN
      RETURN NEW;
    END IF;

    -- Só estorna se houve débito de base lançado pra esta OS...
    IF NOT EXISTS (
      SELECT 1 FROM public.stock_movements
       WHERE movement_type = 'out'
         AND description LIKE 'OS Artesanal ' || COALESCE(NEW.order_number, '?') || ' — base%'
    ) THEN
      RETURN NEW;
    END IF;

    -- ...e ainda não foi estornada (evita duplo estorno em re-cancelamento).
    IF EXISTS (
      SELECT 1 FROM public.stock_movements
       WHERE movement_type = 'in'
         AND description LIKE 'Estorno OS ' || COALESCE(NEW.order_number, '?') || ' cancelada — base%'
    ) THEN
      RETURN NEW;
    END IF;

    v_required := NEW.artisanal_output_meters / v_recipe.yield_per_meter;

    SELECT id INTO v_group_id
      FROM public.product_groups
     WHERE lower(trim(unaccent(name))) = lower(trim(unaccent(v_recipe.base_product_name)))
     LIMIT 1;

    IF v_group_id IS NOT NULL THEN
      SELECT p.id INTO v_product_id
        FROM public.products p
       WHERE p.active = true
         AND p.group_id = v_group_id
         AND (NEW.artisanal_base_color IS NULL
              OR NEW.artisanal_base_color = ''
              OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color))))
       ORDER BY p.quantity DESC NULLS LAST
       LIMIT 1;
    ELSE
      SELECT p.id INTO v_product_id
        FROM public.products p
       WHERE p.active = true
         AND lower(trim(unaccent(p.name))) = lower(trim(unaccent(v_recipe.base_product_name)))
         AND (NEW.artisanal_base_color IS NULL
              OR NEW.artisanal_base_color = ''
              OR lower(trim(unaccent(coalesce(p.color, '')))) = lower(trim(unaccent(NEW.artisanal_base_color))))
       ORDER BY p.quantity DESC NULLS LAST
       LIMIT 1;
    END IF;

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
             NULL
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
