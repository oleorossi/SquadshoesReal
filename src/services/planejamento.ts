import { ConversaoUnidadeError } from './conversao';
import { UnidadeMedida } from '@/types/unidades';
import { resolveConversionFactors } from '@/lib/unitConversion';

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
    const quantidadeAComprar = Math.ceil(deficitEstoque * 1.1);
    const custoTotal = quantidadeAComprar * dados.precoCustoUnitario;
    const dataVencimento = new Date();
    dataVencimento.setDate(dataVencimento.getDate() + dados.tempoReposicao);
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
      dataVencimento: dataVencimento.toISOString().split('T')[0],
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
