import { getAllMenuItems } from '@/data/navigation';
import { ROLE_MODULES, resolveModuleForPath } from '@/hooks/useAccessControl';

/** Conjunto de ações concedidas a uma tela pelo template. */
export interface TemplateActions {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface PermissionTemplate {
  key: string;
  label: string;
  description: string;
  /** Ações padrão aplicadas às telas do template. */
  actions: TemplateActions;
  /** Paths das telas incluídas no template. */
  paths: string[];
}

const FULL: TemplateActions = { view: true, create: true, edit: true, delete: true };
const READ_ONLY: TemplateActions = { view: true, create: false, edit: false, delete: false };

// Metadados dos modelos, espelhando os perfis (roles) — menos 'admin', que é
// irrestrito e não usa allow-list. As ações padrão refletem a natureza do
// perfil: operacionais recebem CRUD total nas suas telas; 'consulta' é leitura.
const TEMPLATE_META: Array<{ role: string; label: string; description: string; actions: TemplateActions }> = [
  { role: 'gerente',      label: 'Gerente',        description: 'Gestão geral com CRUD nas áreas de negócio', actions: FULL },
  { role: 'producao',     label: 'Produção',       description: 'Chão de fábrica — OPs, estoque, expedição',  actions: FULL },
  { role: 'almoxarifado', label: 'Almoxarifado',   description: 'Estoque e movimentações',                    actions: FULL },
  { role: 'comercial',    label: 'Comercial',      description: 'Vendas, clientes e relatórios',              actions: FULL },
  { role: 'nfe_operator', label: 'Operador NF-e',  description: 'Emite NF-e + cadastros de PV/cliente',       actions: FULL },
  { role: 'rh',           label: 'RH',             description: 'Funcionários, ponto, banco de horas',        actions: FULL },
  { role: 'consulta',     label: 'Consulta',       description: 'Acesso amplo — somente leitura',             actions: READ_ONLY },
];

/**
 * Constrói os modelos de permissão a partir do mapa role→módulos e dos itens
 * de menu reais. Cada modelo lista as telas cujo módulo pertence ao perfil —
 * dando ao admin um ponto de partida coerente que ele ajusta antes de salvar.
 *
 * Fonte única: `ROLE_MODULES` (o mesmo mapa que o RBAC legado usa), então os
 * modelos não divergem do que cada perfil já enxergava por role.
 */
export function buildPermissionTemplates(): PermissionTemplate[] {
  const items = getAllMenuItems();
  return TEMPLATE_META.map(({ role, label, description, actions }) => {
    const mods = new Set(ROLE_MODULES[role] ?? []);
    const paths = items
      .filter((it) => {
        const mod = resolveModuleForPath(it.path);
        return mod ? mods.has(mod) : false;
      })
      .map((it) => it.path);
    return { key: role, label, description, actions, paths };
  });
}
