import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ════════════════════════════════════════════════════════════════════════
// Contrato: no financeiro, FONTE VAZIA nunca é apresentada como RESULTADO.
//
// O módulo já se protegia de falha de fonte (useDREAuto lança em vez de
// degradar CMV/regime pra zero, "senão vira lucro fictício"). O que faltava
// era o vazio: medido em 20/08/2026 havia 0 AR com amount_received, 0 AP com
// amount_paid, 0 CMV reconhecido e saldo bancário R$ 0,00 — o DRE renderizava
// uma tabela inteira zerada (lê como empresa parada) e a projeção de caixa
// desenhava uma curva só de entradas, incapaz de ficar negativa.
// ════════════════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
const HOOK = read('src/hooks/useFinanceIntelligence.ts');
const DRE = read('src/components/finance/DREAuto.tsx');
const CASH = read('src/components/finance/CashFlowProjection.tsx');

describe('contrato de fonte vazia no financeiro', () => {
  it('o DRE reporta quais fontes do regime de caixa vieram vazias', () => {
    expect(HOOK).toContain('origemVazia');
    for (const campo of ['recebimentos', 'pagamentos', 'cmv']) {
      expect(HOOK).toMatch(new RegExp(`${campo}:`));
    }
    // Precisa estar no TIPO, senão a UI perde o campo silenciosamente.
    expect(HOOK).toMatch(/origemVazia: \{ recebimentos: boolean; pagamentos: boolean; cmv: boolean \}/);
  });

  it('a tela do DRE troca a tabela zerada por um estado explícito', () => {
    expect(DRE).toContain('semNenhumLancamento');
    expect(DRE).toContain('EmptyState');
    // O estado tem que vir ANTES de somar os totais, senão renderiza zero.
    expect(DRE.indexOf('semNenhumLancamento')).toBeLessThan(DRE.indexOf('const totalReceita'));
  });

  it('a projeção de caixa declara quando não tem saída nem saldo inicial', () => {
    expect(HOOK).toContain('semPagamentosCadastrados');
    expect(HOOK).toContain('semSaldoBancario');
    expect(CASH).toContain('Projeção incompleta');
    // A ressalva precede o alerta de saldo negativo: sem saídas ele nunca
    // dispara, e a ausência do vermelho passaria por boa notícia.
    expect(CASH.indexOf('Projeção incompleta')).toBeLessThan(CASH.indexOf('saldo zera em breve'));
  });

  it('o guard antigo contra falha de fonte continua de pé', () => {
    expect(HOOK).toMatch(/Falha ao carregar o CMV reconhecido/);
    expect(HOOK).toMatch(/sem regime tributário cadastrado/);
  });
});
