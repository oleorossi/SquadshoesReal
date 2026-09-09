import { readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS_DIR = resolve(ROOT, 'supabase/migrations');
const CUTOVER = '20270101009300';

type Migration = { name: string; version: string; sql: string };

const migrations: Migration[] = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{14}_.+\.sql$/.test(name))
  .sort()
  .map((name) => ({
    name,
    version: name.slice(0, 14),
    sql: readFileSync(resolve(MIGRATIONS_DIR, name), 'utf8'),
  }));

function latestMigrationContaining(marker: string | RegExp): Migration {
  const found = migrations
    .slice()
    .reverse()
    .find(({ sql }) => typeof marker === 'string' ? sql.includes(marker) : marker.test(sql));
  expect(found, `Nenhuma migration contém ${String(marker)}`).toBeDefined();
  return found!;
}

function functionBody(sql: string, functionName: string, occurrence: 'first' | 'last' = 'last'): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${functionName}`;
  const start = occurrence === 'last' ? sql.lastIndexOf(marker) : sql.indexOf(marker);
  expect(start, `${functionName} deve existir`).toBeGreaterThanOrEqual(0);
  const tail = sql.slice(start);
  const delimiterMatch = tail.match(/\bAS\s+(\$[a-zA-Z_]*\$)/i);
  expect(delimiterMatch, `${functionName} deve declarar delimitador do corpo`).toBeTruthy();
  const delimiter = delimiterMatch![1];
  const bodyStart = tail.indexOf(delimiter, delimiterMatch!.index);
  const bodyEnd = tail.indexOf(delimiter, bodyStart + delimiter.length);
  expect(bodyEnd, `${functionName} deve fechar o corpo SQL`).toBeGreaterThan(bodyStart);
  return tail.slice(0, bodyEnd + delimiter.length);
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') return [];
      return sourceFiles(path);
    }
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.test\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [path];
  });
}

describe('PV System — contratos versionados', () => {
  it('não mantém DML direto de sale_orders/sale_order_items no browser', () => {
    const violations = sourceFiles(resolve(ROOT, 'src')).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      const match = source.match(
        /\.from\(['"]sale_orders(?:_items)?['"]\)[\s\S]{0,220}?\.(?:insert|update|delete)\(/,
      );
      return match ? [`${file.replace(`${ROOT}/`, '')}: ${match[0].replace(/\s+/g, ' ')}`] : [];
    });

    expect(violations).toEqual([]);
  });

  it('mantém todas as migrations do novo sistema depois do cutover automático', () => {
    const markers = [
      'CREATE OR REPLACE FUNCTION public.get_sale_order_pendencias',
      /CREATE TABLE(?: IF NOT EXISTS)? public\.sale_order_command_receipts/i,
      'CREATE OR REPLACE FUNCTION public.resync_op_atomic',
      'partial_promotion_enabled',
      'unsafe_stock_debit_overloads',
    ];

    for (const marker of markers) {
      const migration = latestMigrationContaining(marker);
      expect(
        migration.version > CUTOVER,
        `${migration.name} seria ignorada por supabase-migrate.yml (cutover ${CUTOVER})`,
      ).toBe(true);
    }
  });

  it('classifica falta como esperado − debitado positivo, nunca delta positivo', () => {
    const migration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.get_sale_order_pendencias',
    );
    const body = compact(functionBody(migration.sql, 'get_sale_order_pendencias'));

    expect(body).toMatch(/r\.delta\s*<\s*0/);
    expect(body).toMatch(/r\.esperado\s*-\s*r\.debitado/);
    expect(body).not.toMatch(/where\s+r\.delta\s*>\s*0/);
  });

  it('persiste configuração conservadora, versões, planos, overrides e receipts idempotentes', () => {
    const migration = latestMigrationContaining(
      /CREATE TABLE(?: IF NOT EXISTS)? public\.sale_order_command_receipts/i,
    );
    const sql = compact(migration.sql);

    for (const table of [
      'sale_order_command_config',
      'sale_order_command_receipts',
      'sale_order_material_plan_revisions',
      'sale_order_readiness_overrides',
    ]) {
      expect(sql).toContain(`public.${table}`);
    }
    expect(sql).toContain('promotion_atomicity_mode');
    expect(sql).toContain("'all_or_nothing'");
    expect(sql).toMatch(/partial_promotion_enabled\s+boolean[^,;]*default\s+false/);
    expect(sql).toMatch(/material_plan_commit_milestone\s+text[^,;]*default\s+'debit'/);
    expect(sql).toContain("material_plan_commit_milestone in ('picking', 'debit', 'op_start')");
    expect(sql).not.toContain('material_plan_freeze_milestone');
    expect(sql).toContain('revision_milestone');
    expect(sql).toContain("status in ('proposed', 'committed', 'superseded')");
    expect(sql).toContain('readiness_gate_enabled');
    expect(sql).toMatch(/add column if not exists order_version\s+bigint/);
    expect(sql).toMatch(/unique[^;]*(request_id|idempotency_key)/);
    expect(migration.sql).toContain('command_receipts');
    expect(migration.sql).toContain('readiness_gate');
  });

  it('expõe preflight/execute/override e diagnóstico com todos os sinais estáveis', () => {
    const preflightMigration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.preflight_sale_order_command',
    );
    const executeMigration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.execute_sale_order_command',
    );
    const overrideMigration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.create_sale_order_readiness_override',
    );
    const diagnosticMigration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.get_sale_order_command_diagnostics',
    );

    expect(compact(preflightMigration.sql))
      .toMatch(/function public\.preflight_sale_order_command\s*\(\s*p_sale_order_id uuid/);
    expect(compact(executeMigration.sql))
      .toMatch(/function public\.execute_sale_order_command\s*\(\s*p_sale_order_id uuid/);
    expect(compact(overrideMigration.sql))
      .toMatch(/function public\.create_sale_order_readiness_override\s*\(/);
    expect(compact(diagnosticMigration.sql))
      .toMatch(/function public\.get_sale_order_command_diagnostics\s*\(/);

    for (const signal of [
      'command_receipts_in_progress_stale',
      'material_plan_readiness_blocked',
      'active_ops_outdated_plan',
      'debit_delta_missing',
      'unsafe_stock_debit_overloads',
      'partial_promotion_enabled',
    ]) {
      expect(diagnosticMigration.sql).toContain(signal);
    }
  });

  it('ressincroniza pelo estorno exato e reconstrói soft, mantendo embalagem hard', () => {
    const migration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.resync_op_atomic',
    );
    const body = compact(functionBody(migration.sql, 'resync_op_atomic'));
    const restore = body.indexOf('restore_order_stock_for_safe_resync');
    const reservationsRetire = body.search(/update public\.material_reservations/);
    const hybridDebit = body.indexOf('hybrid_debit_stock_for_order');
    const soleDebit = body.indexOf('debit_sole_stock_by_grade');
    const packagingDebit = body.indexOf('debit_packaging_for_order');
    const restoreBody = compact(functionBody(
      migration.sql,
      'restore_order_stock_for_safe_resync',
    ));

    expect(restore).toBeGreaterThanOrEqual(0);
    expect(reservationsRetire).toBeGreaterThan(restore);
    expect(hybridDebit).toBeGreaterThan(reservationsRetire);
    expect(soleDebit).toBeGreaterThan(hybridDebit);
    expect(packagingDebit).toBeGreaterThan(soleDebit);
    expect(body).not.toMatch(/delete from public\.material_reservations/);
    expect(body).not.toMatch(/update\s+public\.products\s+set\s+quantity/);
    expect(body).toMatch(/hybrid_debit_stock_for_order\s*\([^;]*p_force_soft\s*=>\s*true/);
    expect(body).toMatch(/debit_sole_stock_by_grade\s*\([^;]*p_force_soft\s*=>\s*true/);
    expect(body).toMatch(/debit_packaging_for_order\s*\([^;]*p_force_soft\s*=>\s*false/);
    expect(restoreBody).toContain('previous_grade');
    expect(restoreBody).toContain('new_grade');
    expect(restoreBody).toContain("movement_type = 'out'");
    expect(restoreBody).toContain("'in'");
    expect(restoreBody).toContain('sale_order_resync_movement_supersessions');
    expect(restoreBody).toContain('resync recusado');
    expect(compact(migration.sql)).toMatch(
      /drop function public\.hybrid_debit_stock_for_order\s*\(\s*uuid\s*,\s*numeric\s*,\s*text\s*,\s*uuid\s*,\s*jsonb\s*\)/,
    );
  });

  it('mantém um único motor de promoção e wrappers finos para os dois overloads', () => {
    const migration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.promote_sale_order_atomic_internal',
    );
    const sql = compact(migration.sql);

    expect(sql).toContain('promote_sale_order_atomic_internal');
    expect(sql).toContain('promotion_atomicity_mode');
    expect(sql).toContain("'all_or_nothing'");
    expect(sql).toMatch(/promote_sale_order_to_production\s*\(\s*p_sale_order_id uuid\s*\)/);
    expect(sql).toMatch(/promote_sale_order_to_production\s*\(\s*p_sale_order_id uuid\s*,\s*p_target_status text/);
    expect(sql.match(/execute_sale_order_command\s*\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('revoga PUBLIC de todos os overloads críticos e não concede helpers internos', () => {
    const migration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.run_sale_order_command_contract_tests',
    );
    const sql = compact(migration.sql);
    const sqlWithoutWhitespace = sql.replace(/\s+/g, '');
    const allNewSystemSql = compact(
      migrations.filter((item) => item.version > CUTOVER).map((item) => item.sql).join('\n'),
    );

    const signatures = [
      'hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb)',
      'hybrid_debit_stock_for_order(uuid,numeric,text,uuid,jsonb,boolean)',
      'promote_sale_order_to_production(uuid)',
      'promote_sale_order_to_production(uuid,text)',
      'resync_op_atomic(uuid)',
    ];
    for (const signature of signatures) {
      expect(sqlWithoutWhitespace).toContain(`revokeallonfunctionpublic.${signature}frompublic`);
    }
    expect(allNewSystemSql).not.toMatch(
      /grant execute on function public\.(build_sale_order_material_plan|persist_sale_order_material_plan_revision|promote_sale_order_atomic_internal|restore_order_stock_for_safe_resync)[^;]*to (public|anon|authenticated|service_role)/,
    );
  });

  it('mantém um guard vivo estável para cada domínio crítico', () => {
    const migration = latestMigrationContaining(
      'CREATE OR REPLACE FUNCTION public.run_sale_order_command_contract_tests',
    );
    for (const domain of [
      'pendencias_delta',
      'resync_safe_overload',
      'grants_hardened',
      'promotion_single_engine',
      'readiness_gate',
      'command_receipts',
    ]) {
      expect(migration.sql).toContain(domain);
    }
  });

  it('alinha identidade da palmilha e arredondamento discreto da embalagem sem backfill', () => {
    const migration = latestMigrationContaining(
      'PV-CONSUMPTION-IDENTITY-PARITY: embalagem-discreta-por-item',
    );
    const resolver = compact(functionBody(
      migration.sql,
      'resolve_insole_material_for_variant',
    ));
    const sql = compact(migration.sql);

    expect(migration.name).toBe(
      '20270101010600_sale_order_consumption_identity_parity.sql',
    );
    expect(resolver).toContain('insole_material_product_id');
    expect(resolver).toContain('p.active = true');
    expect(resolver).toContain('pv-consumption-identity-parity: pin explícito');
    expect(resolver).toContain('pv-consumption-identity-parity: area-first');
    for (const unit of ['dm2', 'dm²', 'm2', 'm²', 'cm2', 'cm²']) {
      expect(resolver).toContain(`'${unit}'`);
    }
    expect(resolver).toContain('exact_color');
    expect(resolver).toContain('partial_name');
    expect(resolver).toContain('color_mismatch');
    expect(resolver).toContain('pv-consumption-identity-parity: linear-only-fallback');
    expect(resolver).toContain('resolve_material_product');

    expect(sql).toContain("btrim(v_row_cat_norm) = 'embalagem'");
    expect(sql).toContain("array['un', 'par', 'placa']::text[]");
    expect(sql).toContain('v_required := ceil(v_required)');
    expect(sql).toContain('calculate_order_consumption_by_grade(uuid,jsonb,text,uuid)');
    expect(sql).toContain('calculate_order_consumption(uuid,numeric,text,integer,uuid)');
    expect(sql).toContain('run_sale_order_consumption_identity_parity_tests');
    expect(sql).toMatch(
      /revoke all on function public\.run_sale_order_consumption_identity_parity_tests\(\) from public, anon, authenticated/,
    );

    // A migration muda apenas definições/ACLs; catálogo e histórico ficam intactos.
    expect(sql).not.toMatch(
      /\b(update|insert into|delete from)\s+public\.(products|technical_sheets|sale_orders|sale_order_items|orders|sheet_materials)\b/,
    );
  });

  it('liga os sinais à tela e impede o CI de aceitar skip/zero casos', () => {
    const diagnostics = readFileSync(resolve(ROOT, 'src/pages/SystemDiagnostics.tsx'), 'utf8');
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/weekly-units.yml'), 'utf8');
    const runner = readFileSync(resolve(ROOT, 'scripts/run-pv-system-integration.mjs'), 'utf8');
    const reportGate = readFileSync(resolve(ROOT, 'scripts/pv-system-vitest-report.mjs'), 'utf8');
    const ciSetup = readFileSync(resolve(ROOT, 'docs/PV_SYSTEM_CI_SETUP.md'), 'utf8');

    expect(diagnostics).toContain("rpc('get_sale_order_command_diagnostics'");
    for (const internalTable of [
      'sale_order_command_receipts',
      'sale_order_material_plan_revisions',
      'sale_order_readiness_overrides',
    ]) {
      expect(diagnostics).not.toContain(`.from('${internalTable}')`);
    }
    for (const signal of [
      'command_receipts_in_progress_stale',
      'material_plan_readiness_blocked',
      'active_ops_outdated_plan',
      'debit_delta_missing',
      'unsafe_stock_debit_overloads',
      'partial_promotion_enabled',
      'consumption_parity_skipped',
    ]) {
      expect(diagnostics).toContain(signal);
    }
    expect(diagnostics).toContain('Resync/baixa');
    expect(diagnostics).toContain('esperado − debitado');
    expect(diagnostics).toContain('&gt; 0');
    expect(workflow).toContain('SUPABASE_CI_SERVICE_ROLE_KEY');
    expect(workflow).toContain('SUPABASE_CI_PROJECT_ID');
    expect(workflow).toMatch(
      /VITE_SUPABASE_URL:\s*\$\{\{\s*secrets\.SUPABASE_CI_URL\s*\}\}/,
    );
    expect(workflow).toMatch(
      /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_CI_SERVICE_ROLE_KEY\s*\}\}/,
    );
    expect(workflow).not.toContain('SUPABASE_CI_DB_PASSWORD');
    expect(workflow).not.toMatch(/if:\s*env\.SUPABASE/);
    expect(workflow).toContain('docs/PV_SYSTEM_CI_SETUP.md');
    for (const requiredSuite of [
      'consumptionService.parity.test.ts',
      'consumptionService.integration.test.ts',
      'debitGuards.integration.test.ts',
      'consumptionParity.integration.test.ts',
      'pvSystemDatabase.integration.test.ts',
    ]) {
      expect(runner).toContain(requiredSuite);
    }
    expect(reportGate).toContain("env.CI !== 'true'");
    expect(reportGate).toContain("env.GITHUB_ACTIONS !== 'true'");
    expect(reportGate).toContain('produção nunca recebe fixtures');
    expect(reportGate).toContain('numPendingTests');
    expect(reportGate).toContain('0 casos executados');
    expect(runner).toContain('Projeto Supabase CI validado:');
    expect(ciSetup).toContain('20270101009300');
    expect(ciSetup).toContain('ssvxfoybzmjlypnipqzn');
    expect(ciSetup).toContain('gh workflow run weekly-units.yml');
    expect(basename(latestMigrationContaining('run_sale_order_command_contract_tests').name))
      .toMatch(/^\d{14}_/);
  });
});
