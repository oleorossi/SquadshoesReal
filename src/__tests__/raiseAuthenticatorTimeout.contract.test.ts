import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101025600_raise_authenticator_statement_timeout.sql'),
  'utf8',
);
const PREV = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101025500_execute_sale_order_raise_timeout.sql'),
  'utf8',
);

describe('raise authenticator/authenticated timeouts (20270101025600)', () => {
  it('eleva statement_timeout e lock_timeout nos roles do PostgREST', () => {
    expect(SQL).toContain('raise_authenticator_statement_timeout_20270101025600');
    expect(SQL).toContain("ALTER ROLE authenticator SET statement_timeout = '90s'");
    expect(SQL).toContain("ALTER ROLE authenticator SET lock_timeout = '30s'");
    expect(SQL).toContain("ALTER ROLE authenticated SET statement_timeout = '90s'");
    expect(SQL).toContain("ALTER ROLE authenticated SET lock_timeout = '30s'");
  });

  it('explica por que a 25500 (set_config no corpo) não basta', () => {
    expect(SQL).toContain('NÃO reagenda esse alarme');
    expect(SQL).toContain('authenticator');
    // A 25500 continua válida como documentação/orçamento da RPC, mas o
    // teto efetivo vem do role — esta migration é quem destrava o save.
    expect(PREV).toContain("set_config('statement_timeout', '90s', true)");
  });

  it('não afrouxa o teto do anon', () => {
    expect(SQL).not.toMatch(/ALTER ROLE\s+anon\s+SET\s+statement_timeout/i);
  });
});
