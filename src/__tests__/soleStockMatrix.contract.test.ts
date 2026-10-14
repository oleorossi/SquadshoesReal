import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupSoleStockOrders, type SoleStockOrderRow } from '@/hooks/useSoleStockMatrix';

// Spec: specs/estoque-solado-por-numeracao.md
const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20270101041600_matriz-estoque-solado-por-numeracao.sql'),
  'utf8',
);

function fnBody(name: string): string {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start, `função ${name} ausente`).toBeGreaterThanOrEqual(0);
  const end = sql.slice(start).search(/\n\$(function)?\$;/);
  expect(end, `fim da função ${name} ausente`).toBeGreaterThan(0);
  return sql.slice(start, start + end);
}

describe('matriz de estoque de solado por numeração (contract)', () => {
  it('R1: Empenhado conta SÓ PV em produção — é o material que precisa estar na fábrica agora', () => {
    const body = fnBody('sole_stock_matrix');
    // O CTE das reservas filtra por status do PV. Sem isto, `Empenhado` somaria
    // PV aprovado e a linha deixaria de responder "o que está na fábrica".
    expect(body).toMatch(/so\.status = 'Em Produção'/);
  });

  it('R5: Projetado carteira sai do motor de DEMANDA, nunca da soma reserva+demanda', () => {
    const body = fnBody('sole_stock_matrix');
    expect(body).toMatch(/compute_allocated_per_pv_purchase_need_lines\(/);
    // A carteira abre para Aprovado + Em Produção: PV aprovado não tem reserva
    // de solado, então o consumo dele só existe no lado da demanda.
    expect(body).toMatch(/so\.status IN \('Aprovado', 'Em Produção'\)/);
    // projetado_carteira usa o consumo da carteira (ca), não empenhado+falta:
    // somar as duas fontes contaria duas vezes um PV aprovado que ganhe reserva.
    expect(body).toMatch(/COALESCE\(ca\.qty, 0\)\s*\+\s*COALESCE\(c\.qty, 0\) AS projetado_carteira/);
  });

  it('R4: a pedir arredonda para CIMA em múltiplo de 10 (regra do dono: 84 → 90)', () => {
    const body = fnBody('sole_stock_matrix');
    expect(body).toMatch(/ceil\(COALESCE\(f\.qty, 0\) \/ 10\.0\) \* 10/);
  });

  it('R6: "Em compra" exclui `suggested` — sugestão não é compromisso', () => {
    const body = fnBody('sole_stock_matrix');
    expect(body).toMatch(/po\.status NOT IN \('cancelled', 'received', 'suggested', 'draft'\)/);
  });

  it('as duas funções guardam acesso com is_approved_user() e não expõem anon', () => {
    for (const fn of ['sole_stock_matrix', 'sole_stock_orders']) {
      expect(fnBody(fn), `${fn} sem guarda de acesso`).toMatch(/public\.is_approved_user\(\)/);
      expect(sql).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(uuid\\) FROM PUBLIC, anon;`),
      );
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\(uuid\\)\\s*\\n?\\s*TO authenticated, service_role;`),
      );
    }
  });

  it('R2: a lista de pedidos vem da RESERVA, não de um filtro paralelo por status', () => {
    const body = fnBody('sole_stock_orders');
    expect(body).toMatch(/material_reservation_is_pv_managed\(mr\)/);
    expect(body).toMatch(/'sole_grade'/);
    // Sem filtro por status aqui: é isso que faz os dois blocos da tela fecharem
    // por construção (Consumo total − Estoque = Projetado).
    expect(body).not.toMatch(/so\.status\s*=/);
  });

  it('ordena baldes conjugados pelo PRIMEIRO número — "33/34" vale 33, não 3334', () => {
    for (const fn of ['sole_stock_matrix', 'sole_stock_orders']) {
      expect(fnBody(fn)).toMatch(/split_part\((?:k|c)\.size_key, '\/', 1\)/);
    }
  });
});

describe('groupSoleStockOrders', () => {
  const linha = (over: Partial<SoleStockOrderRow>): SoleStockOrderRow => ({
    sale_order_id: 'pv-1', order_number: 'PV-00232', client_name: 'LNG 10',
    pv_status: 'Em Produção', billing_monday: '2026-08-03', priority: 1885715200,
    size_key: '36', size_ord: 36, consumo: 10, falta: 0, ...over,
  });

  it('agrupa por PV e soma consumo e falta por numeração', () => {
    const g = groupSoleStockOrders([
      linha({ size_key: '36', consumo: 82, falta: 0 }),
      linha({ size_key: '37', consumo: 123, falta: 5 }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].porNumero['36']).toEqual({ consumo: 82, falta: 0 });
    expect(g[0].porNumero['37']).toEqual({ consumo: 123, falta: 5 });
    expect(g[0].consumoTotal).toBe(205);
    expect(g[0].faltaTotal).toBe(5);
  });

  it('preserva a ordem de prioridade que a RPC já devolveu — não reordena por id', () => {
    const g = groupSoleStockOrders([
      linha({ sale_order_id: 'pv-a', order_number: 'PV-00232', priority: 1885715200 }),
      linha({ sale_order_id: 'pv-b', order_number: 'PV-00236', priority: 1892368000 }),
      linha({ sale_order_id: 'pv-a', order_number: 'PV-00232', size_key: '37' }),
    ]);
    expect(g.map(x => x.orderNumber)).toEqual(['PV-00232', 'PV-00236']);
  });

  it('caso vivo PV-00236: consumo 2.280 com 1.368 sem lastro', () => {
    const celulas: Array<[string, number, number]> = [
      ['35', 190, 0], ['36', 570, 482], ['37', 760, 443], ['38', 380, 172], ['39', 380, 271],
    ];
    const g = groupSoleStockOrders(
      celulas.map(([k, consumo, falta]) =>
        linha({ sale_order_id: 'pv-236', order_number: 'PV-00236', size_key: k, consumo, falta })),
    );
    expect(g[0].consumoTotal).toBe(2280);
    expect(g[0].faltaTotal).toBe(1368);
  });
});
