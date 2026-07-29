import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import ProducaoKanbanGestao from './ProducaoKanbanGestao';

/**
 * KANBAN (rota do menu) — moldura fina do MESMO quadro da Central de Produção.
 *
 * ⚠ Esta tela já teve implementação PRÓPRIA (187 linhas) e virou uma cópia
 * pobre: sem rolagem por coluna (as 69 OPs de Corte Palmilha esticavam a página
 * sem fim), sem WIP/gargalo, sem gate de material, sem ordenar atrasadas
 * primeiro, sem realce de destino no arraste, sem mover em lote e sem QR. Dois
 * componentes pro mesmo quadro significavam que quem operava pelo menu decidia
 * com menos informação que quem abria o "Modo Gestão" — mesmo motor, mesma RPC.
 *
 * Não recriar o componente separado: o quadro mora em `ProducaoKanbanGestao` e
 * o que muda aqui é só a moldura (`embedded`).
 */
export default function ProducaoKanban() {
  return (
    <div className="space-y-4 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · KANBAN"
        title="Kanban"
        description="Arraste o card pro próximo setor e preencha a quantidade — o apontamento é real e alimenta o mesmo motor de todas as telas."
      />
      <ProducaoKanbanGestao embedded />
    </div>
  );
}
