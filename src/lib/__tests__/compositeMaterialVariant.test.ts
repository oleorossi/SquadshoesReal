import { describe, expect, it } from 'vitest';
import {
  resolveCompositeMaterialVariant,
  shouldVariantLiningFollowMainMaterial,
  type CompositeMaterialVariantGroup,
  type CompositeMaterialVariantLayer,
} from '@/lib/compositeMaterialVariant';

const groups: CompositeMaterialVariantGroup[] = [
  { id: 'napa', name: 'NAPA SOFT' },
  { id: 'glow', name: 'GLOW METALLIC' },
  { id: 'massabox', name: 'MASSA BOX' },
  { id: 'espuma', name: 'ESPUMA' },
  { id: 'base', name: 'NAPA SOFT + MASSA BOX' },
  { id: 'target', name: 'DUBLADO METÁLICO' },
];

function layer(
  compositeGroupId: string,
  componentGroupId: string | null,
  isColorSource: boolean,
  label?: string,
  displayOrder = isColorSource ? 0 : 1,
): CompositeMaterialVariantLayer {
  return {
    composite_group_id: compositeGroupId,
    component_group_id: componentGroupId,
    component_label: label,
    is_color_source: isColorSource,
    display_order: displayOrder,
    role: isColorSource ? 'cabedal' : 'estrutura',
  };
}

const baseLayers = [layer('base', 'napa', true), layer('base', 'massabox', false, 'MASSA BOX')];
const targetLayers = [layer('target', 'glow', true), layer('target', 'massabox', false)];

function resolve(layers: CompositeMaterialVariantLayer[], extraGroups: CompositeMaterialVariantGroup[] = []) {
  return resolveCompositeMaterialVariant({
    baseGroupId: 'base', mainGroupId: 'glow', groups: [...groups, ...extraGroups], layers,
  });
}

