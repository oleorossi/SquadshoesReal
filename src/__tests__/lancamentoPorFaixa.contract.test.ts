import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101052500_lancamento_por_faixa_de_faca.sql',
), 'utf8');

describe('lançamento por faixa de faca — migration aditiva', () => {
  it('não reescreve o motor nem toca fila, status de PV ou o pedido protegido', () => {
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.apontar_producao_setor/);
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.execute_production_pointing_command/);
    expect(migration).not.toMatch(/\bproduction_queue\b/);
    expect(migration).not.toMatch(/auto_motor_enabled/);
    expect(migration).not.toMatch(/\bUPDATE public\.sale_orders\b/);
    expect(migration).not.toMatch(/PV-00249/);
    expect(migration).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP TABLE\b/i);
  });

  it('liga a faixa no cabedal e preserva o limite do setor anterior', () => {
    expect(migration).toContain('point_by_size_mode');
    expect(migration).toContain('knife_range');
    expect(migration).toContain('corte cabedal');
    expect(migration).toContain('costura cabedal');
    expect(migration).toContain('knife_size_ranges');
    expect(migration).toContain('check_prev_sector_limit');
    expect(migration).toContain('Faixa %: % passa o saldo de % pares.');
    expect(migration).toContain('Ficha sem faixas P/M/G cadastradas');
    expect(migration).toContain('DISABLE TRIGGER tg_sector_settings_recompute');
    expect(migration).toContain('execute_production_pointing_command');
    expect(migration).toContain("'_faixas'");
  });
});
