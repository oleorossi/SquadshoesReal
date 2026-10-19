import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS = resolve(__dirname, '../../supabase/migrations');

/**
 * Regressão de 19/10/2026 — índice único do nome da ficha incluía
 * aposentadas, enquanto findSheetNameCollision (e o pedido do dono) libera
 * o nome operacional pra ficha nova/corrigida.
 *
 * Sem a cláusula `retired_at IS NULL` no WHERE parcial, recriar SP130/
 * BT01/… depois da aposentadoria em massa estoura
 * technical_sheets_name_unique_idx no save.
 */
describe('ficha nome único ignora aposentada', () => {
  const fixFile = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('_ficha-nome-unico-ignora-aposentada.sql'))
    .sort()
    .at(-1);

  it('existe migration de alinhamento do índice', () => {
    expect(fixFile).toBeTruthy();
  });

  it('recria o índice parcial só sobre fichas ativas com nome', () => {
    const sql = readFileSync(resolve(MIGRATIONS, fixFile!), 'utf8');
    expect(sql).toMatch(/drop index if exists public\.technical_sheets_name_unique_idx/i);
    expect(sql).toMatch(/create unique index technical_sheets_name_unique_idx/i);
    expect(sql).toMatch(/retired_at is null/i);
    expect(sql).toMatch(/coalesce\(trim\(name\), ''\) <> ''/i);
    expect(sql).toMatch(/lower\(trim\(name\)\)/);
  });

  it('a trave da UI continua ignorando aposentada (contrato vivo do hook)', () => {
    const hook = readFileSync(
      resolve(__dirname, '../hooks/useTechnicalSheets.ts'),
      'utf8',
    );
    const fnStart = hook.indexOf('export async function findSheetNameCollision');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = hook.slice(fnStart, fnStart + 900);
    expect(fnBody).toContain(".is('retired_at', null)");
    expect(hook).toMatch(/Ficha aposentada também não reserva o nome operacional/);
  });
});
