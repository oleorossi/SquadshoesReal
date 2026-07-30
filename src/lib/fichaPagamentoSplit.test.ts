// Invariante dos relatórios de PAGO x A PAGAR da Ficha de Montadores.
//
// A tela separa a produção do período em "já quitado pela folha"
// (ficha_montadores.payroll_run_id preenchido) e "ainda em aberto", e o gestor
// usa esses números pra conferir a folha. Duas coisas precisam ser verdade e
// nenhuma delas é óbvia o bastante pra ficar sem trava:
//
//  1. A PARTIÇÃO FECHA: pago + aberto == total. Se um lançamento escapar dos
//     dois lados (ou entrar nos dois), o gestor paga a mais ou a menos.
//  2. O VALOR VEM DO SNAPSHOT DA LINHA, não de "pares × taxa de hoje". Foi
//     exatamente esse o bug do fluxo antigo: a aba Produtividade reescrevia o
//     R$/par de TODAS as fichas do montador, revalorizando retroativamente
//     produção já paga.
import { describe, it, expect } from 'vitest';
import { sumProducaoRows, ratesOfRow, type FichaMontadorRow } from './montadorProduction';

/** Lançamento com o vínculo de folha — `dia` deixa de ser opcional, porque toda
 *  reivindicação é por janela de datas. */
type LinhaComFolha = FichaMontadorRow & { dia: string; payroll_run_id: string | null };

/** Linha de produção diária (modelo 'chamada'), como a tela grava. */
const linha = (
  p: { dia: string; medio: number; dificil: number; vm: number; vd: number; pago?: boolean },
): LinhaComFolha => ({
  montador_id: 'emp-1',
  dia: p.dia,
  origem: 'chamada',
  numeracoes: [],
  total: p.medio + p.dificil,
  detalhe: [{ tamanho: 12, medio: p.medio, dificil: p.dificil }],
  valor_par: p.vm,
  valor_par_medio: p.vm,
  valor_par_dificil: p.vd,
  payroll_run_id: p.pago ? 'run-1' : null,
});

/** Reivindicação como o trigger tg_ficha_claim_production faz: a folha leva os
 *  dias da janela que ainda estão LIVRES e valem mais que zero. */
function reivindicar(
  rows: LinhaComFolha[], runId: string, de: string, ate: string,
): { claimed: LinhaComFolha[]; conflito: LinhaComFolha[]; zerados: LinhaComFolha[] } {
  const naJanela = rows.filter(r => r.dia >= de && r.dia <= ate);
  const conflito = naJanela.filter(r => r.payroll_run_id !== null && r.payroll_run_id !== runId);
  const livres = naJanela.filter(r => r.payroll_run_id === null);
  const zerados = livres.filter(r => sumProducaoRows([r]).bruto <= 0);
  const claimed = livres.filter(r => sumProducaoRows([r]).bruto > 0);
  claimed.forEach(r => { r.payroll_run_id = runId; });
  return { claimed, conflito, zerados };
}

describe('Ficha de Montadores — split pago x a pagar', () => {
  // Junho pago a R$ 1,00/1,50; julho ainda aberto e já com taxa reajustada.
  const rows = [
    linha({ dia: '2026-06-20', medio: 100, dificil: 20, vm: 1.0, vd: 1.5, pago: true }),
    linha({ dia: '2026-06-21', medio: 50, dificil: 0, vm: 1.0, vd: 1.5, pago: true }),
    linha({ dia: '2026-07-10', medio: 80, dificil: 10, vm: 1.2, vd: 1.8 }),
  ];

  it('pago + aberto fecha com o total, sem lançamento sobrando nem contado duas vezes', () => {
    const pagos = rows.filter((r) => !!r.payroll_run_id);
    const abertos = rows.filter((r) => !r.payroll_run_id);

    expect(pagos.length + abertos.length).toBe(rows.length);

    const bPago = sumProducaoRows(pagos).bruto;
    const bAberto = sumProducaoRows(abertos).bruto;
    const bTotal = sumProducaoRows(rows).bruto;

    expect(bPago).toBeCloseTo(100 * 1.0 + 20 * 1.5 + 50 * 1.0, 6); // 180,00
    expect(bAberto).toBeCloseTo(80 * 1.2 + 10 * 1.8, 6);           // 114,00
    expect(bPago + bAberto).toBeCloseTo(bTotal, 6);
  });

  it('pares também particionam sem perda', () => {
    const total = sumProducaoRows(rows);
    const pago = sumProducaoRows(rows.filter((r) => !!r.payroll_run_id));
    const aberto = sumProducaoRows(rows.filter((r) => !r.payroll_run_id));
    expect(pago.pares + aberto.pares).toBe(total.pares);
    expect(pago.paresMedio + aberto.paresMedio).toBe(total.paresMedio);
    expect(pago.paresDificil + aberto.paresDificil).toBe(total.paresDificil);
  });

  it('cada linha vale pelo SNAPSHOT dela — reajuste não revaloriza o que já foi pago', () => {
    // Mesmos pares nas duas linhas; só a taxa gravada difere.
    const antes = linha({ dia: '2026-06-20', medio: 100, dificil: 0, vm: 1.0, vd: 1.5, pago: true });
    const depois = linha({ dia: '2026-07-20', medio: 100, dificil: 0, vm: 2.0, vd: 3.0 });

    expect(ratesOfRow(antes).vm).toBe(1.0);
    expect(ratesOfRow(depois).vm).toBe(2.0);
    expect(sumProducaoRows([antes]).bruto).toBeCloseTo(100, 6);
    expect(sumProducaoRows([depois]).bruto).toBeCloseTo(200, 6);

    // Se o cálculo usasse "pares totais × taxa vigente", os dois dariam 200 e a
    // produção de junho seria repaga pela diferença.
    expect(sumProducaoRows([antes, depois]).bruto).toBeCloseTo(300, 6);
    expect(sumProducaoRows([antes, depois]).bruto).not.toBeCloseTo(200 * 2, 6);
  });

  it('linha sem R$/par cadastrado vale zero, mas ainda conta os pares produzidos', () => {
    // Situação real do banco: os 33 lançamentos existentes têm R$/par 0,00.
    const semTaxa = linha({ dia: '2026-06-15', medio: 120, dificil: 0, vm: 0, vd: 0 });
    const agg = sumProducaoRows([semTaxa]);
    expect(agg.pares).toBe(120);
    expect(agg.bruto).toBe(0);
  });
});

