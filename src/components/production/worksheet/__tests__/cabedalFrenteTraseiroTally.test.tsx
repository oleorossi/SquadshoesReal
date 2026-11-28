import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { CabedalFrenteTraseiroTally } from '../CabedalFrenteTraseiroTally';

function boxesIn(el: Element): HTMLElement[] {
  return Array.from(el.querySelectorAll('[data-tally-box]')) as HTMLElement[];
}

describe('CabedalFrenteTraseiroTally', () => {
  it('não renderiza nada com count <= 0', () => {
    const { container } = render(<CabedalFrenteTraseiroTally count={0} />);
    expect(container.querySelector('[data-cabedal-frente-traseiro-tally]')).toBeNull();
  });

  it('renderiza duas grades independentes 1..N, uma por parte', () => {
    const { container } = render(
      <CabedalFrenteTraseiroTally count={12} pairsPerCard={12} totalUnits={144} />,
    );
    const root = container.querySelector('[data-cabedal-frente-traseiro-tally]');
    expect(root).not.toBeNull();
    const frente = root!.querySelector('[data-cabedal-part-band="frente"]') as HTMLElement;
    const traseiro = root!.querySelector('[data-cabedal-part-band="traseiro"]') as HTMLElement;
    expect(frente).not.toBeNull();
    expect(traseiro).not.toBeNull();

    const frenteBoxes = boxesIn(frente);
    const traseiroBoxes = boxesIn(traseiro);
    expect(frenteBoxes).toHaveLength(12);
    expect(traseiroBoxes).toHaveLength(12);
    expect(frenteBoxes.map((b) => b.textContent)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    expect(traseiroBoxes.map((b) => b.textContent)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    // As duas grades são nós distintos — marcar uma não mistura com a outra.
    expect(frente.contains(traseiroBoxes[0])).toBe(false);
    expect(traseiro.contains(frenteBoxes[0])).toBe(false);
  });

  it('identifica Frente e Traseiro com cabeçalhos e badges contrastantes em P&B', () => {
    const { container } = render(<CabedalFrenteTraseiroTally count={3} titleSuffix="REF-01" />);
    const frente = container.querySelector('[data-cabedal-part-band="frente"]') as HTMLElement;
    const traseiro = container.querySelector('[data-cabedal-part-band="traseiro"]') as HTMLElement;

    expect(frente.textContent).toContain('FRENTE');
    expect(frente.textContent).toContain('Controle de Fichas · Frente · REF-01');
    expect(traseiro.textContent).toContain('TRASEIRO');
    expect(traseiro.textContent).toContain('Controle de Fichas · Traseiro · REF-01');

    const frenteBadge = frente.querySelector('[data-cabedal-part-badge="frente"]') as HTMLElement;
    const traseiroBadge = traseiro.querySelector('[data-cabedal-part-badge="traseiro"]') as HTMLElement;
    expect(frenteBadge.textContent).toBe('F');
    expect(traseiroBadge.textContent).toBe('T');
    // Frente: badge sólido (fundo preto). Traseiro: badge vazado (fundo branco).
    // Frente: badge sólido (fundo preto, letra branca).
    expect(frenteBadge.style.background.replace(/\s/g, '')).toMatch(/#000|rgb\(0,0,0\)/);
    expect(frenteBadge.style.color.replace(/\s/g, '')).toMatch(/#fff|#ffffff|rgb\(255,255,255\)/i);
    // Traseiro: badge vazado (fundo branco, letra preta) + faixa com borda tracejada.
    expect(traseiroBadge.style.background.replace(/\s/g, '')).toMatch(/#fff|#ffffff|rgb\(255,255,255\)/i);
    expect(traseiroBadge.style.color.replace(/\s/g, '')).toMatch(/#000|rgb\(0,0,0\)/);
    expect(traseiro.style.border).toContain('dashed');
  });

  it('explica que as partes se marcam à parte', () => {
    const { container } = render(<CabedalFrenteTraseiroTally count={1} />);
    expect(container.textContent).toMatch(/traseiro pode ficar pronto com a frente pendente/i);
  });

  it('com 80 fichas auto-ajusta a caixa pra não vazar a borda da faixa', () => {
    const { container } = render(
      <CabedalFrenteTraseiroTally count={80} pairsPerCard={12} totalUnits={960} />,
    );
    for (const part of ['frente', 'traseiro'] as const) {
      const band = container.querySelector(`[data-cabedal-part-band="${part}"]`) as HTMLElement;
      const boxes = boxesIn(band);
      expect(boxes).toHaveLength(80);
      const px = Number(boxes[0].dataset.tallyBoxPx || boxes[0].style.width.replace('px', ''));
      expect(px).toBeLessThan(20);
      expect(px).toBeGreaterThanOrEqual(14);
      expect(boxes[0].style.width).toBe(`${px}px`);
      // Caixinhas 30 e 60 existem e têm o mesmo tamanho (não saem da linha).
      expect(boxes[29].textContent).toBe('30');
      expect(boxes[59].textContent).toBe('60');
      expect(boxes[29].style.width).toBe(`${px}px`);
    }
  });

  it('com 12 fichas coloca Frente e Traseiro lado a lado', () => {
    const { container } = render(
      <CabedalFrenteTraseiroTally count={12} pairsPerCard={12} totalUnits={144} />,
    );
    const root = container.querySelector('[data-cabedal-frente-traseiro-tally]') as HTMLElement;
    expect(root.getAttribute('data-cabedal-tally-layout')).toBe('side-by-side');
    const frente = root.querySelector('[data-cabedal-part-band="frente"]') as HTMLElement;
    const traseiro = root.querySelector('[data-cabedal-part-band="traseiro"]') as HTMLElement;
    expect(frente).not.toBeNull();
    expect(traseiro).not.toBeNull();
    expect(frente.parentElement).toBe(traseiro.parentElement);
  });

  it('com 80 fichas empilha as faixas (lado a lado ficaria mais alto)', () => {
    const { container } = render(
      <CabedalFrenteTraseiroTally count={80} pairsPerCard={12} totalUnits={960} />,
    );
    const root = container.querySelector('[data-cabedal-frente-traseiro-tally]') as HTMLElement;
    expect(root.getAttribute('data-cabedal-tally-layout')).toBe('stack');
  });
});
