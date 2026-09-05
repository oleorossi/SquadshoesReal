import { describe, expect, it, vi } from 'vitest';
import {
  assertSettlementDate, FinancialSettlementCommandRunner, FinancialSettlementPendingError,
  normalizeSettlementIntent, parseSettlementAmount, settlementAmountCents,
  type FinancialSettlementIntent,
} from '@/lib/financialSettlement';

const actor = 'a0000000-0000-4000-8000-000000000001';
const account = 'b0000000-0000-4000-8000-000000000001';
const commandId = 'c0000000-0000-4000-8000-000000000001';
const eventId = 'd0000000-0000-4000-8000-000000000001';
const today = '2026-09-05';
const intent: FinancialSettlementIntent = {
  command: 'register', payload: { source_type: 'manual', entries: [{
    kind: 'payable', account_id: account, amount: 30.01, settled_on: '2026-09-02', method: 'pix',
    bank_account_id: null, reference: null, notes: null,
  }] },
};
const confirmed = { data: { ok: true, command_id: commandId, command: 'register', event_ids: [eventId] }, error: null };

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe('validação de baixa financeira', () => {
  it.each([[0.01, 1], [0.29, 29], [1.1, 110], [1234.56, 123456]])('centavos exatos %s', (amount, cents) => {
    expect(settlementAmountCents(amount)).toBe(cents);
  });
  it.each([0, -1, NaN, Infinity, 0.001, 1.005, '1', null, undefined, Number.MAX_SAFE_INTEGER])('recusa %s sem arredondar', value => {
    expect(() => settlementAmountCents(value)).toThrow();
  });
  it.each(['1.234,56', '1,234.56', '1e3', '-1', '12,345', '', 'R$ 10', '10.', '0', '90071992547409.91', '90071992547409.93'])('recusa entrada textual %s', value => {
    expect(() => parseSettlementAmount(value)).toThrow();
  });
  it.each(['1234,56', '1234.56', ' 1234,56 '])('aceita decimal %s', value => {
    expect(parseSettlementAmount(value)).toBe(1234.56);
  });
  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-09-06', '', '2026-9-01', '0000-01-01'])('recusa data %s', value => {
    expect(() => assertSettlementDate(value, today)).toThrow();
  });
  it('aceita ano bissexto e a data atual', () => {
    expect(() => assertSettlementDate('2024-02-29', today)).not.toThrow();
    expect(() => assertSettlementDate(today, today)).not.toThrow();
  });
  it('não aceita origem externa alegada pelo cliente', () => {
    expect(() => normalizeSettlementIntent({ ...intent, payload: { ...intent.payload, source_type: 'ofx' } } as unknown as FinancialSettlementIntent, today)).toThrow('origem');
  });
  it('não aceita lote vazio/acima de 200, nem estorno sem motivo ou repetido', () => {
    expect(() => normalizeSettlementIntent({ ...intent, payload: { source_type: 'manual', entries: [] } }, today)).toThrow();
    expect(() => normalizeSettlementIntent({ ...intent, payload: { source_type: 'manual', entries: Array(201).fill(intent.payload.entries[0]) } }, today)).toThrow();
    const entry = { event_id: eventId, reversed_on: today, reason: '' };
    expect(() => normalizeSettlementIntent({ command: 'reverse', payload: { entries: [entry] } }, today)).toThrow('motivo');
    entry.reason = 'Movimento registrado em duplicidade';
    expect(() => normalizeSettlementIntent({ command: 'reverse', payload: { entries: [entry, entry] } }, today)).toThrow('repetido');
  });
});

