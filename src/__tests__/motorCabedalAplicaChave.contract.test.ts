import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync('supabase/migrations/20270101050200_motor_cabedal_aplica_com_chave.sql', 'utf8');

describe('motor só grava com a chave ligada', () => {
  it('OC, reserva e trava saem antes de escrever quando a chave está desligada', () => {
    for (const name of [
      'create_cabedal_motor_purchase_orders',
      'apply_cabedal_motor_soft_reservations',
      'apply_cabedal_motor_holds',
    ]) {
      const start = SQL.indexOf(`FUNCTION public.${name}`);
      const body = SQL.slice(start, SQL.indexOf('$$;', start));
      const gate = body.indexOf('IF NOT public.cabedal_motor_is_enabled()');
      const write = body.search(/INSERT INTO|UPDATE public/);
      expect(gate).toBeGreaterThan(-1);
      expect(write === -1 || gate < write).toBe(true);
    }
    expect(SQL).toContain('PV-00249');
    expect(SQL).toContain("WHEN NOT public.cabedal_motor_is_enabled() THEN 0");
    expect(SQL).toContain('Aguardando material');
    expect(SQL).toContain('Aguardando cabedal');
    expect(SQL).toContain('cabedal_motor_corte_released');
    expect(SQL).toContain('quantity_reserved');
    expect(SQL).not.toMatch(/SET quantity =/);
    expect(SQL).not.toMatch(/UPDATE public\.sale_orders/);
    expect(SQL).not.toMatch(/INSERT INTO public\.products/);
  });
});
