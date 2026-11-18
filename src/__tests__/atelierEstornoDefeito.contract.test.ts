import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20270101048900_atelier_estorno_e_defeito.sql',
  'utf8',
);
const UI = readFileSync('src/components/atelier/AtelierReceiptDialog.tsx', 'utf8');
const HOOKS = readFileSync('src/hooks/useAtelier.ts', 'utf8');
const BOARD = readFileSync('src/components/atelier/AtelierOperacao.tsx', 'utf8');

describe('Ateliê — estorno compensatório e defeito', () => {
  it('o estorno grava outro retorno e não apaga o histórico', () => {
    const body = SQL.slice(SQL.indexOf('FUNCTION public.atelier_reverse_receipt_return'));
    const fn = body.slice(0, body.indexOf('REVOKE ALL ON FUNCTION public.atelier_reverse_receipt_return'));
    expect(fn).toContain('adjustment_kind');
    expect(fn).toContain("'reversal'");
    expect(fn).toContain('reverses_return_id');
    expect(fn).toContain('return_reversed');
    expect(fn).toContain("status = 'cancelled'");
    expect(fn).toContain('service_order_return_credit');
    expect(fn).not.toContain('DELETE FROM public.service_order_returns');
    expect(fn).not.toContain('DELETE FROM public.accounts_payable');
  });

  it('retrabalho reenvia na mesma OS e o descarte pode cobrar', () => {
    expect(SQL).toContain('atelier-rework:');
    expect(SQL).toContain("'rework'");
    expect(SQL).toContain("'scrap'");
    expect(SQL).toContain('INSERT INTO public.contractor_loss_claims');
    expect(SQL).toContain('atelier_pending_defect(v_job.id) = 0');
    expect(SQL).toContain('Entregue');
    expect(SQL).toContain('defect_pairs numeric, loss_pairs numeric');
  });

  it('a tela reabre a conferência e chama o retorno do retrabalho', () => {
    expect(SQL).toContain('FUNCTION public.atelier_receive_rework');
    expect(HOOKS).toContain('atelier_receive_rework');
    expect(HOOKS).toContain('p_resolution_id: input.resolutionId');
    expect(UI).toContain('receiveAtelierRework');
    expect(UI).toContain('Receber retrabalho');
    expect(UI).toContain('if ((defectPairs ?? 0) <= 0) onClose()');
    expect(BOARD).toContain('pendingDefect: tallyQuery.data?.pendingDefect');
    expect(BOARD).toContain('inRework: tallyQuery.data?.inRework');
  });
});
