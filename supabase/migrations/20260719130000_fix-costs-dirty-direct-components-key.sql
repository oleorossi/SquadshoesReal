-- Fix: tg_mark_so_costs_dirty_from_product_price nunca invalidava custo por
-- COMPONENTE DIRETO.
--
-- O ramo de direct_components procurava a chave `id` no JSONB:
--
--     EXISTS (... WHERE (dc ->> 'id')::uuid = NEW.id)
--
-- mas o editor da ficha (src/pages/TechnicalSheets.tsx) grava a chave
-- `product_id` — nunca `id`. Confirmado no dado real (ficha NL03):
--
--     {"unit": "cm", "quantity": 20, "product_id": "b83f4c03-…",
--      "unit_price": 1, "product_name": "Elástico 6MM"}
--
-- Com isso `dc->>'id'` era NULL, `NULL::uuid = NEW.id` avaliava NULL, o EXISTS
-- dava false e o ramo inteiro era código morto: mudar o preço de um componente
-- direto não marcava nenhum PV como costs_dirty. O ramo de sheet_materials
-- (logo acima) sempre funcionou — por isso o buraco passou despercebido.
--
-- Correção: ler `product_id` com fallback pra `id` (fichas antigas, se houver),
-- comparando como TEXTO em vez de castar pra uuid — um `product_id` vazio ou
-- malformado no JSONB derrubaria o UPDATE inteiro com 22P02 no meio de um save
-- de produto. UUID em jsonb e `NEW.id::text` são ambos canônicos minúsculos.

CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_product_price()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.unit_price IS NOT DISTINCT FROM OLD.unit_price THEN RETURN NEW; END IF;

  UPDATE public.sale_orders so SET costs_dirty_at = now()
   WHERE so.id IN (SELECT DISTINCT soi.sale_order_id FROM public.sale_order_items soi
       JOIN public.sheet_materials sm ON sm.sheet_id = soi.reference_id WHERE sm.product_id = NEW.id)
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Faturado', 'Expedido', 'Concluído', 'Concluido', 'Finalizado sem NF', 'Finalizado s/ NF');

  UPDATE public.sale_orders so SET costs_dirty_at = now()
   WHERE so.id IN (SELECT DISTINCT soi.sale_order_id FROM public.sale_order_items soi
       JOIN public.technical_sheets ts ON ts.id = soi.reference_id
      WHERE ts.direct_components IS NOT NULL AND jsonb_typeof(ts.direct_components) = 'array'
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(ts.direct_components) AS dc
                     WHERE COALESCE(dc ->> 'product_id', dc ->> 'id') = NEW.id::text))
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho', 'Faturado', 'Expedido', 'Concluído', 'Concluido', 'Finalizado sem NF', 'Finalizado s/ NF');

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Correção de dado: elástico cadastrado com preço da unidade de COMPRA.
--
-- products.unit_price é canonicamente R$ por `unit` (unidade de ESTOQUE/consumo)
-- — vide src/lib/purchaseConversion.ts, materialAutoPO.ts (multiplica por
-- conversion_rate pra chegar no preço de compra) e o vizinho coerente
-- PLACA 1.0 EVA (0,11 R$/dm² × 150 = R$ 16,50/placa).
--
-- Os 3 SKUs de Elástico 6MM estão com unit='cm' e unit_price=1, ou seja
-- R$ 1,00 POR CENTÍMETRO = R$ 100,00 o metro. O preço real é R$ 1,00/m,
-- logo R$ 0,01/cm. Efeito: a ficha NL03 (20 cm/par) custava R$ 20,00/par em
-- vez de R$ 0,20/par, e o mesmo fator contaminava calculate_order_cost_item.
--
-- Condicionado ao estado errado exato (unit='cm' AND unit_price=1) pra ser
-- idempotente e não reescrever um preço já corrigido à mão.
UPDATE public.products
   SET unit_price = 0.01
 WHERE sku IN ('ELA6MM-01', 'ELA6MM-02', 'ELA6MM-03')
   AND unit = 'cm'
   AND unit_price = 1;

-- O UPDATE acima dispara o trigger recém-corrigido, que marca costs_dirty_at
-- nos PVs abertos que usam essas fichas — eles recalculam sozinhos.
