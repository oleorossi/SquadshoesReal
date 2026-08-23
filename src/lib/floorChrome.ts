/**
 * Chrome de chão de fábrica (Onda 1).
 *
 * Admin/gerente continuam no BottomNav de ERP. Quem aponta ou separa
 * material vê atalhos de operação, não Painel/Vendas.
 *
 * A prioridade de papel é a MESMA de `resolveRoleHome` — múltiplos papéis
 * vencem pelo de maior alcance.
 */

export interface FloorNavItem {
  key: 'apontar' | 'kanban' | 'estoque' | 'separar' | 'conferencia';
  label: string;
  path: string;
}

const PRIORIDADE = [
  'admin',
  'gerente',
  'consulta',
  'producao',
  'comercial',
  'nfe_operator',
  'almoxarifado',
  'rh',
] as const;

export function dominantRole(roles: readonly string[]): string | undefined {
  return PRIORIDADE.find((r) => roles.includes(r));
}

/** Apontador ou almoxarife, sem ser admin/gerente/consulta. */
export function isFloorOperator(roles: readonly string[]): boolean {
  const papel = dominantRole(roles);
  return papel === 'producao' || papel === 'almoxarifado';
}

export function floorPrimaryItems(roles: readonly string[]): FloorNavItem[] | null {
  const papel = dominantRole(roles);
  if (papel === 'producao') {
    return [
      { key: 'apontar', label: 'Apontar', path: '/producao/apontamento' },
      { key: 'kanban', label: 'Kanban', path: '/producao/kanban' },
      { key: 'estoque', label: 'Estoque', path: '/estoque' },
      { key: 'separar', label: 'Separar', path: '/picking' },
    ];
  }
  if (papel === 'almoxarifado') {
    return [
      { key: 'estoque', label: 'Estoque', path: '/estoque' },
      { key: 'separar', label: 'Separar', path: '/picking' },
      { key: 'conferencia', label: 'Saída', path: '/conferencia-saida' },
      { key: 'kanban', label: 'Kanban', path: '/producao/kanban' },
    ];
  }
  return null;
}

/** Colunas essenciais de estoque no phone/tablet — o resto vai em "Mais colunas". */
export const TABLET_INVENTORY_COLUMNS = ['quantity', 'status', 'actions'] as const;
