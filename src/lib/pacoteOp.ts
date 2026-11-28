/**
 * Pacote da OP — UM PDF com a ordem fixa Palmilha (A4 retrato) → Fardo
 * (A4 paisagem, 18 por folha) → Caixa (A4 paisagem, 6 por folha, 15 fichas
 * por caixa), com reimpressão parcial por tipo, por folha ou por item.
 *
 * Tudo aqui é função pura sobre contagens: nenhuma escrita no banco, nenhum
 * log de reimpressão. A 2ª via é só um carimbo no papel ("2ª VIA · data").
 */
import { CARTAO_FISICO_PER_PAGE } from '@/lib/cartaoFisico';
import { CAIXA_TRANSPORTE_PER_PAGE } from '@/lib/cartaoCaixaTransporte';
import { formatarIndices } from '@/lib/pacoteOpSelecao';

export type PacoteTipo = 'palmilha' | 'fardo' | 'caixa';
/** Ordem fixa do PDF. */
export const PACOTE_ORDEM: readonly PacoteTipo[] = ['palmilha', 'fardo', 'caixa'];

export type PacoteUnidade = 'folhas' | 'cartoes' | 'fichas';

export const PACOTE_TIPO_ROTULO: Record<PacoteTipo, string> = {
  palmilha: 'Palmilha',
  fardo: 'Fardo',
  caixa: 'Caixa',
};

export const PACOTE_FARDO_POR_FOLHA = CARTAO_FISICO_PER_PAGE;
export const PACOTE_CAIXA_POR_FOLHA = CAIXA_TRANSPORTE_PER_PAGE;

export interface PacoteInventario {
  /** Folhas A4 (retrato) da ficha Palmilha. */
  palmilhaFolhas: number;
  /** Cartões do fardo (1 por ficha). */
  fardoCartoes: number;
  /** Fichas dentro de cada cartão de caixa, na ordem de impressão. */
  caixaFichas: readonly number[];
}

/** Itens escolhidos, 1-based, ordenados e sem repetição. */
export interface PacoteSelecao {
  palmilha: number[];
  fardo: number[];
  caixa: number[];
}

function faixa(n: number): number[] {
  const total = Math.max(0, Math.trunc(Number(n) || 0));
  return Array.from({ length: total }, (_, i) => i + 1);
}

