/**
 * Escuta o evento global `consumption-schema-error` (disparado por
 * `validateConsumptionPayload` no consumptionService) e expõe o último
 * `ConsumptionSchemaError` recebido. Permite que qualquer tela mostre
 * o `ConsumptionErrorAlert` sem precisar interceptar a chamada à RPC.
 */
import { useEffect, useState } from 'react';
import { ConsumptionSchemaError } from '@/services/consumptionService';

export function useConsumptionSchemaError() {
  const [error, setError] = useState<ConsumptionSchemaError | null>(null);

  useEffect(() => {
    function onErr(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail instanceof ConsumptionSchemaError) setError(detail);
    }
    window.addEventListener('consumption-schema-error', onErr);
    return () => window.removeEventListener('consumption-schema-error', onErr);
  }, []);

  return { error, clear: () => setError(null) };
}
