import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  single: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  },
}));

import {
  createPrintJob,
  isPhysicallyConfirmed,
  PRINT_JOB_STATUS_LABELS,
  shouldPrintJobMarkOrdersAsPrinted,
} from '../printJobs';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  mocks.single.mockResolvedValue({ data: { id: 'job-1' }, error: null });
  mocks.select.mockReturnValue({ single: mocks.single });
  mocks.insert.mockReturnValue({ select: mocks.select });
  mocks.from.mockReturnValue({ insert: mocks.insert });
});

describe('status de impressão', () => {
  it('só confirmação humana significa impressão física', () => {
    expect(isPhysicallyConfirmed('confirmed')).toBe(true);
    expect(isPhysicallyConfirmed('generated')).toBe(false);
    expect(isPhysicallyConfirmed('completed')).toBe(false);
  });

  it('expõe o status legado como não confirmado', () => {
    expect(PRINT_JOB_STATUS_LABELS.completed).toMatch(/não confirmado/i);
  });

  it('só exclui da fila impressa jobs declarados como reimpressão', () => {
    expect(shouldPrintJobMarkOrdersAsPrinted(false)).toBe(false);
    expect(shouldPrintJobMarkOrdersAsPrinted(true)).toBe(true);
    expect(shouldPrintJobMarkOrdersAsPrinted(undefined)).toBe(true);
  });

  it('mantém o comportamento padrão de impressão total', async () => {
    await createPrintJob({ batchName: 'Lote total', totalLabels: 12, orderIds: ['op-1'] });

    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      order_ids: ['op-1'],
      marks_orders_as_printed: true,
    }));
  });

  it('registra ZPL parcial já gerado sem perder o vínculo da OP', async () => {
    await createPrintJob({
      batchName: 'Reimpressão Parcial - ZPL',
      totalLabels: 1,
      orderIds: ['op-1'],
      marksOrdersAsPrinted: false,
      initialStatus: 'generated',
    });

    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: 'generated',
      order_ids: ['op-1'],
      marks_orders_as_printed: false,
    }));
  });
});
