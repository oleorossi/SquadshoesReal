import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('fronteira canônica da conciliação OFX', () => {
  it('não mantém writer direto ou estado efêmero de baixa na aba', () => {
    const source = read('src/components/finance/BankReconciliationTab.tsx');
    expect(source).toContain("from '@/hooks/useBankReconciliation'");
    expect(source).toContain('readOfxFile(file)');
    expect(source).toContain('expected_revision');
    expect(source).not.toMatch(/\.from\(['"]accounts_(?:payable|receivable)['"]\)/);
    expect(source).not.toContain('.update({');
    expect(source).not.toContain('new Set(prev)');
    expect(source).not.toContain('File.text()');
  });

  it('remove a segunda criação/exclusão de sessão da rota histórica', () => {
    const source = read('src/pages/BankReconciliation.tsx');
    expect(source).toContain("pathname: '/financeiro'");
    expect(source).toContain("params.set('tab', 'conciliacao')");
    expect(source).not.toContain("from('bank_reconciliations')");
    expect(source).not.toMatch(/insert|delete|DataListPage/);
  });

  it('amarra FITID, revisão, core financeiro e unmatch atômico no SQL', () => {
    const sql = read('supabase/migrations/20270101016000_ofx_persistido_e_conciliacao_ledger.sql');
    expect(sql).toContain('UNIQUE (bank_account_id, fit_id)');
    expect(sql).toContain('v_item.revision <> v_expected_revision');
    expect(sql).toContain("v_item.fit_id || ':r' || v_item.revision::text");
    expect(sql).toContain('private.execute_financial_settlement_core_159(');
    expect(sql).toMatch(/action_type,\s*from_revision, to_revision[\s\S]*'unmatch'/);
    expect(sql).toMatch(/SET status = 'nao_conciliado'[\s\S]*settlement_event_id = NULL/);
    expect(sql).toContain('REVOKE ALL ON TABLE public.bank_reconciliation_items');
  });
});
