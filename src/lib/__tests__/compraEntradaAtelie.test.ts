import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  atelierKitIsClosed,
  billingFortnightStart,
  canStealReservation,
  compareAllocation,
  cutPendingFill,
} from '@/lib/atelierInbound';
import { atelierStrapBuyer, weeklyOcIncludesMaterial } from '@/lib/atelierStrapPurchase';
import { gradeReceiptIsValid, invoiceReceiptDecision } from '@/lib/purchaseReceipt';
import { minOrderWarning, purchaseWeekStart, weeklyPurchaseIdempotency } from '@/lib/weeklyPurchaseOrder';

const sql = (name: string) => readFileSync(
  resolve(process.cwd(), 'supabase/migrations', name),
  'utf8',
);

function fnBody(file: string, name: string): string {
  const text = sql(file);
  const start = text.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return text.slice(start);
}

describe('OC semanal e tira', () => {
  it('uma chave por fornecedor e semana, rascunho, mínimo só avisa', () => {
    expect(purchaseWeekStart('2026-11-11', '2026-11-18')).toBe('2026-11-09');
    expect(weeklyPurchaseIdempotency('supplier:abc', '2026-11-09')).toBe(
      'auto_pv:outbox:supplier:abc:week:2026-11-09',
    );
    expect(minOrderWarning({
      productName: 'NAPA', quantity: 40, minOrder: 100, unit: 'm',
    })).toMatch(/não foi aplicado/);
    expect(minOrderWarning({
      productName: 'NAPA', quantity: 100, minOrder: 100, unit: 'm',
    })).toBeNull();
  });

  it('tira artesanal fica no motor strap_demand; componente comum fica na OC semanal', () => {
    expect(atelierStrapBuyer({ isArtisanalStrap: true })).toBe('strap_demand');
    expect(weeklyOcIncludesMaterial({ isArtisanalStrap: true })).toBe(false);
    expect(atelierStrapBuyer({ isArtisanalStrap: false, component: 'Componente Direto' })).toBe('weekly_oc');
    const weekly = sql('20270101047600_oc_semanal_por_fornecedor.sql');
    expect(weekly).toContain('NOT COALESCE(p.is_artisanal_strap, false)');
    expect(weekly).toContain('generate_atelier_strap_purchase_and_service');
    expect(weekly).not.toContain('PERFORM public.generate_atelier_strap_purchase_and_service');
    expect(weekly).toContain("'draft'");
    expect(weekly).toContain('purchase_week_start');
  });
});

describe('entrada da OC', () => {
  it('grade parcial fecha com a quantidade desta entrada', () => {
    expect(gradeReceiptIsValid({ '37': 2, '38': 1 }, 3).ok).toBe(true);
    const bad = gradeReceiptIsValid({ '37': 2, '38': 2 }, 3);
    expect(bad.ok).toBe(false);
  });

  it('a mesma NF não entra de novo pelo XML nem pelo botão', () => {
    expect(invoiceReceiptDecision({
      invoiceId: 'nf-1', alreadyReceivedInvoiceId: 'nf-1', mode: 'receive',
    }).ok).toBe(false);
    expect(invoiceReceiptDecision({
      invoiceId: null, alreadyReceivedInvoiceId: null, mode: 'receive',
    }).ok).toBe(true);
    const receive = sql('20270101047700_entrada_oc_nf_grade.sql');
    expect(receive).toContain('Esta nota fiscal já deu entrada em estoque');
    expect(receive).toContain('purchase_order_id, invoice_id');
    expect(receive).toContain('recebimento %');
  });
});

describe('Ateliê na entrada', () => {
  it('1. a liberação ignora débito já feito antes de mexer no estoque', () => {
    const body = fnBody('20270101047800_liberacao_atelie_idempotente.sql', 'atelier_confirm_lot_release');
    const guard = body.indexOf("s.sector = 'liberacao_atelier'");
    const stock = body.indexOf('UPDATE public.products');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(stock);
    expect(body).toContain('CONTINUE');
    expect(body).not.toContain('atelier_mark_job_sent');
  });

  it('3. kit fechou é uma função só: napa sem pending e portão pronto', () => {
    expect(atelierKitIsClosed({ napaPendingQty: 0, kitGate: 'ready_to_send' })).toBe(true);
    expect(atelierKitIsClosed({ napaPendingQty: 2, kitGate: 'ready_to_send' })).toBe(false);
    expect(atelierKitIsClosed({ napaPendingQty: 0, kitGate: 'awaiting_components' })).toBe(false);
    const body = fnBody('20270101047800_liberacao_atelie_idempotente.sql', 'atelier_lot_kit_is_closed');
    expect(body).toContain("d.sector = 'corte_atelier'");
    expect(body).toContain("v_gate = 'ready_to_send'");
    const inbound = sql('20270101047900_entrada_libera_atelie.sql');
    expect(inbound).toContain('atelier_lot_kit_is_closed');
    expect(inbound).not.toContain('atelier_mark_job_sent');
    expect(inbound).toContain("<> 'internal'");
  });

  it('4. quitar a napa do corte gera movimento e não zera a falta sem saldo', () => {
    expect(cutPendingFill(10, 4)).toEqual({ movementQty: 4, pendingAfter: 6 });
    expect(cutPendingFill(10, 0)).toEqual({ movementQty: 0, pendingAfter: 10 });
    const body = fnBody('20270101047900_entrada_libera_atelie.sql', 'apply_atelier_inbound');
    const movement = body.indexOf('INSERT INTO public.stock_movements');
    const pending = body.indexOf('pending_qty = pending_qty - v_qty');
    expect(movement).toBeGreaterThan(0);
    expect(movement).toBeLessThan(pending);
    expect(body).toContain('lot_id');
    expect(body).toContain('Não zera pending_qty');
    expect(body).toContain("'consumo_op'");
  });

  it('Ateliê não fura a quinzena; dentro dela o lote parado vem primeiro', () => {
    expect(billingFortnightStart('2026-11-09')).toBe('2026-11-01');
    expect(billingFortnightStart('2026-11-16')).toBe('2026-11-16');
    const earlier = { id: 'pv-cedo', fortnightStart: '2026-11-01', atelierStuck: false, priorityScore: 1 };
    const stuck = { id: 'lote', fortnightStart: '2026-11-01', atelierStuck: true, priorityScore: 5 };
    const later = { id: 'pv-tarde', fortnightStart: '2026-11-16', atelierStuck: true, priorityScore: 0 };
    expect(compareAllocation(stuck, earlier)).toBeLessThan(0);
    expect(compareAllocation(earlier, later)).toBeLessThan(0);
    expect(canStealReservation(later, stuck)).toBe(true);
    expect(canStealReservation(earlier, later)).toBe(false);
  });
});
