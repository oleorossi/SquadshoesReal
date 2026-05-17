-- =============================================================================
-- Fix: trigger de categoria não recalculava em UPDATE de group_id.
--
-- Comportamento antigo:
--   "Se NEW.category vem preenchida, respeita e não recalcula."
--   → Mover produto pra outro grupo deixava category desatualizada
--     (BINÓCULO 6MM movido pra grupo COMPONENTES ficou como 'Solado').
--
-- Comportamento novo:
--   INSERT: respeita NEW.category quando explícito (operador escolheu);
--           senão deriva do grupo.
--   UPDATE de group_id: SEMPRE recalcula category baseado no novo grupo
--                       (intenção do operador foi mudar a classificação).
--   UPDATE direto de category: respeita (edit manual da ficha).
--
-- Junto: backfill em massa dos produtos que estavam com category divergente
-- do nome do grupo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_products_auto_category()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group_name text;
  v_recompute  boolean := false;
BEGIN
  -- Lê o nome do grupo atual (NULL se sem grupo)
  IF NEW.group_id IS NOT NULL THEN
    SELECT name INTO v_group_name
      FROM public.product_groups
     WHERE id = NEW.group_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- INSERT: só deriva quando category não veio (ou veio vazia)
    IF NEW.category IS NULL OR length(trim(NEW.category)) = 0 THEN
      v_recompute := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- UPDATE: recalcula quando group_id mudou (intenção de reclassificar)
    -- ou quando category virou vazia.
    IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
      v_recompute := true;
    ELSIF NEW.category IS NULL OR length(trim(NEW.category)) = 0 THEN
      v_recompute := true;
    END IF;
  END IF;

  IF v_recompute THEN
    NEW.category := public.derive_category_from_group_name(v_group_name);
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger continua o mesmo (BEFORE INSERT OR UPDATE OF category, group_id);
-- só a função interna mudou.

COMMENT ON FUNCTION public.fn_products_auto_category() IS
  'Mantém products.category sincronizado com o grupo: recalcula em INSERT (quando vazio) e em UPDATE de group_id. Respeita edit manual de category sem mexer no grupo.';

-- =============================================================================
-- Backfill: corrige todos os produtos com category divergente do nome do grupo
-- =============================================================================

-- Snapshot pre-backfill (pra contagem no resultado)
DO $$
DECLARE v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.products p
  LEFT JOIN public.product_groups g ON g.id = p.group_id
  WHERE p.active = true
    AND p.category IS DISTINCT FROM public.derive_category_from_group_name(g.name);
  RAISE NOTICE '[backfill] % produtos com category divergente serão corrigidos', v_count;
END $$;

UPDATE public.products p
   SET category = public.derive_category_from_group_name(g.name)
  FROM public.product_groups g
 WHERE p.active = true
   AND p.group_id = g.id
   AND p.category IS DISTINCT FROM public.derive_category_from_group_name(g.name);

-- Produtos sem grupo (group_id IS NULL): força 'Componente'
UPDATE public.products
   SET category = 'Componente'
 WHERE active = true
   AND group_id IS NULL
   AND category IS DISTINCT FROM 'Componente';
