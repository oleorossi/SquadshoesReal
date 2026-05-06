ALTER TABLE public.technical_sheet_overhead_history
DROP CONSTRAINT IF EXISTS technical_sheet_overhead_history_changed_by_fkey;

ALTER TABLE public.technical_sheet_overhead_history
ADD CONSTRAINT technical_sheet_overhead_history_changed_by_fkey
FOREIGN KEY (changed_by) REFERENCES public.profiles(id)
ON DELETE SET NULL;
