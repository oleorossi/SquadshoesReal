import { ConversaoUnidadeError } from './conversao';
import { UnidadeMedida } from '@/types/unidades';
import { resolveConversionFactors } from '@/lib/unitConversion';

// Adiciona N dias úteis (seg-sex) à data. Helper sync para uso em planejamento
// — feriados não são considerados aqui (a data autoritativa vem do SQL view
// purchase_projection_timeline que usa add_business_days() respeitando feriados).
// Esta função fornece estimativa visual rápida, não data fiscal.
function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  const step = days >= 0 ? 1 : -1;
  const target = Math.abs(days);
  while (added < target) {
    result.setDate(result.getDate() + step);
    const dow = result.getDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

// Formata uma Date como YYYY-MM-DD usando timezone LOCAL.
// Evita o bug de toISOString() que converte para UTC e desloca a data
// em -3h no fuso BRT (Sex 22:00 BRT vira Sab 01:00 UTC = "Sábado").
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface DadosMaterialPlanejamento {
  materialId: string;
  sku: string;
  nome: string;
  quantidadeNecessaria: number;
  unidadeNecessaria: UnidadeMedida | string;
  estoqueAtual: number;
  unidadeEstoque: UnidadeMedida | string;
  precoCustoUnitario: number;
  unidadeCompra: UnidadeMedida | string;
  tempoReposicao: number;
  consumoMedio: number;
  conversionRate?: number;
}

export interface CalculoCusto {
  materialId: string;
  sku: string;
  nome: string;
  quantidadeNecessaria: number;
  unidadeNecessaria: UnidadeMedida | string;
  estoqueAtual: number;
  unidadeEstoque: UnidadeMedida | string;
  estoqueConverted: number;
  deficitEstoque: number;
  deficitConverted: number;
  quantidadeAComprar: number;
  unidadeCompra: UnidadeMedida | string;
  precoCustoUnitario: number;
  custoTotal: number;
  tempoReposicao: number;
  dataVencimento: string;
  categoria: 'ok' | 'baixo' | 'critico';
}

export interface ResumoCalculoCompras {
  totalItens: number;
  custoTotal: number;
  custoPorCategoria: { ok: number; baixo: number; critico: number };
  quantidadeItens: { ok: number; baixo: number; critico: number };
  dataProximaAnalise: string;
}

export const planejamentoService = {
  calcularCustoMaterial(dados: DadosMaterialPlanejamento): CalculoCusto {
    // Use unified conversion factors instead of fragile conversaoService.converter
    const { needToStockDivisor, stockToPurchaseDivisor } = resolveConversionFactors(
      dados.unidadeNecessaria as string,
      dados.unidadeEstoque as string,
      dados.unidadeCompra as string,
      dados.conversionRate ?? 1,
    );
    const needInStock = dados.quantidadeNecessaria / needToStockDivisor;
    const quantidadeNecessariaConverted = needInStock / stockToPurchaseDivisor;
    const estoqueConverted = dados.estoqueAtual / stockToPurchaseDivisor;
    const deficitEstoque = Math.max(0, quantidadeNecessariaConverted - estoqueConverted);
    // ⚠ DIVERGÊNCIA CONHECIDA (avaliação dos motores 2026-07-08): esta é uma
    // calculadora de planejamento MANUAL, independente do MRP canônico. Usa
    // buffer fixo de 10% (× 1.1) + `ceil`, sobre o `estoqueAtual` passado por
    // quem chama (BRUTO — não desconta `reserved_stock` como o `v_mrp_needs`),
    // e NÃO aplica `purchase_multiple`/MOQ. Portanto a quantidade sugerida aqui
    // pode diferir da OC gerada pelo MRP/per-PV para o mesmo material. É de
    // propósito (tela de estimativa rápida); não é a fonte de compra oficial.
    // Se for unificar com o MRP, ler de `v_mrp_needs` em vez deste cálculo.
    const quantidadeAComprar = Math.ceil(deficitEstoque * 1.1);
    const custoTotal = quantidadeAComprar * dados.precoCustoUnitario;
    // tempoReposicao é em dias úteis por convenção do projeto (alinhado com
    // o SQL view purchase_projection_timeline que usa add_business_days()).
    // A versão anterior usava setDate() simples = dias corridos, atrasando
    // a estimativa em ~30% (sáb/dom contam como reposição).
    const dataVencimento = addBusinessDays(new Date(), dados.tempoReposicao);
    const percentualDisponivel = (estoqueConverted > 0 && quantidadeNecessariaConverted > 0) ? (estoqueConverted / quantidadeNecessariaConverted) * 100 : 0;
    let categoria: 'ok' | 'baixo' | 'critico' = 'ok';
    if (percentualDisponivel < 30) categoria = 'critico';
    else if (percentualDisponivel < 70) categoria = 'baixo';

    return {
      materialId: dados.materialId,
      sku: dados.sku,
      nome: dados.nome,
      quantidadeNecessaria: dados.quantidadeNecessaria,
      unidadeNecessaria: dados.unidadeNecessaria,
      estoqueAtual: dados.estoqueAtual,
      unidadeEstoque: dados.unidadeEstoque,
      estoqueConverted: Math.round(estoqueConverted * 100) / 100,
      deficitEstoque: Math.max(0, quantidadeNecessariaConverted - estoqueConverted),
      deficitConverted: Math.round(deficitEstoque * 100) / 100,
      quantidadeAComprar,
      unidadeCompra: dados.unidadeCompra,
      precoCustoUnitario: dados.precoCustoUnitario,
      custoTotal: Math.round(custoTotal * 100) / 100,
      tempoReposicao: dados.tempoReposicao,
      dataVencimento: toLocalDateString(dataVencimento),
      categoria,
    };
  },

  calcularCustosMateriais(materiais: DadosMaterialPlanejamento[]): CalculoCusto[] {
    return materiais.map((m) => this.calcularCustoMaterial(m));
  },

  gerarResumo(calculos: CalculoCusto[]): ResumoCalculoCompras {
    const dataProximaAnalise = new Date();
    dataProximaAnalise.setDate(dataProximaAnalise.getDate() + 7);
    return {
      totalItens: calculos.length,
      custoTotal: Math.round(calculos.reduce((s, c) => s + c.custoTotal, 0) * 100) / 100,
      custoPorCategoria: {
        ok: Math.round(calculos.filter((c) => c.categoria === 'ok').reduce((s, c) => s + c.custoTotal, 0) * 100) / 100,
        baixo: Math.round(calculos.filter((c) => c.categoria === 'baixo').reduce((s, c) => s + c.custoTotal, 0) * 100) / 100,
        critico: Math.round(calculos.filter((c) => c.categoria === 'critico').reduce((s, c) => s + c.custoTotal, 0) * 100) / 100,
      },
      quantidadeItens: {
        ok: calculos.filter((c) => c.categoria === 'ok').length,
        baixo: calculos.filter((c) => c.categoria === 'baixo').length,
        critico: calculos.filter((c) => c.categoria === 'critico').length,
      },
      dataProximaAnalise: dataProximaAnalise.toISOString().split('T')[0],
    };
  },

  filtrarPorCategoria(calculos: CalculoCusto[], categoria: 'ok' | 'baixo' | 'critico'): CalculoCusto[] {
    return calculos.filter((c) => c.categoria === categoria);
  },

  ordenar(calculos: CalculoCusto[], criterio: 'custo' | 'urgencia' | 'nome'): CalculoCusto[] {
    const sorted = [...calculos];
    switch (criterio) {
      case 'custo': sorted.sort((a, b) => b.custoTotal - a.custoTotal); break;
      case 'urgencia': sorted.sort((a, b) => { const o = { critico: 0, baixo: 1, ok: 2 }; return o[a.categoria] - o[b.categoria]; }); break;
      case 'nome': sorted.sort((a, b) => a.nome.localeCompare(b.nome)); break;
    }
    return sorted;
  },
};
