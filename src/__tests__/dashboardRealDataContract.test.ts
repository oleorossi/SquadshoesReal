import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ════════════════════════════════════════════════════════════════════════
// Contrato: o Painel não inventa número.
//
// Auditoria 20/08/2026 — o print do dono tinha 5 cards errados de 3 naturezas:
//   • código mente ....... OEE `value="81%"` e OPs em Atraso `value="0"` literais
//   • código conta errado  Faturamento somava PV CANCELADO (R$ 21.649,20 de
//                          R$ 40.570,80 = 53%); OPs Ativas/PVs Pendentes
//                          filtravam por período uma métrica de ESTADO (10 na
//                          tela contra 58 abertas de fato)
//   • dado não existe .... due_date nulo nas 290 OPs, production_stops vazia
//
// Este teste trava as duas primeiras naturezas. A terceira não é testável em
// código — é cadastro; o que se trava é o card se ESCONDER em vez de exibir 0.
// ════════════════════════════════════════════════════════════════════════

const SOURCE = readFileSync(resolve(process.cwd(), 'src/pages/Dashboard.tsx'), 'utf8');

describe('contrato de dado real do Painel', () => {
  it('nenhum StatCard tem valor literal (número, moeda ou percentual)', () => {
    const literais = [...SOURCE.matchAll(/value=("|\{")\s*R?\$?\s*[\d.,]+\s*%?("|"\})/g)].map(m => m[0]);
    expect(literais).toEqual([]);
  });

  it('carteira exclui PV cancelado e rascunho', () => {
    // A projeção precisa trazer status, senão não há como excluir.
    expect(SOURCE).toMatch(/from\('sale_orders'\)\s*\.select\('total, status'\)/);
    expect(SOURCE).toContain('NON_BACKLOG_STATUSES');
    for (const status of ['Cancelado', 'cancelado', 'Rascunho', 'rascunho']) {
      expect(SOURCE).toContain(`'${status}'`);
    }
  });

  it('faturado vem de NF-e autorizada, não da soma de PV', () => {
    expect(SOURCE).toMatch(/from\('nfe_emitidas'\)[\s\S]{0,160}?\.eq\('status', 'autorizada'\)/);
  });

  it('métricas de ESTADO não são recortadas pelo período do filtro', () => {
    // Fatia por chamada: cada trecho começa num supabase.from( e termina onde
    // o próximo começa. Assim o range de uma query vizinha não contamina a
    // checagem (foi o que deixou este contrato passar vazio na 1ª versão).
    const chamadas = SOURCE.split('supabase.from(').slice(1);
    const estado = chamadas.filter(
      c => /\.in\('status', \[[^\]]*(Reservado|Rascunho)[^\]]*\]\)/.test(c.slice(0, 300)),
    );
    expect(estado.length).toBeGreaterThanOrEqual(2);
    for (const chamada of estado) {
      const corpo = chamada.slice(0, chamada.indexOf(')') > 0 ? 300 : chamada.length);
      expect(corpo).not.toContain('range.startISO');
      expect(corpo).not.toContain('range.endISO');
    }
  });

  it('OEE e OPs em Atraso só renderizam quando existe dado de origem', () => {
    expect(SOURCE).toMatch(/productionStats\?\.hasProductionStops && \(/);
    expect(SOURCE).toMatch(/productionStats\?\.hasDueDates && \(/);
  });

  it('o carimbo ATUALIZADO reflete a busca do dado, não o render', () => {
    expect(SOURCE).toContain('dataUpdatedAt: statsUpdatedAt');
    // `new Date()` sem argumento no meta do header era o bug.
    const meta = SOURCE.slice(SOURCE.indexOf('ATUALIZADO'), SOURCE.indexOf('ATUALIZADO') + 400);
    expect(meta).toContain('statsUpdatedAt');
    expect(meta).not.toMatch(/new Date\(\)\.toLocaleTimeString/);
  });
});
