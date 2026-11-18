import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'supabase/migrations');

function livingCut(): { file: string; body: string } {
  const hits = readdirSync(ROOT)
    .filter((name) => name.endsWith('.sql') && readFileSync(join(ROOT, name), 'utf8').includes('CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_cut'))
    .sort();
  const file = hits[hits.length - 1];
  const text = readFileSync(join(ROOT, file), 'utf8');
  const start = text.indexOf('CREATE OR REPLACE FUNCTION public.atelier_confirm_lot_cut');
  const tail = text.slice(start);
  const end = tail.indexOf('\n$$;');
  return { file, body: tail.slice(0, end) };
}

describe('corte manual do lote grava current_stock', () => {
  it('a função viva baixa quantity e current_stock juntos e não mexe em outros produtos', () => {
    const cut = livingCut();
    expect(cut.file).toContain('20270101049500');
    expect(cut.body).toContain('quantity = quantity - v_debit');
    expect(cut.body).toContain('current_stock = quantity - v_debit');
    expect(cut.body).toContain("'Ateliê · corte ' || v_lot.lot_number");
    expect(cut.body).toContain("'consumo_op'");
    const file = readFileSync(join(ROOT, cut.file), 'utf8');
    expect(file).not.toContain('657aa32d');
    expect(file.match(/UPDATE public\.products/g)).toHaveLength(1);
  });
});
