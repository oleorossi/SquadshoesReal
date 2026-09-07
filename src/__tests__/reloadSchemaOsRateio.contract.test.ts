import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SQL = readFileSync(
  resolve(__dirname, '../../supabase/migrations/20270101020100_reload_schema_os_rateio.sql'),
  'utf8',
);

describe('reload schema OS rateio — contrato', () => {
  it('notifica o PostgREST a recarregar o schema', () => {
    expect(SQL).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('reafirma grants do RPC e da view do ledger', () => {
    expect(SQL).toContain('GRANT EXECUTE ON FUNCTION public.get_pv_outsourceable_lines(uuid)');
    expect(SQL).toContain('GRANT SELECT ON public.v_pv_outsourcing_ledger');
  });
});
