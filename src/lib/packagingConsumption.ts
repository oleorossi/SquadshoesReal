import { gradeTotal, packSaleOrderItem, type GradeInput } from '@/lib/boxPacking';

export type PackagingMode =
  | 'colmeia'
  | 'individual'
  | 'individual_master'
  | 'individual_fitilho'
  | 'individual_amarrado';

export type PackagingType = 'individual' | 'master' | 'colmeia' | 'fitilho';

export interface PackagingSoleGroup {
  id?: string | null;
  box_type_id?: string | null;
  box_type_master_id?: string | null;
  box_type_colmeia_id?: string | null;
  box_type_fitilho_id?: string | null;
  pairs_per_box_individual?: number | null;
  pairs_per_box_master?: number | null;
  pairs_per_box_colmeia?: number | null;
  pairs_per_box_fitilho?: number | null;
}

export interface PackagingBoxType {
  id: string;
  nome: string;
  tipo: PackagingType | string | null;
  quantity?: number | null;
  unit_price?: number | null;
  supplier_id?: string | null;
  active?: boolean | null;
  pairs_per_box_default?: number | null;
  metros_per_amarrado_default?: number | null;
}

export interface CanonicalPackagingLine {
  boxTypeId: string | null;
  packagingType: PackagingType | 'unresolved';
  name: string;
  unit: 'un' | 'm';
  required: number;
  available: number;
  unitPrice: number;
  supplierId: string | null;
  warning?: string;
}

const VALID_MODES = new Set<PackagingMode>([
  'colmeia',
  'individual',
  'individual_master',
  'individual_fitilho',
  'individual_amarrado',
]);

export function packagingTypesForMode(mode: string | null | undefined): PackagingType[] | null {
  if (!mode || !VALID_MODES.has(mode as PackagingMode)) return null;
  if (mode === 'colmeia') return ['colmeia'];
  if (mode === 'individual_master') return ['individual', 'master'];
  if (mode === 'individual_fitilho' || mode === 'individual_amarrado') {
    return ['individual', 'fitilho'];
  }
  return ['individual'];
}

const slotForType = (group: PackagingSoleGroup, type: PackagingType): string | null => {
  if (type === 'individual') return group.box_type_id || null;
  if (type === 'master') return group.box_type_master_id || null;
  if (type === 'colmeia') return group.box_type_colmeia_id || null;
  return group.box_type_fitilho_id || null;
};

const groupCapacityForType = (group: PackagingSoleGroup, type: PackagingType): number => {
  const raw = type === 'individual'
    ? group.pairs_per_box_individual
    : type === 'master'
      ? group.pairs_per_box_master
      : type === 'colmeia'
        ? group.pairs_per_box_colmeia
        : group.pairs_per_box_fitilho;
  return Number(raw) || 0;
};

/**
 * Espelho TS de `calculate_packaging_consumption`/`plan_packaging_for_order`.
 * A identidade vem exclusivamente dos UUIDs dos slots do grupo de solado.
 * Nome de produto/caixa nunca participa da seleção.
 */
export function resolveCanonicalPackaging(params: {
  mode: string | null | undefined;
  quantity: number;
  grade?: GradeInput;
  soleGroup?: PackagingSoleGroup | null;
  boxTypes: PackagingBoxType[];
}): CanonicalPackagingLine[] {
  const types = packagingTypesForMode(params.mode);
  if (!types) {
    return [{
      boxTypeId: null,
      packagingType: 'unresolved',
      name: 'Embalagem não resolvida',
      unit: 'un',
      required: 0,
      available: 0,
      unitPrice: 0,
      supplierId: null,
      warning: 'Modo de embalagem ausente ou inválido; nenhuma caixa foi escolhida.',
    }];
  }

  if (!params.soleGroup) {
    return [{
      boxTypeId: null,
      packagingType: 'unresolved',
      name: 'Embalagem não resolvida',
      unit: 'un',
      required: 0,
      available: 0,
      unitPrice: 0,
      supplierId: null,
      warning: 'Ficha sem grupo de solado; embalagem não configurada.',
    }];
  }

  const boxById = new Map(params.boxTypes.map((box) => [box.id, box]));
  const quantity = Math.max(0, Number(params.quantity) || 0);
  const oneSheetPairs = gradeTotal(params.grade);
  // O helper SQL não recebe `fichas`: relatório, custo, MRP, compra e débito
  // derivam a quantidade de fichas de quantity/grade. A mesma derivação aqui
  // impede que estado stale do cliente altere somente o relatório TS.
  const sheets = oneSheetPairs > 0 ? Math.ceil(quantity / oneSheetPairs) : 0;

  return types.map((type): CanonicalPackagingLine => {
    const boxTypeId = slotForType(params.soleGroup!, type);
    const unit = type === 'fitilho' ? 'm' : 'un';
    if (!boxTypeId) {
      return {
        boxTypeId: null,
        packagingType: type,
        name: 'Embalagem não resolvida',
        unit,
        required: 0,
        available: 0,
        unitPrice: 0,
        supplierId: null,
        warning: `Slot de embalagem ${type} não configurado no grupo de solado.`,
      };
    }

    const box = boxById.get(boxTypeId);
    if (!box || box.active === false) {
      return {
        boxTypeId,
        packagingType: type,
        name: box?.nome || 'Embalagem não resolvida',
        unit,
        required: 0,
        available: 0,
        unitPrice: Number(box?.unit_price) || 0,
        supplierId: box?.supplier_id || null,
        warning: `box_type do slot ${type} está ausente ou inativo.`,
      };
    }

    if (box.tipo !== type) {
      return {
        boxTypeId,
        packagingType: type,
        name: box.nome,
        unit,
        required: 0,
        available: Math.max(0, Number(box.quantity) || 0),
        unitPrice: Number(box.unit_price) || 0,
        supplierId: box.supplier_id || null,
        warning: `box_type do slot ${type} possui tipo incompatível (${box.tipo || 'nulo'}).`,
      };
    }

    const capacity = Math.max(
      1,
      groupCapacityForType(params.soleGroup!, type)
        || Number(box.pairs_per_box_default)
        || 12,
    );
    const packed = type !== 'fitilho' && capacity > 1 && sheets > 0
      ? packSaleOrderItem({ grade: params.grade, fichas: sheets, capacity })
      : [];
    let required = packed.length > 0 ? packed.length : Math.ceil(quantity / capacity);
    if (type === 'fitilho') {
      required *= Number(box.metros_per_amarrado_default) || 1;
    }

    return {
      boxTypeId,
      packagingType: type,
      name: box.nome,
      unit,
      required,
      available: Math.max(0, Number(box.quantity) || 0),
      unitPrice: Number(box.unit_price) || 0,
      supplierId: box.supplier_id || null,
    };
  });
}
