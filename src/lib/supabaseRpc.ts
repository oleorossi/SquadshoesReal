import { supabase } from '@/integrations/supabase/client';

export interface UntypedRpcError {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
}

export interface UntypedRpcResult<T> {
  data: T | null;
  error: UntypedRpcError | null;
}

/**
 * Chama uma RPC criada por migration que ainda não entrou no types.ts gerado.
 * Mantém o escape de tipagem num único ponto, sem espalhar `supabase as any`.
 */
export function callUntypedRpc<T>(
  functionName: string,
  args: Record<string, unknown>,
): PromiseLike<UntypedRpcResult<T>> {
  const client = supabase as unknown as {
    rpc: (name: string, params: Record<string, unknown>) => PromiseLike<UntypedRpcResult<T>>;
  };
  return client.rpc(functionName, args);
}