function unicosOrdenados(valores: Iterable<number>, max: number): number[] {
  const set = new Set<number>();
  for (const v of valores) {
    const n = Math.trunc(Number(v));
    if (Number.isFinite(n) && n >= 1 && n <= max) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

export function totalItens(inv: PacoteInventario, tipo: PacoteTipo): number {
  if (tipo === 'palmilha') return Math.max(0, Math.trunc(inv.palmilhaFolhas) || 0);
  if (tipo === 'fardo') return Math.max(0, Math.trunc(inv.fardoCartoes) || 0);
  return inv.caixaFichas.length;
}

/** Folhas físicas de um tipo (palmilha: já são folhas; fardo/caixa: 18 e 6 por folha). */
export function totalFolhasDoTipo(inv: PacoteInventario, tipo: PacoteTipo): number {
  const n = totalItens(inv, tipo);
  if (tipo === 'palmilha') return n;
  return Math.ceil(n / (tipo === 'fardo' ? PACOTE_FARDO_POR_FOLHA : PACOTE_CAIXA_POR_FOLHA));
}

/** Fichas da OP: 1 cartão de fardo por ficha; sem fardo, a soma das caixas. */
export function totalFichas(inv: PacoteInventario): number {
  const nasCaixas = inv.caixaFichas.reduce((s, n) => s + Math.max(0, Math.trunc(n) || 0), 0);
  return Math.max(totalItens(inv, 'fardo'), nasCaixas);
}

export function selecaoCompleta(inv: PacoteInventario): PacoteSelecao {
  return {
    palmilha: faixa(totalItens(inv, 'palmilha')),
    fardo: faixa(totalItens(inv, 'fardo')),
    caixa: faixa(totalItens(inv, 'caixa')),
  };
}

export function selecaoVazia(): PacoteSelecao {
  return { palmilha: [], fardo: [], caixa: [] };
}

/** Descarta o que não existe mais no inventário (a prévia pode recalcular). */
export function normalizarSelecao(inv: PacoteInventario, sel: PacoteSelecao): PacoteSelecao {
  return {
    palmilha: unicosOrdenados(sel.palmilha, totalItens(inv, 'palmilha')),
    fardo: unicosOrdenados(sel.fardo, totalItens(inv, 'fardo')),
    caixa: unicosOrdenados(sel.caixa, totalItens(inv, 'caixa')),
  };
}

function porFolha(tipo: PacoteTipo): number {
  if (tipo === 'fardo') return PACOTE_FARDO_POR_FOLHA;
  if (tipo === 'caixa') return PACOTE_CAIXA_POR_FOLHA;
  return 1;
}

/** Itens (1-based) que ficam na folha `folha` (1-based) do tipo. */
export function itensDaFolha(inv: PacoteInventario, tipo: PacoteTipo, folha: number): number[] {
  const por = porFolha(tipo);
  const total = totalItens(inv, tipo);
  const ini = (folha - 1) * por + 1;
  const fim = Math.min(total, folha * por);
  const out: number[] = [];
  for (let i = ini; i <= fim; i += 1) out.push(i);
  return out;
}

/** Caixas (1-based) que contêm as fichas pedidas (fichas contadas na ordem das caixas). */
export function caixasDasFichas(inv: PacoteInventario, fichas: readonly number[]): number[] {
  const alvo = new Set(fichas);
  const caixas: number[] = [];
  let acumulado = 0;
  inv.caixaFichas.forEach((n, i) => {
    const qtd = Math.max(0, Math.trunc(n) || 0);
    for (let f = acumulado + 1; f <= acumulado + qtd; f += 1) {
      if (alvo.has(f)) {
        caixas.push(i + 1);
        break;
      }
    }
    acumulado += qtd;
  });
  return caixas;
}

/** Maior número aceito no campo de texto para o alvo/unidade. */
export function maximoDaUnidade(inv: PacoteInventario, alvo: PacoteTipo, unidade: PacoteUnidade): number {
  if (unidade === 'fichas') return totalFichas(inv);
  if (unidade === 'folhas') return totalFolhasDoTipo(inv, alvo);
  return totalItens(inv, alvo);
}

/**
 * Unidades que fazem sentido por tipo: a ficha Palmilha A4 só se escolhe por
 * folha; Fardo e Caixa aceitam folha, cartão e ficha.
 */
export function unidadesDoTipo(tipo: PacoteTipo): PacoteUnidade[] {
  return tipo === 'palmilha' ? ['folhas'] : ['folhas', 'cartoes', 'fichas'];
}

/**
 * Aplica o texto já validado à seleção.
 *  - folhas  → só o `alvo` (folhas do tipo)
 *  - cartões → só o `alvo` (cartões do fardo ou da caixa)
 *  - fichas  → Fardo (1 cartão por ficha) E Caixa (as caixas que as contêm);
 *              a Palmilha A4 não se divide por ficha e fica como está.
 */
export function aplicarSelecaoTexto(
  inv: PacoteInventario,
  atual: PacoteSelecao,
  p: { alvo: PacoteTipo; unidade: PacoteUnidade; indices: readonly number[] },
): PacoteSelecao {
  const base = normalizarSelecao(inv, atual);
  const { alvo, unidade, indices } = p;

  if (unidade === 'fichas') {
    return {
      ...base,
      fardo: unicosOrdenados(indices, totalItens(inv, 'fardo')),
      caixa: unicosOrdenados(caixasDasFichas(inv, indices), totalItens(inv, 'caixa')),
    };
  }

  const itens = unidade === 'folhas'
    ? indices.flatMap((folha) => (alvo === 'palmilha' ? [folha] : itensDaFolha(inv, alvo, folha)))
    : indices;
  return { ...base, [alvo]: unicosOrdenados(itens, totalItens(inv, alvo)) };
}

/** Liga/desliga um tipo inteiro. */
export function alternarTipo(inv: PacoteInventario, sel: PacoteSelecao, tipo: PacoteTipo): PacoteSelecao {
  const base = normalizarSelecao(inv, sel);
  const total = totalItens(inv, tipo);
  const cheio = total > 0 && base[tipo].length === total;
  return { ...base, [tipo]: cheio ? [] : faixa(total) };
}

/** Liga/desliga uma folha de um tipo (palmilha: a folha; fardo/caixa: seus cartões). */
export function alternarFolha(
  inv: PacoteInventario,
  sel: PacoteSelecao,
  tipo: PacoteTipo,
  folha: number,
): PacoteSelecao {
  const base = normalizarSelecao(inv, sel);
  const itens = itensDaFolha(inv, tipo, folha);
  if (itens.length === 0) return base;
  const atuais = new Set(base[tipo]);
  const todos = itens.every((i) => atuais.has(i));
  if (todos) itens.forEach((i) => atuais.delete(i));
  else itens.forEach((i) => atuais.add(i));
  return { ...base, [tipo]: unicosOrdenados(atuais, totalItens(inv, tipo)) };
}

export type PacoteFolhaEstado = 'cheia' | 'parcial' | 'vazia';

export function estadoDaFolha(
  inv: PacoteInventario,
  sel: PacoteSelecao,
  tipo: PacoteTipo,
  folha: number,
): PacoteFolhaEstado {
  const itens = itensDaFolha(inv, tipo, folha);
  const atuais = new Set(sel[tipo]);
  const marcados = itens.filter((i) => atuais.has(i)).length;
  if (marcados === 0) return 'vazia';
  return marcados === itens.length ? 'cheia' : 'parcial';
}

/** "2ª VIA · 28/11/2026" — data em America/Sao_Paulo. */
export function seloSegundaVia(quando: Date = new Date()): string {
  const data = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(quando);
  return `2ª VIA · ${data}`;
}

export interface PacotePlano {
  /** Tem algo de fora do pacote completo → sai com o selo de 2ª via. */
  parcial: boolean;
  selo: string | null;
  /** Itens que entram, por tipo (ordem de leitura). */
  itens: PacoteSelecao;
  /** Folhas que cada tipo ocupa no PDF (fardo/caixa são reempacotados). */
  folhas: Record<PacoteTipo, number>;
  totalFolhas: number;
  /** Linhas da prévia "o que será impresso". */
  linhas: string[];
}

function plural(n: number, um: string, varios: string): string {
  return n === 1 ? um : varios;
}

function resumoItens(
  tipo: Exclude<PacoteTipo, 'palmilha'>,
  itens: readonly number[],
  total: number,
  folhasSaida: number,
): string {
  const rotulo = PACOTE_TIPO_ROTULO[tipo];
  if (itens.length === 0) return `${rotulo} · fora do PDF.`;
  const quais = itens.length === total
    ? `todos os cartões (1 a ${total})`
    : `${plural(itens.length, 'cartão', 'cartões')} ${formatarIndices(itens)} (${itens.length} de ${total})`;
  const reemp = itens.length === total ? '' : ' (reempacotadas)';
  return `${rotulo} · ${quais} em ${folhasSaida} ${plural(folhasSaida, 'folha', 'folhas')}${reemp}.`;
}

export function buildPacotePlano(
  inv: PacoteInventario,
  selecao: PacoteSelecao,
  quando: Date = new Date(),
): PacotePlano {
  const sel = normalizarSelecao(inv, selecao);
  const parcial = PACOTE_ORDEM.some((t) => {
    const total = totalItens(inv, t);
    return total > 0 && sel[t].length < total;
  });
  const selo = parcial ? seloSegundaVia(quando) : null;

  const folhas: Record<PacoteTipo, number> = {
    palmilha: sel.palmilha.length,
    fardo: Math.ceil(sel.fardo.length / PACOTE_FARDO_POR_FOLHA),
    caixa: Math.ceil(sel.caixa.length / PACOTE_CAIXA_POR_FOLHA),
  };
  const totalFolhas = folhas.palmilha + folhas.fardo + folhas.caixa;

  const linhas: string[] = [];
  linhas.push(selo ? `Carimbo: ${selo}` : 'Pacote completo, sem carimbo de 2ª via.');

  const totalPal = totalItens(inv, 'palmilha');
  if (totalPal > 0) {
    if (sel.palmilha.length === 0) linhas.push('Palmilha A4 · fora do PDF.');
    else if (sel.palmilha.length === totalPal) {
      linhas.push(`Palmilha A4 · todas as folhas (1 a ${totalPal}).`);
    } else {
      linhas.push(
        `Palmilha A4 · ${plural(sel.palmilha.length, 'folha', 'folhas')} ${formatarIndices(sel.palmilha)} (${sel.palmilha.length} de ${totalPal}).`,
      );
    }
  }
  if (totalItens(inv, 'fardo') > 0) {
    linhas.push(resumoItens('fardo', sel.fardo, totalItens(inv, 'fardo'), folhas.fardo));
  }
  if (totalItens(inv, 'caixa') > 0) {
    linhas.push(resumoItens('caixa', sel.caixa, totalItens(inv, 'caixa'), folhas.caixa));
  }

  return { parcial, selo, itens: sel, folhas, totalFolhas, linhas };
}

/** Extrai as folhas A4 de 18/6 cartões já reempacotadas (cartões na ordem de leitura). */
export function reempacotar<T>(itens: readonly T[], porFolhaN: number): T[][] {
  const por = Math.max(1, Math.trunc(porFolhaN) || 1);
  const out: T[][] = [];
  for (let i = 0; i < itens.length; i += por) out.push(itens.slice(i, i + por));
  return out;
}

/** Escolhe, pelos números 1-based, os elementos de uma lista. */
export function escolherPorIndice<T>(lista: readonly T[], indices: readonly number[]): T[] {
  return indices.map((i) => lista[i - 1]).filter((v): v is T => v !== undefined);
}
