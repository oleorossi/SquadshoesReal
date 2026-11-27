import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SQL = readFileSync(
  resolve(ROOT, 'supabase/migrations/20270101066100_atelie_ressalva_entrada_baixa_e_delete_where.sql'),
  'utf8',
);

describe('Ateliê — ressalva com entrada automática e baixa imediata', () => {
  it('regulariza a falta com IN e OUT na mesma transação, sem estoque negativo', () => {
    expect(SQL).toContain('atelier_settle_open_kit_shortages');
    expect(SQL).toContain('Entrada automática por ressalva no Ateliê —');
    expect(SQL).toContain('Baixa automática por ressalva no Ateliê —');
    expect(SQL).toContain("'ajuste'");
    expect(SQL).toContain("'consumo_op'");
    expect(SQL).toContain('app.atelier_ressalva_settlement');
    expect(SQL).toContain('atelier_confirm_lot_release');
  });

  it('corrige o DELETE sem WHERE das temporárias de envio (pg-safeupdate)', () => {
    expect(SQL).toContain('DELETE FROM atelier_split_buffer WHERE TRUE;');
    expect(SQL).toContain('DELETE FROM atelier_remessa_remain WHERE TRUE;');
    expect(SQL).toContain('DELETE FROM atelier_remessa_take WHERE TRUE;');
    expect(SQL).toContain("app.atelier_send_os");
    expect(SQL).toContain('tg_atelier_os_only_from_cut');
  });

  it('a confirmação da ressalva passa a liquidar o kit e os textos descrevem entrada e baixa', () => {
    expect(SQL).toContain('v_settle := public.atelier_settle_open_kit_shortages(p_lot_id)');
    expect(SQL).toContain('entra automaticamente a quantidade que falta, baixa o material do lote na mesma transação');
    const board = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierOperacao.tsx'), 'utf8');
    const split = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierSplitDialog.tsx'), 'utf8');
    const remessa = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierRemessaPanel.tsx'), 'utf8');
    const shortage = readFileSync(resolve(ROOT, 'src/lib/atelierKitShortage.ts'), 'utf8');
    const lancamento = readFileSync(resolve(ROOT, 'src/components/atelier/AtelierLancamento.tsx'), 'utf8');
    expect(shortage).toContain('entrada automática na quantidade que falta');
    expect(shortage).toContain('baixa o material necessário para o lote');
    expect(split).toContain('Confirmo o envio com ressalva');
    expect(remessa).toContain('Confirmo o envio com ressalva');
    expect(split).toContain('lançada no estoque e baixada na hora');
    expect(remessa).toContain('lançada no estoque e baixada na hora');
    expect(board).toContain('Confirma o envio com ressalva?');
    expect(board).toContain('lançada no estoque e baixada na hora para este lote');
    expect(lancamento).toContain('lança a entrada do material que chegou e já faz a baixa para o lote');
  });
});
