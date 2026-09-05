import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncFinancialRecordsCore } from '@/lib/financialSync';

type Row = Record<string, unknown>;
type Operation = {
  table: string;
  kind: 'select' | 'update' | 'delete';
  payload?: Row;
  filters: string[];
};

class FakeQuery {
  private kind: Operation['kind'] = 'select';
  private payload?: Row;
  private predicates: Array<(row: Row) => boolean> = [];
  private filters: string[] = [];
  private maxRows: number | null = null;
  private wantsSingle = false;
  private selectedColumns = '*';

  constructor(private db: FakeDb, private table: string) {}

  select(columns = '*') {
    this.selectedColumns = columns;
    return this;
  }

  update(payload: Row) {
    this.kind = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.kind = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push(`${column}=eq.${String(value)}`);
    this.predicates.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push(`${column}=neq.${String(value)}`);
    this.predicates.push((row) => row[column] !== value);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push(`${column}=in.(${values.join(',')})`);
    this.predicates.push((row) => values.includes(row[column]));
    return this;
  }

  not(column: string, operator: string, rawValue: string) {
    this.filters.push(`${column}=not.${operator}.${rawValue}`);
    if (operator === 'in') {
      const values = rawValue
        .replace(/^\(|\)$/g, '')
        .split(',')
        .map((value) => value.replace(/^['"]|['"]$/g, ''));
      this.predicates.push((row) => !values.includes(String(row[column])));
    }
    return this;
  }

  or(expression: string) {
    this.filters.push(`or=(${expression})`);
    if (expression === 'amount_received.is.null,amount_received.eq.0') {
      this.predicates.push((row) => row.amount_received == null || Number(row.amount_received) === 0);
    }
    return this;
  }

  limit(value: number) {
    this.maxRows = value;
    return this;
  }

  single() {
    this.wantsSingle = true;
    return this;
  }

  then(resolve: (value: { data: unknown; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
    try {
      return Promise.resolve(this.execute()).then(resolve, reject);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  }

  private execute() {
    this.db.beforeExecute?.({
      table: this.table,
      kind: this.kind,
      payload: this.payload,
      filters: [...this.filters],
    });

    const source = this.db.tables[this.table] || [];
    let matched = source.filter((row) => this.predicates.every((predicate) => predicate(row)));
    if (this.maxRows != null) matched = matched.slice(0, this.maxRows);

    if (this.kind === 'update') {
      matched.forEach((row) => Object.assign(row, this.payload));
    } else if (this.kind === 'delete') {
      const matchedSet = new Set(matched);
      this.db.tables[this.table] = source.filter((row) => !matchedSet.has(row));
    }

    this.db.operations.push({
      table: this.table,
      kind: this.kind,
      payload: this.payload,
      filters: [...this.filters],
    });

    const columns = this.selectedColumns === '*'
      ? null
      : this.selectedColumns.split(',').map((column) => column.trim());
    const data = matched.map((row) => columns
      ? Object.fromEntries(columns.map((column) => [column, row[column]]))
      : { ...row }
    );
    return { data: this.wantsSingle ? data[0] ?? null : data, error: null };
  }
}

class FakeDb {
  operations: Operation[] = [];
  beforeExecute?: (operation: Operation) => void;

  constructor(public tables: Record<string, Row[]>) {}

  from(table: string) {
    return new FakeQuery(this, table);
  }
}

const SALE_ORDER_ID = 'sale-order-1';

function makeDb(status: string, nfeRequired: boolean) {
  return new FakeDb({
    sale_orders: [{
      id: SALE_ORDER_ID,
      status,
      nfe_required: nfeRequired,
      total: 1_000,
      client_name: 'Cliente',
      client_cnpj: '00.000.000/0001-00',
      payment_condition: '30/60/90',
      delivery_deadline: '2026-10-01',
    }],
    nfe_emitidas: [],
    accounts_receivable: [
      { id: 'ar-pending', sale_order_id: SALE_ORDER_ID, status: 'pending', amount: 400, amount_received: 0, due_date: '2026-01-01', installment_number: 1 },
      { id: 'ar-partial', sale_order_id: SALE_ORDER_ID, status: 'parcial', amount: 300, amount_received: 100, due_date: '2026-02-02', installment_number: 2 },
      { id: 'ar-received', sale_order_id: SALE_ORDER_ID, status: 'received', amount: 300, amount_received: 300, due_date: '2026-03-03', installment_number: 3 },
    ],
    financial_entries: [
      { id: 'fe-confirmed', reference_id: SALE_ORDER_ID, reference_type: 'sale_order', type: 'receita', status: 'confirmed', amount: 1_000, description: 'Confirmada antiga' },
      { id: 'fe-draft', reference_id: SALE_ORDER_ID, reference_type: 'sale_order', type: 'receita', status: 'draft', amount: 1_000, description: 'Rascunho' },
      { id: 'fe-posted', reference_id: SALE_ORDER_ID, reference_type: 'sale_order', type: 'receita', status: 'posted', amount: 700, description: 'Postada imutável' },
      { id: 'fe-paid', reference_id: SALE_ORDER_ID, reference_type: 'sale_order', type: 'receita', status: 'paid', amount: 800, description: 'Paga imutável' },
      { id: 'fe-reconciled', reference_id: SALE_ORDER_ID, reference_type: 'sale_order', type: 'receita', status: 'reconciled', amount: 900, description: 'Conciliada imutável' },
      { id: 'fe-expense', reference_id: SALE_ORDER_ID, reference_type: 'sale_order', type: 'despesa', status: 'confirmed' },
      { id: 'fe-other-order', reference_id: 'sale-order-2', reference_type: 'sale_order', type: 'receita', status: 'confirmed' },
    ],
  });
}

function authorizeNfe(db: FakeDb) {
  db.tables.nfe_emitidas = [{
    id: 'nfe-1',
    sale_order_id: SALE_ORDER_ID,
    status: 'autorizada',
  }];
}

function rowById(db: FakeDb, table: string, id: string) {
  return db.tables[table].find((row) => row.id === id);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('syncFinancialRecordsCore — gate anti-ghost-revenue', () => {
  it.each([
    ['PV informal', 'Aprovado', false],
    ['PV finalizado sem NF', 'Finalizado s/ NF', true],
    ['PV cancelado', 'Cancelado', true],
    ['PV faturado sem documento fiscal', 'Faturado', true],
  ])('estorna receita reversível e preserva caixa/trilha para %s', async (_label, status, nfeRequired) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = makeDb(status, nfeRequired);

    await syncFinancialRecordsCore(db, SALE_ORDER_ID);

    expect(rowById(db, 'accounts_receivable', 'ar-pending')?.status).toBe('cancelled');
    expect(rowById(db, 'accounts_receivable', 'ar-partial')).toMatchObject({ status: 'parcial', amount_received: 100 });
    expect(rowById(db, 'accounts_receivable', 'ar-received')).toMatchObject({ status: 'received', amount_received: 300 });

    expect(rowById(db, 'financial_entries', 'fe-confirmed')?.status).toBe('estornado');
    expect(rowById(db, 'financial_entries', 'fe-draft')).toBeUndefined();
    expect(rowById(db, 'financial_entries', 'fe-posted')?.status).toBe('posted');
    expect(rowById(db, 'financial_entries', 'fe-paid')?.status).toBe('paid');
    expect(rowById(db, 'financial_entries', 'fe-reconciled')?.status).toBe('reconciled');
    expect(rowById(db, 'financial_entries', 'fe-expense')?.status).toBe('confirmed');
    expect(rowById(db, 'financial_entries', 'fe-other-order')?.status).toBe('confirmed');

    const arCancellation = db.operations.find((operation) =>
      operation.table === 'accounts_receivable' && operation.kind === 'update'
    );
    expect(arCancellation?.filters).toContain('or=(amount_received.is.null,amount_received.eq.0)');
  });

  it('não cancela a AR se uma baixa parcial chegar depois da leitura inicial', async () => {
    const db = makeDb('Aprovado', false);
    let injectedReceipt = false;
    db.beforeExecute = (operation) => {
      if (injectedReceipt || operation.table !== 'accounts_receivable' || operation.kind !== 'update') return;
      injectedReceipt = true;
      Object.assign(rowById(db, 'accounts_receivable', 'ar-pending')!, {
        status: 'parcial',
        amount_received: 50,
      });
    };

    await syncFinancialRecordsCore(db, SALE_ORDER_ID);

    expect(rowById(db, 'accounts_receivable', 'ar-pending')).toMatchObject({
      status: 'parcial',
      amount_received: 50,
    });
    expect(rowById(db, 'financial_entries', 'fe-confirmed')?.status).toBe('estornado');
  });

  it('trata total zerado como gate e mantém parcelas com caixa registrado', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = makeDb('Faturado', true);
    db.tables.sale_orders[0].total = 0;
    authorizeNfe(db);

    await syncFinancialRecordsCore(db, SALE_ORDER_ID);

    expect(rowById(db, 'accounts_receivable', 'ar-pending')?.status).toBe('cancelled');
    expect(rowById(db, 'accounts_receivable', 'ar-partial')).toMatchObject({ status: 'parcial', amount_received: 100 });
    expect(rowById(db, 'accounts_receivable', 'ar-received')).toMatchObject({ status: 'received', amount_received: 300 });
    expect(rowById(db, 'financial_entries', 'fe-confirmed')?.status).toBe('estornado');
    expect(rowById(db, 'financial_entries', 'fe-posted')?.status).toBe('posted');
  });

  it('não reescreve parcelas parciais nem lançamentos financeiros protegidos ao ressincronizar faturado', async () => {
    const db = makeDb('Faturado', true);
    db.tables.sale_orders[0].total = 1_200;
    authorizeNfe(db);

    await syncFinancialRecordsCore(db, SALE_ORDER_ID);

    expect(rowById(db, 'accounts_receivable', 'ar-pending')).toMatchObject({
      amount: 400,
      due_date: '2026-10-31',
    });
    expect(rowById(db, 'accounts_receivable', 'ar-partial')).toMatchObject({
      status: 'parcial',
      amount: 300,
      amount_received: 100,
      due_date: '2026-02-02',
    });
    expect(rowById(db, 'accounts_receivable', 'ar-received')).toMatchObject({
      status: 'received',
      amount: 300,
      amount_received: 300,
      due_date: '2026-03-03',
    });

    expect(rowById(db, 'financial_entries', 'fe-confirmed')).toMatchObject({
      status: 'confirmed',
      amount: 1_200,
    });
    expect(rowById(db, 'financial_entries', 'fe-posted')).toMatchObject({
      status: 'posted', amount: 700, description: 'Postada imutável',
    });
    expect(rowById(db, 'financial_entries', 'fe-paid')).toMatchObject({
      status: 'paid', amount: 800, description: 'Paga imutável',
    });
    expect(rowById(db, 'financial_entries', 'fe-reconciled')).toMatchObject({
      status: 'reconciled', amount: 900, description: 'Conciliada imutável',
    });
  });

  it('protege uma parcial concorrente também durante a reconciliação do cronograma', async () => {
    const db = makeDb('Faturado', true);
    db.tables.sale_orders[0].total = 1_200;
    authorizeNfe(db);
    let injectedReceipt = false;
    db.beforeExecute = (operation) => {
      if (injectedReceipt || operation.table !== 'accounts_receivable' || operation.kind !== 'update') return;
      injectedReceipt = true;
      Object.assign(rowById(db, 'accounts_receivable', 'ar-pending')!, {
        status: 'parcial',
        amount_received: 50,
      });
    };

    await syncFinancialRecordsCore(db, SALE_ORDER_ID);

    expect(rowById(db, 'accounts_receivable', 'ar-pending')).toMatchObject({
      status: 'parcial',
      amount: 400,
      amount_received: 50,
      due_date: '2026-01-01',
    });
  });

  it('preserva a parcial no ramo pós-faturamento', async () => {
    const db = makeDb('Expedido', true);
    db.tables.sale_orders[0].total = 1_200;

    await syncFinancialRecordsCore(db, SALE_ORDER_ID);

    expect(rowById(db, 'accounts_receivable', 'ar-pending')).toMatchObject({
      amount: 400,
      due_date: '2026-10-31',
    });
    expect(rowById(db, 'accounts_receivable', 'ar-partial')).toMatchObject({
      status: 'parcial',
      amount: 300,
      amount_received: 100,
      due_date: '2026-02-02',
    });
  });
});
