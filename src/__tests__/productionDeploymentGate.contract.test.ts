import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const config = JSON.parse(read('vercel.json'));
const workflow = read('.github/workflows/vercel-deploy.yml');

describe('produção aguarda CI e banco do mesmo commit', () => {
  it('bloqueia a publicação Git nativa de main, preservando previews das demais branches', () => {
    // A integração nativa publicou ba751cd antes do CI e das migrations. O
    // controle é por branch, não github.enabled=false (que bloquearia previews).
    expect(config.git.deploymentEnabled).toEqual({ main: false });
    expect(config.github?.enabled).not.toBe(false);
  });

  it('mantém o fluxo automático condicionado ao CI e no SHA que ele verificou', () => {
    expect(workflow).toContain('workflows: ["CI"]');
    expect(workflow).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(workflow).toContain('ref: ${{ github.event.workflow_run.head_sha || github.sha }}');
    expect(workflow).toContain('vercel deploy --prebuilt --prod');
  });

  it('confere banco e ponta de main antes de publicar o artefato', () => {
    const databaseGate = workflow.indexOf('- name: Wait for database migrations from this commit');
    const staleGate = workflow.indexOf('- name: Refuse a stale main commit');
    const publish = workflow.indexOf('- name: Deploy to production');
    expect(databaseGate).toBeGreaterThan(-1);
    expect(staleGate).toBeGreaterThan(databaseGate);
    expect(publish).toBeGreaterThan(staleGate);
    expect(workflow).toContain('bash scripts/wait-for-supabase-migrations.sh');
  });
});
