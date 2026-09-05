/** Baixas são eventos; os acumulados do título pertencem à projeção do banco. */
export type SettlementKind = 'payable' | 'receivable';

export interface SettlementTarget {
  id: string;
  kind: SettlementKind;
  description: string;
  openAmount: number;
}

export interface RegisterSettlementEntry {
  kind: SettlementKind;
  account_id: string;
  amount: number;
  settled_on: string;
  method: string;
  bank_account_id: string | null;
  reference: string | null;
  notes: string | null;
}

export interface ReverseSettlementEntry {
  event_id: string;
  reversed_on: string;
  reason: string;
}

export type FinancialSettlementIntent =
  | { command: 'register'; payload: { source_type: 'manual'; entries: RegisterSettlementEntry[] } }
  | { command: 'reverse'; payload: { entries: ReverseSettlementEntry[] } };

export type PendingFinancialSettlement = FinancialSettlementIntent & {
  version: 1;
  commandId: string;
  actorId: string;
};

export const FINANCIAL_SETTLEMENT_METHODS = [
  'pix', 'transferencia', 'boleto', 'dinheiro', 'cheque', 'cartao', 'outro',
] as const;

const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function validId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Não arredonda uma fração de centavo nem transforma NaN em zero. */
export function settlementAmountCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('Informe um valor positivo.');
  }
  const decimal = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(decimal)) {
    throw new Error('O valor deve ter no máximo duas casas decimais, sem arredondamento.');
  }
  const [whole, fraction = ''] = decimal.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('O valor excede o limite de precisão.');
  return Number(cents);
}

/** Entrada monetária sem separador de milhar: 1234,56 ou 1234.56. */
export function parseSettlementAmount(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(normalized)) {
    throw new Error('Informe o valor sem separador de milhar e com até duas casas decimais.');
  }
  const amount = Number(normalized.replace(',', '.'));
  const [whole, fraction = ''] = normalized.replace(',', '.').split('.');
  const exactCents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (BigInt(settlementAmountCents(amount)) !== exactCents) throw new Error('O valor excede o limite de precisão.');
  return amount;
}

export function assertSettlementDate(value: unknown, today: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Informe a data real do movimento.');
  }
  const date = new Date(`${value}T12:00:00Z`);
  if (value.startsWith('0000-') || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > today) {
    throw new Error('A data do movimento deve existir e não pode estar no futuro.');
  }
}

