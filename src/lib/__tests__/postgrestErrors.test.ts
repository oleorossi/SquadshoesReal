import { describe, expect, it } from 'vitest';
import { isMissingPostgrestRelation } from '@/lib/postgrestErrors';

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
