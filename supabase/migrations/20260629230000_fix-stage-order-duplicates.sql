-- ┌─────────────────────────────────────────────────────────────────────┐
-- │ Fix retroativo + proativo do stage_order em order_stages            │
-- ├─────────────────────────────────────────────────────────────────────┤
-- │ Auditoria 22/05/2026 identificou 169 OPs com stage_order DUPLICADO  │
-- │ (Aviamento e Costura ambos com stage_order=3, Expedição pulando     │
-- │ pra 10). Causa raiz: trigger tg_sale_order_creates_ops_on_production│
-- │ usa contador linear baseado em posição no JSONB production_sectors  │
-- │ — diferentes refs tinham JSONB em ordens diferentes, e o backfill   │
-- │ da mig 20260521120000 (Costura) inseriu stage_order=3 sem rebalan-  │
-- │ cear as stages existentes.                                          │
-- │                                                                     │
-- │ Resultado: stage_order não respeita a função stage_order() canô-    │
-- │ nica, comprometendo lógica de "qual setor vem antes/depois".        │
-- │                                                                     │
-- │ Esta migration:                                                     │
-- │   1. UPDATE retroativo: força stage_order canônico baseado em       │
-- │      stage_name (fonte de verdade: função SQL stage_order(enum)).   │
-- │   2. Atualiza trigger tg_sale_order_creates_ops_on_production       │
-- │      pra usar mapping canônico em vez de contador linear.           │
-- │                                                                     │
-- │ Canônico (Costura=3, Aviamento=4):                                  │
-- │   Corte Palmilha=1, Corte Forração=2, Costura=3, Aviamento=4,       │
-- │   Silk=5, Colagem=6, Montagem=7, Solagem=8, Acabamento=9, Exped=10. │
-- └─────────────────────────────────────────────────────────────────────┘

-- ─── PARTE 1: Fix retroativo dos 169 OPs ──────────────────────────────

-- Função helper estável pra map canônico (DRY pra trigger novo + UPDATE)
CREATE OR REPLACE FUNCTION public.canonical_stage_order(p_stage_name text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE p_stage_name
    WHEN 'Corte Palmilha' THEN 1
    WHEN 'Corte Forração' THEN 2
    WHEN 'Corte Forracao' THEN 2  -- variação sem acento
    WHEN 'Corte Cabedal'  THEN 2  -- alternativo a Corte Forração
    WHEN 'Costura'        THEN 3
    WHEN 'Aviamento'      THEN 4
    WHEN 'Mesa'           THEN 4  -- alias legacy de Aviamento
    WHEN 'Silk'           THEN 5
    WHEN 'Colagem'        THEN 6
    WHEN 'Montagem'       THEN 7
    WHEN 'Solagem'        THEN 8
    WHEN 'Acabamento'     THEN 9
    WHEN 'Expedição'      THEN 10
    WHEN 'Expedicao'      THEN 10
    ELSE 99
  END;
$$;

COMMENT ON FUNCTION public.canonical_stage_order(text) IS
  'Mapa canônico de stage_order pra setores (versão pt-BR). Fonte de verdade pro trigger tg_sale_order_creates_ops_on_production. Bate com stage_order(production_stage_enum).';

-- UPDATE retroativo: força canônico em TODAS as stages
UPDATE public.order_stages
SET stage_order = public.canonical_stage_order(stage_name),
    updated_at = now()
WHERE stage_order <> public.canonical_stage_order(stage_name);

-- ─── PARTE 2: Trigger usando canônico ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_sale_order_creates_ops_on_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item RECORD;
  v_op_id uuid;
  v_default_sectors text[] := ARRAY[
    'Corte Palmilha','Corte Forração','Costura','Aviamento',
    'Silk','Colagem','Montagem','Solagem','Acabamento','Expedição'
  ];
  v_sectors text[];
  v_stage_name text;
  v_target_op_status text;
BEGIN
  -- Aprovado → OP 'Reservado'; Em Produção → OP 'Em Produção'
  IF NEW.status = 'Aprovado' THEN
    v_target_op_status := 'Reservado';
  ELSIF NEW.status = 'Em Produção' THEN
    v_target_op_status := 'Em Produção';
  ELSE
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = NEW.status THEN RETURN NEW; END IF;

  FOR v_item IN
    SELECT id, reference_id, quantity, color, grade, observation
      FROM public.sale_order_items
     WHERE sale_order_id = NEW.id
  LOOP
    SELECT id INTO v_op_id
      FROM public.orders
     WHERE sale_order_item_id = v_item.id LIMIT 1;

    IF v_op_id IS NULL THEN
      INSERT INTO public.orders (
        reference_id, quantity, color, grade,
        sale_order_id, sale_order_item_id,
        notes, status, item_observation, planned_delivery
      ) VALUES (
        v_item.reference_id, v_item.quantity, COALESCE(v_item.color,''),
        COALESCE(v_item.grade, '{}'::jsonb),
        NEW.id, v_item.id,
        CASE v_target_op_status
          WHEN 'Reservado' THEN 'OP criada automaticamente ao aprovar PV'
          ELSE 'OP criada automaticamente ao mover PV pra Em Produção'
        END,
        v_target_op_status,
        v_item.observation,
        NEW.delivery_deadline
      ) RETURNING id INTO v_op_id;
    ELSIF v_target_op_status = 'Em Produção' THEN
      UPDATE public.orders
         SET status = 'Em Produção', updated_at = now()
       WHERE id = v_op_id
         AND status NOT IN ('Em Produção','Concluída','Cancelada','Faturado');
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

      -- Fix 22/05/2026: usa canonical_stage_order() em vez de contador
      -- linear. Garante consistência mesmo se production_sectors JSONB
      -- estiver em ordem não-canônica. Stages com nome desconhecido caem
      -- em 99 (last).
      FOREACH v_stage_name IN ARRAY v_sectors LOOP
        INSERT INTO public.order_stages (
          order_id, stage_name, stage_order, status,
          quantity_total, quantity_processed
        ) VALUES (
          v_op_id, v_stage_name,
          public.canonical_stage_order(v_stage_name),
          'pendente',
          v_item.quantity, 0
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
