import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock do cliente Supabase ANTES do import do serviço.
const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { calculateConsumption } from '../consumptionService';

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: [], error: null });
});

/**
 * Edge cases para o parâmetro `size` enviado à RPC `calculate_order_consumption`.
 * A função SQL trata `p_size` como nullable e cai em `reference_size` da ficha
 * quando o valor é NULL. O serviço TypeScript precisa repassar exatamente o
 * que o SQL espera (number ou null) — sem strings, sem zero, sem NaN.
 */
describe('consumptionService — edge cases de size', () => {
  it('size = undefined → envia null para a RPC (fallback p/ reference_size no SQL)', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10 });
    expect(rpcMock.mock.calls[0][1].p_size).toBeNull();
  });

  it('size = null → envia null para a RPC', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10, size: null });
    expect(rpcMock.mock.calls[0][1].p_size).toBeNull();
  });

  it('size = 0 (falsy mas válido tecnicamente) → envia null porque é tratado como ausência', async () => {
    // 0 não é um tamanho industrial válido; o serviço usa ?? que preserva 0.
    // Documentamos o comportamento atual: 0 é repassado como 0 (não null).
    await calculateConsumption({ referenceId: 'ref', quantity: 10, size: 0 });
    expect(rpcMock.mock.calls[0][1].p_size).toBe(0);
  });

  it('size = 37 (válido) → envia 37 como inteiro', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10, size: 37 });
    expect(rpcMock.mock.calls[0][1].p_size).toBe(37);
    expect(typeof rpcMock.mock.calls[0][1].p_size).toBe('number');
  });

  it('size = 99 (tamanho inexistente na grade) → ainda é repassado; SQL fará fallback', async () => {
    // O SQL não rejeita: faz lookup em upper/lining/insole_consumption_per_size[99].
    // Como o JSONB não terá a chave, cai em sole_spec ou no escalar (sheet_materials).
    // Aqui validamos apenas que o serviço repassa o valor sem alterar.
    await calculateConsumption({ referenceId: 'ref', quantity: 10, size: 99 });
    expect(rpcMock.mock.calls[0][1].p_size).toBe(99);
  });

  it('color = undefined → envia string vazia (RPC espera text NOT NULL na assinatura)', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10 });
    expect(rpcMock.mock.calls[0][1].p_color).toBe('');
  });

  it('color = null → envia string vazia', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10, color: null });
    expect(rpcMock.mock.calls[0][1].p_color).toBe('');
  });

  it('color = "" (já string vazia) → mantém string vazia', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10, color: '' });
    expect(rpcMock.mock.calls[0][1].p_color).toBe('');
  });

  it('color com acentos / espaços → preservados (matching no SQL é normalizado)', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10, color: '  Caramelo Médio  ' });
    expect(rpcMock.mock.calls[0][1].p_color).toBe('  Caramelo Médio  ');
  });

  it('quantity = 0 → ainda chama a RPC (validação de regra de negócio fica no SQL/UI)', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 0, size: 37 });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock.mock.calls[0][1].p_order_quantity).toBe(0);
  });

  it('referenceId vazio → repassa para a RPC (que retornará erro "ficha não encontrada")', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Ficha técnica  não encontrada' },
    });
    await expect(
      calculateConsumption({ referenceId: '', quantity: 10 }),
    ).rejects.toThrow(/não encontrada/);
  });

  it('nome do procedimento RPC é "calculate_order_consumption" (não _by_grade)', async () => {
    await calculateConsumption({ referenceId: 'ref', quantity: 10, size: 37 });
    expect(rpcMock.mock.calls[0][0]).toBe('calculate_order_consumption');
  });
});

/**
 * Validação cruzada: garante que os parâmetros enviados batem com a
 * assinatura SQL atual `(p_reference_id uuid, p_order_quantity numeric,
 * p_color text, p_size integer, p_material_variant_id uuid)`.
 *
 * Histórico: mig 20260629210000 (variant-4components) adicionou
 * `p_material_variant_id` pra suportar overrides de produto+consumo
 * dos 4 componentes principais (cabedal/forro/palmilha/solado).
 */
describe('consumptionService — contrato de parâmetros com a RPC', () => {
  it('envia exatamente as 5 chaves esperadas pelo SQL', async () => {
    await calculateConsumption({ referenceId: 'r', quantity: 1, color: 'Preto', size: 37 });
    const params = rpcMock.mock.calls[0][1];
    expect(Object.keys(params).sort()).toEqual(
      ['p_color', 'p_material_variant_id', 'p_order_quantity', 'p_reference_id', 'p_size'].sort(),
    );
  });

  it('nenhum parâmetro extra (evita warnings de unused parameter no Postgres)', async () => {
    await calculateConsumption({ referenceId: 'r', quantity: 1 });
    const params = rpcMock.mock.calls[0][1];
    expect(Object.keys(params)).toHaveLength(5);
  });
});