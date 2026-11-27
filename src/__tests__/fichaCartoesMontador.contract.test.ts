import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('contrato — cartão do montador', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20270101067000_ficha_cartoes_montador.sql'),
    'utf8',
  );
  const page = readFileSync(
    resolve(__dirname, '../components/production/PrintWorkSheetsPage.tsx'),
    'utf8',
  );
  const list = readFileSync(
    resolve(__dirname, '../pages/PrintWorkSheets.tsx'),
    'utf8',
  );

  it('migration cria tabela idempotente com código único e status de conferência futura', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.ficha_cartoes');
    expect(migration).toContain('CONSTRAINT ficha_cartoes_codigo_key UNIQUE (codigo)');
    expect(migration).toContain('CONSTRAINT ficha_cartoes_order_setor_index_key UNIQUE (order_id, setor, ficha_index)');
    expect(migration).toContain("CHECK (status IN ('emitido', 'baixado', 'cancelado'))");
    expect(migration).toContain('montador_id uuid REFERENCES public.employees(id)');
    expect(migration).toContain('baixado_em timestamptz');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.ensure_ficha_cartoes_for_ops');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).toContain('ON CONFLICT (order_id, setor, ficha_index) DO NOTHING');
    expect(migration).toContain("'PM-' || lpad(nextval('public.ficha_cartoes_codigo_seq')::text, 6, '0')");
  });

  it('RPC espelha resolveFicha e inclui a sobra', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolve_ficha');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.plan_ficha_cartoes');
    expect(migration).toContain('is_sobra := true');
  });

  it('Fichas de OP expõe o formato Cartão do Montador na lista e na prévia', () => {
    expect(list).toContain('Cartão do Montador');
    expect(list).toContain('initialCartaoMontador={openAsMontador}');
    expect(page).toContain('setFormatMontador');
    expect(page).toContain('useEnsureFichaCartoes');
    expect(page).toContain('<CartaoMontador');
  });
});