function optionalText(value: unknown, name: string, limit: number): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${name} inválido ou muito longo.`);
  return value.trim() || null;
}

/** Forma canônica também impede que origem OFX/factoring seja alegada pelo formulário. */
export function normalizeSettlementIntent(intent: FinancialSettlementIntent, today: string): FinancialSettlementIntent {
  if (!intent?.payload || !Array.isArray(intent.payload.entries) || intent.payload.entries.length < 1 || intent.payload.entries.length > 200) {
    throw new Error('Selecione entre 1 e 200 movimentos por lote.');
  }
  if (intent.command === 'register') {
    if (intent.payload.source_type !== 'manual') throw new Error('A origem deste comando deve ser manual.');
    const entries = intent.payload.entries.map((entry): RegisterSettlementEntry => {
      if (!validId(entry.account_id) || !['payable', 'receivable'].includes(entry.kind)) throw new Error('Título financeiro inválido.');
      settlementAmountCents(entry.amount);
      assertSettlementDate(entry.settled_on, today);
      if (!(FINANCIAL_SETTLEMENT_METHODS as readonly string[]).includes(entry.method)) throw new Error('Selecione a forma do movimento.');
      if (entry.bank_account_id !== null && !validId(entry.bank_account_id)) throw new Error('Conta bancária inválida.');
      return {
        kind: entry.kind, account_id: entry.account_id.toLowerCase(), amount: entry.amount,
        settled_on: entry.settled_on, method: entry.method,
        bank_account_id: entry.bank_account_id?.toLowerCase() ?? null,
        reference: optionalText(entry.reference, 'Referência', 500),
        notes: optionalText(entry.notes, 'Observação', 4000),
      };
    });
    return { command: 'register', payload: { source_type: 'manual', entries } };
  }
  if (intent.command !== 'reverse') throw new Error('Comando financeiro inválido.');
  const seen = new Set<string>();
  const entries = intent.payload.entries.map((entry): ReverseSettlementEntry => {
    if (!validId(entry.event_id) || seen.has(entry.event_id.toLowerCase())) throw new Error('Movimento de estorno inválido ou repetido.');
    seen.add(entry.event_id.toLowerCase());
    assertSettlementDate(entry.reversed_on, today);
    const reason = optionalText(entry.reason, 'Motivo', 4000);
    if (!reason) throw new Error('Informe o motivo do estorno.');
    return { event_id: entry.event_id.toLowerCase(), reversed_on: entry.reversed_on, reason };
  });
  return { command: 'reverse', payload: { entries } };
}

interface SettlementRpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class FinancialSettlementPendingError extends Error {}

/**
 * Guarda a intenção ANTES da chamada. Uma resposta perdida conserva UUID e
 * payload até a confirmação; F5 não pode transformar retry em uma nova baixa.
 * A fila é isolada por usuário e nunca segue sem armazenamento disponível.
 */
export class FinancialSettlementCommandRunner {
  private running = false;

  constructor(
    private storage: PendingStorage,
    private call: (args: { p_command_id: string; p_command: string; p_payload: FinancialSettlementIntent['payload'] }) => PromiseLike<SettlementRpcResult>,
    private makeId = () => crypto.randomUUID(),
  ) {}

  private key(actorId: string) {
    if (!validId(actorId)) throw new Error('Entre novamente para registrar movimentos financeiros.');
    return `financial-settlement-pending:v1:${actorId.toLowerCase()}`;
  }

  pending(actorId: string): PendingFinancialSettlement | null {
    const raw = this.storage.getItem(this.key(actorId));
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as PendingFinancialSettlement;
      if (value.version !== 1 || value.actorId !== actorId || !validId(value.commandId)) throw new Error();
      // Validação estrutural, sem impedir retry de uma intenção previamente enviada.
      const normalized = normalizeSettlementIntent(value, '9999-12-31');
      return { ...normalized, version: 1, actorId, commandId: value.commandId };
    } catch {
      throw new Error('Há um comando financeiro pendente que não pôde ser lido. Não envie outra baixa; confira o histórico antes de recuperar a sessão.');
    }
  }

  async execute(actorId: string, intent: FinancialSettlementIntent | null, today: string): Promise<unknown> {
    if (this.running) throw new Error('Aguarde a confirmação do movimento em andamento.');
    this.running = true;
    try {
      const normalized = intent ? normalizeSettlementIntent(intent, today) : null;
      let pending = this.pending(actorId);
      const recovering = !!pending;
      if (pending && normalized && JSON.stringify({ command: pending.command, payload: pending.payload }) !== JSON.stringify(normalized)) {
        throw new FinancialSettlementPendingError('Existe uma baixa sem confirmação. Consulte ou repita a mesma operação antes de iniciar outra.');
      }
      if (!pending) {
        if (!normalized) throw new Error('Nenhuma operação pendente para confirmar.');
        const commandId = this.makeId();
        if (!validId(commandId)) throw new Error('Não foi possível identificar a operação com segurança.');
        pending = { ...normalized, version: 1, commandId, actorId };
        this.storage.setItem(this.key(actorId), JSON.stringify(pending));
      }
      let result: SettlementRpcResult;
      try {
        result = await this.call({ p_command_id: pending.commandId, p_command: pending.command, p_payload: pending.payload });
      } catch {
        throw new FinancialSettlementPendingError('A resposta não chegou. A operação pode ter sido concluída; use Confirmar operação pendente para repetir com a mesma identificação.');
      }
      if (result.error) {
        // SQLSTATE explícito: a transação do comando foi recusada/rollbackada.
        // Timeout, falha de rede e resposta sem código NÃO autorizam novo UUID.
        // Uma recusa no RETRY não prova que a primeira tentativa não confirmou
        // (por exemplo, a permissão pode ter sido revogada entre as chamadas).
        if (!recovering && result.error.code !== '23505' && /^(22|23|42|P0)[A-Z\d]{3}$/.test(result.error.code ?? '')) {
          this.storage.removeItem(this.key(actorId));
          throw new Error(result.error.message);
        }
        throw new FinancialSettlementPendingError(`${result.error.message} A identificação foi preservada; confirme a operação pendente antes de tentar outra.`);
      }
      const confirmation = result.data as { ok?: boolean; command_id?: string; command?: string; event_ids?: unknown[] } | null;
      if (!confirmation || confirmation.ok !== true || confirmation.command_id !== pending.commandId || confirmation.command !== pending.command ||
          !Array.isArray(confirmation.event_ids) || confirmation.event_ids.length !== pending.payload.entries.length || !confirmation.event_ids.every(validId)) {
        throw new FinancialSettlementPendingError('O banco não devolveu a confirmação. Repita a operação pendente com a mesma identificação.');
      }
      this.storage.removeItem(this.key(actorId));
      return result.data;
    } finally {
      this.running = false;
    }
  }
}
