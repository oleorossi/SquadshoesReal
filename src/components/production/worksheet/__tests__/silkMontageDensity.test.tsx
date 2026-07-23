import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { SilkMontageWorkSheet, type SoleSilkGroup } from '../../SilkMontageWorkSheet';
import { HEADER_THUMB_PX, STEP_CHECKBOX_PX } from '../density';
import type { ConsumptionRow } from '@/hooks/useBulkOrderConsumption';

/**
 * Renderiza a ficha do AVIAMENTO com os dados reais da folha 1 do maço
 * `teste aviamento.pdf` (DS20 · OFF WHITE, 288 pares, 24 fichas de 12) e trava
 * o layout da densidade "Opção A" (2026-07-23).
 *
 * O que este teste cobre e o guard de fonte (`density.test.ts`) não: que a
 * ficha RENDERIZA sem erro e que a foto está DENTRO do cabeçalho da cor — não
 * numa faixa própria logo abaixo dele, que era exatamente o defeito (140px de
 * altura usando 27% da largura, 73% saindo em branco em toda cor).
 */

beforeAll(() => {
  // O PaginatedSheet re-mede os blocos com ResizeObserver (cobre imagem que
  // chega tarde); o jsdom não implementa. Stub inerte: aqui interessa o que a
  // ficha RENDERIZA, não a repaginação — em jsdom toda altura é 0 e o
  // empacotamento não teria o que medir de qualquer jeito.
  const g = globalThis as unknown as { ResizeObserver?: unknown; matchMedia?: unknown };
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  g.matchMedia ??= (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  });
});

const strapRow = (name: string, color: string, required: number): ConsumptionRow => ({
  component: 'Tiras' as ConsumptionRow['component'],
  product_id: `p-${name}`,
  product_name: name,
  color,
  consumption_per_unit: 0,
  required,
  available: 9999,
  stock_ok: true,
  debit_mode: 'soft',
  unit: 'metro',
});

/** DS20 · OFF WHITE, folha 1/19 do PDF. */
function ds20(consumption: ConsumptionRow[]): SoleSilkGroup {
  return {
    soleName: 'DS20',
    groupKind: 'reference',
    totalPairs: 288,
    sizeBand: 'adulto',
    clientNames: ['LKG 10 CONFECCOES LTDA'],
    colorGroups: [{
      color: 'OFF WHITE',
      combinedGrid: { P: 72, M: 120, G: 96 },
      baseGrid: { P: 3, M: 5, G: 4 },
      baseGradeSum: 12,
      fichas: 24,
      totalPairs: 288,
      opNumbers: ['OP-2026-01193'],
      pvNumbers: ['PV-00147'],
      aviamentoSteps: ['Frente', 'Traseira'],
      variantImageUrl: 'https://example.test/ds20-off-white.png',
      consumption,
    }],
  };
}

function renderAviamento(consumption: ConsumptionRow[] = []) {
  return render(
    <SilkMontageWorkSheet
      groups={[ds20(consumption)]}
      sector="Aviamento"
      sizeBand="adulto"
      sectorLabel="Aviamento"
    />,
  );
}

/** Imagens de produto renderizadas (ProductImageBlock usa <img> puro). */
function productImages(c: HTMLElement): HTMLImageElement[] {
  return Array.from(c.querySelectorAll('img')).filter((i) => !!i.getAttribute('width'));
}

describe('Aviamento — densidade da Opção A', () => {
  it('renderiza a ficha inteira sem erro', () => {
    const { container } = renderAviamento([strapRow('TIRA OVERLOCK 5MM', 'OFF WHITE', 645.12)]);
    expect(container.textContent).toContain('OFF WHITE');
    expect(container.textContent).toContain('288');
  });

  it('a foto do produto é a MINIATURA do cabeçalho — nenhuma faixa de 140px', () => {
    const { container } = renderAviamento();
    const imgs = productImages(container);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('width')).toBe(String(HEADER_THUMB_PX));
    expect(imgs[0].getAttribute('height')).toBe(String(HEADER_THUMB_PX));
  });

  it('a miniatura vive DENTRO do cabeçalho da cor, não num bloco separado', () => {
    const { container } = renderAviamento();
    const img = productImages(container)[0];
    // Sobe até o cabeçalho da cor (o bloco que traz o rótulo "Cor" + o nome).
    const header = img.closest('.keep-with-next');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain('Cor');
    expect(header!.textContent).toContain('OFF WHITE');
    // …e o mesmo bloco traz os números do card — prova que é o cabeçalho.
    expect(header!.textContent).toContain('Pares');
  });

  it('o rótulo redundante "Grade · Pares por Numeração" saiu do papel', () => {
    const { container } = renderAviamento();
    expect(container.textContent).not.toContain('Grade · Pares por Numeração');
    // A grade em si continua inteira: thead "Nº" + Por Ficha + Total.
    expect(container.textContent).toContain('Nº');
    expect(container.textContent).toContain('Por Ficha');
    expect(container.textContent).toContain('× 24 fichas');
  });

  it('controle de fichas usa a caixinha compacta (20px)', () => {
    const { container } = renderAviamento();
    const boxes = container.querySelectorAll('[data-tally-box]');
    expect(boxes).toHaveLength(24);
    expect((boxes[0] as HTMLElement).style.width).toBe('20px');
  });

  it('checkbox de Frente/Traseira encolheu mas continua marcável', () => {
    const { container } = renderAviamento();
    const chks = Array.from(container.querySelectorAll('span.inline-block')).filter(
      (s) => (s as HTMLElement).style.width === `${STEP_CHECKBOX_PX}px`,
    );
    // 2 etapas × (3 numerações + coluna Total) = 8 caixas.
    expect(chks).toHaveLength(8);
  });
});

