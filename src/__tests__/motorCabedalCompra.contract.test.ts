import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const orders = readFileSync('src/hooks/useSaleOrders.ts', 'utf8');
const page = readFileSync('src/pages/PurchasePlanning.tsx', 'utf8');
const migration = readFileSync('supabase/migrations/20270101050000_motor_cabedal_simulacao.sql', 'utf8');

const PREVIOUS = [
  'carteira',
  'programado',
  'make_to_order',
  'pronta_entrega',
  'amostra',
  'bonificacao',
  'troca',
  'exportacao',
];

describe('tipo do pedido e geração de OC', () => {
  it('mantém os tipos atuais e acrescenta Urgente no mesmo seletor', () => {
    for (const value of PREVIOUS) {
      expect(orders).toContain(`value: '${value}'`);
    }
    expect(orders).toContain("value: 'urgente', label: 'Urgente'");
  });

  it('as duas visões ficam na aba Gerar OC e a entrada antiga continua', () => {
    expect(page).toContain("value: 'gerar-oc'");
    expect(page).toContain("value: 'fornecedor'");
    expect(page).toContain("value: 'pedido'");
    expect(page).toContain('PurchaseProjectionWeeklyContent');
    expect(page).toContain("next.set('tab', 'projecao')");
  });

  it('a simulação não grava OC nem reserva e a chave nasce desligada', () => {
    expect(migration).toContain('auto_motor_enabled boolean NOT NULL DEFAULT false');
    expect(migration).toContain('urgent_release_without_material boolean NOT NULL DEFAULT false');
    expect(migration).toContain('Não grava OC nem reserva');
    expect(migration).not.toContain('INSERT INTO public.purchase_orders');
    expect(migration).not.toContain('INSERT INTO public.material_reservations');
    expect(migration).not.toContain('INSERT INTO public.sale_orders');
  });
});
