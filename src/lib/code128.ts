/**
 * Encoder CODE128 próprio — devolve os MÓDULOS crus, não uma imagem.
 *
 * Por que não JsBarcode (que já está no projeto): ele só desenha em <svg>/<canvas>
 * e não expõe a sequência de módulos. Pra etiqueta térmica a gente precisa do
 * módulo cru, porque cada barra tem que cair em pixel inteiro da cabeça de
 * impressão (203 dpi na Elgin L42) — reamostrar uma imagem de código de barras
 * borra a borda com anti-aliasing e o leitor da loja falha.
 *
 * A tabela de padrões abaixo foi conferida 1:1 contra a do `python-barcode`,
 * que é a referência usada pela skill `etiqueta-baby-nalin` (o gerador Python
 * que produziu as etiquetas físicas já validadas no pedido 303222).
 */

/**
 * Larguras dos 107 símbolos do CODE128, na notação canônica: cada dígito é a
 * largura em módulos de um elemento, alternando **barra, espaço, barra…**
 * começando sempre por barra. Os 106 primeiros somam 11 módulos; o STOP (106)
 * soma 13 porque leva a barra de terminação.
 */
export const CODE128_PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', // 0-7
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', // 8-15
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', // 16-23
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', // 24-31
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', // 32-39
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', // 40-47
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', // 48-55
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', // 56-63
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', // 64-71
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', // 72-79
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', // 80-87
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', // 88-95
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', // 96-103
  '211214', '211232', '2331112',                                                   // 104-106
];

/** Símbolos de controle usados aqui. FNC1..FNC4 não entram: a etiqueta é CODE128 puro. */
const START_B = 104;
const START_C = 105;
const STOP = 106;
const CODE_B = 100; // dentro do conjunto C, troca para B
const CODE_C = 99; // dentro do conjunto B, troca para C

export interface Code128Encoding {
  /** Símbolos na ordem final: start, dados, trocas de conjunto, checksum e stop. */
  values: number[];
  /** Dígito verificador módulo 103 (já incluído em `values`). */
  checksum: number;
  /** '1' = barra, '0' = espaço. Um caractere por módulo. */
  modules: string;
  /** `modules.length` — é isto que decide se o código cabe na etiqueta. */
  moduleCount: number;
}

const isDigit = (ch: string) => ch >= '0' && ch <= '9';

/** Quantos dígitos seguidos começam em `pos`. */
function digitRun(data: string, pos: number): number {
  let n = 0;
  while (pos + n < data.length && isDigit(data[pos + n])) n++;
  return n;
}

/**
 * Seleção automática de conjunto, na regra recomendada pela AIM: entra em C
 * quando há corrida de dígitos que compense (4+ no começo, 6+ no meio, ou o
 * resto todo em pares), e volta pra B pro que sobrar.
 */
function encodeValues(data: string): number[] {
  const leading = digitRun(data, 0);
  const startInC = leading >= 4 || (leading === data.length && leading % 2 === 0 && leading > 0);

  const values: number[] = [startInC ? START_C : START_B];
  let inC = startInC;
  let i = 0;

  while (i < data.length) {
    const ch = data[i];
    const run = digitRun(data, i);

    if (inC) {
      if (run >= 2) {
        values.push(Number(data.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      inC = false;
      continue;
    }

    // Em B: só vale trocar pra C se a corrida pagar o símbolo da troca.
    const restoTodoEmPares = i + run === data.length && run % 2 === 0;
    if (run >= 6 || (run >= 4 && restoTodoEmPares)) {
      values.push(CODE_C);
      inC = true;
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(
        `CODE128: caractere não imprimível em "${data}" (posição ${i}). ` +
          'A etiqueta só aceita ASCII imprimível (32–126).',
      );
    }
    values.push(code - 32);
    i++;
  }

  return values;
}

/** Soma ponderada módulo 103 — o start entra com peso 1, os dados a partir de 1. */
function checksumOf(values: number[]): number {
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  return sum % 103;
}

/** Expande um padrão de larguras em módulos, começando por barra. */
function patternToModules(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    out += (i % 2 === 0 ? '1' : '0').repeat(Number(pattern[i]));
  }
  return out;
}

/** Codifica `data` em CODE128 com seleção automática de conjunto. */
export function encodeCode128(data: string): Code128Encoding {
  if (!data) throw new Error('CODE128: conteúdo vazio.');

  const dataValues = encodeValues(data);
  const checksum = checksumOf(dataValues);
  const values = [...dataValues, checksum, STOP];
  const modules = values.map(v => patternToModules(CODE128_PATTERNS[v])).join('');

  return { values, checksum, modules, moduleCount: modules.length };
}

/** Atalho pra quem só quer a régua de módulos. */
export function code128Modules(data: string): string {
  return encodeCode128(data).modules;
}

/** Corridas contíguas de barra, pra desenhar um retângulo por barra em vez de um por módulo. */
export function code128Bars(data: string): Array<{ start: number; width: number }> {
  const modules = code128Modules(data);
  const bars: Array<{ start: number; width: number }> = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      let w = 0;
      while (i + w < modules.length && modules[i + w] === '1') w++;
      bars.push({ start: i, width: w });
      i += w;
    } else {
      i++;
    }
  }
  return bars;
}
