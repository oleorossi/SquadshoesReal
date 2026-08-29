import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATION = readFileSync(resolve(
  ROOT,
  'supabase/migrations/20270101013800_print_jobs_reprint_scope.sql',
), 'utf8');
const PRODUCTION_TAB = readFileSync(resolve(
  ROOT,
  'src/components/label-system/LabelProductionTab.tsx',
), 'utf8');

describe('escopo operacional da reimpressão parcial', () => {
  it('preserva o comportamento histórico como padrão da coluna', () => {
    expect(MIGRATION).toMatch(
      /marks_orders_as_printed\s+boolean\s+NOT\s+NULL\s+DEFAULT\s+true/i,
    );
  });

  it('não classifica uma OP como impressa por causa de reimpressão', () => {
    expect(PRODUCTION_TAB).toContain('shouldPrintJobMarkOrdersAsPrinted');
    expect(PRODUCTION_TAB).toContain("marksOrdersAsPrinted: printCoverage === 'total'");
  });

  it('registra o arquivo ZPL diretamente como gerado', () => {
    expect(PRODUCTION_TAB).toContain("initialStatus: 'generated'");
  });
});
