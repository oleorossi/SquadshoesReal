import { describe, expect, it } from 'vitest';
import { act, createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PrintContinuityProvider, usePrintContinuity } from '../printContinuity';

/**
 * Travado pelo React #185 em /imprimir-fichas (stack: registerContinuationMount).
 * Se o ref callback mudar de identidade a cada update do registry, React chama
 * old(null)+new(el) em loop → maximum update depth.
 */
describe('printContinuity ref callback stability', () => {
  it('mantém registerContinuationMountForNext estável quando leading muda', async () => {
    const seen: Array<(el: HTMLDivElement | null) => void> = [];
    let bumpLeading: (() => void) | null = null;

    function Probe() {
      const slot = usePrintContinuity('sheet-a');
      const [, setTick] = useState(0);
      bumpLeading = () => {
        slot.reportTrailingRemainder(200);
        setTick(t => t + 1);
      };
      useEffect(() => {
        seen.push(slot.registerContinuationMountForNext);
      });
      return createElement('div', {
        ref: slot.registerContinuationMountForNext,
        'data-testid': 'mount',
      });
    }

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(
        createElement(PrintContinuityProvider, null, createElement(Probe)),
      );
    });

    const first = seen[seen.length - 1];
    expect(first).toBeTypeOf('function');

    await act(async () => {
      bumpLeading?.();
    });
    await act(async () => {
      bumpLeading?.();
    });

    const last = seen[seen.length - 1];
    expect(last).toBe(first);

    // Sem churn null↔el: cada identidade nova do callback geraria um clear.
    // Com callback estável, registerContinuationMount só vê o attach inicial.
    root.unmount();
    host.remove();
  });
});
