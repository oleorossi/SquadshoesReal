-- Separa rastreabilidade do job da regra que move a OP para "Imprimidos".
-- Reimpressões parciais preservam order_ids para auditoria, mas não representam
-- a primeira impressão integral da OP.
ALTER TABLE public.print_jobs
  ADD COLUMN IF NOT EXISTS marks_orders_as_printed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.print_jobs.marks_orders_as_printed IS
  'True quando a confirmação física deste job deve classificar as OPs vinculadas como impressas; false para reimpressões.';
