import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { House as Home } from '@phosphor-icons/react';
import { grantableDestinations } from '@/data/navigation';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

type BreadcrumbCrumb = { label: string; to?: string };

const navigationDestinations = grantableDestinations;

const destinationByPath = new Map(
  navigationDestinations.map((destination) => [destination.path, destination]),
);

const firstDestinationByGroup = new Map<string, typeof navigationDestinations[number]>();
for (const destination of navigationDestinations) {
  if (!firstDestinationByGroup.has(destination.group)) {
    firstDestinationByGroup.set(destination.group, destination);
  }
}

const segmentLabels: Record<string, string> = {
  new: 'Novo',
  edit: 'Editar',
  summary: 'Resumo',
  consumo: 'Consumo',
  'grouped-summary': 'Resumo Agrupado',
};

// `view` é estado interno de /producao/analises, não um destino navegável; por
// isso seus rótulos ficam aqui, em vez de criar entradas artificiais no catálogo.
const analysisViewLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  gargalos: 'Gargalos',
  'lead-time': 'Lead Time',
  'tempos-padrao': 'Tempos-Padrão por Setor',
  rccp: 'RCCP',
  'pos-op': 'Pós-OP',
  auditoria: 'Auditoria',
  qualidade: 'Qualidade',
  oee: 'Paradas & OEE',
  cronoanalise: 'Cronoanálise',
  setup: 'Tempos de Setup',
  matriz: 'Matriz (legado)',
  timeline: 'Timeline (legado)',
  lote: 'Visão Lote (legado)',
  'lot-split': 'Split de Lotes',
  'centro-controle': 'Centro de Controle',
};

const UUID_SEGMENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function slugToLabel(segment: string): string {
  const decoded = decodeURIComponent(segment).replace(/-/g, ' ');
  return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}

function labelsMatch(left: string, right: string) {
  const normalize = (label: string) => label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

  return normalize(left) === normalize(right);
}

function findDestination(pathname: string) {
  return navigationDestinations
    .filter((destination) => pathname === destination.path || pathname.startsWith(`${destination.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0];
}

function labelForPath(pathname: string, segment: string) {
  if (UUID_SEGMENT_RE.test(segment)) return 'Detalhe';
  return destinationByPath.get(pathname)?.label
    ?? segmentLabels[segment]
    ?? slugToLabel(segment);
}

/**
 * Rótulo da tela atual pra o chrome mobile (top bar). Prefere o catálogo de
 * navegação; em rotas de detalhe com UUID cai em "Detalhe" em vez do hash.
 */
export function resolveMobileNavMeta(pathname: string, search = ''): { label: string; group?: string } {
  if (pathname === '/' || pathname === '/dashboard') {
    return { label: 'Painel', group: 'Início' };
  }

  const destination = findDestination(pathname);
  if (pathname === '/producao/analises') {
    const view = new URLSearchParams(search).get('view') || '';
    const viewLabel = analysisViewLabels[view];
    if (viewLabel) {
      return { label: viewLabel, group: destination?.group ?? 'Produção' };
    }
  }

  if (destination) {
    return { label: destination.label, group: destination.group };
  }

  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  return { label: labelForPath(pathname, last) };
}

export default function PageHeader({ title, compact }: { title?: string; subtitle?: string; compact?: boolean }) {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'dashboard')) {
    return null;
  }

  const destination = findDestination(location.pathname);
  const firstSegmentDestination = destinationByPath.get(`/${segments[0]}`);
  const group = destination?.group;
  const groupDestination = group ? firstDestinationByGroup.get(group) : undefined;
  const showGroup = Boolean(
    group
    && group !== 'Início'
    && (!firstSegmentDestination || !labelsMatch(firstSegmentDestination.label, group)),
  );
  const skipFirstSegment = showGroup && Boolean(group && labelsMatch(slugToLabel(segments[0]), group));

  const crumbs: BreadcrumbCrumb[] = [];

  if (showGroup && group && groupDestination) {
    crumbs.push({ label: group, to: groupDestination.path });
  }

  let pathAccum = '';
  segments.forEach((segment, index) => {
    pathAccum += `/${segment}`;
    if (index === 0 && skipFirstSegment) return;

    // UUID no meio da trilha (ex.: /orders/:id/edit) some quando o próximo
    // segmento já rotula a ação — evita "… › Detalhe › Editar".
    if (UUID_SEGMENT_RE.test(segment)) {
      const next = segments[index + 1];
      if (next && segmentLabels[next]) return;
    }

    const isLast = index === segments.length - 1;
    crumbs.push({
      label: labelForPath(pathAccum, segment),
      // Prefixos que não estão no catálogo podem ser aliases; nunca os tornamos links.
      to: isLast || !destinationByPath.has(pathAccum) ? undefined : pathAccum,
    });
  });

  const viewLabel = location.pathname === '/producao/analises'
    ? analysisViewLabels[new URLSearchParams(location.search).get('view') || '']
    : undefined;
  if (viewLabel && crumbs.length > 0) {
    // A página de análises continua sendo um destino real; só a visão é estado da URL.
    crumbs[crumbs.length - 1].to = location.pathname;
    crumbs.push({ label: viewLabel });
  }

  return (
    <Breadcrumb className={compact ? undefined : 'mb-4 animate-in fade-in slide-in-from-left-2 duration-300'}>
      <BreadcrumbList className={compact ? 'gap-1.5 ed-eyebrow text-muted-foreground' : 'gap-1.5 text-xs sm:gap-1.5'}>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/dashboard" aria-label="Painel" className="flex items-center gap-1">
              <Home className="h-3.5 w-3.5" />
            </Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {crumb.to ? (
                <BreadcrumbLink asChild>
                  <Link to={crumb.to}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{title || crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
