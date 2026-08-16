import { describe, expect, it } from 'vitest';
import {
  buildClickNotasTechnicalProductName,
  ClickNotasProductPostDefinitelyRejectedError,
  provisionClickNotasProductIdentity,
  resolveClickNotasProductIdentity,
} from '../../../supabase/functions/_shared/clickNotasProductIdentity';

describe('resolveClickNotasProductIdentity', () => {
  it('reserva o sufixo de SKU dentro dos 120 caracteres do nome técnico', () => {
    const technicalName = buildClickNotasTechnicalProductName('R'.repeat(200), 'ref01-madri');

    expect(technicalName).toHaveLength(120);
    expect(technicalName).toMatch(/ \[SKU:REF01-MADRI\]$/);
  });

  it('reutiliza a segunda emissão mesmo quando a API só devolve código interno', () => {
    const technicalName = buildClickNotasTechnicalProductName(
      'REF 01 - NAPA MADRI - OFF WHITE',
      'REF01-MADRI',
    );
    const resolution = resolveClickNotasProductIdentity([
      {
        id: 'madri',
        nome: technicalName,
        codigo_interno: '903927',
      },
    ], technicalName);

    expect(resolution.kind).toBe('match');
    if (resolution.kind === 'match') expect(resolution.product.id).toBe('madri');
  });

  it('não reutiliza a variante de SKU divergente porque o nome técnico é distinto', () => {
    const softName = buildClickNotasTechnicalProductName('REF 01 - OFF WHITE', 'REF01-SOFT');
    const madriName = buildClickNotasTechnicalProductName('REF 01 - OFF WHITE', 'REF01-MADRI');

    expect(resolveClickNotasProductIdentity([
      { id: 'soft', nome: softName, codigo_interno: '111' },
    ], madriName)).toMatchObject({
      kind: 'not_found',
    });
  });

  it('bloqueia duplicidade externa do mesmo nome técnico', () => {
    const technicalName = buildClickNotasTechnicalProductName(
      'REF 01 - NAPA MADRI',
      'REF01-MADRI',
    );
    expect(resolveClickNotasProductIdentity([
      { id: 'one', nome: technicalName, codigo_interno: '111' },
      { id: 'two', nome: technicalName, codigo_interno: '222' },
    ], technicalName)).toMatchObject({
      kind: 'conflict',
      reason: 'ambiguous_identity',
      exactIdentityMatches: 2,
    });
  });

  it('permite criar quando não existe descrição exata', () => {
    expect(resolveClickNotasProductIdentity([
      { id: 'other', nome: 'OUTRA REFERÊNCIA', codigo: 'OUTRA' },
    ], 'REF 01 - NAPA MADRI [SKU:REF01-MADRI]')).toEqual({
      kind: 'not_found',
      exactNameMatches: 0,
      exactIdentityMatches: 0,
    });
  });

  it('serializa duas emissões da mesma identidade e faz um único POST', async () => {
    type Row = {
      state: 'resolving' | 'posting' | 'ready';
      owner: string | null;
      technicalName: string;
      providerId: string | null;
      generation: number;
    };
    let row: Row | null = null;
    let createCalls = 0;
    const externalProducts = new Map<string, string>();

    const optionsFor = (owner: string, proposedTechnicalName: string) => ({
      claim: async () => {
        if (!row) {
          row = {
            state: 'resolving',
            owner,
            technicalName: proposedTechnicalName,
            providerId: null,
            generation: 1,
          };
        }
        if (row.state === 'ready') {
          return {
            outcome: 'ready' as const,
            technical_name: row.technicalName,
            provider_id: row.providerId!,
            lease_generation: row.generation,
          };
        }
        if (row.state === 'resolving' && row.owner === owner) {
          return {
            outcome: 'acquired' as const,
            technical_name: row.technicalName,
            lease_generation: row.generation,
          };
        }
        return {
          outcome: 'busy' as const,
          state: row.state,
          technical_name: row.technicalName,
          retry_after_ms: 1,
          lease_generation: row.generation,
        };
      },
      lookup: async (technicalName: string) => {
        const providerId = externalProducts.get(technicalName);
        return providerId
          ? { kind: 'match' as const, providerId }
          : { kind: 'not_found' as const };
      },
      beginPost: async (generation: number) => {
        expect(row?.owner).toBe(owner);
        expect(row?.generation).toBe(generation);
        row!.state = 'posting';
        return {
          outcome: 'posting' as const,
          technical_name: row!.technicalName,
          lease_generation: generation,
        };
      },
      create: async (technicalName: string) => {
        createCalls += 1;
        await new Promise(resolve => setTimeout(resolve, 15));
        externalProducts.set(technicalName, 'provider-1');
        return { providerId: 'provider-1' };
      },
      complete: async (generation: number, providerId: string) => {
        expect(row?.owner).toBe(owner);
        row = { ...row!, state: 'ready', owner: null, providerId };
        return {
          outcome: 'ready' as const,
          technical_name: row.technicalName,
          provider_id: providerId,
          lease_generation: generation,
        };
      },
      recordOutcome: async () => ({}),
      reconcile: async () => ({
        outcome: 'reconcile_required' as const,
        technical_name: row!.technicalName,
        lease_generation: row!.generation,
      }),
      sleep: async () => new Promise<void>(resolve => setTimeout(resolve, 1)),
      maxWaitMs: 250,
    });

    const firstName = 'REF 01 - NAPA MADRI [SKU:REF01-MADRI]';
    const [first, second] = await Promise.all([
      provisionClickNotasProductIdentity(optionsFor('owner-1', firstName)),
      provisionClickNotasProductIdentity(optionsFor(
        'owner-2',
        'DESCRIÇÃO FUTURA [SKU:REF01-MADRI]',
      )),
    ]);

    expect(createCalls).toBe(1);
    expect(first.providerId).toBe('provider-1');
    expect(second.providerId).toBe('provider-1');
    expect(first.technicalName).toBe(firstName);
    expect(second.technicalName).toBe(firstName);
  });

  it('reconcilia crash pós-POST por GET e nunca repete o POST', async () => {
    let createCalls = 0;
    const reconciliations: string[] = [];
    const result = await provisionClickNotasProductIdentity({
      claim: async () => ({
        outcome: 'reconcile_required',
        technical_name: 'REF 01 - MADRI [SKU:REF01-MADRI]',
        lease_generation: 3,
      }),
      lookup: async () => ({ kind: 'match', providerId: 'provider-recovered' }),
      beginPost: async () => { throw new Error('beginPost não deve rodar'); },
      create: async () => {
        createCalls += 1;
        return { providerId: 'duplicado' };
      },
      complete: async () => { throw new Error('complete normal não deve rodar'); },
      recordOutcome: async () => ({}),
      reconcile: async (observation, providerId) => {
        reconciliations.push(observation);
        return {
          outcome: 'ready',
          technical_name: 'REF 01 - MADRI [SKU:REF01-MADRI]',
          provider_id: providerId,
          lease_generation: 3,
        };
      },
    });

    expect(result.providerId).toBe('provider-recovered');
    expect(result.source).toBe('external_lookup');
    expect(createCalls).toBe(0);
    expect(reconciliations).toEqual(['found']);
  });

  it('falha fechado quando o POST foi ambíguo e o GET ainda não encontra produto', async () => {
    let createCalls = 0;
    const observations: string[] = [];
    await expect(provisionClickNotasProductIdentity({
      claim: async () => ({
        outcome: 'reconcile_required',
        technical_name: 'REF 01 [SKU:REF01]',
        lease_generation: 2,
      }),
      lookup: async () => ({ kind: 'not_found' }),
      beginPost: async () => { throw new Error('não deve iniciar POST'); },
      create: async () => {
        createCalls += 1;
        return { providerId: 'indevido' };
      },
      complete: async () => { throw new Error('não deve concluir'); },
      recordOutcome: async () => ({}),
      reconcile: async (observation) => {
        observations.push(observation);
        return {
          outcome: 'reconcile_required',
          technical_name: 'REF 01 [SKU:REF01]',
          lease_generation: 2,
        };
      },
    })).rejects.toThrow('Nenhum novo POST será feito');

    expect(createCalls).toBe(0);
    expect(observations).toEqual(['not_found']);
  });

  it('só torna posting retryable quando o provedor comprova recusa sem processar', async () => {
    const outcomes: string[] = [];
    await expect(provisionClickNotasProductIdentity({
      claim: async () => ({
        outcome: 'acquired',
        technical_name: 'REF 01 [SKU:REF01]',
        lease_generation: 1,
      }),
      lookup: async () => ({ kind: 'not_found' }),
      beginPost: async () => ({
        outcome: 'posting',
        technical_name: 'REF 01 [SKU:REF01]',
        lease_generation: 1,
      }),
      create: async () => {
        throw new ClickNotasProductPostDefinitelyRejectedError('429 não processado');
      },
      complete: async () => { throw new Error('não deve concluir'); },
      recordOutcome: async (_generation, outcome) => {
        outcomes.push(outcome);
      },
      reconcile: async () => { throw new Error('não deve reconciliar'); },
    })).rejects.toThrow('429 não processado');

    expect(outcomes).toEqual(['retryable']);
  });

  it('não inicia POST quando a consulta externa falha', async () => {
    let beginCalls = 0;
    let createCalls = 0;
    const outcomes: string[] = [];

    await expect(provisionClickNotasProductIdentity({
      claim: async () => ({
        outcome: 'acquired',
        technical_name: 'REF 01 [SKU:REF01]',
        lease_generation: 4,
      }),
      lookup: async () => { throw new Error('GET ClickNotas 503'); },
      beginPost: async () => {
        beginCalls += 1;
        throw new Error('não deve iniciar POST');
      },
      create: async () => {
        createCalls += 1;
        return { providerId: 'indevido' };
      },
      complete: async () => { throw new Error('não deve concluir'); },
      recordOutcome: async (_generation, outcome) => {
        outcomes.push(outcome);
      },
      reconcile: async () => { throw new Error('não deve reconciliar'); },
    })).rejects.toThrow('GET ClickNotas 503');

    expect(beginCalls).toBe(0);
    expect(createCalls).toBe(0);
    expect(outcomes).toEqual(['retryable']);
  });
});
