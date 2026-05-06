DO $$
DECLARE
  v_ids uuid[] := ARRAY[
    '8e309167-2ecf-45ce-bf76-c117860f0934'::uuid,
    'f0a033a6-54af-47f6-bac7-6befc88dd843'::uuid,
    'a6c394fa-6eae-450f-96c0-78dedd1820af'::uuid,
    '2e1917ab-e9f3-4e58-b983-f39b3c5056cf'::uuid
  ];
  v_now timestamptz := now();
BEGIN
  -- Marca todas as etapas como concluídas
  UPDATE public.order_stages
  SET status = 'concluido',
      started_at = COALESCE(started_at, v_now),
      completed_at = v_now
  WHERE order_id = ANY(v_ids)
    AND status <> 'concluido';

  -- Atualiza ordens para Finalizado
  UPDATE public.orders
  SET status = 'Finalizado',
      production_step = 'Acabamento',
      updated_at = v_now
  WHERE id = ANY(v_ids);
END $$;