export const BRASIL_API_CNPJ_ORIGIN = 'https://brasilapi.com.br';

const CNPJ_LOOKUP_TIMEOUT_MS = 10_000;

export interface BrasilApiCnpjData {
  razao_social?: string | null;
  nome_fantasia?: string | null;
  descricao_tipo_de_logradouro?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  bairro?: string | null;
  municipio?: string | null;
  uf?: string | null;
  cep?: string | number | null;
  codigo_municipio_ibge?: string | number | null;
  ddd_telefone_1?: string | null;
  email?: string | null;
}

export type CnpjLookupStatus =
  | 'success'
  | 'invalid'
  | 'not-found'
  | 'rate-limit'
  | 'service'
  | 'timeout'
  | 'network';

export type CnpjLookupResult =
  | { status: 'success'; data: BrasilApiCnpjData }
  | { status: Exclude<CnpjLookupStatus, 'success'> };

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface LookupCnpjOptions {
  fetcher?: FetchLike;
  timeoutMs?: number;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function lookupCnpj(
  rawCnpj: string,
  options: LookupCnpjOptions = {},
): Promise<CnpjLookupResult> {
  const cnpj = rawCnpj.replace(/\D/g, '');
  if (cnpj.length !== 14) return { status: 'invalid' };

  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? CNPJ_LOOKUP_TIMEOUT_MS,
  );

  try {
    const response = await fetcher(
      `${BRASIL_API_CNPJ_ORIGIN}/api/cnpj/v1/${cnpj}`,
      { signal: controller.signal },
    );

    if (response.status === 400) return { status: 'invalid' };
    if (response.status === 404) return { status: 'not-found' };
    if (response.status === 429) return { status: 'rate-limit' };
    if (!response.ok) return { status: 'service' };

    try {
      const data = await response.json();
      if (!data || typeof data !== 'object') return { status: 'service' };
      return { status: 'success', data: data as BrasilApiCnpjData };
    } catch {
      return { status: 'service' };
    }
  } catch (error) {
    return { status: isAbortError(error) ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timeoutId);
  }
}
