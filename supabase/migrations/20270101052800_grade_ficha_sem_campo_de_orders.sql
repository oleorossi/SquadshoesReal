-- grade_ficha_sem_campo_de_orders_20270101052800
--
-- Hotfix já aplicado em produção às 21:39 BRT de 21/11/2026.
-- tg_grade_must_close_ficha lia NEW.sale_order_item_id dentro de um IF
-- TG_TABLE_NAME = 'orders'. O PL/pgSQL resolve o campo mesmo quando o IF
-- curto-circuita, e todo INSERT em sale_order_items morria com
-- record "new" has no field "sale_order_item_id".
-- O id do item da OP passa a sair de to_jsonb(NEW), só no ramo orders.
-- O resto da função é o mesmo. Não mexe em pedido.

CREATE OR REPLACE FUNCTION public.tg_grade_must_close_ficha()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_msg text;
  v_legacy boolean;
  v_soi uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.grade IS NOT DISTINCT FROM OLD.grade THEN
    RETURN NEW;
  END IF;

  -- OP copiada de item antigo que já não fecha: o promote não pode travar.
  -- sale_order_item_id só existe em orders. Ler pelo jsonb evita o campo
  -- estático, que o PL/pgSQL exige mesmo com o IF em curto-circuito.
  IF TG_TABLE_NAME = 'orders' AND TG_OP = 'INSERT' THEN
    v_soi := NULLIF(to_jsonb(NEW) ->> 'sale_order_item_id', '')::uuid;
    IF v_soi IS NOT NULL THEN
      SELECT public.grade_ficha_violation_message(
               COALESCE(soi.quantity, 0),
               COALESCE(soi.grade, '{}'::jsonb)
             ) IS NOT NULL
        INTO v_legacy
        FROM public.sale_order_items soi
       WHERE soi.id = v_soi;
      IF COALESCE(v_legacy, false) THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  v_msg := public.grade_ficha_violation_message(
    COALESCE(NEW.quantity, 0),
    COALESCE(NEW.grade, '{}'::jsonb)
  );
  IF v_msg IS NOT NULL THEN
    RAISE EXCEPTION '%', v_msg USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
