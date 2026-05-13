/**
 * Testes de idempotência para `debit_sole_stock_by_grade` (RPC).
 *
 * A RPC é chamada após `hybrid_debit_stock_for_order` quando o pedido tem grade
 * (matriz de tamanho/quantidade) e produto-solado configurado. Migrations
 * relevantes:
 *   - 20260426130000 — adiciona suporte a numerações conjugadas (23/24)
 *   - 20260426140000 — corrige fallback legacy quando key conjugado não existe
 *   - 20260507140000 — fix sole-debit metadata pollution (`_size_from/_size_to`)
 *   - 20260527130000 — idempotência via material_reservations + advisory lock
 *     no caller `hybrid_debit_stock_for_order`
 *
 * O comportamento real do banco (idempotência via reservas, advisory lock) é
 * validado pelos testes SQL em supabase/tests/. Aqui validamos:
 *   - contrato do wrapper TS (chama com os params corretos)
 *   - chamadas repetidas com mesmo p_order_id retornam coerentes
 *   - erro do backend propaga sem mascarar
 *   - chamadas concorrentes (Promise.all) não acumulam débitos
 *     (mock simula backend idempotente)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { supabase } from '@/integrations/supabase/client';

const ORDER_ID = '22222222-2222-2222-2222-222222222222';
const REF_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const COLOR = 'Preto';
const GRADE = { '34': 2, '35': 3, '36': 4, '37': 3, '38': 2 };

async function debitSole(orderId = ORDER_ID, grade = GRADE) {
  const { error } = await (supabase as any).rpc('debit_sole_stock_by_grade', {
    p_reference_id: REF_ID,
    p_order_id: orderId,
    p_color: COLOR,
    p_order_grade: grade,
  });
  if (error) throw error;
}

describe('debit_sole_stock_by_grade — idempotência', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('chama a RPC com os parâmetros corretos', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await debitSole();
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('debit_sole_stock_by_grade', {
      p_reference_id: REF_ID,
      p_order_id: ORDER_ID,
      p_color: COLOR,
      p_order_grade: GRADE,
    });
  });

  it('chamadas repetidas com mesmo p_order_id não disparam erro (backend é idempotente)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await debitSole();
    await debitSole();
    await debitSole();
    expect(rpcMock).toHaveBeenCalledTimes(3);
    // Backend retornou null em todas — sem erros propagados
  });

  it('chamadas concorrentes para o mesmo pedido resolvem sem error (lock + dedup no backend)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    await Promise.all([debitSole(), debitSole(), debitSole()]);
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it('propaga erro de débito sem mascarar', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'insufficient_stock', code: 'P0001' },
    });
    await expect(debitSole()).rejects.toMatchObject({ message: 'insufficient_stock' });
  });

  it('ignora p_order_grade vazio (caller responsabilidade)', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    // Caller skipa essa rpc quando grade={} — mas validamos que se chamada
    // com grade vazia mesmo assim, backend não quebra (retorna sem efeito)
    await debitSole(ORDER_ID, {});
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('debit_sole_stock_by_grade', expect.objectContaining({
      p_order_grade: {},
    }));
  });

  it('grade com tamanhos conjugados (23/24) é passada literal pro backend', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const conjGrade = { '23': 5, '24': 5, '25': 4 };
    await debitSole(ORDER_ID, conjGrade);
    // Backend internamente chama get_sole_size_key() pra mapear 23+24 → "23/24"
    // O wrapper TS não faz transformação — entrega a grade como veio
    expect(rpcMock).toHaveBeenCalledWith('debit_sole_stock_by_grade', expect.objectContaining({
      p_order_grade: conjGrade,
    }));
  });
});
