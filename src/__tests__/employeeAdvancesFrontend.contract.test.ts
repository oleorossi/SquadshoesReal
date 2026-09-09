import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const EMPLOYEE_HOOKS = read('src/hooks/useEmployees.ts');
const PANEL = read('src/components/hr/AdvancesPanel.tsx');
const PAYROLL = read('src/pages/Payroll.tsx');
const API_SERVICE = read('src/lib/apiService.ts');
const PAYMENT_DIALOG = read('src/components/hr/RegistrarPagamentoDialog.tsx');
const PAYMENT_HOOKS = read('src/hooks/usePayrollPayments.ts');

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `${startMarker} ausente`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(end, `${endMarker} ausente`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('contrato frontend dos adiantamentos', () => {
  it('inclui o vínculo no tipo e força todo lançamento novo a começar pending', () => {
    expect(EMPLOYEE_HOOKS).toContain('payroll_run_id: string | null;');
    expect(EMPLOYEE_HOOKS).toContain("'status' | 'payroll_run_id'");

    const addAdvance = section(EMPLOYEE_HOOKS, 'export function useAddAdvance()', 'export function useCancelAdvance()');
    expect(addAdvance).toContain("runRhCommand('create_employee_advance'");
    expect(addAdvance).not.toContain(".from('employee_advances').insert");
    expect(PANEL).not.toContain('form.status');
  });

  it('baixa manual somente como baixado_externo e nunca reabre ou escreve deducted', () => {
    const manualSettlement = section(
      EMPLOYEE_HOOKS,
      'export function useMarkAdvanceExternallySettled()',
      'export function periodDateRange',
    );
    const batchSettlement = section(
      EMPLOYEE_HOOKS,
      'export function useSettleEmployeeAdvancesExternally()',
      '\n}',
    );

    expect(manualSettlement).toContain("runRhCommand('settle_employee_advance_external'");
    expect(batchSettlement).toContain("runRhCommand('settle_employee_advances_external'");
    expect(manualSettlement).not.toContain(".from('employee_advances').update");
    expect(batchSettlement).not.toContain(".from('employee_advances').update");
    expect(PANEL).not.toContain('Reabrir');
    expect(PANEL).not.toContain("status: 'deducted'");
    expect(PANEL).toContain('NÃO serão descontados nesta nem em folhas futuras');
  });

  it('exibe paid como entregue a descontar e cancela com motivo sem apagar a trilha', () => {
    expect(PANEL).toContain('<SelectItem value="paid">Entregue · a descontar</SelectItem>');
    expect(PANEL).not.toContain('Pago / quitado');
    expect(PANEL).toContain('canManageOpenEmployeeAdvance(a)');
    expect(PANEL).toContain('Controlado pela folha; não pode ser alterado');

    const cancellation = section(EMPLOYEE_HOOKS, 'export function useCancelAdvance()', 'export function useMarkAdvanceExternallySettled()');
    expect(cancellation).toContain("runRhCommand('cancel_employee_advance'");
    expect(cancellation).toContain('reason.trim()');
    expect(cancellation).not.toContain(".from('employee_advances').delete");
  });

  it('consulta pending e paid desvinculados nos três caminhos da Folha', () => {
    const canonicalFilter = /\.is\('payroll_run_id', null\)\s*\.in\('status', \[\.\.\.OPEN_EMPLOYEE_ADVANCE_STATUSES\]\)/g;
    expect(PAYROLL.match(canonicalFilter)).toHaveLength(3);
    expect(PAYROLL).not.toContain(".eq('status', 'pending')");
  });

  it('conta pending e paid desvinculados também na notificação global', () => {
    expect(API_SERVICE).toMatch(
      /\.from\('employee_advances'\)[\s\S]*?\.is\('payroll_run_id', null\)\s*\.in\('status', \[\.\.\.OPEN_EMPLOYEE_ADVANCE_STATUSES\]\)/,
    );
  });

  it('limita o pagamento ao saldo líquido e não orienta a lançar adiantamento em payroll_payments', () => {
    expect(PAYMENT_DIALOG).toContain('const amountExceedsBalance =');
    expect(PAYMENT_DIALOG).toContain('!amountExceedsBalance');
    expect(PAYMENT_DIALOG).toContain('!futurePaymentDate');
    expect(PAYMENT_DIALOG).toContain('max={today}');
    expect(PAYMENT_DIALOG).toContain('O valor não pode superar o saldo de');
    expect(PAYMENT_DIALOG).toContain('somente pagamentos do saldo líquido desta folha');
    expect(PAYMENT_DIALOG).not.toContain('Ex.: adiantamento, saldo, etc.');
    expect(PAYMENT_HOOKS).not.toContain('pagamentos (adiantamento + saldo)');
    expect(PAYMENT_HOOKS).toContain('Adiantamentos pertencem exclusivamente a `employee_advances`');
    expect(PAYMENT_HOOKS).toContain('p_idempotency_key: input.idempotencyKey');
    expect(PAYMENT_HOOKS).toContain('findPayrollPaymentByIdempotencyKey(input.idempotencyKey)');
    expect(PAYMENT_HOOKS).toContain('assertIdempotentPaymentMatches(existing, input, receipt)');
    expect(PAYMENT_HOOKS).toContain('payroll_run_id,employee_id,amount,method,paid_on');
    expect(PAYMENT_HOOKS).toContain('depois do COMMIT');
    expect(PAYMENT_HOOKS).toContain("runPayrollCommand('register_payroll_payment'");
    expect(PAYMENT_HOOKS).toContain("runPayrollCommand('reverse_payroll_payment'");
    expect(PAYMENT_HOOKS).not.toContain(".from('payroll_payments')\n        .delete()");
    expect(PAYMENT_DIALOG).not.toContain('ou anexe depois');
    expect(PAYMENT_DIALOG).toContain('application/pdf,image/jpeg,image/png,image/webp');
  });
});
