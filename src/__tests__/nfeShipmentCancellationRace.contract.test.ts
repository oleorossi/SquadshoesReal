import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20270101011400_nfe_cancellation_shipment_lock_boundary.sql',
);
const CANCEL = read('supabase/functions/cancel-nfe/index.ts');

function sqlFunction(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = MIGRATION.indexOf(marker);
  expect(start, `${name} ausente`).toBeGreaterThanOrEqual(0);
  const tail = MIGRATION.slice(start);
  const end = tail.indexOf('\n$$;');
  expect(end, `${name} sem terminador`).toBeGreaterThanOrEqual(0);
  return tail.slice(0, end + 4);
}

function expectNfeThenSaleOrderLockOrder(source: string) {
  const nfeSetLock = source.indexOf(
    'WHERE ne.sale_order_id = v_sale_order_hint\n     ORDER BY ne.id\n     FOR UPDATE;',
  );
  const commandLock = source.indexOf("'sale-order-command:'");
  const saleOrderLock = source.indexOf('FROM public.sale_orders so', commandLock);
  const phantomLock = source.indexOf('FOR UPDATE NOWAIT', saleOrderLock);
  expect(nfeSetLock).toBeGreaterThanOrEqual(0);
  expect(commandLock).toBeGreaterThan(nfeSetLock);
  expect(saleOrderLock).toBeGreaterThan(commandLock);
  expect(phantomLock).toBeGreaterThan(saleOrderLock);
}

describe('NF-e x expedição — fronteira transacional', () => {
  it('patch da expedição trava NF-es antes do advisory/PV e detecta phantom NOWAIT', () => {
    const shipmentPatch = MIGRATION.slice(
      MIGRATION.indexOf('-- 1) Expedição'),
      MIGRATION.indexOf('-- 2) Claim curto'),
    );
    const nfeLock = shipmentPatch.indexOf(
      "E'  PERFORM ne.id\\n'\n    || E'    FROM public.nfe_emitidas ne\\n'",
    );
    expect(nfeLock).toBeGreaterThanOrEqual(0);
    expect(shipmentPatch.indexOf('|| v_marker', nfeLock)).toBeGreaterThan(nfeLock);
    expect(shipmentPatch).toContain("E'       FOR UPDATE NOWAIT;\\n'");
    expect(shipmentPatch).toContain('FOUND prova uma NF autorizada');
    expect(shipmentPatch).toContain('patch de phantom não aplicado');
    expect(shipmentPatch).toContain('EXECUTE v_after');
    expect(MIGRATION).toContain(
      'v_nfe_lock < v_command_lock AND v_command_lock < v_pv_lock',
    );
  });

  it('begin/abort/complete compartilham NF-e -> advisory -> PV -> NOWAIT', () => {
    expectNfeThenSaleOrderLockOrder(sqlFunction('begin_nfe_cancellation_command'));
    expectNfeThenSaleOrderLockOrder(sqlFunction('abort_nfe_cancellation_command'));
    expectNfeThenSaleOrderLockOrder(sqlFunction('complete_nfe_cancellation_command'));
  });

  it('begin recusa expedição concluída e faz claim fiscal por CAS', () => {
    const begin = sqlFunction('begin_nfe_cancellation_command');
    for (const status of [
      'expedido',
      'concluído',
      'concluido',
      'finalizado',
      'finalizado s/ nf',
      'entregue',
    ]) {
      expect(begin).toContain(`'${status}'`);
    }
    expect(begin).toContain("v_so.status <> 'Faturado'");
    expect(begin).toContain("SET status = 'cancelando'");
    expect(begin).toContain("AND pg_catalog.lower(pg_catalog.btrim(ne.status)) = 'autorizada'");
    expect(begin).toContain('GET DIAGNOSTICS v_changed = ROW_COUNT');
    expect(begin).toContain("'provider_call_required', false");
  });

  it('complete só reabre o PV por CAS Faturado e mantém avulsa em Rascunho', () => {
    const complete = sqlFunction('complete_nfe_cancellation_command');
    expect(complete).toContain("v_so.status NOT IN ('Faturado', 'Rascunho')");
    expect(complete).toContain(
      "v_so.status NOT IN ('Faturado', 'Em Produção')",
    );
    expect(complete).toContain("SET status = 'cancelada'");
    expect(complete).toContain("SET status = 'Em Produção'");
    expect(complete).toContain("AND so.status = 'Faturado'");
    expect(complete).toContain('CAS Faturado -> Em Produção perdeu a corrida');
    expect(complete).toContain('reverse_standalone_nfe_stock_for_cancel');
    expect(complete).toContain("v_current_order_status <> 'Rascunho'");
    expect(complete).not.toMatch(/SET status = '(Expedido|Finalizado|Concluído)'/);
  });

  it('commit local inclui financeiro e AR sob o mesmo lock idempotente da NF-e', () => {
    const complete = sqlFunction('complete_nfe_cancellation_command');
    const fiscalCommit = complete.indexOf("SET status = 'cancelada'");
    const financialLock = complete.indexOf('FROM public.financial_entries fe', fiscalCommit);
    const reversal = complete.indexOf("'sale_order_cancel_nfe'", financialLock);
    const receivable = complete.indexOf('UPDATE public.accounts_receivable', reversal);
    expect(financialLock).toBeGreaterThan(fiscalCommit);
    expect(reversal).toBeGreaterThan(financialLock);
    expect(receivable).toBeGreaterThan(reversal);
    expect(complete).toContain('FOR UPDATE;');
    expect(complete).toContain("ar.status NOT IN ('received', 'cancelled')");
  });

  it('commands locais são exclusivamente service_role', () => {
    for (const signature of [
      'begin_nfe_cancellation_command(uuid,text)',
      'abort_nfe_cancellation_command(uuid,text)',
      'complete_nfe_cancellation_command(uuid,text,text)',
    ]) {
      expect(MIGRATION).toContain(signature);
    }
    expect(MIGRATION).toContain(
      "'REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role'",
    );
    expect(MIGRATION).toContain(
      "'GRANT EXECUTE ON FUNCTION public.%s TO service_role'",
    );
  });
});

