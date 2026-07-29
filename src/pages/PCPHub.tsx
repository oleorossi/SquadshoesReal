import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * REDIRECT LEGADO (remodelagem 2026-07-12, specs/remodelagem-producao.md R7.3).
 *
 * O hub PCP de 14 abas foi substituído por itens diretos no menu Produção:
 * Planejamento, Kanban, Estouro de Produção, Setores, Apontamento, Imprimir
 * Fichas e Análises. Este componente só traduz bookmarks /pcp?tab=… até
 * 12/01/2027; deve sair quando a rota completar 90 dias sem acesso.
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
      case 'capacidade':  to = '/producao/analises?view=tempos-padrao'; break;
      case 'tempos-padrao': to = '/producao/analises?view=tempos-padrao'; break;
      case 'auditoria':   to = '/producao/analises?view=auditoria'; break;
      case 'rccp':        to = '/producao/analises?view=rccp'; break;
      case 'pos-op':      to = '/producao/analises?view=pos-op'; break;
      case 'lot-split':   to = '/producao/analises?view=lot-split'; break;
      case 'picking':     to = '/picking'; break;
      default:            to = '/producao/planejamento';
    }
  }

  const [pathname, targetQuery = ''] = to.split('?');
  const targetParams = new URLSearchParams(targetQuery);

  // O bookmark pode carregar seleção/filtro além da aba antiga. Mantemos o que
  // não foi fixado pelo destino para não trocar o setor que o operador abriu.
  searchParams.forEach((value, key) => {
    if (!targetParams.has(key)) targetParams.append(key, value);
  });

  const search = targetParams.toString();
  return <Navigate to={`${pathname}${search ? `?${search}` : ''}`} replace />;
}
