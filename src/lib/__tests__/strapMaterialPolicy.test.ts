import { describe, expect, it } from 'vitest';
import {
  applyStrapMaterialPolicy,
  normalizeStrapMaterialPolicy,
  resolveStrapMaterialBaseGroupId,
  strapMaterialMode,
  validateStrapMaterialPolicy,
  type StrapMaterialPolicyLike,
} from '@/lib/strapMaterialPolicy';

const SOFT = '11111111-1111-4111-8111-111111111111';
const COMPOSITE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

describe('strapMaterialPolicy', () => {
  it.each([undefined, null])('somente modo ausente/null herda a referência (%s)', mode => {
    expect(strapMaterialMode({ material_mode: mode })).toBe('follow_reference');
    expect(normalizeStrapMaterialPolicy({ material_mode: mode })).toMatchObject({
      material_mode: 'follow_reference', material_group_id: null, allowed_material_group_ids: [],
    });
  });

  it.each(['', 'fixed', 'FIXED_GROUP', 'future_mode', 0, false])('bloqueia modo explícito inválido (%s) mesmo após normalizar', mode => {
    const line = { material_mode: mode } as unknown as StrapMaterialPolicyLike;
    expect(strapMaterialMode(line)).toBeNull();
    expect(validateStrapMaterialPolicy(normalizeStrapMaterialPolicy(line))).not.toEqual([]);
    expect(resolveStrapMaterialBaseGroupId(line, { referenceBaseGroupId: SOFT })).toBeNull();
  });

  it('não apaga política inválida de tira comprada pronta na hidratação', () => {
    const line = normalizeStrapMaterialPolicy({
      identity_basis: 'finished_product_group', identity_group_id: OTHER,
      material_mode: 'fixed_group', material_group_id: SOFT,
    });
    expect(validateStrapMaterialPolicy(line)).not.toEqual([]);
    expect(resolveStrapMaterialBaseGroupId(line)).toBeNull();
  });

  it('tira pronta mantém grupo acabado sem buscar napa-base', () => {
    expect(resolveStrapMaterialBaseGroupId({
      identity_basis: 'finished_product_group', identity_group_id: OTHER,
    }, { referenceBaseGroupId: SOFT })).toBe(OTHER);
  });

  it('material fixo vence referência e seleção do pedido sem decompor composto', () => {
    const line = {
      material_mode: 'fixed_group', material_group_id: COMPOSITE,
      base_group_name: 'NAPA SOFT + MASSABOX',
    };
    expect(resolveStrapMaterialBaseGroupId(line, {
      referenceBaseGroupId: SOFT, selectedBaseGroupId: OTHER,
    })).toBe(COMPOSITE);
    expect(normalizeStrapMaterialPolicy(line).base_group_name).toBe('NAPA SOFT + MASSABOX');
  });

  it('seleção precisa estar na lista exata, não cai na referência quando falta', () => {
    const line = { material_mode: 'select_on_order', allowed_material_group_ids: [SOFT, COMPOSITE] };
    expect(resolveStrapMaterialBaseGroupId(line, { referenceBaseGroupId: SOFT })).toBeNull();
    expect(resolveStrapMaterialBaseGroupId(line, { selectedBaseGroupId: COMPOSITE })).toBe(COMPOSITE);
    expect(resolveStrapMaterialBaseGroupId(line, { selectedBaseGroupId: OTHER })).toBeNull();
    expect(resolveStrapMaterialBaseGroupId({ ...line, base_group_id: SOFT })).toBe(SOFT);
  });

  it('segue referência fornecida; snapshot é fallback quando contexto não mudou', () => {
    expect(resolveStrapMaterialBaseGroupId({ base_group_id: SOFT })).toBe(SOFT);
    expect(resolveStrapMaterialBaseGroupId({ base_group_id: SOFT }, { referenceBaseGroupId: COMPOSITE })).toBe(COMPOSITE);
  });

  it.each([
    { material_mode: 'fixed_group' },
    { material_mode: 'fixed_group', material_group_id: 'NAPA SOFT' },
    { material_mode: 'select_on_order', allowed_material_group_ids: [] },
    { material_mode: 'select_on_order', allowed_material_group_ids: [SOFT, SOFT] },
    { material_mode: 'select_on_order', allowed_material_group_ids: ['NAPA SOFT'] },
    { material_mode: 'select_on_order', allowed_material_group_ids: SOFT },
    { material_mode: 'select_on_order', allowed_material_group_ids: [SOFT], material_group_id: SOFT },
    { material_mode: 'follow_reference', material_group_id: SOFT },
    { material_mode: 'fixed_group', material_group_id: SOFT, allowed_material_group_ids: [COMPOSITE] },
  ])('não resolve configuração estrutural inválida: %j', line => {
    const malformedLine = line as unknown as StrapMaterialPolicyLike;
    expect(validateStrapMaterialPolicy(malformedLine)).not.toEqual([]);
    expect(resolveStrapMaterialBaseGroupId(malformedLine, { referenceBaseGroupId: SOFT, selectedBaseGroupId: SOFT })).toBeNull();
  });

  it('catálogo ausente não bloqueia; catálogo carregado rejeita grupo inelegível', () => {
    const line = { material_mode: 'fixed_group', material_group_id: SOFT };
    expect(validateStrapMaterialPolicy(line)).toEqual([]);
    expect(validateStrapMaterialPolicy(line, new Set([COMPOSITE]))).not.toEqual([]);
    expect(validateStrapMaterialPolicy(line, new Set([SOFT]))).toEqual([]);
    expect(resolveStrapMaterialBaseGroupId(line, { eligibleGroupIds: new Set() })).toBeNull();
  });

  it('respeita o limite de 25 materiais sem truncar os valores recebidos', () => {
    const ids = Array.from({ length: 26 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    const line = { material_mode: 'select_on_order', allowed_material_group_ids: ids };
    expect(validateStrapMaterialPolicy({ ...line, allowed_material_group_ids: ids.slice(0, 25) })).toEqual([]);
    expect(validateStrapMaterialPolicy(line)).toEqual(['Selecione no máximo 25 materiais por posição.']);
    expect(normalizeStrapMaterialPolicy(line).allowed_material_group_ids).toHaveLength(26);
  });

  it('normaliza UUID sem alterar ordem nem perder duplicatas inválidas', () => {
    const lower = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const upper = lower.toUpperCase();
    expect(normalizeStrapMaterialPolicy({ material_mode: 'fixed_group', material_group_id: upper }).material_group_id).toBe(lower);
    const selected = { material_mode: 'select_on_order', allowed_material_group_ids: [SOFT, upper], base_group_id: upper };
    expect(normalizeStrapMaterialPolicy(selected).allowed_material_group_ids).toEqual([SOFT, lower]);
    expect(resolveStrapMaterialBaseGroupId(selected)).toBe(lower);
    expect(validateStrapMaterialPolicy({ ...selected, allowed_material_group_ids: [upper, lower] })).not.toEqual([]);
  });

  it('troca da política limpa somente seleção efetiva e preserva UUID/cor/consumo', () => {
    const source = Object.freeze({
      id: OTHER, color: 'PRETO', consumption: 42, consumption_per_size: { '34': 40, '35': 44 },
      material_mode: 'fixed_group', material_group_id: SOFT, base_group_id: SOFT, base_group_name: 'NAPA SOFT',
    });
    const allowed = Object.freeze([SOFT, COMPOSITE]);
    const next = applyStrapMaterialPolicy(source, 'select_on_order', null, allowed);
    expect(next).toMatchObject({
      id: OTHER, color: 'PRETO', consumption: 42, consumption_per_size: source.consumption_per_size,
      material_mode: 'select_on_order', material_group_id: null, allowed_material_group_ids: allowed,
      base_group_id: null, base_group_name: null,
    });
    expect(next.allowed_material_group_ids).not.toBe(allowed);
    expect(source.base_group_id).toBe(SOFT);
  });
});
