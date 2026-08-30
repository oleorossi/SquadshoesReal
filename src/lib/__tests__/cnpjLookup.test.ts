import { describe, expect, it, vi } from 'vitest';
import {
  BRASIL_API_CNPJ_ORIGIN,
  lookupCnpj,
} from '@/lib/cnpjLookup';

function response(status: number, data?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe('lookupCnpj', () => {
  it('consulta o domínio oficial e devolve os dados quando a BrasilAPI responde', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(200, {
      razao_social: 'VIA Z COMERCIO DE CALCADOS LTDA',
      municipio: 'VALENCA',
      uf: 'RJ',
    }));

    const result = await lookupCnpj('27.414.388/0001-23', { fetcher });

    expect(fetcher).toHaveBeenCalledWith(
      `${BRASIL_API_CNPJ_ORIGIN}/api/cnpj/v1/27414388000123`,
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toEqual({
      status: 'success',
      data: {
        razao_social: 'VIA Z COMERCIO DE CALCADOS LTDA',
        municipio: 'VALENCA',
        uf: 'RJ',
      },
    });
  });

  it.each([
    [400, 'invalid'],
    [404, 'not-found'],
    [429, 'rate-limit'],
    [500, 'service'],
  ] as const)('distingue HTTP %s como %s', async (status, expectedStatus) => {
    const fetcher = vi.fn().mockResolvedValue(response(status));

    await expect(lookupCnpj('27414388000123', { fetcher }))
      .resolves.toEqual({ status: expectedStatus });
  });

  it('distingue timeout de erro de rede', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    const timedOutFetcher = vi.fn().mockRejectedValue(abortError);
    const networkFetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(lookupCnpj('27414388000123', { fetcher: timedOutFetcher }))
      .resolves.toEqual({ status: 'timeout' });
    await expect(lookupCnpj('27414388000123', { fetcher: networkFetcher }))
      .resolves.toEqual({ status: 'network' });
  });

  it('não chama a rede para um CNPJ incompleto', async () => {
    const fetcher = vi.fn();

    await expect(lookupCnpj('123', { fetcher }))
      .resolves.toEqual({ status: 'invalid' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('trata JSON inválido em resposta 200 como falha do serviço', async () => {
    const malformedResponse = response(200);
    vi.mocked(malformedResponse.json).mockRejectedValue(new SyntaxError('invalid json'));
    const fetcher = vi.fn().mockResolvedValue(malformedResponse);

    await expect(lookupCnpj('27414388000123', { fetcher }))
      .resolves.toEqual({ status: 'service' });
  });
});
