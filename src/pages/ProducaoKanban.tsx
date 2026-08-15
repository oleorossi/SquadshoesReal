import { Navigate } from 'react-router-dom';

/**
 * Compatibilidade da antiga rota do Kanban.
 *
 * A área embutida foi desativada. O path continua existindo porque é a
 * identidade histórica das permissões granulares, mas toda navegação segue
 * para a Central de Produção em Modo Gestão.
 */
export default function ProducaoKanban() {
  return <Navigate to="/producao/kanban/gestao" replace />;
}