describe('cancel-nfe — orquestração sem escrita service-role crua', () => {
  it('faz begin antes do provedor e complete somente após confirmação', () => {
    const begin = CANCEL.indexOf('"begin_nfe_cancellation_command"');
    const provider = CANCEL.indexOf(
      '`${CLICKNOTAS_BASE}/notas_fiscais_produtos/cancelar/',
    );
    const complete = CANCEL.indexOf('"complete_nfe_cancellation_command"');
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(provider).toBeGreaterThan(begin);
    expect(complete).toBeGreaterThan(provider);
    expect(CANCEL).toContain('provider_call_required === true');
    expect(CANCEL).toContain('provider_call_skipped: true');
  });

  it('não atualiza NF, PV, financeiro ou AR diretamente', () => {
    for (const table of [
      'nfe_emitidas',
      'sale_orders',
      'financial_entries',
      'accounts_receivable',
    ]) {
      expect(CANCEL).not.toContain(`.from("${table}")`);
    }
    expect(CANCEL).toContain('"abort_nfe_cancellation_command"');
    expect(CANCEL).toContain('"complete_nfe_cancellation_command"');
  });

  it('falha ambígua mantém cancelando; só rejeição conclusiva chama abort', () => {
    expect(CANCEL).toContain('const deterministicRejection =');
    expect(CANCEL).toContain('Resposta do provedor/local é ambígua');
    expect(CANCEL).toContain('NF-e mantida em cancelando para reconciliação');
    expect(CANCEL).toContain('_providerCalled && _claimedNfeId !== null');
    expect(CANCEL).toContain('if (!_providerCalled && _adminClientForAbort && _claimedNfeId)');
  });
});
