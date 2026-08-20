/**
 * Vocabulário operacional do almoxarifado calçadista.
 *
 * O setor responde "onde este material é aplicado". A família técnica responde
 * "o que este material é". Manter as duas perguntas separadas evita famílias
 * genéricas como "Componentes diversos" e também evita duplicar o mesmo saldo
 * em árvores concorrentes.
 *
 * Os valores de `sector` continuam sendo os valores canônicos já persistidos no
 * banco. Os rótulos e sugestões abaixo são somente orientação de cadastro — não
 * criam grupos nem reclassificam itens automaticamente.
 */

export interface FootwearFamilySuggestion {
  name: string;
  description: string;
  examples: string;
}

export interface FootwearSectorGuide {
  value: string;
  label: string;
  purpose: string;
  kind: 'material' | 'resource';
  families: readonly FootwearFamilySuggestion[];
}

export const FOOTWEAR_SECTOR_GUIDE: readonly FootwearSectorGuide[] = [
  {
    value: 'Cabedal',
    label: 'Cabedal',
    purpose: 'Materiais externos da parte superior do calçado.',
    kind: 'material',
    families: [
      { name: 'COUROS', description: 'Couros naturais por acabamento e espessura.', examples: 'couro liso, camurça, nobuck' },
      { name: 'LAMINADOS SINTÉTICOS', description: 'Revestimentos sintéticos de PU ou PVC.', examples: 'napa, verniz, laminado' },
      { name: 'TÊXTEIS E MALHAS', description: 'Tecidos, não tecidos e malhas de cabedal.', examples: 'lona, mesh, velvet' },
      { name: 'REFORÇOS E ESTRUTURAS', description: 'Materiais que estruturam o cabedal.', examples: 'couraça, contraforte, entretela' },
    ],
  },
  {
    value: 'Forração da Palmilha',
    label: 'Forração',
    purpose: 'Revestimentos internos do cabedal e da palmilha.',
    kind: 'material',
    families: [
      { name: 'FORROS TÊXTEIS', description: 'Tecidos e não tecidos de contato interno.', examples: 'cacharel, jersey, não tecido' },
      { name: 'LAMINADOS DE FORRAÇÃO', description: 'Laminados usados no forro interno.', examples: 'napa de forro, PU fino' },
      { name: 'DUBLAGENS E ESPUMAS', description: 'Conjuntos dublados e camadas de conforto.', examples: 'espuma, manta, dublagem' },
    ],
  },
  {
    value: 'Palmilha',
    label: 'Palmilha',
    purpose: 'Estrutura, conforto e acabamento da palmilha.',
    kind: 'material',
    families: [
      { name: 'ESTRUTURA DE PALMILHA', description: 'Bases de montagem e reforço.', examples: 'celulose, Strobel, papelão' },
      { name: 'CONFORTO E AMORTECIMENTO', description: 'Camadas de conforto e absorção.', examples: 'EVA, espuma, látex' },
      { name: 'REVESTIMENTO DE PALMILHA', description: 'Materiais de acabamento da palmilha interna.', examples: 'forro, sintético, tecido' },
    ],
  },
  {
    value: 'Solado',
    label: 'Solados e parte inferior',
    purpose: 'Componentes inferiores que sustentam ou tocam o piso.',
    kind: 'material',
    families: [
      { name: 'SOLAS', description: 'Solados completos e suas linhas técnicas.', examples: 'TR, PVC, PU, borracha' },
      { name: 'ENTRESSOLAS', description: 'Camadas intermediárias de suporte e amortecimento.', examples: 'EVA, PU expandido' },
      { name: 'SALTOS E TACOS', description: 'Saltos, tacões, capas e ponteiras.', examples: 'salto bloco, taco, capa' },
      { name: 'VIRAS E FACHETES', description: 'Acabamentos periféricos da parte inferior.', examples: 'vira, fachete, welt' },
    ],
  },
  {
    value: 'Componente',
    label: 'Componentes',
    purpose: 'Aviamentos, reforços, fechos e adornos aplicados ao calçado.',
    kind: 'material',
    families: [
      { name: 'REFORÇOS ESTRUTURAIS', description: 'Peças que dão forma e rigidez.', examples: 'cambrião, biqueira, alma' },
      { name: 'AVIAMENTOS E FECHOS', description: 'Itens funcionais de fechamento e montagem.', examples: 'ilhós, fivela, zíper, velcro' },
      { name: 'TIRAS, FITAS E ELÁSTICOS', description: 'Componentes lineares e flexíveis.', examples: 'tira, elástico, fita, atacador' },
      { name: 'LINHAS E COSTURA', description: 'Linhas e insumos diretos de costura.', examples: 'linha, retrós, fio' },
      { name: 'ADORNOS E APLICAÇÕES', description: 'Componentes de função estética.', examples: 'metal, pedraria, hot-fix, enfeite' },
    ],
  },
  {
    value: 'Cola / Químico',
    label: 'Químicos e acabamento',
    purpose: 'Adesão, preparação, limpeza e acabamento de superfícies.',
    kind: 'material',
    families: [
      { name: 'ADESIVOS', description: 'Adesivos por tecnologia e aplicação.', examples: 'base água, solvente, hot melt' },
      { name: 'PREPARAÇÃO DE SUPERFÍCIE', description: 'Produtos que preparam o material para colagem.', examples: 'primer, halogenante, catalisador' },
      { name: 'SOLVENTES E LIMPEZA', description: 'Diluição, remoção e limpeza industrial.', examples: 'solvente, limpador, desengraxante' },
      { name: 'ACABAMENTO', description: 'Proteção e acabamento final.', examples: 'tinta, cera, pigmento, impermeabilizante' },
    ],
  },
  {
    value: 'Embalagem',
    label: 'Embalagens',
    purpose: 'Acondicionamento, proteção e identificação do produto.',
    kind: 'material',
    families: [
      { name: 'CAIXAS', description: 'Caixas individuais, coletivas e corrugadas.', examples: 'caixa individual, caixa master' },
      { name: 'PAPÉIS E PROTEÇÕES', description: 'Proteção interna e enchimento.', examples: 'papel seda, papel bucha, sílica' },
      { name: 'ETIQUETAS', description: 'Identificação logística e comercial.', examples: 'etiqueta, adesivo, tag' },
      { name: 'FECHAMENTO', description: 'Materiais de fechamento da embalagem.', examples: 'fita, fitilho, saco' },
    ],
  },
  {
    value: 'Fôrma',
    label: 'Fôrmas e moldes',
    purpose: 'Recursos duráveis que definem forma e numeração.',
    kind: 'resource',
    families: [
      { name: 'FÔRMAS ADULTO', description: 'Fôrmas de linhas adultas.', examples: 'feminino, masculino, unissex' },
      { name: 'FÔRMAS INFANTIL', description: 'Fôrmas de linhas infantis.', examples: 'bebê, infantil, juvenil' },
      { name: 'MOLDES E MATRIZES', description: 'Moldes e matrizes de processo.', examples: 'molde, matriz, gabarito mestre' },
    ],
  },
  {
    value: 'Ferramentas',
    label: 'Ferramental e MRO',
    purpose: 'Ferramentas, gabaritos e manutenção que não entram no par.',
    kind: 'resource',
    families: [
      { name: 'CORTE', description: 'Ferramental de corte e preparação.', examples: 'navalha, faca, balancim' },
      { name: 'COSTURA', description: 'Ferramental e acessórios de costura.', examples: 'calcador, agulha, guia' },
      { name: 'MONTAGEM', description: 'Ferramental de montagem e acabamento.', examples: 'gabarito, pinça, matriz' },
      { name: 'MANUTENÇÃO E MRO', description: 'Materiais de manutenção e operação.', examples: 'peça, lubrificante, EPI' },
    ],
  },
] as const;

export function getFootwearSectorGuide(sector: string | null | undefined): FootwearSectorGuide | null {
  if (!sector) return null;
  return FOOTWEAR_SECTOR_GUIDE.find((entry) => entry.value === sector) ?? null;
}

export function normalizeTaxonomyName(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

