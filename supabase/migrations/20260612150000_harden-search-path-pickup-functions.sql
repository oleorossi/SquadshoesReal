-- =============================================================================
-- Hardening: SET search_path nas funções da feature pickup
-- =============================================================================
-- Supabase advisor levantou warning `function_search_path_mutable` em 4 funções
-- novas (next_dow, compute_wave_timeline, update_wave_timeline,
-- get_wave_pickup_summary). Sem search_path explícito, um usuário malicioso
-- com permissão de CREATE em algum schema poderia sobrepor funções helper
-- (ex.: add_business_days) através do search_path atual.
--
-- Fix: pin search_path = 'public' em cada uma. Não muda comportamento, só
-- garante que o resolver de nomes não pode ser sequestrado.
-- =============================================================================

ALTER FUNCTION public.next_dow(date, int)               SET search_path TO 'public';
ALTER FUNCTION public.compute_wave_timeline(uuid[])     SET search_path TO 'public';
ALTER FUNCTION public.update_wave_timeline(uuid)        SET search_path TO 'public';
ALTER FUNCTION public.get_wave_pickup_summary(uuid)     SET search_path TO 'public';
