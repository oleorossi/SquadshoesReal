import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20270101054300_fila_corte_somente_leitura.sql',
  'utf8',
);
const older = readFileSync(
  'supabase/migrations/20270101054100_os_terceirizados_ledger_unico.sql',
  'utf8',
);
const script = readFileSync('scripts/teste-fila-corte-somente-leitura.sql', 'utf8');

function stableBodies(sql: string): string[] {
  const bodies: string[] = [];
  const marker = /LANGUAGE (?:plpgsql|sql)\s+STABLE/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(sql))) {
    const start = sql.lastIndexOf('CREATE OR REPLACE FUNCTION', match.index);
    const end = sql.indexOf('$$;', match.index);
    if (start >= 0 && end > start) bodies.push(sql.slice(start, end));
  }
  return bodies;
}

describe('fila do corte em transação somente leitura', () => {
  it('lê o kit sem gravar e devolve as duas funções a STABLE', () => {
    expect(migration).toContain('atelier_lot_kit_closed_readonly');
    expect(migration).toContain('atelier_lot_kit_closed_readonly(v_lot)');
    expect(migration).not.toContain('atelier_lot_kit_is_closed');
    expect(migration).not.toContain('FOR UPDATE');
    expect(migration).not.toContain('atelier_refresh_lot_kit_gate');
    expect(migration).toContain('ALTER FUNCTION public.list_atelier_cut_queue() STABLE');
    expect(migration).toContain('LANGUAGE plpgsql\nSTABLE');
    expect(migration).not.toContain('VOLATILE');
  });

  it('as outras STABLE de 54100 e 54200 não travam lote', () => {
    for (const body of stableBodies(older)) {
      expect(body).not.toContain('FOR UPDATE');
      expect(body).not.toContain('atelier_refresh_lot_kit_gate');
      expect(body).not.toContain('atelier_lot_kit_is_closed');
    }
    const caps = readFileSync(
      'supabase/migrations/20270101054200_corte_parcial_gera_os.sql',
      'utf8',
    );
    const capsStart = caps.indexOf('FUNCTION public.atelier_cut_range_caps');
    const capsBody = caps.slice(capsStart, caps.indexOf('$$;', capsStart));
    expect(capsBody).not.toContain('FOR UPDATE');
    expect(capsBody).not.toContain('atelier_refresh_lot_kit_gate');
  });

  it('o script chama a fila dentro de BEGIN READ ONLY', () => {
    expect(script).toContain('BEGIN READ ONLY;');
    expect(script).toContain('PERFORM public.list_atelier_cut_queue()');
    expect(script).toContain('ROLLBACK;');
    expect(script).not.toContain('COMMIT');
    expect(script).toContain('ON_ERROR_STOP');
  });
});