// A trava de duplicidade: duas folhas com janelas SOBREPOSTAS não podem somar o
// mesmo dia. O banco tem períodos assim de verdade ('2026-06' cruza
// '2026-06-16_2026-06-30'), então isto não é hipótese.
describe('Ficha de Montadores — reivindicação impede pagar o mesmo dia duas vezes', () => {
  const novoMes = () => [
    linha({ dia: '2026-06-15', medio: 264, dificil: 0, vm: 1, vd: 2 }),
    linha({ dia: '2026-06-20', medio: 300, dificil: 10, vm: 1, vd: 2 }),
    linha({ dia: '2026-06-25', medio: 156, dificil: 0, vm: 1, vd: 2 }),
  ];

  it('a 2ª folha só leva o que sobrou — a soma nunca passa da produção real', () => {
    const rows = novoMes();
    const producaoTotal = sumProducaoRows(rows).bruto;

    // Folha A (16–30/06) aprova primeiro: pega 20/06 e 25/06.
    const a = reivindicar(rows, 'run-A', '2026-06-16', '2026-06-30');
    // Folha B (junho inteiro) aprova depois: sobrou só 15/06.
    const b = reivindicar(rows, 'run-B', '2026-06-01', '2026-06-30');

    expect(a.claimed.map(r => r.dia)).toEqual(['2026-06-20', '2026-06-25']);
    expect(b.claimed.map(r => r.dia)).toEqual(['2026-06-15']);
    expect(b.conflito.map(r => r.dia)).toEqual(['2026-06-20', '2026-06-25']);

    const brutoA = sumProducaoRows(a.claimed).bruto;
    const brutoB = sumProducaoRows(b.claimed).bruto;

    // O invariante que vale dinheiro.
    expect(brutoA + brutoB).toBeCloseTo(producaoTotal, 6);
    // Sem a trava, B teria somado junho inteiro e pago a produção 2× menos o dia 15.
    expect(brutoB).toBeLessThan(producaoTotal);
  });

  it('nenhum lançamento fica com duas folhas ao mesmo tempo', () => {
    const rows = novoMes();
    reivindicar(rows, 'run-A', '2026-06-16', '2026-06-30');
    reivindicar(rows, 'run-B', '2026-06-01', '2026-06-30');
    const donos = rows.map(r => r.payroll_run_id);
    expect(donos).toEqual(['run-B', 'run-A', 'run-A']);
    expect(new Set(donos).size).toBe(2);
  });

  it('lançamento valendo zero NÃO é reivindicado — segue livre pra quando a taxa for corrigida', () => {
    // Exatamente o estado de hoje: produção lançada antes de existir R$/par.
    const rows = [
      linha({ dia: '2026-06-20', medio: 264, dificil: 0, vm: 0, vd: 0 }),
      linha({ dia: '2026-06-21', medio: 100, dificil: 0, vm: 1, vd: 0 }),
    ];
    const r = reivindicar(rows, 'run-A', '2026-06-01', '2026-06-30');

    expect(r.zerados.map(x => x.dia)).toEqual(['2026-06-20']);
    expect(r.claimed.map(x => x.dia)).toEqual(['2026-06-21']);
    // O de valor zero continua livre: queimá-lo numa folha que pagou nada por
    // ele exigiria UPDATE manual no banco pra destravar.
    expect(rows[0].payroll_run_id).toBeNull();
  });

  it('liberar (cancelamento da folha) devolve tudo pro pool', () => {
    const rows = novoMes();
    reivindicar(rows, 'run-A', '2026-06-01', '2026-06-30');
    expect(rows.every(r => r.payroll_run_id === 'run-A')).toBe(true);

    // tg_ficha_claim_production no ramo 'cancelado'
    rows.filter(r => r.payroll_run_id === 'run-A').forEach(r => { r.payroll_run_id = null; });

    // E uma folha nova consegue reivindicar de novo — se não, a produção ficaria
    // impagável pra sempre, que é o efeito de copiar a lacuna dos adiantamentos.
    const novo = reivindicar(rows, 'run-C', '2026-06-01', '2026-06-30');
    expect(novo.claimed).toHaveLength(3);
  });
});
