-- =============================================================================
-- UNIFICAÇÃO DE TERMO: componente 'Forro' → 'Forração' (refatoração dedicada)
-- =============================================================================
-- Decisão do dono (2026-05-31): "Forro" e "Forração" são a mesma coisa — usar UM
-- termo só ("Forração") em todo o sistema. O frontend (chave de contrato + ~40
-- testes) foi renomeado junto nesta mesma branch; aqui renomeamos o COMPONENTE
-- emitido pelas funções SQL de consumo/reserva e a asserção do teste de integração.
--
-- Técnica: pg_get_functiondef + replace dos literais + EXECUTE — evita recolar os
-- corpos grandes e mantém o resto idêntico. Idempotente: se já estiver 'Forração',
-- não há literal 'Forro' a trocar (no-op). Só casa o literal CAPITAL entre aspas
-- ('Forro' e 'Forro (alternativa)') — NÃO toca:
--   • 'Forração Palmilha' (componente NOVO da palmilha — espaço antes da aspa de fecho);
--   • categorias minúsculas 'forro'/'forração'/'forracao' em v_covered_categories;
--   • setor de produção "Corte Forração" (conceito distinto);
--   • sole_structures.component_type (discriminador estrutural — valor de dado).
-- =============================================================================
DO $$
DECLARE r record; src text;
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'calculate_order_consumption',
         'calculate_order_consumption_by_grade',
         'try_reserve_materials',
         'run_consumption_integration_tests'
       )
  LOOP
    src := pg_get_functiondef(r.oid);
    src := replace(src, '''Forro (alternativa)''', '''Forração (alternativa)''');
    src := replace(src, '''Forro''', '''Forração''');
    EXECUTE src;
  END LOOP;
END $$;
