export class SingleFlightBusyError extends Error {
  constructor() {
    super('A single-flight operation is already in progress.');
    this.name = 'SingleFlightBusyError';
  }
}

export class SingleFlightCooldownError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super('The single-flight operation is cooling down.');
    this.name = 'SingleFlightCooldownError';
    this.retryAfterMs = Math.max(0, retryAfterMs);
  }
}

interface SingleFlightCooldownOptions {
  cooldownMs: number;
  /** Mantém o intervalo também depois de falha. Desative quando o chamador
   * consegue atualizar o snapshot e deve permitir nova tentativa correta. */
  cooldownAfterError?: boolean;
  now?: () => number;
}

interface SingleFlightCooldown {
  run<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

/**
 * Mantém no máximo uma operação ativa e impõe um intervalo curto depois que ela
 * termina. O relógio injetável deixa a regra determinística sem timers em teste.
 */
export function createSingleFlightCooldown({
  cooldownMs,
  cooldownAfterError = true,
  now = Date.now,
}: SingleFlightCooldownOptions): SingleFlightCooldown {
  const safeCooldownMs = Math.max(0, cooldownMs);
  const inFlightKeys = new Set<string>();
  const availableAtByKey = new Map<string, number>();

  return {
    async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
      const currentTime = now();
      for (const [entryKey, availableAt] of availableAtByKey) {
        if (availableAt <= currentTime) availableAtByKey.delete(entryKey);
      }

      if (inFlightKeys.has(key)) throw new SingleFlightBusyError();

      const retryAfterMs = (availableAtByKey.get(key) || 0) - currentTime;
      if (retryAfterMs > 0) throw new SingleFlightCooldownError(retryAfterMs);

      inFlightKeys.add(key);
      let succeeded = false;
      try {
        const result = await operation();
        succeeded = true;
        return result;
      } finally {
        inFlightKeys.delete(key);
        if (safeCooldownMs > 0 && (succeeded || cooldownAfterError)) {
          availableAtByKey.set(key, now() + safeCooldownMs);
        }
      }
    },
  };
}
