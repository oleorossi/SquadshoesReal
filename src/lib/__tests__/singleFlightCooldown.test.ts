import {
  createSingleFlightCooldown,
  SingleFlightBusyError,
  SingleFlightCooldownError,
} from '@/lib/singleFlightCooldown';

describe('createSingleFlightCooldown', () => {
  it('bloqueia uma segunda operação enquanto a primeira está em andamento', async () => {
    let release!: (value: string) => void;
    const firstResult = new Promise<string>((resolve) => {
      release = resolve;
    });
    const gate = createSingleFlightCooldown({ cooldownMs: 10_000 });
    const operation = vi.fn(() => firstResult);

    const firstRun = gate.run('referencia-1', operation);

    await expect(gate.run('referencia-1', operation)).rejects.toBeInstanceOf(SingleFlightBusyError);
    expect(operation).toHaveBeenCalledTimes(1);

    release('ok');
    await expect(firstRun).resolves.toBe('ok');
  });

  it('aplica cooldown também depois de uma falha e informa o tempo restante', async () => {
    let now = 1_000;
    const gate = createSingleFlightCooldown({ cooldownMs: 10_000, now: () => now });

    await expect(gate.run('referencia-1', async () => {
      throw new Error('falhou');
    })).rejects.toThrow('falhou');

    now = 4_000;
    const retry = gate.run('referencia-1', async () => 'não deve executar');
    await expect(retry).rejects.toMatchObject({ retryAfterMs: 7_000 });

    now = 11_000;
    await expect(gate.run('referencia-1', async () => 'ok')).resolves.toBe('ok');
  });

  it('permite retry imediato depois de falha quando o snapshot será atualizado', async () => {
    const gate = createSingleFlightCooldown({
      cooldownMs: 10_000,
      cooldownAfterError: false,
    });

    await expect(gate.run('referencia-1', async () => {
      throw new Error('snapshot obsoleto');
    })).rejects.toThrow('snapshot obsoleto');

    await expect(gate.run('referencia-1', async () => 'snapshot novo')).resolves.toBe('snapshot novo');
  });

  it('inicia o cooldown depois da conclusão, não a partir do início', async () => {
    let now = 0;
    let release!: () => void;
    const gate = createSingleFlightCooldown({ cooldownMs: 5_000, now: () => now });
    const pending = gate.run('referencia-1', () => new Promise<void>((resolve) => {
      release = resolve;
    }));

    now = 20_000;
    release();
    await pending;

    now = 24_999;
    await expect(gate.run('referencia-1', async () => undefined)).rejects.toBeInstanceOf(SingleFlightCooldownError);
    now = 25_000;
    await expect(gate.run('referencia-1', async () => 'liberado')).resolves.toBe('liberado');
  });

  it('permite operações simultâneas para chaves diferentes', async () => {
    let releaseFirst!: () => void;
    const gate = createSingleFlightCooldown({ cooldownMs: 10_000 });
    const firstRun = gate.run('referencia-1', () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));

    await expect(gate.run('referencia-2', async () => 'segunda')).resolves.toBe('segunda');

    releaseFirst();
    await expect(firstRun).resolves.toBeUndefined();
  });
});
