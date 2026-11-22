import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20270101054200_corte_parcial_gera_os.sql', 'utf8');
const script = readFileSync('scripts/teste-corte-parcial-gera-os.sql', 'utf8');
const launch = readFileSync('src/components/atelier/AtelierLancamento.tsx', 'utf8');
const queue = readFileSync('src/components/production/kanban/CorteCabedalQueue.tsx', 'utf8');
const paper = readFileSync('src/lib/printCutFollowSheet.ts', 'utf8');

describe('corte parcial gera OS', () => {
  it('não debita estoque e não chama o corte do lote', () => {
    expect(migration).not.toContain('atelier_confirm_lot_cut');
    expect(migration).not.toContain('stock_movements');
    expect(migration).not.toContain('auto_motor_enabled');
    expect(migration).toContain('approve_atelier_cut');
    expect(migration).toContain('client_request_id');
    expect(migration).toContain('service_order_dispatches');
  });

  it('o lançamento deixa de gerar OS e o corte usa o arraste das fichas', () => {
    expect(launch).not.toContain('Gerar OS desta cor');
    expect(launch).toContain('Reservar divisão');
    expect(queue).toContain('@dnd-kit/core');
    expect(queue).toContain('Confirmar prestadores');
    expect(queue).toContain('Aprovar corte e gerar OS');
    expect(queue).toContain('ReferenceThumb');
    expect(queue).toContain('Prioridade baixa');
  });

  it('o papel que acompanha as peças não leva valor', () => {
    expect(paper).not.toContain('R$');
    expect(paper).not.toContain('unit_price');
    expect(paper).toContain('Assinatura do prestador');
    expect(paper).toContain('Esta folha não contém valores');
    expect(paper).toContain('ACOMPANHA AS PEÇAS'.toLowerCase());
  });

  it('o teste SQL volta atrás e cobre as duas levas', () => {
    expect(script).toContain('BEGIN;');
    expect(script).toContain("RAISE EXCEPTION 'rollback teste corte parcial'");
    expect(script).not.toContain('COMMIT');
    expect(script).toContain('PV-00249');
    expect(script).toContain('LOTE-00004');
    expect(script).toContain('esperava 4 OS');
  });
});
