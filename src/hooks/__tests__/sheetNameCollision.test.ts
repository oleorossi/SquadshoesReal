// Trave de identidade da ficha técnica (pedido do dono em 20/08/2026):
// "não permitir cadastrar a mesma referência que já tem no sistema".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ilikeMock = vi.fn();
const fromMock = vi.fn(() => ({ select: () => ({ ilike: (col: string, val: string) => ilikeMock(col, val) }) }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (_table: string) => fromMock() },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import { findSheetNameCollision } from '../useTechnicalSheets';

beforeEach(() => {
  ilikeMock.mockReset();
  fromMock.mockClear();
});

const linhas = (rows: unknown[]) => ilikeMock.mockResolvedValue({ data: rows, error: null });

describe('findSheetNameCollision', () => {
  it('acha a ficha de mesmo nome', async () => {
    linhas([{ id: 'a', name: 'SP130', code: 'SP130' }]);
    const dup = await findSheetNameCollision('SP130');
    expect(dup).toMatchObject({ id: 'a', name: 'SP130' });
  });

  // Foi exatamente assim que a duplicata real nasceu: mesmo nome, código vazio.
  it('acha mesmo quando a existente tem código vazio', async () => {
    linhas([{ id: 'a', name: 'SP130', code: '' }]);
    expect(await findSheetNameCollision('SP130')).toMatchObject({ id: 'a' });
  });

  it('ignora caixa e espaço nas extremidades', async () => {
    linhas([{ id: 'a', name: '  sp130 ', code: null }]);
    expect(await findSheetNameCollision('SP130')).toMatchObject({ id: 'a' });
  });

  it('não acusa a própria ficha ao renomear', async () => {
    linhas([{ id: 'mesma', name: 'SP130', code: 'SP130' }]);
    expect(await findSheetNameCollision('SP130', 'mesma')).toBeNull();
  });

  it('nome vazio nunca colide e nem consulta o banco', async () => {
    expect(await findSheetNameCollision('   ')).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('nome livre devolve null', async () => {
    linhas([]);
    expect(await findSheetNameCollision('SP999')).toBeNull();
  });

  /**
   * A trave é conveniência, não integridade: derrubar o cadastro porque um
   * SELECT falhou (RLS, rede) seria pior que o duplicado que ela evita — a
   * integridade de verdade fica no índice único do banco.
   */
  it('erro de leitura não trava o cadastro', async () => {
    ilikeMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await findSheetNameCollision('SP130')).toBeNull();
  });

  /**
   * ⚠ A trave é por NOME, nunca por CÓDIGO. `code` é "Código interno / SKU
   * (opcional)" e é reusado de propósito entre fichas distintas — medido em
   * 20/08/2026: BT01/BT02 dividem 'BT01', I100/I90/I91 dividem 'I90I',
   * NL01/NL02 dividem 'NL02', CF 07/CF 09 dividem 'CONFORTO'. Travar por
   * código quebraria esses 11 cadastros legítimos.
   */
  it('não confunde código repetido com nome repetido', async () => {
    linhas([{ id: 'bt01', name: 'BT01', code: 'BT01' }]);
    expect(await findSheetNameCollision('BT02')).toBeNull();
  });
});
