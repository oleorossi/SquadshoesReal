import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { Scale, Info } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const STATUS: Record<string, string> = {
  em_andamento: 'bg-blue-100 text-blue-700',
  conciliada: 'bg-emerald-100 text-emerald-700',
  divergencia: 'bg-amber-100 text-amber-700',
  cancelada: 'bg-muted text-muted-foreground',
};

/**
 * Histórico read-only das sessões persistidas em `bank_reconciliations`.
 * Pra iniciar uma nova conciliação (importar OFX/CSV e matchar contra
 * AR/AP), use a aba "Conciliação" dentro de /financeiro — esse fluxo é
 * onde a UI ad-hoc vive hoje.
 */
export default function BankReconciliation() {
  return (
    <div className="space-y-4">
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 px-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-blue-900 dark:text-blue-200">
              Histórico de conciliações persistidas
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
              Pra iniciar uma nova conciliação (importar OFX/CSV e matchar contra AR/AP),
              use a aba <span className="font-medium">Conciliação</span> dentro do módulo Financeiro.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/financeiro?tab=conciliacao">Abrir conciliação</Link>
          </Button>
        </CardContent>
      </Card>

      <DataListPage
        title="Conciliação Bancária — Histórico"
        subtitle="Sessões salvas em bank_reconciliations"
        icon={Scale}
        table="bank_reconciliations"
        orderBy="reconciliation_date"
        emptyText="Nenhuma conciliação registrada"
        newButtonLabel="Nova Conciliação"
        newButtonOnClick={() => toast.info('Use a aba "Conciliação" em /financeiro pra importar extrato')}
        columns={[
          { key: 'reconciliation_date', label: 'Data', render: r => format(new Date(r.reconciliation_date), 'dd/MM/yy') },
          { key: 'total_credits', label: 'Créditos', align: 'right', render: r => <span className="text-emerald-600 font-mono text-xs">R$ {Number(r.total_credits).toFixed(2)}</span> },
          { key: 'total_debits', label: 'Débitos', align: 'right', render: r => <span className="text-destructive font-mono text-xs">R$ {Number(r.total_debits).toFixed(2)}</span> },
          { key: 'matched_count', label: 'Conciliados', align: 'right' },
          { key: 'unmatched_count', label: 'Pendentes', align: 'right', render: r => <span className={r.unmatched_count > 0 ? 'text-amber-600 font-bold' : ''}>{r.unmatched_count}</span> },
          { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status.replace('_',' ')}</Badge> },
        ]}
      />
    </div>
  );
}
