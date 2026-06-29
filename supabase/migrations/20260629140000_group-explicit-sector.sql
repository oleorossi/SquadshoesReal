-- ============================================================================
-- Setor EXPLÍCITO por grupo de material (substitui a dedução por NOME)
-- ============================================================================
-- Pedido do dono (2026-06-29): na edição do grupo, poder MOVER o grupo pra outro
-- setor (ex.: "Napa Santorine" de Palmilha → Forração). Hoje o setor (categoria)
-- é DEDUZIDO do nome do grupo por heurística (derive_category_from_group_name):
-- "napa" força Cabedal, "palmilha" força Palmilha, etc. Isso impedia mover —
-- o trigger reclassificava de volta pelo nome.
--
-- Nova regra: cada grupo tem um SETOR explícito (product_groups.sector, valor =
-- products.category canônico). A categoria do produto passa a vir do setor do
-- grupo, NÃO mais do nome. A dedução por nome deixa de governar (fica só como
-- semente única deste backfill e sugestão no cadastro de grupo novo).
--
-- Setor canônico = products.category (CATEGORIES em src/types/inventory.ts):
--   Cabedal · Solado · Palmilha · Forração da Palmilha · Componente ·
--   Cola / Químico · Ferramentas · Fôrma · Embalagem
-- ============================================================================

-- 1) Coluna do setor explícito.
ALTER TABLE public.product_groups ADD COLUMN IF NOT EXISTS sector text;

-- 2) Backfill a partir da categoria REAL dos itens do grupo (preserva o estado
--    atual exibido — ex.: Napa Santorine fica em Palmilha porque os itens são
--    Palmilha, mesmo o nome contendo "napa"). Maioria vence empate.
WITH ranked AS (
  SELECT group_id, category AS cat,
         row_number() OVER (PARTITION BY group_id ORDER BY count(*) DESC, category) AS rn
  FROM public.products
  WHERE group_id IS NOT NULL AND category IS NOT NULL AND length(trim(category)) > 0
  GROUP BY group_id, category
)
UPDATE public.product_groups g
SET sector = r.cat
FROM ranked r
WHERE r.group_id = g.id AND r.rn = 1 AND g.sector IS NULL;

-- 3) Grupos SEM itens: semente única pela dedução por nome (one-time, não é
--    mais regra viva — depois disso o setor é explícito e editável).
UPDATE public.product_groups
SET sector = public.derive_category_from_group_name(name)
WHERE sector IS NULL OR length(trim(sector)) = 0;

-- 4) Trigger de categoria do produto: ler o SETOR do grupo (não mais o nome).
--    Mantém o respeito a category manual (edição direta) e o recálculo só quando
--    o group_id muda ou a categoria vem vazia.
CREATE OR REPLACE FUNCTION public.fn_products_auto_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sector    text;
  v_recompute boolean := false;
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    SELECT sector INTO v_sector FROM public.product_groups WHERE id = NEW.group_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.category IS NULL OR length(trim(NEW.category)) = 0 THEN
      v_recompute := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
      v_recompute := true;                       -- trocou de grupo → herda o setor
    ELSIF NEW.category IS NULL OR length(trim(NEW.category)) = 0 THEN
      v_recompute := true;
    END IF;
  END IF;

  IF v_recompute THEN
    -- Setor do grupo é a fonte; sem grupo/sem setor → 'Componente' (default seguro).
    NEW.category := COALESCE(NULLIF(trim(v_sector), ''), 'Componente');
  END IF;

  RETURN NEW;
END;
$function$;

-- 5) Cascata: mover o grupo de setor reclassifica os itens AUTOMATICAMENTE.
--    Move = UPDATE product_groups.sector; os produtos do grupo seguem.
--    (O BEFORE trigger acima respeita a category nova porque group_id não mudou.)
CREATE OR REPLACE FUNCTION public.fn_group_sector_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.sector IS DISTINCT FROM OLD.sector
     AND NEW.sector IS NOT NULL AND length(trim(NEW.sector)) > 0 THEN
    UPDATE public.products
       SET category = NEW.sector
     WHERE group_id = NEW.id
       AND COALESCE(category,'') <> NEW.sector;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tg_group_sector_cascade ON public.product_groups;
CREATE TRIGGER tg_group_sector_cascade
  AFTER UPDATE OF sector ON public.product_groups
  FOR EACH ROW EXECUTE FUNCTION public.fn_group_sector_cascade();

COMMENT ON COLUMN public.product_groups.sector IS
  'Setor/categoria EXPLÍCITO do grupo (= products.category canônico). Fonte da '
  'categoria dos itens — substitui a dedução por nome. Mover o grupo de setor '
  'cascateia pra products.category via tg_group_sector_cascade.';
