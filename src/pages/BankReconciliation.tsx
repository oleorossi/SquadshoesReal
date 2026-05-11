import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Scale } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  em_andamento: 'bg-blue-100 text-blue-700',
  conciliada: 'bg-emerald-100 text-emerald-700',
  divergencia: 'bg-amber-100 text-amber-700',
  cancelada: 'bg-muted text-muted-foreground',
};

export default function BankReconciliation() {
  return (
    <DataListPage
      title="Conciliação Bancária"
      subtitle="Importação de extratos + match automático com AR/AP"
      icon={Scale}
      table="bank_reconciliations"
      orderBy="reconciliation_date"
      emptyText="Nenhuma conciliação registrada"
      newButtonLabel="Nova Conciliação"
      newButtonOnClick={() => toast.info('Importe extrato bancário OFX/CSV pra iniciar conciliação')}
      columns={[
        { key: 'reconciliation_date', label: 'Data', render: r => format(new Date(r.reconciliation_date), 'dd/MM/yy') },
        { key: 'total_credits', label: 'Créditos', align: 'right', render: r => <span className="text-emerald-600 font-mono text-xs">R$ {Number(r.total_credits).toFixed(2)}</span> },
        { key: 'total_debits', label: 'Débitos', align: 'right', render: r => <span className="text-destructive font-mono text-xs">R$ {Number(r.total_debits).toFixed(2)}</span> },
        { key: 'matched_count', label: 'Conciliados', align: 'right' },
        { key: 'unmatched_count', label: 'Pendentes', align: 'right', render: r => <span className={r.unmatched_count > 0 ? 'text-amber-600 font-bold' : ''}>{r.unmatched_count}</span> },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status.replace('_',' ')}</Badge> },
      ]}
    />
  );
}
