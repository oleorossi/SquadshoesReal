import { Link } from 'react-router-dom';
import { Scissors } from '@phosphor-icons/react';
import { ATELIER_PIPELINE_LABEL, ATELIER_SECTOR_LABEL, type AtelierSector } from '@/lib/atelier';
import { useAtelierPrepConsumption } from '@/hooks/useAtelier';
import { formatNumber } from '@/lib/utils';

interface Props {
  saleOrderIds: string[];
}

/**
 * Bloco separado no Consumo do PV: materiais já debitados na prep Ateliê.
 * Só aparece após confirmação de débito (não na soft).
 */
export default function AtelierPrepConsumptionSection({ saleOrderIds }: Props) {
  const { data: rows = [], isLoading, isError } = useAtelierPrepConsumption(saleOrderIds);

  if (isLoading || isError || rows.length === 0) return null;

  return (
    <section className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Scissors className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">Preparação de cabedal (rua)</h3>
            <p className="text-xs text-muted-foreground">
              Já debitado no Ateliê — não entra de novo no consumo da produção.
            </p>
          </div>
        </div>
        <Link
          to="/atelie?view=fila"
          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
        >
          Abrir Ateliê
        </Link>
      </header>

      <ul className="divide-y divide-border/50 rounded-md border border-border/50 bg-card">
        {rows.map((row) => {
          const job = row.cabedal_prep_jobs;
          const sector = (job?.sector || row.sector || 'corte_cabedal') as AtelierSector;
          const status = job?.pipeline_status ?? 'debited';
          return (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">
                  {row.products?.name ?? row.product_id}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {ATELIER_SECTOR_LABEL[sector] ?? sector}
                  {job?.reference_code ? ` · ${job.reference_code}` : ''}
                  {job?.color ? ` · ${job.color}` : ''}
                  {job?.atelier_service_number ? ` · ${job.atelier_service_number}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-mono text-sm">
                  {formatNumber(Number(row.quantity))}
                  {row.products?.unit ? ` ${row.products.unit}` : ''}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {ATELIER_PIPELINE_LABEL[status] ?? status}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
