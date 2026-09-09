import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import TechnicalStrapMaterialPolicyEditor from '../TechnicalStrapMaterialPolicyEditor';
import type { StrapMaterialPolicyLike } from '@/lib/strapMaterialPolicy';

HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};

const SOFT = '11111111-1111-4111-8111-111111111111';
const COMPOSITE = '22222222-2222-4222-8222-222222222222';
const groups = [{ id: SOFT, name: 'NAPA SOFT' }, { id: COMPOSITE, name: 'NAPA SOFT + MASSABOX' }];

function Harness({
  initial = {}, onChange = vi.fn(),
}: { initial?: StrapMaterialPolicyLike; onChange?: (line: StrapMaterialPolicyLike) => void }) {
  const [line, setLine] = useState(initial);
  return <TechnicalStrapMaterialPolicyEditor
    line={line} label="TIRA 1" groups={groups}
    onChange={next => { setLine(next); onChange(next); }}
  />;
}

describe('TechnicalStrapMaterialPolicyEditor', () => {
  it('mostra legado seguindo referência sem modificar a linha ao abrir', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Política de material de TIRA 1' })).toHaveTextContent('Segue o material da referência');
    expect(screen.queryByRole('combobox', { name: 'Material fixo de TIRA 1' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('permite escolher material fixo composto sem criar materiais separados', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('combobox', { name: 'Política de material de TIRA 1' }));
    await user.click(screen.getByRole('option', { name: 'Material fixo nesta posição' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Selecione o material fixo');
    await user.click(screen.getByRole('combobox', { name: 'Material fixo de TIRA 1' }));
    await user.click(screen.getByRole('option', { name: 'NAPA SOFT + MASSABOX' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      material_mode: 'fixed_group', material_group_id: COMPOSITE, allowed_material_group_ids: [],
    }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('permite autorizar grupos diferentes para uma posição do pedido', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ material_mode: 'select_on_order' }} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'NAPA SOFT' }));
    await user.click(screen.getByRole('checkbox', { name: 'NAPA SOFT + MASSABOX' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      material_mode: 'select_on_order', material_group_id: null, allowed_material_group_ids: [SOFT, COMPOSITE],
    }));
    expect(screen.getByText('2 material(is) autorizado(s) para esta posição.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'NAPA SOFT' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ allowed_material_group_ids: [COMPOSITE] }));
  });

  it('busca combina todos os termos sem descartar a seleção oculta', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ material_mode: 'select_on_order', allowed_material_group_ids: [SOFT] }} onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: 'Buscar materiais de TIRA 1' }), 'massabox napa');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.queryByRole('checkbox', { name: 'NAPA SOFT' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'NAPA SOFT + MASSABOX' }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ allowed_material_group_ids: [SOFT, COMPOSITE] }));
  });

  it.each([{ loading: true }, { failed: true }])('bloqueia escolha material quando o catálogo não é utilizável: %j', state => {
    render(<TechnicalStrapMaterialPolicyEditor
      line={{ material_mode: 'fixed_group', material_group_id: SOFT }} label="TIRA 1"
      groups={[]} {...state} onChange={vi.fn()}
    />);
    expect(screen.getByRole('combobox', { name: 'Material fixo de TIRA 1' })).toBeDisabled();
    expect(screen.queryByText('O material fixo não está elegível como matéria-prima de tira.')).not.toBeInTheDocument();
  });

  it('exibe política desconhecida e permite repará-la explicitamente', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={{ material_mode: 'future_mode' }} onChange={onChange} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Política de material desconhecida');
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('combobox', { name: 'Política de material de TIRA 1' }));
    await user.click(screen.getByRole('option', { name: 'Segue o material da referência' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ material_mode: 'follow_reference' }));
  });

  it('material gravado inelegível permanece visível e pode ser removido da lista', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TechnicalStrapMaterialPolicyEditor
      line={{ material_mode: 'select_on_order', allowed_material_group_ids: [COMPOSITE] }}
      label="TIRA 1" groups={[groups[0]]} knownGroups={groups} onChange={onChange}
    />);
    const checkbox = screen.getByRole('checkbox', { name: 'NAPA SOFT + MASSABOX · indisponível' });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent('não está elegível');
    await user.click(checkbox);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ allowed_material_group_ids: [] }));
  });

  it('limita a 25 grupos sem impedir a remoção de uma opção já autorizada', async () => {
    const user = userEvent.setup();
    const materialGroups = Array.from({ length: 26 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: `MATERIAL ${index + 1}`,
    }));
    const onChange = vi.fn();
    render(<TechnicalStrapMaterialPolicyEditor
      line={{ material_mode: 'select_on_order', allowed_material_group_ids: materialGroups.slice(0, 25).map(group => group.id) }}
      label="TIRA 1" groups={materialGroups} onChange={onChange}
    />);
    expect(screen.getByRole('checkbox', { name: 'MATERIAL 26' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'MATERIAL 1' })).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: 'MATERIAL 1' }));
    expect(onChange.mock.lastCall[0].allowed_material_group_ids).toHaveLength(24);
  });
});
