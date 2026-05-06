-- Remove permissive SELECT policies that bypass approved-user restrictions
-- on sensitive fiscal and HR tables.

DROP POLICY IF EXISTS "Auth users can view nfe_emitidas" ON public.nfe_emitidas;
DROP POLICY IF EXISTS "Auth users can read time_exceptions" ON public.time_exceptions;