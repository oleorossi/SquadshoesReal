import { describe, expect, it, vi } from 'vitest';
import {
  executeBankReconciliationIntent,
  fetchBankReconciliationItemsPage,
  type BankReconciliationIntent,
} from '@/hooks/useBankReconciliation';
import type { PersistedBankStatementLine } from '@/lib/bankReconciliation';

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const reconciliationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const accountId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const eventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function statementLine(index: number): PersistedBankStatementLine {
  const suffix = index.toString(16).padStart(12, '0');
  return {
    id: `11111111-1111-4111-8111-${suffix}`,
    reconciliation_id: reconciliationId,
    bank_account_id: '22222222-2222-4222-8222-222222222222',
    movement_date: '2026-09-01', movement_type: 'credito', amount: 1,
    description: 'Linha', fit_id: `FIT-${index}`, transaction_type: 'CREDIT',
    transaction_name: '', memo: '', status: 'nao_conciliado', matched_to_type: null,
    matched_to_id: null, settlement_event_id: null, revision: 0,
  };
}

function matchIntent(revision = 0): BankReconciliationIntent {
  return {
    command: 'match',
    payload: {
      reconciliation_id: reconciliationId,
      entries: [{ item_id: itemId, expected_revision: revision, kind: 'payable', account_id: accountId }],
    },
  };
}

describe('comando de conciliação OFX', () => {
  it('envia somente identidade/revisão/alvo e exige confirmação integral', async () => {
    const rpc = vi.fn(async (args: Record<string, unknown>) => ({
      error: null,
      data: {
        ok: true,
        command_id: args.p_command_id,
        command: 'match',
        reconciliation_id: reconciliationId,
        event_ids: [eventId],
        items: [{ item_id: itemId, event_id: eventId, revision: 1, status: 'conciliado' }],
        replayed: false,
      },
    }));
    await expect(executeBankReconciliationIntent(actorId, matchIntent(), rpc)).resolves.toMatchObject({
      ok: true, command: 'match', reconciliation_id: reconciliationId,
    });
    const sent = rpc.mock.calls[0][0] as Record<string, unknown>;
    expect(sent.p_command_id).toMatch(/^[\da-f-]{36}$/);
    expect(sent.p_expected_actor_id).toBe(actorId);
    expect(sent.p_payload).toEqual(matchIntent().payload);
    expect(JSON.stringify(sent.p_payload)).not.toMatch(/amount|settled_on|bank_account|fit_id|source|event_id/);
  });

  it('retry da mesma revisão reutiliza ID e rematch após nova revisão usa outro', async () => {
    const ids: string[] = [];
    const rpc = vi.fn(async (args: Record<string, unknown>) => {
      ids.push(args.p_command_id as string);
      const payload = args.p_payload as Extract<BankReconciliationIntent, { command: 'match' }>['payload'];
      const revision = payload.entries[0].expected_revision + 1;
      return { error: null, data: {
        ok: true, command_id: args.p_command_id, command: 'match', reconciliation_id: reconciliationId,
        event_ids: [eventId], items: [{ item_id: itemId, event_id: eventId, revision, status: 'conciliado' }], replayed: ids.length === 2,
      } };
    });
    await executeBankReconciliationIntent(actorId, matchIntent(0), rpc);
    await executeBankReconciliationIntent(actorId, matchIntent(0), rpc);
    await executeBankReconciliationIntent(actorId, matchIntent(2), rpc);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('não aceita resposta parcial, erro RPC ou falha de transporte como confirmação', async () => {
    await expect(executeBankReconciliationIntent(actorId, matchIntent(), async args => ({
      error: null,
      data: { ok: true, command_id: args.p_command_id, command: 'match', reconciliation_id: reconciliationId, event_ids: [], items: [], replayed: false },
    }))).rejects.toThrow('não confirmou');
    await expect(executeBankReconciliationIntent(actorId, matchIntent(), async () => ({
      data: null, error: { message: 'revisão stale', code: '40001' },
    }))).rejects.toThrow('revisão stale');
    await expect(executeBankReconciliationIntent(actorId, matchIntent(), async () => {
      throw new TypeError('network');
    })).rejects.toThrow('resposta não chegou');
  });

  it('rejeita recibo com sessão, linha, revisão, estado ou evento divergente', async () => {
    const otherId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const baseResult = {
      ok: true,
      command: 'match',
      reconciliation_id: reconciliationId,
      event_ids: [eventId],
      items: [{ item_id: itemId, event_id: eventId, revision: 1, status: 'conciliado' }],
      replayed: false,
    };
    for (const patch of [
      { reconciliation_id: otherId },
      { items: [{ ...baseResult.items[0], item_id: otherId }] },
      { items: [{ ...baseResult.items[0], revision: 99 }] },
      { items: [{ ...baseResult.items[0], status: 'nao_conciliado' }] },
      { items: [{ ...baseResult.items[0], event_id: otherId }] },
    ]) {
      await expect(executeBankReconciliationIntent(actorId, matchIntent(), async args => ({
        error: null,
        data: { ...baseResult, ...patch, command_id: args.p_command_id },
      }))).rejects.toThrow('não confirmou');
    }
  });

  it('completa página quando o servidor aplica cap menor e rejeita recorte truncado', async () => {
    const rows = Array.from({ length: 150 }, (_, index) => statementLine(index));
    const capped = vi.fn(async (from: number, to: number) => ({
      data: rows.slice(from, Math.min(to + 1, from + 50)), error: null, count: rows.length,
    }));
    await expect(fetchBankReconciliationItemsPage(reconciliationId, 1, capped)).resolves.toMatchObject({
      rows: rows.slice(0, 100), count: 150, page: 1, totalPages: 2,
    });
    expect(capped.mock.calls.map(call => call[0])).toEqual([0, 50]);

    await expect(fetchBankReconciliationItemsPage(reconciliationId, 1, async () => ({
      data: [], error: null, count: 150,
    }))).rejects.toThrow('incompleta');
    await expect(fetchBankReconciliationItemsPage(reconciliationId, 1, async () => ({
      data: [rows[0]], error: null, count: 0,
    }))).rejects.toThrow('incompleta');
  });
});