describe('Aviamento — consumo de tiras: faixa única vs tabela', () => {
  it('UMA tira vira faixa única, com as DUAS medidas no papel', () => {
    const { container } = renderAviamento([strapRow('TIRA OVERLOCK 5MM', 'OFF WHITE', 645.12)]);
    const txt = container.textContent || '';
    // A barra preta + o thead da tabela somem…
    expect(txt).not.toContain('Consumo de Tiras · Metros');
    // …mas nem "por ficha" nem "total" saem do papel.
    expect(txt).toContain('TIRA OVERLOCK 5MM');
    expect(txt).toContain('por ficha');
    expect(txt).toContain('26,88'); // 645,12 ÷ 24 fichas
    expect(txt).toContain('645,12');
  });

  it('UMA linha com largura faltando mantém a TABELA — o aviso precisa da 2ª linha', () => {
    const row = strapRow('NAPA SANTORINE', 'OFF WHITE', 5.7);
    const { container } = render(
      <SilkMontageWorkSheet
        groups={[ds20([{ ...row, component: 'Cabedal' as ConsumptionRow['component'], source: 'width_missing' }])]}
        sector="Corte Cabedal"
        sectorLabel="Corte Cabedal"
      />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('Consumo · Corte do Rolo');
    expect(txt).toContain('cadastrar largura na ficha de componente');
  });

  it('DUAS tiras mantêm a TABELA — a comparação precisa das colunas alinhadas', () => {
    const { container } = renderAviamento([
      strapRow('TIRA STRASS 6MM', 'ROSADO COM FUNDO ROSADO', 41.76),
      strapRow('MEIA CANA 10MM', 'OFF WHITE', 20.88),
    ]);
    const txt = container.textContent || '';
    expect(txt).toContain('Consumo de Tiras · Metros');
    expect(txt).toContain('TIRA STRASS 6MM');
    expect(txt).toContain('MEIA CANA 10MM');
    // Linha "Total tiras · <cor>" da tabela agregada.
    expect(txt).toContain('Total tiras');
  });
});

describe('outros setores do mesmo card', () => {
  it('Corte Cabedal: um material vira faixa única, com o rótulo da coluna', () => {
    const { container } = render(
      <SilkMontageWorkSheet
        groups={[ds20([{
          ...strapRow('NAPA SANTORINE', 'OFF WHITE', 30.4),
          component: 'Cabedal' as ConsumptionRow['component'],
        }])]}
        sector="Corte Cabedal"
        sectorLabel="Corte Cabedal"
      />,
    );
    const txt = container.textContent || '';
    expect(txt).not.toContain('Consumo · Corte do Rolo'); // barra preta saiu
    expect(txt).toContain('NAPA SANTORINE');
    expect(txt).toContain('Cabedal a cortar');            // rótulo preservado
    expect(txt).toContain('30,4');
  });

  it('Costura Cabedal: "Peças a Costurar" virou faixa de largura inteira', () => {
    const { container } = render(
      <SilkMontageWorkSheet groups={[ds20([])]} sector="Costura Cabedal" sectorLabel="Costura Cabedal" />,
    );
    const txt = container.textContent || '';
    expect(txt).toContain('Peças a Costurar');
    expect(txt).toContain('576');                 // 288 pares × 2 peças
    expect(txt).toContain('2 peças/par');
    // A foto desceu pra miniatura do cabeçalho aqui também (era 48px ao lado).
    const imgs = productImages(container);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('width')).toBe(String(HEADER_THUMB_PX));
  });
});
