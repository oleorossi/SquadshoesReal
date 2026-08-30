import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('onda pronta entrega', () => {
  it('define grade com SET em vez de somar delta', () => {
    const hook = read('src/hooks/useReadyStock.ts');
    expect(hook).toContain('useSetReadyStockGrade');
    expect(hook).toContain("action: 'set'");
    expect(hook).toContain('Defini');
  });

  it('vitrine publica nao vira PV', () => {
    const page = read('src/pages/ProntaEntrega.tsx');
    const vitrine = read('src/pages/VitrineProntaEntrega.tsx');
    expect(page).toContain('/vitrine/');
    expect(page).toContain('Pedidos da vitrine');
    expect(page).toContain('ReadyStockBoard');
    expect(vitrine).toContain('submitPublicReadyStockInquiry');
    expect(vitrine).toContain('ão cria pedido de venda automático');
  });

  it('migration expoe so RPC anon e nao SELECT direto', () => {
    const sql = read('supabase/migrations/20270101014000_pronta_entrega_vitrine_publica.sql');
    expect(sql).toContain('get_public_ready_stock');
    expect(sql).toContain('submit_public_ready_stock_inquiry');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_public_ready_stock');
    expect(sql).not.toMatch(/GRANT SELECT ON TABLE public\.ready_stock TO anon/);
  });

  it('painel usa SET + lote por grade e a rota publica existe', () => {
    const panel = read('src/components/inventory/ReadyStockBoard.tsx');
    const route = read('src/router.public.tsx');
    expect(route).toContain('/vitrine/:token');
    expect(route).toContain('VitrineProntaEntrega');
    expect(panel).toContain('useSetReadyStockGrade');
    expect(panel).toContain('groupItemsByLot');
    expect(panel).toContain('encodeGradeNotes');
    const app = read('src/App.tsx');
    expect(app).toContain('publicVitrineRoute');
  });
});
