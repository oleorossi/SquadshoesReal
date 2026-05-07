-- =============================================================================
-- Fix fluxo de produção: stages legacy + force_sale_order_production
-- =============================================================================
-- Auditoria do banco apontou:
--
--   1) 9 OPs criadas em 2026-04-19 ainda têm stages legacy:
--        Corte    -> deveria ser Corte Palmilha (PR rename 06/05/2026)
--        Forração -> Corte Forração
--        Mesa     -> Aviamento (label novo)
--      Além disso, Costura (PR2) e Expedição faltavam em todas as OPs.
--
--   2) Função force_sale_order_production tinha v_default_sectors hardcoded:
--        ['Corte','Forração','Aviamento','Silk','Colagem','Montagem','Solagem','Acabamento']
--      Sem Costura, sem Expedição, com nomes legacy.
--
-- Esta migration corrige ambos. Aplicada via MCP em 2026-05-08.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) Migra stages legacy nas OPs existentes
-- ----------------------------------------------------------------------------
-- Constraint UNIQUE (order_id, stage_name) impede rename direto se ambos os
-- nomes já existem na mesma OP. Estratégia: deleta o legacy quando o
-- canonical já existe; senão renomeia.

DELETE FROM public.order_stages a
WHERE a.stage_name = 'Mesa'
  AND EXISTS (SELECT 1 FROM public.order_stages b
              WHERE b.order_id = a.order_id AND b.stage_name = 'Aviamento');

DELETE FROM public.order_stages a
WHERE a.stage_name = 'Corte'
  AND EXISTS (SELECT 1 FROM public.order_stages b
              WHERE b.order_id = a.order_id AND b.stage_name = 'Corte Palmilha');

DELETE FROM public.order_stages a
WHERE a.stage_name = 'Forração'
  AND EXISTS (SELECT 1 FROM public.order_stages b
              WHERE b.order_id = a.order_id AND b.stage_name = 'Corte Forração');

UPDATE public.order_stages SET stage_name = 'Corte Palmilha', stage_order = 1
WHERE stage_name = 'Corte';

UPDATE public.order_stages SET stage_name = 'Corte Forração', stage_order = 2
WHERE stage_name = 'Forração';

UPDATE public.order_stages SET stage_name = 'Aviamento', stage_order = 4
WHERE stage_name = 'Mesa';

-- ----------------------------------------------------------------------------
-- 2) Adiciona Costura e Expedição onde estão faltando
-- ----------------------------------------------------------------------------
INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
SELECT DISTINCT os.order_id, 'Costura', 3, 'pendente',
  COALESCE(o.quantity, 0), 0
FROM public.order_stages os
JOIN public.orders o ON o.id = os.order_id
WHERE os.stage_name = 'Corte Forração'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_stages os2
    WHERE os2.order_id = os.order_id AND os2.stage_name = 'Costura'
  );

INSERT INTO public.order_stages (order_id, stage_name, stage_order, status, quantity_total, quantity_processed)
SELECT DISTINCT os.order_id, 'Expedição', 10, 'pendente',
  COALESCE(o.quantity, 0), 0
FROM public.order_stages os
JOIN public.orders o ON o.id = os.order_id
WHERE os.stage_name = 'Acabamento'
  AND NOT EXISTS (
    SELECT 1 FROM public.order_stages os2
    WHERE os2.order_id = os.order_id AND os2.stage_name = 'Expedição'
  );

-- ----------------------------------------------------------------------------
-- 3) Recria force_sale_order_production com 10 setores canônicos
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.force_sale_order_production(uuid) CASCADE;
CREATE OR REPLACE FUNCTION public.force_sale_order_production(p_sale_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_so record;
  v_item record;
  v_op_id uuid;
  v_created_ops int := 0;
  v_updated_ops int := 0;
  v_created_stages int := 0;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_stage_idx int;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Autenticação necessária'; END IF;
  IF NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem forçar produção';
  END IF;

  SELECT id, status, delivery_deadline INTO v_so
  FROM public.sale_orders WHERE id = p_sale_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido de venda não encontrado'; END IF;

  UPDATE public.sale_orders
     SET status = 'Em Produção', updated_at = now()
   WHERE id = p_sale_order_id;

  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, observation
    FROM public.sale_order_items WHERE sale_order_id = p_sale_order_id
  LOOP
    SELECT id INTO v_op_id FROM public.orders WHERE sale_order_item_id = v_item.id LIMIT 1;

    IF v_op_id IS NULL THEN
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        p_sale_order_id, v_item.id,
        'Forçada por admin - Em Produção', 'Em Produção',
        v_item.observation, v_so.delivery_deadline
      ) RETURNING id INTO v_op_id;
      v_created_ops := v_created_ops + 1;
    ELSE
      UPDATE public.orders SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id
         AND status NOT IN ('Em Produção','Concluída','Cancelada','Faturado');
      IF FOUND THEN v_updated_ops := v_updated_ops + 1; END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.order_stages WHERE order_id = v_op_id) THEN
      SELECT ARRAY(
        SELECT jsonb_array_elements_text(production_sectors)
          FROM public.technical_sheets
         WHERE id = v_item.reference_id
           AND production_sectors IS NOT NULL
           AND jsonb_typeof(production_sectors) = 'array'
           AND jsonb_array_length(production_sectors) > 0
      ) INTO v_sectors;

      IF v_sectors IS NULL OR array_length(v_sectors, 1) IS NULL THEN
        v_sectors := v_default_sectors;
      END IF;

      v_stage_idx := 1;
      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name, v_stage_idx, 'pendente',
          v_item.quantity, 0
        );
        v_stage_idx := v_stage_idx + 1;
        v_created_stages := v_created_stages + 1;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sale_order_id', p_sale_order_id,
    'created_ops', v_created_ops,
    'updated_ops', v_updated_ops,
    'created_stages', v_created_stages
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.force_sale_order_production(uuid) TO authenticated;

COMMENT ON FUNCTION public.force_sale_order_production(uuid) IS
  'Força um PV em Em Produção, criando OPs e order_stages padrão (10 setores '
  'canônicos: Corte Palmilha → Corte Forração → Costura → Aviamento → Silk → '
  'Colagem → Montagem → Solagem → Acabamento → Expedição). Default só usado '
  'quando technical_sheets.production_sectors está vazio. Apenas admin.';
