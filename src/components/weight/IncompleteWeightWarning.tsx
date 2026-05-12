import { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { IncompleteWeightItem } from '@/hooks/useSaleOrderWeight';

interface Props {
  items: IncompleteWeightItem[];
  /** Texto opcional pra contextualizar a origem (ex: "neste PV", "nesta rota"). */
  scope?: string;
  /** Quando true, esconde detalhes e mostra só o chip compacto. */
  compact?: boolean;
}

/**
 * Chip âmbar reutilizável: "Peso incompleto: N fichas sem cadastro" com
 * lista expansível das fichas e link pra editar a ficha técnica.
 *
 * Usado em /manifests, /mdfe, /entregas e qualquer lugar que consuma a
 * RPC calculate_sale_order_weight quando is_complete=false.
 */
export function IncompleteWeightWarning({ items, scope, compact = false }: Props) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  const totalPairs = items.reduce((sum, i) => sum + (i.pairs || 0), 0);

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
        <AlertTriangle className="h-3 w-3" />
        Peso incompleto ({items.length})
      </span>
    );
  }

  return (
    <div className="rounded-md border border-amber-300 bg-amber-500/10 dark:border-amber-800 dark:bg-amber-500/5 px-3 py-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 w-full text-left text-amber-700 dark:text-amber-400"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="text-xs font-bold">
          Peso incompleto: {items.length} ficha{items.length > 1 ? 's' : ''} sem cadastro
          {scope ? ` ${scope}` : ''}
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {totalPairs} par{totalPairs > 1 ? 'es' : ''} afetado{totalPairs > 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 pl-6">
          {items.map((it) => (
            <li key={it.reference_id} className="text-xs flex items-center gap-2">
              <span className="font-mono text-muted-foreground">{it.code || '—'}</span>
              <span className="truncate flex-1">{it.name || 'Sem nome'}</span>
              <span className="font-mono text-muted-foreground">{it.pairs} prs</span>
              <Link
                to={`/fichas-tecnicas?ref=${it.reference_id}`}
                className="text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 inline-flex items-center gap-0.5"
                title="Editar ficha técnica"
              >
                <ExternalLink className="h-3 w-3" />
                editar
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
