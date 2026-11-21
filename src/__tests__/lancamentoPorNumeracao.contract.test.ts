import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(
  __dirname,
  '../../supabase/migrations/20270101052000_lancamento_producao_por_numeracao.sql',
), 'utf8');

describe('lançamento por numeração — migration aditiva', () => {
  it('não reescreve o motor nem toca fila, status de PV ou os pedidos protegidos', () => {
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.apontar_producao_setor/);
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.execute_production_pointing_command/);
    expect(migration).not.toMatch(/\bproduction_queue\b/);
    expect(migration).not.toMatch(/auto_motor_enabled/);
    expect(migration).not.toMatch(/sale_orders/);
    expect(migration).not.toMatch(/PV-00249|PV-00250|LOTE-00004/);
    expect(migration).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|\bDROP TABLE\b/i);
  });

  it('liga o flag pelo cadastro, não por nome fixo no caminho de gravação', () => {
    expect(migration).toContain('point_by_size');
    expect(migration).toContain('acabamento palmilha');
    expect(migration).toContain('costura de palmilha');
    expect(migration).toContain('corte de fibra');
    expect(migration).toContain('corte de forração');
    expect(migration).toContain('sector_settings');
    expect(migration).toContain('execute_production_pointing_by_size');
    expect(migration).toContain('execute_production_pointing_command');
    expect(migration).toContain('size_breakdown');
    expect(migration).toContain('DISABLE TRIGGER tg_sector_settings_recompute');
  });
});
