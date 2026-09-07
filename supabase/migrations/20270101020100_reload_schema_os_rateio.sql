-- Força o PostgREST a recarregar o schema após o rateio multi-prestador
-- (DROP+CREATE de get_pv_outsourceable_lines e view v_pv_outsourcing_ledger).
-- Sem NOTIFY, clientes veem PGRST002 ("Could not query the database for the
-- schema cache") na janela fria pós-migrate.

GRANT EXECUTE ON FUNCTION public.get_pv_outsourceable_lines(uuid)
  TO authenticated, service_role;

GRANT SELECT ON public.v_pv_outsourcing_ledger TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
