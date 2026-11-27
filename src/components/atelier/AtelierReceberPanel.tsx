/**
 * Aba Receber: jobs do Ateliê com saldo na rua, para lançar parcial ou confirmar o retorno.
 */
import { useMemo, useState } from 'react';
import { CheckCircle, Warehouse } from '@phosphor-icons/react';
import { AtelierReceiptDialog } from '@/components/atelier/AtelierReceiptDialog';
import { AtelierReceiptMeter } from '@/components/atelier/AtelierReceiptMeter';
import { Button } from '@/components/ui/button';
import { ATELIER_SECTOR_LABEL, type AtelierSector } from '@/lib/atelier';
import { atelierCanRecordReceipt, atelierReceiptRemaining } from '@/lib/atelierReceipt';
import {
  useAtelierLots,
  type AtelierLotJob,
  type AtelierLotRow,
} from '@/hooks/useAtelier';

export function AtelierReceberPanel() {
  const { data: lots = [], isLoading, isError } = useAtelierLots();
  const [receipt, setReceipt] = useState<{ job: AtelierLotJob; intent: 'partial' | 'total' } | null>(null);

  const rows = useMemo(() => {
    const list: { lot: AtelierLotRow; job: AtelierLotJob; remaining: number }[] = [];
    for (const lot of lots) {
      for (const job of lot.jobs ?? []) {
        if (!atelierCanRecordReceipt(job)) continue;
        list.push({
          lot,
          job,
          remaining: atelierReceiptRemaining(Number(job.pairs) || 0, Number(job.received_pairs) || 0),
        });
      }
    }
    return list.sort((a, b) => (a.job.order_number ?? '').localeCompare(b.job.order_number ?? '', 'pt-BR'));
  }, [lots]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando os cabedais na rua…</p>;
  if (isError) return <p className="text-sm text-destructive">Não foi possível ler os recebimentos do Ateliê.</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum cabedal do Ateliê está na rua aguardando conferência. Se o lote ainda está em Cortado, registre o envio na aba Corte (com ressalva, se o kit estiver pendente) e volte aqui.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {rows.length} {rows.length === 1 ? 'job' : 'jobs'} com saldo a receber. Informe a quantidade parcial ou confirme o retorno total do cabedal.
      </p>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ lot, job, remaining }) => {
          const sector = ATELIER_SECTOR_LABEL[job.sector as AtelierSector] ?? job.sector;
          return (
            <li key={job.id} className="space-y-2 rounded-lg border border-border bg-card p-3">
              <p className="truncate text-sm font-semibold text-foreground">
                {job.order_number} · {lot.reference_code ?? '—'} {lot.color ?? ''}
              </p>
              <p className="text-xs text-muted-foreground">
                {sector}
                {job.atelier_service_number ? ` · OS ${job.atelier_service_number}` : ''}
                {job.contractor_name ? ` · ${job.contractor_name}` : ''}
              </p>
              <AtelierReceiptMeter
                received={Number(job.received_pairs) || 0}
                pairs={Number(job.pairs) || 0}
                label="recebidos"
              />
              <p className="text-xs text-foreground">Saldo a receber: {remaining} pares.</p>
              <div className="flex flex-wrap justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => setReceipt({ job, intent: 'partial' })}
                >
                  <Warehouse className="h-3 w-3" />
                  Recebimento parcial
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setReceipt({ job, intent: 'total' })}
                >
                  <CheckCircle className="h-3 w-3" />
                  Confirmar retorno total
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <AtelierReceiptDialog
        job={receipt?.job ?? null}
        intent={receipt?.intent}
        onClose={() => setReceipt(null)}
      />
    </div>
  );
}
