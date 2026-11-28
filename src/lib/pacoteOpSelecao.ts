/**
 * Seleção por texto do "Pacote da OP" — `1,5,15` (só esses), `1:15` (de 1 até 15)
 * e combinações (`1,5,10:15`).
 *
 * Diferente de `parseFardoSelection` (Elgin), que ignora em silêncio o que está
 * fora da faixa, este parser VALIDA: reimprimir o item errado gasta papel e
 * confunde a fábrica, então qualquer entrada duvidosa vira erro com mensagem
 * em pt-BR dizendo o que corrigir. Função pura; não toca em banco nem em DOM.
 */

/**
 * `ok` verdadeiro → `indices` (ordenados, sem repetição) e `vazio` (campo em
 * branco); `ok` falso → `erro` em pt-BR. Objeto plano de propósito: o projeto
 * roda sem `strictNullChecks`, e aí uma união discriminada por boolean não afunila.
 */
export interface SelecaoTextoResultado {
  ok: boolean;
  vazio: boolean;
  indices: number[];
  erro: string;
}

const falha = (erro: string): SelecaoTextoResultado => ({ ok: false, vazio: false, indices: [], erro });

const TOKEN_INTEIRO = /^\d+$/;

function paraInteiro(token: string): number | null {
  if (!TOKEN_INTEIRO.test(token)) return null;
  const n = Number(token);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * @param entrada texto digitado (`1,5,10:15`). Separadores aceitos: vírgula,
 *   ponto e vírgula ou espaço. Vazio → `{ ok: true, vazio: true }`.
 * @param max maior número válido (1..max). `max < 1` → nada a selecionar.
 */
export function parseSelecaoTexto(entrada: string, max: number): SelecaoTextoResultado {
  const texto = String(entrada ?? '').trim();
  if (!texto) return { ok: true, vazio: true, indices: [], erro: '' };
  const limite = Math.trunc(Number(max));
  if (!Number.isFinite(limite) || limite < 1) {
    return falha('Não há itens para selecionar.');
  }

  // Espaços ao redor de ":" não quebram o intervalo ("10 : 15" → "10:15").
  const normalizado = texto.replace(/\s*:\s*/g, ':');
  // Vírgula/ponto e vírgula separam itens e NÃO podem ficar vazios ("1,,5");
  // espaço dentro de um item também separa ("1 5 10:15").
  const partes: string[] = [];
  for (const bloco of normalizado.split(/[,;]/)) {
    const itens = bloco.trim().split(/\s+/).filter(Boolean);
    if (itens.length === 0) return falha('Há uma vírgula sobrando na lista.');
    partes.push(...itens);
  }
  const escolhidos = new Set<number>();

  for (const parte of partes) {

    const pedacos = parte.split(':');
    if (pedacos.length > 2) {
      return falha(`“${parte}” não é um intervalo válido. Use o formato 10:15.`);
    }

    const numeros: number[] = [];
    for (const pedaco of pedacos) {
      if (pedaco === '') {
        return falha(`Intervalo incompleto em “${parte}”. Use o formato 10:15.`);
      }
      const n = paraInteiro(pedaco);
      if (n === null) {
        return falha(`“${pedaco}” não é um número inteiro válido.`);
      }
      if (n < 1) return falha('Os números começam em 1.');
      if (n > limite) {
        return falha(`${n} está fora da faixa: o máximo é ${limite}.`);
      }
      numeros.push(n);
    }

    if (numeros.length === 2) {
      const [de, ate] = numeros;
      if (de > ate) {
        return falha(`Intervalo invertido em “${parte}”: use ${ate}:${de}.`);
      }
      for (let i = de; i <= ate; i += 1) escolhidos.add(i);
    } else {
      escolhidos.add(numeros[0]);
    }
  }

  return { ok: true, vazio: false, indices: [...escolhidos].sort((a, b) => a - b), erro: '' };
}

/**
 * Descreve índices ordenados: `[1,5,10,11,12,13,14,15]` → "1, 5 e 10 a 15".
 * Sequências de 3+ viram "a"; pares seguidos ficam como "10 e 11".
 */
export function formatarIndices(indices: readonly number[]): string {
  const ordenados = [...new Set(indices)].sort((a, b) => a - b);
  const itens: string[] = [];
  let i = 0;
  while (i < ordenados.length) {
    let j = i;
    while (j + 1 < ordenados.length && ordenados[j + 1] === ordenados[j] + 1) j += 1;
    const tamanho = j - i + 1;
    if (tamanho >= 3) itens.push(`${ordenados[i]} a ${ordenados[j]}`);
    else for (let k = i; k <= j; k += 1) itens.push(String(ordenados[k]));
    i = j + 1;
  }
  if (itens.length === 0) return '';
  if (itens.length === 1) return itens[0];
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}
