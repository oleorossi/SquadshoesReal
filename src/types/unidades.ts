export enum UnidadeMedida {
  // Peso
  QUILOGRAMA = 'kg',
  GRAMA = 'g',
  MILIGRAMA = 'mg',
  // Volume
  LITRO = 'l',
  MILILITRO = 'ml',
  // Comprimento
  METRO = 'm',
  METRO_LINEAR = 'm linear',
  CENTIMETRO = 'cm',
  MILIMETRO = 'mm',
  // Área
  METRO_QUADRADO = 'm²',
  DECIMETRO_QUADRADO = 'dm²',
  CENTIMETRO_QUADRADO = 'cm²',
  // Cubagem
  METRO_CUBICO = 'm³',
  // Contagem
  UNIDADE = 'un',
  PAR = 'par',
  // Placa (chapa cortada de material de área, ex.: EVA). A conversão
  // placa→dm² depende da ÁREA da placa e mora em products.conversion_rate
  // (ex.: 150), NÃO num fator fixo de CONVERSOES — por isso não há entrada
  // de conversão pra PLACA aqui (mesmo princípio do dm²→linear via largura).
  PLACA = 'placa',
  CAIXA = 'cx',
  PACOTE = 'pc',
  ROLO = 'rl',
  FOLHA = 'fh',
  JOGO = 'jg',
}

export interface FatorConversao {
  de: UnidadeMedida;
  para: UnidadeMedida;
  fator: number;
  descricao: string;
}

export const CONVERSOES: FatorConversao[] = [
  // ── Peso ──
  { de: UnidadeMedida.QUILOGRAMA, para: UnidadeMedida.GRAMA, fator: 1000, descricao: 'kg → g' },
  { de: UnidadeMedida.GRAMA, para: UnidadeMedida.QUILOGRAMA, fator: 0.001, descricao: 'g → kg' },
  { de: UnidadeMedida.GRAMA, para: UnidadeMedida.MILIGRAMA, fator: 1000, descricao: 'g → mg' },
  { de: UnidadeMedida.MILIGRAMA, para: UnidadeMedida.GRAMA, fator: 0.001, descricao: 'mg → g' },
  { de: UnidadeMedida.QUILOGRAMA, para: UnidadeMedida.MILIGRAMA, fator: 1000000, descricao: 'kg → mg' },
  { de: UnidadeMedida.MILIGRAMA, para: UnidadeMedida.QUILOGRAMA, fator: 0.000001, descricao: 'mg → kg' },
  // ── Volume ──
  { de: UnidadeMedida.LITRO, para: UnidadeMedida.MILILITRO, fator: 1000, descricao: 'l → ml' },
  { de: UnidadeMedida.MILILITRO, para: UnidadeMedida.LITRO, fator: 0.001, descricao: 'ml → l' },
  { de: UnidadeMedida.METRO_CUBICO, para: UnidadeMedida.LITRO, fator: 1000, descricao: 'm³ → l' },
  { de: UnidadeMedida.LITRO, para: UnidadeMedida.METRO_CUBICO, fator: 0.001, descricao: 'l → m³' },
  { de: UnidadeMedida.METRO_CUBICO, para: UnidadeMedida.MILILITRO, fator: 1000000, descricao: 'm³ → ml' },
  { de: UnidadeMedida.MILILITRO, para: UnidadeMedida.METRO_CUBICO, fator: 0.000001, descricao: 'ml → m³' },
  // ── Comprimento ──
  { de: UnidadeMedida.METRO, para: UnidadeMedida.CENTIMETRO, fator: 100, descricao: 'm → cm' },
  { de: UnidadeMedida.CENTIMETRO, para: UnidadeMedida.METRO, fator: 0.01, descricao: 'cm → m' },
  { de: UnidadeMedida.METRO, para: UnidadeMedida.MILIMETRO, fator: 1000, descricao: 'm → mm' },
  { de: UnidadeMedida.MILIMETRO, para: UnidadeMedida.METRO, fator: 0.001, descricao: 'mm → m' },
  { de: UnidadeMedida.CENTIMETRO, para: UnidadeMedida.MILIMETRO, fator: 10, descricao: 'cm → mm' },
  { de: UnidadeMedida.MILIMETRO, para: UnidadeMedida.CENTIMETRO, fator: 0.1, descricao: 'mm → cm' },
  // Metro linear é equivalente a metro (sinônimo industrial)
  { de: UnidadeMedida.METRO_LINEAR, para: UnidadeMedida.METRO, fator: 1, descricao: 'm linear → m' },
  { de: UnidadeMedida.METRO, para: UnidadeMedida.METRO_LINEAR, fator: 1, descricao: 'm → m linear' },
  { de: UnidadeMedida.METRO_LINEAR, para: UnidadeMedida.CENTIMETRO, fator: 100, descricao: 'm linear → cm' },
  { de: UnidadeMedida.CENTIMETRO, para: UnidadeMedida.METRO_LINEAR, fator: 0.01, descricao: 'cm → m linear' },
  // ── Área (indústria calçadista) ──
  // 1 m² = 100 dm²
  { de: UnidadeMedida.METRO_QUADRADO, para: UnidadeMedida.DECIMETRO_QUADRADO, fator: 100, descricao: 'm² → dm²' },
  { de: UnidadeMedida.DECIMETRO_QUADRADO, para: UnidadeMedida.METRO_QUADRADO, fator: 0.01, descricao: 'dm² → m²' },
  // 1 dm² = 100 cm²
  { de: UnidadeMedida.DECIMETRO_QUADRADO, para: UnidadeMedida.CENTIMETRO_QUADRADO, fator: 100, descricao: 'dm² → cm²' },
  { de: UnidadeMedida.CENTIMETRO_QUADRADO, para: UnidadeMedida.DECIMETRO_QUADRADO, fator: 0.01, descricao: 'cm² → dm²' },
  // 1 m² = 10000 cm²
  { de: UnidadeMedida.METRO_QUADRADO, para: UnidadeMedida.CENTIMETRO_QUADRADO, fator: 10000, descricao: 'm² → cm²' },
  { de: UnidadeMedida.CENTIMETRO_QUADRADO, para: UnidadeMedida.METRO_QUADRADO, fator: 0.0001, descricao: 'cm² → m²' },
];

export const GRUPOS_COMPATIBILIDADE = {
  PESO: [UnidadeMedida.QUILOGRAMA, UnidadeMedida.GRAMA, UnidadeMedida.MILIGRAMA],
  VOLUME: [UnidadeMedida.LITRO, UnidadeMedida.MILILITRO, UnidadeMedida.METRO_CUBICO],
  COMPRIMENTO: [UnidadeMedida.METRO, UnidadeMedida.METRO_LINEAR, UnidadeMedida.CENTIMETRO, UnidadeMedida.MILIMETRO],
  AREA: [UnidadeMedida.METRO_QUADRADO, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.CENTIMETRO_QUADRADO],
  UNIDADE: [UnidadeMedida.UNIDADE, UnidadeMedida.PAR, UnidadeMedida.CAIXA, UnidadeMedida.PACOTE, UnidadeMedida.ROLO, UnidadeMedida.FOLHA, UnidadeMedida.JOGO],
  // PLACA fica isolada de propósito: a conversão placa→dm² depende da área da
  // placa (conversion_rate, ex.: 150), NÃO de um fator fixo. Colocá-la no grupo
  // UNIDADE faria conversaoService achar que placa↔un são intercambiáveis (e
  // estourar). Grupo próprio ⇒ saoCompativeis(placa, placa)=true e nada mais.
  PLACA: [UnidadeMedida.PLACA],
} as const;
