-- Fix search_path for the newly created trigger function
ALTER FUNCTION public.log_technical_sheet_overhead_change() SET search_path = public;
