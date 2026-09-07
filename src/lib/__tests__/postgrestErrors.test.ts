import { describe, expect, it } from 'vitest';
import {
  isMissingPostgrestRelation,
  isSchemaCacheTransientError,
} from '@/lib/postgrestErrors';

describe('isMissingPostgrestRelation', () => {
  it('reconhece os códigos retornados por Postgres e pelo cache do PostgREST', () => {
    expect(isMissingPostgrestRelation(
      { code: '42P01', message: 'relation "v_strap_service_orders" does not exist' },
      'v_strap_service_orders',
    )).toBe(true);
    expect(isMissingPostgrestRelation(
      { code: 'PGRST205', details: 'public.v_strap_service_orders was not found in the schema cache' },
      'v_strap_service_orders',
    )).toBe(true);
    expect(isMissingPostgrestRelation(
      { code: '42P01', message: 'relation "outra_view" does not exist' },
      'v_strap_service_orders',
    )).toBe(false);
  });

  it('aceita a mensagem de schema cache e não mascara erros de permissão', () => {
    expect(isMissingPostgrestRelation(
      { message: "Could not find the table 'public.v_strap_service_orders' in the schema cache" },
      'v_strap_service_orders',
    )).toBe(true);
    expect(isMissingPostgrestRelation(
      { code: '42501', message: 'permission denied for v_strap_service_orders' },
      'v_strap_service_orders',
    )).toBe(false);
  });
});

describe('isSchemaCacheTransientError', () => {
  it('reconhece PGRST002 e a mensagem de schema cache', () => {
    expect(isSchemaCacheTransientError({
      code: 'PGRST002',
      message: 'Could not query the database for the schema cache. Retrying.',
    })).toBe(true);
    expect(isSchemaCacheTransientError({
      message: 'Could not query the database for the schema cache',
    })).toBe(true);
  });

  it('não confunde com ausência de relation ou erro de rede genérico', () => {
    expect(isSchemaCacheTransientError({
      code: 'PGRST205',
      message: "Could not find the table 'public.v_pv_outsourcing_ledger' in the schema cache",
    })).toBe(false);
    expect(isSchemaCacheTransientError({
      message: 'Failed to fetch',
    })).toBe(false);
    expect(isSchemaCacheTransientError(null)).toBe(false);
  });
});
