import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const edgeWorkflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-edge-deploy.yml'),
  'utf8',
);
const migrationWorkflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-migrate.yml'),
  'utf8',
);
const vercelWorkflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/vercel-deploy.yml'),
  'utf8',
);
const waitScript = readFileSync(
  resolve(process.cwd(), 'scripts/wait-for-supabase-migrations.sh'),
  'utf8',
);

describe('ordem de deploy das Edge Functions', () => {
  it('só publica o conjunto canônico após CI verde, banco completo e SHA atual', () => {
    const waitStep = edgeWorkflow.indexOf('Wait for database migrations from this commit');
    const freshnessStep = edgeWorkflow.indexOf('Refuse a stale main commit');
    const deployStep = edgeWorkflow.indexOf('Deploy each function');

    expect(waitStep).toBeGreaterThan(-1);
    expect(freshnessStep).toBeGreaterThan(waitStep);
    expect(deployStep).toBeGreaterThan(freshnessStep);
    expect(edgeWorkflow).toContain('workflow_run:');
    expect(edgeWorkflow).toContain('workflows: ["CI"]');
    expect(edgeWorkflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(edgeWorkflow).toContain('github.event.workflow_run.head_sha || github.sha');
    expect(edgeWorkflow).toContain('cancel-in-progress: false');
    expect(edgeWorkflow).toContain("-type d ! -name '_shared'");
    expect(edgeWorkflow).toContain('version: 2.115.0');
    expect(edgeWorkflow).toContain('Bundle preflight for all Edge Functions');
    expect(edgeWorkflow).toContain('esbuild@0.27.0');
    expect(edgeWorkflow).toContain('REQUESTED_FUNCTION: ${{ inputs.function_name }}');
    expect(edgeWorkflow).toContain('^[a-z0-9][a-z0-9-]*$');
    expect(edgeWorkflow).toContain('bash scripts/wait-for-supabase-migrations.sh');
    expect(edgeWorkflow).toContain('main:refs/remotes/origin/main');
    expect(waitScript).toContain('supabase_migrations.schema_migrations');
    expect(waitScript).toContain("find \"$migration_root\" -maxdepth 1");
    expect(waitScript).toContain('comm -23');
    expect(waitScript).toContain('required_versions.txt');
    expect(waitScript).toContain('missing_versions.txt');
    expect(waitScript).toContain('Banco não contém todas as migrations exigidas até ${required_version}; deploy bloqueado.');
  });

  it('só aplica migrations após CI verde e só publica o frontend após o banco', () => {
    expect(migrationWorkflow).toContain('workflow_run:');
    expect(migrationWorkflow).toContain('workflows: ["CI"]');
    expect(migrationWorkflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(migrationWorkflow).toContain('github.event.workflow_run.head_sha || github.sha');

    const waitStep = vercelWorkflow.indexOf('Wait for database migrations from this commit');
    const deployStep = vercelWorkflow.indexOf('Deploy to production');
    expect(waitStep).toBeGreaterThan(-1);
    expect(deployStep).toBeGreaterThan(waitStep);
    expect(vercelWorkflow).toContain('bash scripts/wait-for-supabase-migrations.sh');
    expect(vercelWorkflow).toContain('timeout-minutes: 45');
    expect(vercelWorkflow).toContain('vercel@59.5.0');
    expect(vercelWorkflow).toContain('bun-version: 1.3.13');
    expect(vercelWorkflow).toContain('cancel-in-progress: false');
    expect(vercelWorkflow).toContain('Refuse a stale main commit');
    expect(vercelWorkflow).toContain('main:refs/remotes/origin/main');
  });
});
