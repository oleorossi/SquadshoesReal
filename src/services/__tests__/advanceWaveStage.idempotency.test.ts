/**
 * Testes de idempotência para `advanceWaveStage` (RPC `advance_wave_stage`).
 *
 * Garantem que invocações repetidas para o mesmo `wave_id`:
 *   - não criem `order_stages` duplicados (validado no SQL test);
 *   - produzam o mesmo estágio de retorno quando a onda já avançou;
 *   - propaguem corretamente a estratégia "no-op" do backend.
 *
 * O comportamento real do banco (CTEs, locks, conflict resolution) é
 * verificado pelos testes SQL em `supabase/tests/`. Aqui validamos o
 * contrato do wrapper TS e a idempotência observada pelo cliente.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { advanceWaveStage } from '../productionWavesService';

const WAVE_ID = '11111111-1111-1111-1111-111111111111';

describe('advanceWaveStage — idempotência', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('chama a RPC com os parâmetros corretos', async () => {
    rpcMock.mockResolvedValue({ data: 'corte', error: null });
    await advanceWaveStage(WAVE_ID);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('advance_wave_stage', { p_wave_id: WAVE_ID });
  });

  it('retorna o mesmo estágio em chamadas consecutivas (no-op no backend)', async () => {
    rpcMock
      .mockResolvedValueOnce({ data: 'montagem', error: null })
      .mockResolvedValueOnce({ data: 'montagem', error: null });

    const a = await advanceWaveStage(WAVE_ID);
    const b = await advanceWaveStage(WAVE_ID);

    expect(a).toBe('montagem');
    expect(b).toBe('montagem');
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });

  it('retorna null quando a onda chegou ao estágio terminal', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const stage = await advanceWaveStage(WAVE_ID);
    expect(stage).toBeNull();
  });

  it('chamadas concorrentes para a mesma onda resolvem no mesmo estágio', async () => {
    rpcMock.mockResolvedValue({ data: 'acabamento', error: null });

    const results = await Promise.all([
      advanceWaveStage(WAVE_ID),
      advanceWaveStage(WAVE_ID),
      advanceWaveStage(WAVE_ID),
    ]);

    expect(new Set(results)).toEqual(new Set(['acabamento']));
    expect(rpcMock).toHaveBeenCalledTimes(3);
  });

  it('propaga erro do backend sem mascarar', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'wave not found', code: 'P0002' },
    });
    await expect(advanceWaveStage(WAVE_ID)).rejects.toMatchObject({
      message: 'wave not found',
    });
  });
});
