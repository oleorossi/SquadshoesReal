import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { TallyBox } from '../TallyBox';

/**
 * Regressão da grade de quadrados do tally ("Controle de Fichas" / "Caixas
 * conferidas"). Antes os quadrados eram fatiados em CHUNKS fixos de 60, cada um
 * um `.keep-together` grande — quando o último chunk não cabia no resto da folha
 * ele pulava INTEIRO pra uma folha nova, deixando-a quase vazia (defeito de
 * overflow: 90 caixas → folha com 1-60 + folha quase vazia só com 61-90).
 *
 * Agora cada LINHA de quadrados é um `.keep-together` independente dentro de um
 * container quebrável → o browser quebra ENTRE LINHAS, empacotando cada folha
 * até o fim. Estes testes travam a estrutura (linhas atômicas, contagem exata,
 * nenhuma linha maior que o nº de colunas, sem chunk de 60).
 */

/** Quadrados renderizados, em ordem, lidos do DOM. */
function boxNumbers(container: HTMLElement): number[] {
  // Cada quadrado é um div folha com texto numérico dentro de uma linha.
  const rows = Array.from(container.querySelectorAll('.keep-together')).filter(
    (el) => (el as HTMLElement).style.display === 'flex' && el.parentElement?.style.flexDirection === 'column',
  );
  const nums: number[] = [];
  for (const row of rows) {
    for (const box of Array.from(row.children)) {
      nums.push(Number((box as HTMLElement).textContent));
    }
  }
  return nums;
}

/** Linhas atômicas (`.keep-together` que são filhas diretas do container coluna). */
function tallyRows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('.keep-together')).filter(
    (el) =>
      (el as HTMLElement).style.display === 'flex' &&
      el.parentElement?.style.flexDirection === 'column',
  ) as HTMLElement[];
}

describe('TallyBox — paginação por linha', () => {
  it('não renderiza nada com count <= 0', () => {
    const { container } = render(<TallyBox count={0} />);
    expect(container.firstChild).toBeNull();
  });

  for (const count of [1, 12, 30, 60, 90, 120, 213]) {
    it(`renderiza exatamente ${count} quadrados numerados 1..${count} (md)`, () => {
      const { container } = render(<TallyBox count={count} />);
      const nums = boxNumbers(container);
      expect(nums).toHaveLength(count);
      expect(nums).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    });
  }

  it('quebra em LINHAS (não em chunks de 60): 90 caixas viram várias linhas atômicas', () => {
    const { container } = render(<TallyBox count={90} unit="caixas" />);
    const rows = tallyRows(container);
    // Cada linha cabe ~24 quadrados (md) — 90 caixas = 4 linhas, nenhuma com 60.
    expect(rows.length).toBeGreaterThan(1);
    const perRow = rows.map((r) => r.children.length);
    expect(Math.max(...perRow)).toBeLessThanOrEqual(25); // jamais um "chunk" de 60
    // soma fecha com o total
    expect(perRow.reduce((a, b) => a + b, 0)).toBe(90);
    // só a última linha pode ser parcial; as demais são cheias e iguais
    const full = perRow.slice(0, -1);
    expect(new Set(full).size).toBe(1);
    expect(perRow[perRow.length - 1]).toBeLessThanOrEqual(full[0]);
  });

  it('size="sm" cabe MAIS quadrados por linha que size="md" (caixa menor)', () => {
    const sm = tallyRows(render(<TallyBox count={120} size="sm" />).container);
    const md = tallyRows(render(<TallyBox count={120} size="md" />).container);
    expect(sm[0].children.length).toBeGreaterThan(md[0].children.length);
  });

  it('toda linha cheia tem a mesma largura lógica (nº de colunas estável)', () => {
    const { container } = render(<TallyBox count={200} />);
    const rows = tallyRows(container);
    const full = rows.slice(0, -1).map((r) => r.children.length);
    expect(new Set(full).size).toBe(1);
    // 200 quadrados não cabem numa única linha (prova que pagina por linha)
    expect(rows.length).toBeGreaterThan(5);
  });
});
