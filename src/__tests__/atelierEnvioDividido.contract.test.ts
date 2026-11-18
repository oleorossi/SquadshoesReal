import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048800_atelier_envio_dividido.sql',
  'utf8',
);
const UI = readFileSync('src/components/atelier/AtelierSplitDialog.tsx', 'utf8');
const PRINT = readFileSync('src/lib/printAtelierShipment.ts', 'utf8');

describe('Ateliê — envio dividido e tarifa por referência', () => {
  it('uma OS por prestador, com despacho, grade e preço travado', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.atelier_job_parts');
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.contractor_reference_rates');
    expect(SQL).toContain("'Remessa do Ateliê'");
    expect(SQL).toContain('is_avulsa');
    expect(SQL).toContain('false,');
    expect(SQL).toContain('atelier-part:');
    expect(SQL).toContain('INSERT INTO public.service_order_dispatches');
    expect(SQL).toContain('preco_parte_atelie');
    expect(SQL).toContain('Só admin ou gerência altera o R$/par');
    expect(SQL).toContain('O tamanho % passa do saldo');
    expect(SQL).toContain('atelier_job_parts p WHERE p.job_id = j.id');
  });

  it('a tela edita o R$/par e a impressão leva a ficha', () => {
    expect(UI).toContain('R$/par');
    expect(UI).toContain('Salvar como tarifa deste prestador para esta referência');
    expect(UI).toContain('Distribuir pelo menor prazo');
    expect(UI).toContain('Enviar tudo');
    expect(PRINT).toContain('Ficha do operador de cabedal');
    expect(PRINT).toContain('appendixHtml');
  });
});