describe('resolveCompositeMaterialVariant', () => {
  it('troca Napa por Glow preservando Massa Box, sem depender do nome ou de produtos ativos', () => {
    expect(resolve([...baseLayers, ...targetLayers])).toEqual({
      status: 'resolved', groupId: 'target', groupName: 'DUBLADO METÁLICO', sourceGroupId: 'napa',
    });
  });

  it('preserva todas as camadas fixas e suas multiplicidades, independentemente da ordem', () => {
    const extendedBase = [...baseLayers, layer('base', 'espuma', false), layer('base', 'massabox', false)];
    expect(resolve([...extendedBase, ...targetLayers, layer('target', 'espuma', false)])).toMatchObject({ status: 'missing' });
    expect(resolve([
      ...extendedBase,
      layer('target', 'massabox', false), layer('target', 'espuma', false), ...targetLayers,
    ])).toMatchObject({ status: 'resolved', groupId: 'target' });
  });

  it('ignora nome idêntico quando a fonte ou a camada fixa é diferente', () => {
    const wrongSource = targetLayers.map((entry) => entry.is_color_source ? { ...entry, component_group_id: 'napa' } : entry);
    expect(resolve([...baseLayers, ...wrongSource])).toMatchObject({ status: 'missing' });
    const wrongFixed = targetLayers.map((entry) => entry.is_color_source ? entry : { ...entry, component_group_id: 'espuma', component_label: 'MASSA BOX' });
    expect(resolve([...baseLayers, ...wrongFixed])).toMatchObject({ status: 'missing' });
  });

  it('sugere nome pela ordem das camadas, usando UUID para obter rótulo ausente', () => {
    expect(resolve([
      layer('base', 'massabox', false, undefined, 2),
      layer('base', 'napa', true, 'rótulo antigo', 1),
      layer('base', 'espuma', false, 'ESPUMA 2 MM', 0),
    ])).toEqual({ status: 'missing', expectedGroupName: 'ESPUMA 2 MM + GLOW METALLIC + MASSA BOX', sourceGroupId: 'napa' });
  });

  it('usa fallback normalizado de rótulo e papel apenas nas camadas fixas sem UUID', () => {
    expect(resolve([
      layer('base', 'napa', true), layer('base', null, false, 'MASSA BÓX'),
      layer('target', 'glow', true), layer('target', null, false, ' massa   box '),
    ])).toMatchObject({ status: 'resolved' });
    expect(resolve([
      layer('base', 'napa', true), layer('base', null, false, 'MASSA BOX'),
      layer('target', 'glow', true), { ...layer('target', null, false, 'MASSA BOX'), role: 'outra função' },
    ])).toMatchObject({ status: 'missing' });
  });

  it('não inventa a identidade da fonte de cor a partir de rótulo', () => {
    expect(resolve([layer('base', null, true, 'NAPA SOFT'), baseLayers[1], ...targetLayers])).toEqual({
      status: 'invalid', reason: 'base_color_source_invalid',
    });
    expect(resolve([...baseLayers, layer('target', null, true, 'GLOW METALLIC'), targetLayers[1]])).toMatchObject({ status: 'missing' });
  });

  it('recusa base sem fonte ou com mais de uma camada marcada como fonte', () => {
    expect(resolve([baseLayers[1], ...targetLayers])).toMatchObject({ status: 'invalid', reason: 'base_color_source_invalid' });
    expect(resolve([...baseLayers, layer('base', 'napa', true), ...targetLayers])).toMatchObject({ status: 'invalid', reason: 'base_color_source_invalid' });
  });

  it('não deriva dublado sem nenhuma camada fixa, como exige o preparo no servidor', () => {
    expect(resolve([baseLayers[0], ...targetLayers])).toEqual({ status: 'invalid', reason: 'base_structure_missing' });
  });

  it('não escolhe silenciosamente entre dois dublados de composição equivalente', () => {
    expect(resolve([
      ...baseLayers, ...targetLayers,
      ...targetLayers.map((entry) => ({ ...entry, composite_group_id: 'duplicate' })),
    ], [{ id: 'duplicate', name: 'OUTRO NOME' }])).toEqual({
      status: 'ambiguous', expectedGroupName: 'GLOW METALLIC + MASSA BOX', sourceGroupId: 'napa',
      candidates: [
        { groupId: 'target', groupName: 'DUBLADO METÁLICO' },
        { groupId: 'duplicate', groupName: 'OUTRO NOME' },
      ],
    });
  });

  it('rejeita material principal composto, família ou container com filhos', () => {
    expect(resolve([...baseLayers, layer('glow', 'napa', true)])).toMatchObject({ status: 'invalid', reason: 'main_group_is_composite' });
    expect(resolveCompositeMaterialVariant({
      baseGroupId: 'base', mainGroupId: 'glow', layers: baseLayers,
      groups: groups.map((group) => group.id === 'glow' ? { ...group, is_family: true } : group),
    })).toMatchObject({ status: 'invalid', reason: 'main_group_is_container' });
    expect(resolve(baseLayers, [{ id: 'child', name: 'GLOW FILHO', parent_group_id: 'glow' }])).toMatchObject({ status: 'invalid', reason: 'main_group_is_container' });
  });

  it('ignora candidatos container e candidatos com fontes múltiplas', () => {
    expect(resolve([...baseLayers, ...targetLayers], [{ id: 'child', name: 'FILHO', parent_group_id: 'target' }])).toMatchObject({ status: 'missing' });
    expect(resolve([...baseLayers, ...targetLayers, layer('target', 'glow', true)])).toMatchObject({ status: 'missing' });
  });

  it('reutiliza a base quando o principal já é a fonte original', () => {
    expect(resolveCompositeMaterialVariant({
      baseGroupId: 'base', mainGroupId: 'napa', groups,
      layers: [...baseLayers, layer('target', 'napa', true), targetLayers[1]],
    })).toEqual({ status: 'resolved', groupId: 'base', groupName: 'NAPA SOFT + MASSA BOX', sourceGroupId: 'napa' });
  });

  it('não se aplica a base simples, base ausente ou seleção vazia', () => {
    expect(resolve([])).toEqual({ status: 'not_applicable' });
    expect(resolveCompositeMaterialVariant({ groups, layers: baseLayers, mainGroupId: 'glow' })).toEqual({ status: 'not_applicable' });
    expect(resolveCompositeMaterialVariant({ groups, layers: baseLayers, baseGroupId: 'base', mainGroupId: '' })).toEqual({ status: 'not_applicable' });
  });
});

describe('shouldVariantLiningFollowMainMaterial', () => {
  it('acompanha o principal só quando a forração é a única fonte de cor do cabedal', () => {
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'napa', layers: baseLayers })).toBe(true);
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'massabox', layers: baseLayers })).toBe(false);
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'glow', layers: baseLayers })).toBe(false);
  });

  it('mantém forração quando a relação não pode ser comprovada', () => {
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', layers: baseLayers })).toBe(false);
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'napa', layers: [] })).toBe(false);
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'napa', layers: [baseLayers[0]] })).toBe(false);
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'napa', layers: [...baseLayers, layer('base', 'napa', true)] })).toBe(false);
    expect(shouldVariantLiningFollowMainMaterial({ baseGroupId: 'base', liningGroupId: 'napa', layers: [layer('base', null, true, 'NAPA SOFT')] })).toBe(false);
  });
});
