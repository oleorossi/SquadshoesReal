import { useState } from 'react';
import { Warning as AlertTriangle, CaretDown as ChevronDown, CaretRight as ChevronRight, ArrowSquareOut as ExternalLink } from '@phosphor-icons/react';
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
  const estimatedItems = items.filter(i => (i.estimated_kg_per_pair ?? 0) > 0);
  const missingItems = items.filter(i => !(i.estimated_kg_per_pair && i.estimated_kg_per_pair > 0));
  const allEstimated = estimatedItems.length === items.length;

  // Quando TODOS os itens incompletos têm estimativa via solado: tom verde
  // claro (peso confiável, só falta cadastrar pra ficar 100%). Caso contrário,
  // mantém o âmbar tradicional (alguns itens nem estimativa têm).
  const tone = allEstimated ? 'emerald' : 'amber';

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
        tone === 'emerald'
          ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10'
          : 'text-amber-700 dark:text-amber-400 bg-amber-500/10'
      }`}>
        <AlertTriangle className="h-3 w-3" />
        {allEstimated
          ? `Peso estimado (${items.length})`
          : `Peso incompleto (${items.length})`}
      </span>
    );
  }

  return (
    <div className={`rounded-md border px-3 py-2 ${
      tone === 'emerald'
        ? 'border-emerald-300 bg-emerald-500/10 dark:border-emerald-800 dark:bg-emerald-500/5'
        : 'border-amber-300 bg-amber-500/10 dark:border-amber-800 dark:bg-amber-500/5'
    }`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 w-full text-left ${
          tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
        }`}
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="text-xs font-bold">
          {allEstimated
            ? `Peso estimado pelo solado: ${items.length} ficha${items.length > 1 ? 's' : ''}`
            : `Peso incompleto: ${items.length} ficha${items.length > 1 ? 's' : ''}${estimatedItems.length > 0 ? ` (${estimatedItems.length} estimadas)` : ' sem cadastro'}`}
          {scope ? ` ${scope}` : ''}
        </span>
        <span className="text-xs text-muted-foreground ml-auto">
          {totalPairs} par{totalPairs > 1 ? 'es' : ''} afetado{totalPairs > 1 ? 's' : ''}
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 pl-6">
          {items.map((it) => {
            const est = it.estimated_kg_per_pair ?? 0;
            const hasEstimate = est > 0;
            return (
              <li key={it.reference_id} className="text-xs flex items-center gap-2">
                <span className="font-mono text-muted-foreground">{it.code || '—'}</span>
                <span className="truncate flex-1">{it.name || 'Sem nome'}</span>
                <span className="font-mono text-muted-foreground">{it.pairs} prs</span>
                {hasEstimate ? (
                  <span
                    className="font-mono text-xs px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    title={`Média de fichas com mesmo solado: ${est.toFixed(3)} kg/par`}
                  >
                    ~{est.toFixed(3)} kg/par
                  </span>
                ) : (
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    sem estimativa
                  </span>
                )}
                <Link
                  to={`/fichas-tecnicas?ref=${it.reference_id}`}
                  className={`inline-flex items-center gap-0.5 ${
                    tone === 'emerald'
                      ? 'text-emerald-700 hover:text-emerald-900 dark:text-emerald-400 dark:hover:text-emerald-200'
                      : 'text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200'
                  }`}
                  title="Editar ficha técnica"
                >
                  <ExternalLink className="h-3 w-3" />
                  editar
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {/* Footnote explicando a estimativa quando houver pelo menos uma */}
      {estimatedItems.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2 pl-6">
          Peso estimado = média de outras fichas com o mesmo solado. Cadastre <code>weight_per_pair_kg</code> nas fichas pra peso real.
        </p>
      )}
    </div>
  );
}
