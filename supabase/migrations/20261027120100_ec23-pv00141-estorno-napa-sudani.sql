-- Estorno do consumo indevido de NAPA SUDANI no PV-00141 (EC23)
-- ============================================================================
-- A ficha EC23 tem `upper_material` vazio: a napa dela sai por Forração e
-- Forração Palmilha. A única variante (`EC23`, NAPA SOFT) pinava o CABEDAL —
-- slot que a ficha não consome — então a variante era no-op silencioso e o
-- débito seguiu o forro da ficha, NAPA SUDANI. 600 pares saíram assim.
--
-- Decisão do dono (31/07/2026): a variante está certa, a fábrica cortou NAPA
-- SOFT. Então o que saiu de NAPA SUDANI volta.
--
-- ⚠ Estorna só o que REALMENTE saiu, e não debita NAPA SOFT no lugar:
--   • OP-2026-01131 (NUDE, 420 pares) baixou 18,240875912408759100 (Forração)
--     + 13,208029197080292000 (Forração Palmilha) = 31,448905109489051100 m de
--     NAPA SUDANI NUDE. Creditar devolve o produto aos 64,00 m de antes.
--   • OP-2026-01130 (MARROM, 180 pares) NÃO tem movimento de napa: as reservas
--     ficaram 'converted' sem stock_movement porque NAPA SUDANI MARROM estava
--     em 0. Não há o que estornar — os ~13,478 m viraram furo, e é um dos que
--     `list_stock_debit_holes` já acusa.
--   • NAPA SOFT NÃO é debitada aqui: NUDE está em 0 e nunca teve entrada
--     registrada. Debitar automático inventaria um movimento que não existiu.
--     Fica como pendência de contagem física (registrada em audit_logs).
--
-- As material_reservations 'converted' das duas OPs ficam como estão: são o
-- histórico do que a OP consumiu. A correção aparece como movimento próprio.

DO $$
DECLARE
  v_pid   uuid := '50708143-2bbb-4f6f-a61b-003802e6f9e5';  -- NAPA SUDANI / NUDE
  v_qty   numeric := 31.448905109489051100;
  v_descr text := 'Estorno PV-00141/EC23 — consumo lançado em NAPA SUDANI; a variante do item é NAPA SOFT';
  v_prev  numeric;
BEGIN
  -- Idempotente: se o estorno já foi lançado, não repete.
  IF EXISTS (SELECT 1 FROM public.stock_movements
              WHERE product_id = v_pid AND movement_type = 'in' AND description = v_descr) THEN
    RAISE NOTICE 'Estorno do PV-00141 já lançado — nada a fazer.';
    RETURN;
  END IF;

  SELECT quantity INTO v_prev FROM public.products WHERE id = v_pid FOR UPDATE;
  IF v_prev IS NULL THEN
    RAISE EXCEPTION 'Produto NAPA SUDANI/NUDE (%) não encontrado', v_pid;
  END IF;

  UPDATE public.products
     SET quantity = v_prev + v_qty, updated_at = now()
   WHERE id = v_pid;

  INSERT INTO public.stock_movements
    (product_id, movement_type, quantity, previous_stock, new_stock, description)
  VALUES
    (v_pid, 'in', v_qty, v_prev, v_prev + v_qty, v_descr);

  -- Pendência de contagem: o que a fábrica cortou de NAPA SOFT e o sistema
  -- nunca registrou. Não vira movimento — vira tarefa de inventário.
  BEGIN
    INSERT INTO public.audit_logs (action, resource, resource_id, new_data, success)
    VALUES ('ec23_pv00141_napa_pendency', 'sale_order', 'PV-00141',
      jsonb_build_object(
        'estornado_napa_sudani_nude_m', v_qty,
        'pendencia_contagem', jsonb_build_array(
          jsonb_build_object('produto', 'NAPA SOFT / NUDE',   'op', 'OP-2026-01131', 'pares', 420, 'metros', 31.448905109489051100),
          jsonb_build_object('produto', 'NAPA SOFT / MARROM', 'op', 'OP-2026-01130', 'pares', 180, 'metros', 13.478102189781021900)
        ),
        'nota', 'Metros calculados com largura 1370 (toda napa é 1000x1370). NAPA SOFT não foi debitada: estoque 0 e sem entrada registrada — conferir fisicamente antes de lançar.'
      ), true);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RAISE NOTICE 'Estornados % m de NAPA SUDANI/NUDE (% -> %)', v_qty, v_prev, v_prev + v_qty;
END
$$;
