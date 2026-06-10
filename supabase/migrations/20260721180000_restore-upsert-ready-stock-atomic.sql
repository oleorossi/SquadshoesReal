-- Auditoria 2026-06-09: upsert_ready_stock_atomic estava AUSENTE no banco —
-- a RPC do painel Pronta Entrega (useReadyStock) falhava em runtime. Causa
-- provável: par de migrations com a MESMA versão (20260518130000 /
-- 20260523130000 duplicadas) fez o replay pular o arquivo que a criava,
-- e o DROP ... CASCADE da 20260520120000 levou a função sem recriar.
-- Recriada conforme 20260520120000_tighten-definer-rpcs-approved-user.sql.
CREATE OR REPLACE FUNCTION public.upsert_ready_stock_atomic(
  p_reference_id uuid,
  p_color        text,
  p_size         text,
  p_qty_delta    numeric,
  p_location     text DEFAULT NULL,
  p_notes        text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Permission denied: usuário não aprovado';
  END IF;

  INSERT INTO public.ready_stock (reference_id, color, size, quantity, location, notes)
  VALUES (p_reference_id, p_color, p_size, GREATEST(p_qty_delta, 0), p_location, p_notes)
  ON CONFLICT (reference_id, color, size) DO UPDATE
    SET quantity   = GREATEST(ready_stock.quantity + p_qty_delta, 0),
        location   = COALESCE(p_location, ready_stock.location),
        notes      = COALESCE(p_notes, ready_stock.notes),
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_ready_stock_atomic(uuid, text, text, numeric, text, text) TO authenticated;
