-- Remover estoque mínimo — entrega E1 (desligar, reversível).
-- Spec: specs/remover-estoque-minimo.md. Decisão do dono (10/10/2026):
-- estoque mínimo deixa de existir em todos os setores; compra só sob
-- demanda de PV.
--
-- E1 NÃO dropa coluna nem reescreve as 46 funções que citam min_stock
-- (isso é a E2). Aqui:
--   1. guarda os valores atuais em estoque_minimo_backup_20261010 (volta atrás);
--   2. zera min_stock / min_stock_grade / box_types.min_stock / min_stock_m;
--   3. trava em zero por gatilho BEFORE, pra nenhuma tela/import religar;
--   4. get_inventory_summary deixa de contar "estoque baixo" (com mínimo 0,
--      `quantity <= min_stock` contaria todo item zerado).
--
-- Gatilhos dependentes do mínimo ficam inertes com o zero:
--   auto_create_purchase_order exige `NEW.min_stock > 0`;
--   reconcile_strap_variant_local_202701 dá piso 0 com min_stock_m = 0.
--
-- Nome dos gatilhos novos começa com `a00_`: gatilhos do mesmo evento rodam
-- em ordem alfabética, e trg_guard_artisanal_strap_finished_product /
-- trg_guard_legacy_artisanal_product_update comparam NEW.min_stock com
-- OLD.min_stock — o zero tem que estar aplicado antes deles.

-- 1. backup -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.estoque_minimo_backup_20261010 (
  tabela text NOT NULL,
  registro_id uuid NOT NULL,
  min_stock numeric,
  min_stock_grade jsonb,
  min_stock_m numeric,
  min_stock_replenishment_mode text,
  copiado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tabela, registro_id)
);
ALTER TABLE public.estoque_minimo_backup_20261010 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.estoque_minimo_backup_20261010 FROM anon, authenticated;

INSERT INTO public.estoque_minimo_backup_20261010 (tabela, registro_id, min_stock, min_stock_grade)
SELECT 'products', p.id, p.min_stock, p.min_stock_grade
  FROM public.products p
 WHERE coalesce(p.min_stock, 0) <> 0
    OR (p.min_stock_grade IS NOT NULL AND p.min_stock_grade NOT IN ('{}'::jsonb, 'null'::jsonb))
ON CONFLICT DO NOTHING;

INSERT INTO public.estoque_minimo_backup_20261010 (tabela, registro_id, min_stock)
SELECT 'box_types', b.id, b.min_stock
  FROM public.box_types b
 WHERE coalesce(b.min_stock, 0) <> 0
ON CONFLICT DO NOTHING;

INSERT INTO public.estoque_minimo_backup_20261010 (tabela, registro_id, min_stock_m, min_stock_replenishment_mode)
SELECT 'artisanal_strap_variants', v.id, v.min_stock_m, v.min_stock_replenishment_mode::text
  FROM public.artisanal_strap_variants v
 WHERE coalesce(v.min_stock_m, 0) <> 0
ON CONFLICT DO NOTHING;

-- 2. zerar --------------------------------------------------------------
-- Produtos de tira são protegidos por guardas que liberam com este token.
SELECT set_config('app.artisanal_strap_catalog_write', '1', true);

UPDATE public.products
   SET min_stock = 0,
       min_stock_grade = '{}'::jsonb
 WHERE coalesce(min_stock, 0) <> 0
    OR (min_stock_grade IS NOT NULL AND min_stock_grade NOT IN ('{}'::jsonb, 'null'::jsonb));

UPDATE public.box_types SET min_stock = 0 WHERE coalesce(min_stock, 0) <> 0;

-- min_stock_replenishment_mode fica: validadores do catálogo de tiras exigem
-- o modo preenchido; com piso 0 ele não gera demanda nenhuma.
UPDATE public.artisanal_strap_variants SET min_stock_m = 0 WHERE coalesce(min_stock_m, 0) <> 0;

-- 3. trava --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_force_zero_min_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Estoque mínimo foi descontinuado (specs/remover-estoque-minimo.md).
  -- Para religar: DROP dos gatilhos a00_force_zero_min_stock e restaurar
  -- a partir de estoque_minimo_backup_20261010.
  IF TG_TABLE_NAME = 'products' THEN
    NEW.min_stock := 0;
    IF NEW.min_stock_grade IS NOT NULL AND NEW.min_stock_grade <> '{}'::jsonb THEN
      NEW.min_stock_grade := '{}'::jsonb;
    END IF;
  ELSIF TG_TABLE_NAME = 'box_types' THEN
    NEW.min_stock := 0;
  ELSIF TG_TABLE_NAME = 'artisanal_strap_variants' THEN
    NEW.min_stock_m := 0;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS a00_force_zero_min_stock ON public.products;
CREATE TRIGGER a00_force_zero_min_stock
  BEFORE INSERT OR UPDATE OF min_stock, min_stock_grade ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_zero_min_stock();

DROP TRIGGER IF EXISTS a00_force_zero_min_stock ON public.box_types;
CREATE TRIGGER a00_force_zero_min_stock
  BEFORE INSERT OR UPDATE OF min_stock ON public.box_types
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_zero_min_stock();

DROP TRIGGER IF EXISTS a00_force_zero_min_stock ON public.artisanal_strap_variants;
CREATE TRIGGER a00_force_zero_min_stock
  BEFORE INSERT OR UPDATE OF min_stock_m ON public.artisanal_strap_variants
  FOR EACH ROW EXECUTE FUNCTION public.tg_force_zero_min_stock();

-- 4. resumo do estoque --------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_inventory_summary()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    result json;
BEGIN
    -- lowStockCount fica 0: estoque mínimo descontinuado
    -- (specs/remover-estoque-minimo.md). Mantido no JSON para não quebrar
    -- consumidores antigos até a E2.
    SELECT json_build_object(
        'totalValue', (
            SELECT COALESCE(SUM(quantity * unit_price), 0) FROM products WHERE active = true
        ) + (
            SELECT COALESCE(SUM(quantity * unit_price), 0) FROM box_types WHERE active = true
        ),
        'activeItems', (
            SELECT COUNT(*) FROM products WHERE active = true
        ) + (
            SELECT COUNT(*) FROM box_types WHERE active = true
        ),
        'lowStockCount', 0
    ) INTO result;

    RETURN result;
END;
$function$;
