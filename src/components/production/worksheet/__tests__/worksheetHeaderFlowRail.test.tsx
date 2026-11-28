import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { WorksheetHeader } from '../WorksheetHeader';
import { FLOW_RAIL_STEPS } from '../flowRail';

const Icon = () => <span data-testid="icon" />;

const currentLabel = (container: HTMLElement) => {
  const rail = container.querySelector('[aria-label^="Setor "]');
  expect(rail).toBeTruthy();
  const spans = Array.from(rail!.querySelectorAll('span')).filter((el) =>
    FLOW_RAIL_STEPS.includes((el.textContent || '').trim() as (typeof FLOW_RAIL_STEPS)[number]),
  );
  const current = spans.find((el) => (el as HTMLElement).style.fontWeight === '700');
  return current?.textContent?.trim();
};

describe('WorksheetHeader — trilho de etapas', () => {
  it('Costura Cabedal destaca CS.CAB, não AVIA', () => {
    const { container, getByLabelText } = render(
      <WorksheetHeader sector="Costura Cabedal" icon={Icon} identification={<span>id</span>} />,
    );
    expect(getByLabelText('Setor 5 de 12 no fluxo')).toBeTruthy();
    expect(currentLabel(container)).toBe('CS.CAB');
  });

  it('Aviamento destaca AVIA, não SILK', () => {
    const { container, getByLabelText } = render(
      <WorksheetHeader sector="Aviamento" icon={Icon} identification={<span>id</span>} />,
    );
    expect(getByLabelText('Setor 6 de 12 no fluxo')).toBeTruthy();
    expect(currentLabel(container)).toBe('AVIA');
  });

  it('Corte Cabedal destaca C.CAB, não CS.PLM', () => {
    const { container, getByLabelText } = render(
      <WorksheetHeader sector="Corte Cabedal" icon={Icon} identification={<span>id</span>} />,
    );
    expect(getByLabelText('Setor 3 de 12 no fluxo')).toBeTruthy();
    expect(currentLabel(container)).toBe('C.CAB');
  });

  it('Palmilha com flowSector Corte Fibra destaca C.PLM', () => {
    const { getByLabelText, container } = render(
      <WorksheetHeader
        sector="Corte de Placa de Fibra"
        flowSector="Corte Fibra"
        icon={Icon}
        identification={<span>id</span>}
      />,
    );
    expect(getByLabelText('Setor 1 de 12 no fluxo')).toBeTruthy();
    expect(currentLabel(container)).toBe('C.PLM');
  });

  it('Expedição entra no trilho (passo 12)', () => {
    const { getByLabelText, container } = render(
      <WorksheetHeader sector="Expedição" icon={Icon} identification={<span>id</span>} />,
    );
    expect(getByLabelText('Setor 12 de 12 no fluxo')).toBeTruthy();
    expect(currentLabel(container)).toBe('EXP');
  });
});
