-- ============================================================================
-- Reconciliação do relógio de ponto: fechar o acesso até haver vigência
-- Auditoria de RH 30/07/2026 — docs/AUDITORIA_RH_PONTO_2026-07-29.md
-- ============================================================================
--
-- PROBLEMA 1 (segurança) — `punch_map_resolve` e `get_punch_reconciliation` foram
-- criadas em 20260627120000 como SECURITY DEFINER com EXECUTE para `anon`. A chave
-- anônima do Supabase vai no bundle do frontend, ou seja, é PÚBLICA. Qualquer pessoa
-- com ela podia:
--   • ler nome, matrícula e estatística de batidas de todos os funcionários
--     (`get_punch_reconciliation`);
--   • reescrever o vínculo matrícula→funcionário e disparar o backfill do histórico
--     (`punch_map_resolve`).
-- Verificado hoje: as duas eram as ÚNICAS funções DEFINER de RH com grant a `anon`
-- — as demais (complete_punches, import_time_records_safe, get_payroll_inputs_for_period,
-- calculate_weekly_he_breakdown, snapshot_all_employees_week, unlock_week,
-- apply_manual_punch_completion) já eram só `authenticated`. É erro pontual, não padrão.
--
-- PROBLEMA 2 (corrupção de histórico) — `punch_map_resolve` faz
-- `UPDATE time_records ... WHERE employee_external_id = p_device_id` SEM filtro de data,
-- e `punch_device_map` tem `UNIQUE(device_id)`, ou seja: um dono por matrícula, para
-- sempre. Mas a matrícula é RECICLADA entre pessoas. Medido em produção:
--   matrícula 6 → `camila` 98 linhas (03/10/25→13/07/26) e `admilson` 2 (14/07/26→)
--   matrícula 3 → `junior` 63 (→18/06/26) e `camila` 15 (23/06/26→)
--   matrícula 8 → `carla` 110 e `edsoncoelhochevet` 4  (períodos SOBREPOSTOS)
--   matrícula 43 → `taispinheiro` 51 e `daianepinheiro` 13 (SOBREPOSTOS)
-- No cadastro a matrícula 6 é do Admilson. Vincular hoje transferiria as 98 batidas
-- da Camila para ele.
--
-- O QUE ESTA MIGRATION FAZ — apenas fecha a porta. Nenhuma função é reescrita e
-- nenhum dado é tocado.
--   • revoga `anon` das duas (fecha o vazamento público);
--   • revoga `authenticated` de `punch_map_resolve` (a escrita perigosa). Nada legítimo
--     a chama hoje: `PunchReconciliationPage.tsx` é órfã — sem rota em App.tsx e sem
--     entrada em navigation.ts. Fail-closed em vez de confiar em disciplina.
--   • MANTÉM `authenticated` em `get_punch_reconciliation` (é leitura, e o hook
--     `usePunchReconciliation` a usa para diagnóstico).
--
-- É REVERSÍVEL: basta o GRANT de volta. Mas só re-conceda `punch_map_resolve` depois
-- de (a) dar vigência ao mapa — colunas valid_from/valid_to, backfill filtrado por
-- range, UNIQUE por (device_id, vigência) — e (b) exigir papel de RH dentro da própria
-- função. Enquanto isso não existir, re-conceder recria a corrupção acima.
-- ============================================================================

-- ⚠ PEGADINHA: em Postgres, função nasce com EXECUTE concedido a PUBLIC. Revogar só
-- de `anon`/`authenticated` NÃO surte efeito — `has_function_privilege` continua true
-- porque o privilégio vem via PUBLIC. Tem que revogar de PUBLIC e depois re-conceder
-- explicitamente a quem deve ter. (Na primeira tentativa desta migration o REVOKE
-- retornou sucesso e os privilégios ficaram idênticos; só a verificação pegou.)

REVOKE EXECUTE ON FUNCTION public.punch_map_resolve(text, uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.punch_map_resolve(text, uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.punch_map_resolve(text, uuid, text, text, text) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.get_punch_reconciliation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_punch_reconciliation() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_punch_reconciliation() TO authenticated;

-- Estado verificado após aplicar (30/07/2026):
--   punch_map_resolve        → anon=false, authenticated=false, service_role=true
--   get_punch_reconciliation → anon=false, authenticated=true,  service_role=true

COMMENT ON FUNCTION public.punch_map_resolve(text, uuid, text, text, text) IS
  'PERIGOSA ENQUANTO NÃO TIVER VIGÊNCIA: faz backfill de time_records sem filtro de '
  'data e punch_device_map tem UNIQUE(device_id). A matrícula é reciclada entre '
  'pessoas (6, 3, 8, 43 em produção), então vincular reescreve o histórico do dono '
  'anterior. EXECUTE revogado em 30/07/2026 (auditoria de RH). Só re-conceder depois '
  'de valid_from/valid_to no mapa + checagem de papel de RH aqui dentro.';

COMMENT ON FUNCTION public.get_punch_reconciliation() IS
  'Diagnóstico da reconciliação do relógio. SECURITY DEFINER: expõe nome e matrícula '
  'de funcionários, então EXECUTE de anon foi revogado em 30/07/2026 (a chave anônima '
  'é pública, vai no bundle). Mantido para authenticated.';
