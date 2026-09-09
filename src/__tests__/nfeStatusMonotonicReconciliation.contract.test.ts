import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const migration = read(
  'supabase/migrations/20270101012600_nfe_status_monotonic_reconciliation.sql',
);
const cancelNfe = read('supabase/functions/cancel-nfe/index.ts');
const nfeStatus = read('supabase/functions/nfe-status/index.ts');
const providerSync = read('supabase/functions/sync-nfe-from-provider/index.ts');
const nfeHook = read('src/hooks/useNfe.ts');

describe('reconciliação monotônica de status da NF-e', () => {
  it('mantém cancelando absorvente e conclui cancelada pelo comando canônico', () => {
    expect(migration).toContain(
      'Absorvente: autorizada/processando/rejeitada nunca desfazem cancelando',
    );
    expect(migration).toContain('public.complete_nfe_cancellation_command(');
    expect(migration).toContain("SET state = 'manual_review'");
    expect(migration).toContain("'provider_ambiguous'");
    expect(migration).toContain("'provider_cancelled'");
  });

  it('preserva os nomes públicos begin/abort/complete e os restringe ao service_role', () => {
    for (const signature of [
      'begin_nfe_cancellation_command(uuid,text)',
      'abort_nfe_cancellation_command(uuid,text)',
      'complete_nfe_cancellation_command(uuid,text,text)',
    ]) {
      expect(migration).toContain(signature);
    }
    expect(migration).toContain('begin_nfe_cancellation_command_impl_126');
    expect(migration).toContain('abort_nfe_cancellation_command_impl_126');
    expect(migration).toContain('complete_nfe_cancellation_command_impl_126');
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.observe_nfe_provider_status_126(uuid,text,jsonb,text)',
    );
    expect(migration).toContain('TO service_role;');
  });

  it('recusa troca de identidade legal e não deixa null apagar snapshot', () => {
    expect(migration).toContain(
      'Observação diverge dos dados legais já confirmados da NF-e',
    );
    expect(migration).toContain("USING ERRCODE = 'PZ231'");
    expect(migration).toContain('pg_catalog.jsonb_strip_nulls(p_snapshot)');
    expect(migration).toContain("case_name := 'legal_identity_is_fail_closed_and_sparse'");
  });
});

describe('chamadores da fronteira monotônica', () => {
  it('cancel-nfe não conclui retry ambíguo e persiste confirmação nova antes do complete', () => {
    const pendingGuard = cancelNfe.indexOf('begin.reconciliation_required === true');
    const providerPost = cancelNfe.indexOf('/notas_fiscais_produtos/cancelar/');
    const observation = cancelNfe.indexOf('"observe_nfe_provider_status_126"');
    const legacyComplete = cancelNfe.indexOf('"complete_nfe_cancellation_command"');

    expect(pendingGuard).toBeGreaterThan(-1);
    expect(providerPost).toBeGreaterThan(pendingGuard);
    expect(observation).toBeGreaterThan(providerPost);
    expect(legacyComplete).toBeGreaterThan(observation);
    expect(cancelNfe).toContain('status: 202');
    expect(cancelNfe).toContain('Cancelamento ainda sem confirmação conclusiva do provedor');
    expect(cancelNfe).toContain('"provider_cancelled"');
    expect(cancelNfe).toContain('"manual_review"');
  });

  it('nfe-status observa status/identidade pela RPC e não escreve NF/PV diretamente', () => {
    expect(nfeStatus).toContain('"observe_nfe_provider_status_126"');
    expect(nfeStatus).toContain('p_source: "nfe-status"');
    expect(nfeStatus).not.toMatch(/\.from\("nfe_emitidas"\)[\s\S]{0,160}\.update\(/);
    expect(nfeStatus).not.toMatch(/\.from\("sale_orders"\)[\s\S]{0,160}\.update\(/);
  });

  it('sync reconcilia existentes e a corrida 23505 sem update fiscal cru', () => {
    expect(providerSync).toContain('"observe_nfe_provider_status_126"');
    expect(providerSync).toContain('p_source: "sync-nfe-from-provider"');
    expect(providerSync).toContain('.update(metadataPayload)');
    expect(providerSync).toContain('.insert(insertPayload)');
    expect(providerSync).not.toContain('.update(payload)');
    expect(providerSync).not.toContain('.update(insertPayload)');

    const conflict = providerSync.indexOf('code === "23505"');
    const lookup = providerSync.indexOf('.select("id")', conflict);
    const retry = providerSync.indexOf('await reconcileExisting(collided.id)', lookup);
    expect(conflict).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(conflict);
    expect(retry).toBeGreaterThan(lookup);
  });

  it('frontend trata 202 como reconciliação pendente, não como cancelamento concluído', () => {
    expect(nfeHook).toContain("res.status === 202 && parsed?.pending === true");
    expect(nfeHook).toContain(
      "data?.pending === true && data?.reconciliation_needed === true",
    );
    expect(nfeHook).toContain(
      'Cancelamento mantido em análise até a confirmação do provedor.',
    );
    expect(nfeHook).toContain(
      'Status consultado, mas o cancelamento ainda aguarda reconciliação do provedor.',
    );
  });
});
