import { UnidadeMedida, CONVERSOES, GRUPOS_COMPATIBILIDADE } from '@/types/unidades';

export class ConversaoUnidadeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversaoUnidadeError';
  }
}

export const conversaoService = {
  converter(valor: number, de: UnidadeMedida, para: UnidadeMedida, casasDecimais: number = 4): number {
    if (de === para) return parseFloat(valor.toFixed(casasDecimais));

    if (!this.saoCompativeis(de, para)) {
      throw new ConversaoUnidadeError(`Não é possível converter de ${de} para ${para}. Unidades incompatíveis.`);
    }

    const direta = CONVERSOES.find((c) => c.de === de && c.para === para);
    if (direta) return parseFloat((valor * direta.fator).toFixed(casasDecimais));

    const inversa = CONVERSOES.find((c) => c.de === para && c.para === de);
    if (inversa) return parseFloat((valor / inversa.fator).toFixed(casasDecimais));

    return this.converterPorIntermediaria(valor, de, para, casasDecimais);
  },

  converterPorIntermediaria(valor: number, de: UnidadeMedida, para: UnidadeMedida, casasDecimais: number): number {
    const conversoes = CONVERSOES.filter((c) => c.de === de);
    for (const conversao of conversoes) {
      const valorIntermediario = valor * conversao.fator;
      const conversaoFinal = CONVERSOES.find((c) => c.de === conversao.para && c.para === para);
      if (conversaoFinal) {
        return parseFloat((valorIntermediario * conversaoFinal.fator).toFixed(casasDecimais));
      }
    }
    throw new ConversaoUnidadeError(`Não foi possível estabelecer uma rota de conversão de ${de} para ${para}`);
  },

  saoCompativeis(unidade1: UnidadeMedida, unidade2: UnidadeMedida): boolean {
    if (unidade1 === unidade2) return true;
    for (const grupo of Object.values(GRUPOS_COMPATIBILIDADE)) {
      if ((grupo as readonly UnidadeMedida[]).includes(unidade1) && (grupo as readonly UnidadeMedida[]).includes(unidade2)) {
        return true;
      }
    }
    return false;
  },

  obterGrupo(unidade: UnidadeMedida): string | null {
    for (const [grupo, unidades] of Object.entries(GRUPOS_COMPATIBILIDADE)) {
      if ((unidades as readonly UnidadeMedida[]).includes(unidade)) return grupo;
    }
    return null;
  },

  obterUnidadesCompativeis(unidade: UnidadeMedida): UnidadeMedida[] {
    const grupo = this.obterGrupo(unidade);
    if (!grupo) return [unidade];
    return [...GRUPOS_COMPATIBILIDADE[grupo as keyof typeof GRUPOS_COMPATIBILIDADE]];
  },

  formatarComUnidade(valor: number, unidade: UnidadeMedida, casasDecimais: number = 2): string {
    return `${valor.toFixed(casasDecimais)} ${unidade}`;
  },

  calcularQuantidadeComConversao(quantidadeNecessaria: number, unidadeNecessaria: UnidadeMedida, unidadeCompra: UnidadeMedida, casasDecimais: number = 2): number {
    try {
      return this.converter(quantidadeNecessaria, unidadeNecessaria, unidadeCompra, casasDecimais);
    } catch {
      console.error('Erro ao calcular quantidade com conversão');
      return quantidadeNecessaria;
    }
  },
};
