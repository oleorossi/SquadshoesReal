-- nfe_cce.nfe_id já existia mas sem FK declarada → PostgREST não conseguia
-- resolver embed nfe_emitidas(...) e quebrava com:
--   "Could not find a relationship between 'nfe_cce' and 'nfe_emitidas'"
-- Adiciona FK ON DELETE CASCADE + índice. Limpa órfãos antes.

DELETE FROM public.nfe_cce
WHERE nfe_id IS NOT NULL
  AND nfe_id NOT IN (SELECT id FROM public.nfe_emitidas);

ALTER TABLE public.nfe_cce
  ADD CONSTRAINT nfe_cce_nfe_id_fkey
    FOREIGN KEY (nfe_id) REFERENCES public.nfe_emitidas(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_nfe_cce_nfe_id ON public.nfe_cce(nfe_id);
