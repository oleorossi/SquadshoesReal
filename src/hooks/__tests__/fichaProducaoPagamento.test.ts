// Contrato entre a JANELA que a Ficha de Montadores exibe e o PERÍODO que a
// folha grava. Três coisas precisam ser verdade, e nenhuma delas falha de forma
// barulhenta em produção:
//
//  1. O formato do período tem que ser o que o banco reconhece. Se não for,
//     `tg_ficha_claim_production` cai no ramo "formato ilegível" e NÃO reivindica
//     a produção — sem erro, sem toast, e os lançamentos ficam em aberto para
//     sempre parecendo que ninguém pagou.
//  2. A semana de pagamento é segunda→domingo. Terminar no sábado deixaria
//     órfão o par lançado em domingo: nenhuma janela o cobriria.
//  3. Semanas consecutivas são ADJACENTES, não sobrepostas. Desde
//     `tg_payroll_block_period_overlap`, duas folhas da mesma pessoa com janelas
//     que se cruzam são recusadas pelo banco — se a semana 2 encostasse na 1, o
//     segundo pagamento seria impossível e a fábrica travaria na semana seguinte.
import { describe, it, expect } from 'vitest';
import {
  periodoDeJanela, semanaDePagamento, PERIODO_JANELA_RE,
} from '../useFichaProducaoPagamento';

/** Espelha `payroll_period_range`: daterange SEMIABERTO [de, ate+1). É por isso
 *  que domingo e a segunda seguinte não colidem — o fim é exclusivo. */
function faixa(period: string): { ini: number; fim: number } {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(period);
  if (!m) throw new Error(`período fora do formato do banco: ${period}`);
  const ini = new Date(`${m[1]}T00:00:00`).getTime();
  const fim = new Date(`${m[2]}T00:00:00`).getTime() + 86_400_000; // ate + 1 dia
  return { ini, fim };
}
/** Operador && do Postgres para daterange. */
const cruzam = (a: string, b: string) => {
  const x = faixa(a), y = faixa(b);
  return x.ini < y.fim && y.ini < x.fim;
};
const diasEntre = (from: string, to: string) =>
  (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000 + 1;

describe('periodoDeJanela — formato aceito pelo banco', () => {
  it('casa a regex que payroll_period_range usa', () => {
    expect(periodoDeJanela('2026-06-15', '2026-06-21')).toBe('2026-06-15_2026-06-21');
    expect(PERIODO_JANELA_RE.test(periodoDeJanela('2026-06-15', '2026-06-21'))).toBe(true);
  });

  it('a janela de QUALQUER semana sai no formato do banco', () => {
    for (const anchor of ['2026-01-01', '2026-02-28', '2026-06-17', '2026-12-31']) {
      const { from, to } = semanaDePagamento(anchor);
      expect(PERIODO_JANELA_RE.test(periodoDeJanela(from, to))).toBe(true);
    }
  });
});

describe('semanaDePagamento — segunda a domingo', () => {
  it('sempre começa numa segunda e termina no domingo seguinte', () => {
    // Uma semana inteira de âncoras: cada dia tem que cair na MESMA semana.
    const esperado = { from: '2026-06-15', to: '2026-06-21' };
    for (const dia of ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18',
                       '2026-06-19', '2026-06-20', '2026-06-21']) {
      expect(semanaDePagamento(dia)).toEqual(esperado);
    }
  });

  it('a semana tem 7 dias e inclui o fim de semana', () => {
    const { from, to } = semanaDePagamento('2026-06-17');
    expect(diasEntre(from, to)).toBe(7);
    // Domingo lançado em produção precisa de janela que o cubra (já aconteceu
    // no histórico: há lançamento de fim de semana em 15/06 e 22/06).
    expect(new Date(`${to}T00:00:00`).getDay()).toBe(0); // domingo
    expect(new Date(`${from}T00:00:00`).getDay()).toBe(1); // segunda
  });

  it('atravessa virada de mês e de ano sem quebrar', () => {
    expect(semanaDePagamento('2026-07-01')).toEqual({ from: '2026-06-29', to: '2026-07-05' });
    expect(semanaDePagamento('2027-01-01')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
  });
});

describe('trava de sobreposição — o que o banco vai aceitar', () => {
  it('semanas consecutivas NÃO se cruzam (senão o pagamento semanal morre)', () => {
    const s1 = semanaDePagamento('2026-06-17');
    const s2 = semanaDePagamento('2026-06-24');
    const p1 = periodoDeJanela(s1.from, s1.to);
    const p2 = periodoDeJanela(s2.from, s2.to);
    expect(p1).toBe('2026-06-15_2026-06-21');
    expect(p2).toBe('2026-06-22_2026-06-28');
    expect(cruzam(p1, p2)).toBe(false);
  });

  it('as 5 semanas do backlog são duas a duas independentes', () => {
    // Semanas com produção lançada em 07/08/2026 — todas têm que poder virar
    // folha própria, já que a decisão foi 14 folhas semanais retroativas.
    const semanas = ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-20', '2026-07-27']
      .map((seg) => { const s = semanaDePagamento(seg); return periodoDeJanela(s.from, s.to); });
    for (let i = 0; i < semanas.length; i++) {
      for (let j = i + 1; j < semanas.length; j++) {
        expect(cruzam(semanas[i], semanas[j])).toBe(false);
      }
    }
  });

  it('janela que ENGLOBA outra é sobreposição — é o caso que a trava existe pra pegar', () => {
    // Foi assim que 23 janelas de teste recontaram os mesmos dias e inflaram os
    // rascunhos em R$ 632 mil.
    expect(cruzam('2026-06-01_2026-07-18', '2026-06-15_2026-06-21')).toBe(true);
    expect(cruzam('2026-06-15_2026-06-21', '2026-06-18_2026-06-25')).toBe(true);
  });
});
