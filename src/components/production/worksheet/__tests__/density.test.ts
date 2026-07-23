import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  TALLY_SIZE,
  HEADER_THUMB_PX,
  STEP_CHECKBOX_PX,
  CONSUMO_SLIM_MAX_ROWS,
  canUseSlimConsumo,
} from '../density';

/**
 * Trava a densidade das fichas de operador ("Opção A", 2026-07-23).
 *
 * Contexto: o maço de Aviamento imprimia 19 folhas A4 pra 11,7 folhas de tinta
 * (61% de ocupação média) porque o card de cor tinha 622px contra ~948px úteis
 * — dois cards nunca cabiam juntos. A Opção A corta 231px do card sem tirar
 * informação nenhuma do papel.
 *
 * Os dois guards abaixo são AUTO-DERIVADOS do próprio fonte (varrem os arquivos
 * em vez de repetir uma lista), então não desatualizam quando alguém adicionar
 * uma ficha nova — o teste quebra até a ficha nova entrar no padrão.
 */

const PRODUCTION_DIR = join(__dirname, '..', '..');

/** Remove comentários — os guards varrem só o que RENDERIZA. Sem isso, uma
 *  linha de comentário explicando o que saiu do papel faz o guard acusar que
 *  aquilo continua lá. */
function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')  // {/* comentário JSX */}
    .replace(/\/\*[\s\S]*?\*\//g, '')            // /* bloco */
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');      // // linha (poupa "https://")
}

/** Fichas de operador = componentes *WorkSheet.tsx do diretório de produção. */
function worksheetFiles(): Array<{ name: string; src: string }> {
  return readdirSync(PRODUCTION_DIR)
    .filter((f) => /WorkSheet\.tsx$/.test(f))
    .map((name) => ({ name, src: stripComments(readFileSync(join(PRODUCTION_DIR, name), 'utf8')) }));
}

/** Todas as ocorrências de `<TallyBox ... />` (incl. multilinha) de um fonte. */
function tallyBoxUsages(src: string): string[] {
  return src.match(/<TallyBox[\s\S]*?\/>/g) || [];
}

/** Valores passados em `size={...}` pros `<ProductImageBlock ... />` do fonte. */
function productImageSizes(src: string): string[] {
  const blocks = src.match(/<ProductImageBlock[\s\S]*?\/>/g) || [];
  return blocks
    .map((b) => b.match(/\bsize=\{([^}]*)\}/)?.[1]?.trim())
    .filter((v): v is string => !!v);
}

describe('density — constantes da Opção A', () => {
  it('tally de ficha de operador é o compacto', () => {
    // `sm` (20px) em vez de `md` (25px). Além dos 5px por caixa, o TallyBox
    // recalcula as colunas pela largura útil: md cabe 20/linha, sm cabe 30.
    expect(TALLY_SIZE).toBe('sm');
  });

  it('miniatura do cabeçalho é bem menor que a faixa de foto antiga (140px)', () => {
    expect(HEADER_THUMB_PX).toBeLessThan(140);
    // Não pode encolher a ponto de o operador não reconhecer o modelo.
    expect(HEADER_THUMB_PX).toBeGreaterThanOrEqual(40);
  });

  it('checkbox por numeração continua marcável à caneta', () => {
    expect(STEP_CHECKBOX_PX).toBeLessThan(20);
    expect(STEP_CHECKBOX_PX).toBeGreaterThanOrEqual(14);
  });
});

describe('canUseSlimConsumo', () => {
  it('uma linha sem aviso vira faixa única', () => {
    expect(canUseSlimConsumo([{ source: 'sheet' }])).toBe(true);
  });

  it('lista vazia não vira faixa (o bloco nem renderiza)', () => {
    expect(canUseSlimConsumo([])).toBe(false);
  });

  it('duas ou mais linhas mantêm a TABELA — o operador compara as linhas', () => {
    expect(canUseSlimConsumo([{ source: 'sheet' }, { source: 'sheet' }])).toBe(false);
    expect(CONSUMO_SLIM_MAX_ROWS).toBe(1);
  });

  it('width_missing mantém a tabela: o aviso precisa da 2ª linha', () => {
    // Espremer o "cadastrar largura na ficha de componente" numa faixa
    // esconderia o alerta que evita consumo ~100× errado (dm² lido como metro).
    expect(canUseSlimConsumo([{ source: 'width_missing' }])).toBe(false);
  });

  it('source ausente/nulo não confunde com width_missing', () => {
    expect(canUseSlimConsumo([{}])).toBe(true);
    expect(canUseSlimConsumo([{ source: null }])).toBe(true);
  });
});

describe('guard — toda ficha de operador segue a densidade', () => {
  it('encontra as fichas (o guard não pode passar por varrer zero arquivo)', () => {
    const files = worksheetFiles();
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('nenhum <TallyBox> usa tamanho literal — todos puxam TALLY_SIZE', () => {
    const offenders: string[] = [];
    for (const { name, src } of worksheetFiles()) {
      for (const usage of tallyBoxUsages(src)) {
        if (!/\bsize=\{TALLY_SIZE\}/.test(usage)) {
          offenders.push(`${name}: ${usage.replace(/\s+/g, ' ').slice(0, 110)}`);
        }
      }
    }
    // Sem `size`, o TallyBox cai no default 'md' (25px) — é assim que a folha
    // volta a inchar sem ninguém perceber.
    expect(offenders).toEqual([]);
  });

  it('nenhuma foto de produto volta pra faixa de 140px', () => {
    const offenders: string[] = [];
    for (const { name, src } of worksheetFiles()) {
      for (const size of productImageSizes(src)) {
        // Só dois tamanhos são legítimos: a miniatura do cabeçalho e a
        // miniatura por referência do Corte Forração (IMG, 92px — AUMENTADA a
        // pedido do dono em 2026-07-22, não reduzir).
        const ok = size === 'HEADER_THUMB_PX' || size === 'IMG';
        if (!ok) offenders.push(`${name}: size={${size}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('o rótulo redundante da grade não voltou', () => {
    for (const { name, src } of worksheetFiles()) {
      // O thead da própria tabela já abre com "Nº".
      expect(`${name}:${src.includes('Grade · Pares por Numeração')}`).toBe(`${name}:false`);
    }
  });
});
