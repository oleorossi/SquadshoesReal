-- Registro retroativo de migrations APLICADAS no banco mas ausentes de
-- supabase_migrations.schema_migrations.
--
-- Contexto: durante ~2 meses as migrations foram aplicadas via MCP (apply_migration)
-- ou pelo SQL Editor, que NÃO gravam em schema_migrations. Em 20/08/2026 o topo
-- registrado era 20270101004400 enquanto a main já tinha arquivos até 20270101005900.
-- Cada carimbo abaixo foi verificado objeto a objeto em pg_proc antes de entrar aqui.
--
-- 20270101005050 = resolve_s039_strap_catalog APÓS o rename. O carimbo original
-- (20270101005000) estava em DOIS arquivos — expor_historico_receitas_tiras_legadas e
-- resolve_s039_strap_catalog — e version é PK de schema_migrations, o que sozinho
-- inviabilizava o `supabase db push`. As duas são mutuamente independentes (nenhuma
-- chama função da outra, e a 005100 não chama nenhuma das duas) e expor_historico
-- entrou primeiro, então quem se moveu foi a resolve_s039.
--
-- Modelado em scripts/repair-verified-migration-history-20260816.sql, que está
-- OBSOLETO: os 10 carimbos daquele script já estão todos registrados.

-- Nota (20/08/2026): a migration de famílias deste mesmo commit ficou em
-- 20270101006100, e não 006000. Durante a aplicação, uma sessão paralela
-- registrou 20270101006000 (fix-coerencia-grade-produto-sem-numeracao) — que
-- existe no banco e NÃO tem arquivo no repo. Vale a regra do CLAUDE.md:
-- reconsulte as DUAS fontes na hora de aplicar, não só na hora de criar.

BEGIN;

INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES
  ('20270101004500','employee_termination_lifecycle','{}'::text[]),
  ('20270101004600','priorizar_costura_cabedal_e_aviamento_nas_os','{}'::text[]),
  ('20270101004700','sync_canonical_colors_from_products','{}'::text[]),
  ('20270101004800','color_agnostic_strap_conversions','{}'::text[]),
  ('20270101004900','bootstrap_canonical_strap_catalog','{}'::text[]),
  ('20270101005000','expor_historico_receitas_tiras_legadas','{}'::text[]),
  ('20270101005050','resolve_s039_strap_catalog','{}'::text[]),
  ('20270101005100','reaproveitar_receitas_tiras_legadas','{}'::text[]),
  ('20270101005200','fix_min_billing_generation_safe_update','{}'::text[]),
  ('20270101005300','fix_corte_fibra_routing_normalization','{}'::text[]),
  ('20270101005400','cabedal_dublagem_groups_and_composition','{}'::text[]),
  ('20270101005500','auto_internal_strap_intent_from_pv','{}'::text[]),
  ('20270101005600','restore_component_consumption_sector_schema','{}'::text[]),
  ('20270101005700','skip_prebaseline_strap_schedule_events','{}'::text[]),
  ('20270101005800','sp120_glow_material_identity','{}'::text[]),
  ('20270101005900','sole_pair_unit_contract','{}'::text[])
ON CONFLICT (version) DO NOTHING;

DO $$
DECLARE v_missing text[];
BEGIN
  SELECT array_agg(v.version ORDER BY v.version) INTO v_missing
    FROM (VALUES
      ('20270101004500'),('20270101004600'),('20270101004700'),
      ('20270101004800'),('20270101004900'),('20270101005000'),
      ('20270101005050'),('20270101005100'),('20270101005200'),
      ('20270101005300'),('20270101005400'),('20270101005500'),
      ('20270101005600'),('20270101005700'),('20270101005800'),
      ('20270101005900')
    ) v(version)
   WHERE NOT EXISTS (
     SELECT 1 FROM supabase_migrations.schema_migrations m
      WHERE m.version = v.version
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Histórico ainda sem migrations verificadas: %', v_missing;
  END IF;
END;
$$;

COMMIT;
