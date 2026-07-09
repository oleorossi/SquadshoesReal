import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import GroupOrganizationPanel from '@/components/groups/GroupOrganizationPanel';

/**
 * Página Grupos (/grupos) — árvore Setor → Família → Grupo. Mesmo painel usado
 * pela aba Materiais do Estoque (GroupOrganizationPanel), então as duas telas
 * ficam idênticas e sem lógica duplicada. Ver specs/grupos-estoque.md.
 */
export default function Groups() {
  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ESTOQUE · GRUPOS"
        title="Grupos de Estoque"
        description="Organize o estoque em Setor → Família → Grupo, com saldo, valor e reservas por nível"
      />
      <GroupOrganizationPanel permPath="/grupos" />
    </div>
  );
}
