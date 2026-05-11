-- Bug: sale_orders.transport_company_id existia como coluna uuid, mas SEM
-- a FOREIGN KEY pra transport_companies. PostgREST/Supabase JS quebrava
-- ao tentar JOINs aninhados (ex.: `transport_companies(nome)` no select),
-- retornando PGRST200 "Could not find a relationship".
--
-- Fix: cria a FK com ON DELETE SET NULL (não bloqueia deleção de
-- transportadora — o PV mantém histórico sem o FK). Cleanup defensivo
-- de valores órfãos antes pra não falhar a constraint.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_name='sale_orders'
       AND constraint_name='sale_orders_transport_company_id_fkey'
  ) THEN
    ALTER TABLE public.sale_orders
      ADD CONSTRAINT sale_orders_transport_company_id_fkey
      FOREIGN KEY (transport_company_id)
      REFERENCES public.transport_companies(id)
      ON DELETE SET NULL;
  END IF;
END $$;

UPDATE public.sale_orders
   SET transport_company_id = NULL
 WHERE transport_company_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.transport_companies tc
      WHERE tc.id = sale_orders.transport_company_id
   );

-- Força reload do schema cache do PostgREST pra reconhecer a nova FK
NOTIFY pgrst, 'reload schema';
