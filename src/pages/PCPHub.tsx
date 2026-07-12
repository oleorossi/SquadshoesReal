import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * REDIRECT LEGADO (remodelagem 2026-07-12, specs/remodelagem-producao.md R7.3).
 *
 * O hub PCP de 14 abas foi substituído por itens diretos no menu Produção:
 * Planejamento, Kanban, Estouro de Produção, Setores, Apontamento, Imprimir
 * Fichas e Análises. Este componente só traduz as URLs antigas (/pcp?tab=…)
 * pras telas novas — nenhum link antigo pode dar 404.
 */
const LEGACY_SECTOR_TABS = new Set([
  'corte', 'forracao', 'costura', 'aviamento', 'silk',
  'colagem', 'montagem', 'solagem', 'acabamento', 'expedicao',
]);

export default function PCPHub() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get('tab') || '';
  const modo = searchParams.get('modo') || '';
  const sub = searchParams.get('sub') || '';

  let to = '/producao/planejamento';

  if (LEGACY_SECTOR_TABS.has(tab)) {
    to = `/producao/apontamento?sub=${tab}`;
  } else {
    switch (tab) {
      case 'ondas':
      case 'planejamento':
      case 'cronograma':
        to = '/producao/planejamento';
        break;
      case 'quadro':
        // 'cartoes' (Live) virou o Kanban; matriz/timeline/lote são views legadas
        to = modo && modo !== 'cartoes'
          ? `/producao/analises?view=${modo}`
          : '/producao/kanban';
        break;
      case 'setores':
        to = sub ? `/producao/apontamento?sub=${sub}` : '/producao/apontamento';
        break;
      case 'gargalos':
      case 'gargalo-diario':
      case 'gargalo-semanal':
        to = '/producao/analises?view=gargalos';
        break;
      case 'dashboard':   to = '/producao/analises?view=dashboard'; break;
      case 'lead-time':   to = '/producao/analises?view=lead-time'; break;
      case 'capacidade':  to = '/producao/analises?view=capacidade'; break;
      case 'auditoria':   to = '/producao/analises?view=auditoria'; break;
      case 'rccp':        to = '/producao/analises?view=rccp'; break;
      case 'pos-op':      to = '/producao/analises?view=pos-op'; break;
      case 'lot-split':   to = '/producao/analises?view=lot-split'; break;
      case 'picking':     to = '/picking'; break;
      default:            to = '/producao/planejamento';
    }
  }

  return <Navigate to={to} replace />;
}
