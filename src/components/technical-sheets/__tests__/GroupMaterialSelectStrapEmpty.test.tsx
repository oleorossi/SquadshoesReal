import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GroupMaterialSelect } from '@/components/technical-sheets/sheetSelectors';
import { isStrapInventorySelectableGroup } from '@/lib/strapInventorySelection';

/**
 * Bug 28/11/2026: "TIRA CHATA 20MM" existe, está mapeada no Hub e tem 7 napas,
 * mas não tinha SKU ativo ainda → sumia do seletor de tira da ficha técnica.
 * Spec tira-material-de-estoque R6/R7: o PV cria o SKU ao salvar, então o grupo
 * da bitola precisa ser escolhível mesmo sem SKU.
 */
const groups = [
  { id: 'tiras', name: 'TIRAS', parent_group_id: null, is_family: true },
  { id: 'c8', name: 'TIRA CHATA 8MM', parent_group_id: 'tiras', is_artisanal_strap: true, strap_origin: 'prestador', consumption_unit: 'm', dimensions_width: 8 },
  { id: 'c20', name: 'TIRA CHATA 20MM', parent_group_id: 'tiras', is_artisanal_strap: true, strap_origin: 'prestador', consumption_unit: 'm', dimensions_width: 20 },
  { id: 'eg', name: 'ELÁSTICO ESPECIAL G', parent_group_id: null, is_family: true },
  { id: 'eg20', name: '20MM', parent_group_id: 'eg', is_artisanal_strap: true, consumption_unit: 'm', dimensions_width: 20 },
];
const products = [{ id: 'p1', name: 'TIRA CHATA 8MM · NAPA · PRETO', group_id: 'c8', color: 'PRETO', active: true }];

vi.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ data: groups, isLoading: false, isError: false }) }));
vi.mock('@/hooks/useProducts', () => ({ useProducts: () => ({ data: products, isLoading: false, isError: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock('@/components/groups/GroupEditDialog', () => ({ default: () => null }));

Element.prototype.scrollIntoView = vi.fn();
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

function open(allowEmptyGroups: boolean, onGroupSelect = vi.fn()) {
  render(
    <GroupMaterialSelect
      label="Tira"
      value=""
      onChange={() => undefined}
      onGroupSelect={onGroupSelect}
      groupFilter={(group) => isStrapInventorySelectableGroup(group as never, new Set())}
      allowEmptyGroups={allowEmptyGroups}
    />,
  );
  fireEvent.click(screen.getByRole('combobox'));
  return onGroupSelect;
}

const body = () => (document.body.textContent || '').replace(/\s+/g, ' ');
const optionWith = (text: string) => screen.getAllByRole('option').find((el) => (el.textContent || '').includes(text));

describe('GroupMaterialSelect — tira de estoque sem SKU ainda', () => {
  it('com allowEmptyGroups a bitola 20 mm sem SKU aparece na busca e é selecionável', () => {
    const onGroupSelect = open(true);
    fireEvent.change(screen.getByPlaceholderText(/Buscar família/), { target: { value: '20mm' } });
    expect(body()).toContain('TIRAS › TIRA CHATA 20MM');
    expect(body()).toContain('ELÁSTICO ESPECIAL G › 20MM');
    expect(body()).not.toContain('cadastre antes de usar');
    fireEvent.click(optionWith('TIRA CHATA 20MM')!);
    expect(onGroupSelect).toHaveBeenCalledTimes(1);
    expect((onGroupSelect.mock.calls[0][0] as { id: string }).id).toBe('c20');
  });

  it('dentro da família TIRAS lista 8 mm e 20 mm como larguras escolhíveis', () => {
    open(true);
    fireEvent.click(optionWith('TIRAS')!);
    expect(optionWith('TIRA CHATA 8MM')).toBeTruthy();
    expect(optionWith('TIRA CHATA 20MM')).toBeTruthy();
    expect(body()).toContain('Sem SKU ainda');
  });

  it('sem allowEmptyGroups (outros materiais) o grupo vazio segue como atalho de cadastro, mas a busca na raiz o encontra', () => {
    open(false);
    fireEvent.change(screen.getByPlaceholderText(/Buscar família/), { target: { value: '20mm' } });
    expect(body()).toContain('Sem itens ativos');
    expect(body()).toContain('TIRAS › TIRA CHATA 20MM');
  });
});
