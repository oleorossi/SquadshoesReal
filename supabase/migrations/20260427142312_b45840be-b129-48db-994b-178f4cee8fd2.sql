CREATE OR REPLACE FUNCTION public.wave_is_active(wave_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.production_waves
    WHERE id = wave_id
      AND status NOT IN ('finished', 'cancelled')
  );
$$;

COMMENT ON FUNCTION public.wave_is_active(uuid) IS
  'Returns true when the given production wave is in an active (non-finished, non-cancelled) state.';