describe('comando financeiro com confirmação recuperável', () => {
  it('persiste antes de enviar e limpa somente após confirmação correspondente', async () => {
    const storage = memory();
    const call = vi.fn(async args => {
      expect(storage.getItem(`financial-settlement-pending:v1:${actor}`)).toContain(args.p_command_id);
      return confirmed;
    });
    const runner = new FinancialSettlementCommandRunner(storage, call, () => commandId);
    expect(await runner.execute(actor, intent, today)).toEqual(confirmed.data);
    expect(runner.pending(actor)).toBeNull();
    expect(call).toHaveBeenCalledOnce();
  });
  it('resposta perdida + F5: reenvia o mesmo UUID e payload, mesmo em outro dia', async () => {
    const storage = memory();
    const lost = vi.fn(async () => { throw new Error('Failed to fetch'); });
    const first = new FinancialSettlementCommandRunner(storage, lost, () => commandId);
    await expect(first.execute(actor, intent, today)).rejects.toBeInstanceOf(FinancialSettlementPendingError);
    const retry = vi.fn(async () => confirmed);
    const recreated = new FinancialSettlementCommandRunner(storage, retry, () => { throw new Error('Não pode criar outra identificação'); });
    await recreated.execute(actor, null, '2026-09-06');
    expect(retry.mock.calls[0]).toEqual(lost.mock.calls[0]);
    expect(recreated.pending(actor)).toBeNull();
  });
  it('não troca a intenção enquanto resultado anterior é incerto', async () => {
    const call = vi.fn(async () => ({ data: null, error: { message: 'timeout' } }));
    const runner = new FinancialSettlementCommandRunner(memory(), call, () => commandId);
    await expect(runner.execute(actor, intent, today)).rejects.toBeInstanceOf(FinancialSettlementPendingError);
    const changed = structuredClone(intent);
    changed.payload.entries[0].amount = 50;
    await expect(runner.execute(actor, changed, today)).rejects.toThrow('Existe uma baixa');
    expect(call).toHaveBeenCalledOnce();
  });
  it('recusa de permissão no retry não apaga uma possível confirmação anterior', async () => {
    const storage = memory();
    const first = new FinancialSettlementCommandRunner(storage, async () => { throw new Error('Resposta perdida'); }, () => commandId);
    await expect(first.execute(actor, intent, today)).rejects.toThrow();
    const retry = new FinancialSettlementCommandRunner(storage, async () => ({ data: null, error: { message: 'Permissão revogada', code: '42501' } }));
    await expect(retry.execute(actor, null, today)).rejects.toBeInstanceOf(FinancialSettlementPendingError);
    expect(retry.pending(actor)?.commandId).toBe(commandId);
  });
  it.each(['23505', '57014', 'PGRST000', undefined])('erro %s conserva intenção', async code => {
    const runner = new FinancialSettlementCommandRunner(memory(), async () => ({ data: null, error: { message: 'Falha', code } }), () => commandId);
    await expect(runner.execute(actor, intent, today)).rejects.toBeInstanceOf(FinancialSettlementPendingError);
    expect(runner.pending(actor)?.commandId).toBe(commandId);
  });
  it.each(['22023', '23514', '42501', 'P0001'])('recusa SQL %s permite correção sem fingir sucesso', async code => {
    const runner = new FinancialSettlementCommandRunner(memory(), async () => ({ data: null, error: { message: 'Recusado no banco', code } }), () => commandId);
    await expect(runner.execute(actor, intent, today)).rejects.toThrow('Recusado no banco');
    expect(runner.pending(actor)).toBeNull();
  });
  it.each([null, {}, { ok: true }, { ...confirmed.data, command_id: eventId }, { ...confirmed.data, event_ids: [] }])('resposta incompleta não libera intenção', async data => {
    const runner = new FinancialSettlementCommandRunner(memory(), async () => ({ data, error: null }), () => commandId);
    await expect(runner.execute(actor, intent, today)).rejects.toBeInstanceOf(FinancialSettlementPendingError);
    expect(runner.pending(actor)?.commandId).toBe(commandId);
  });
  it('storage indisponível falha antes de qualquer chamada', async () => {
    const call = vi.fn();
    const storage = { ...memory(), setItem: () => { throw new Error('QuotaExceededError'); } };
    const runner = new FinancialSettlementCommandRunner(storage, call, () => commandId);
    await expect(runner.execute(actor, intent, today)).rejects.toThrow('QuotaExceededError');
    expect(call).not.toHaveBeenCalled();
  });
  it('isola a fila por usuário e recusa corrupção em vez de apagar evidência', async () => {
    const storage = memory();
    const runner = new FinancialSettlementCommandRunner(storage, async () => { throw new Error(); }, () => commandId);
    await expect(runner.execute(actor, intent, today)).rejects.toThrow();
    expect(runner.pending(account)).toBeNull();
    storage.setItem(`financial-settlement-pending:v1:${actor}`, '{}');
    expect(() => runner.pending(actor)).toThrow('não pôde ser lido');
  });
  it('duplo clique não emite duas requisições', async () => {
    let release: (result: typeof confirmed) => void;
    const call = vi.fn(() => new Promise<typeof confirmed>(resolve => { release = resolve; }));
    const runner = new FinancialSettlementCommandRunner(memory(), call, () => commandId);
    const first = runner.execute(actor, intent, today);
    await expect(runner.execute(actor, intent, today)).rejects.toThrow('Aguarde');
    release!(confirmed);
    await first;
    expect(call).toHaveBeenCalledOnce();
  });
});
