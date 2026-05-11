import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS_COLOR: Record<string, string> = {
  aberta: 'bg-blue-100 text-blue-700',
  enviada: 'bg-amber-100 text-amber-700',
  recebida: 'bg-indigo-100 text-indigo-700',
  analisada: 'bg-purple-100 text-purple-700',
  aprovada: 'bg-emerald-100 text-emerald-700',
  cancelada: 'bg-muted text-muted-foreground',
  expirada: 'bg-destructive/10 text-destructive',
};

export default function Quotations() {
  return (
    <DataListPage
      title="Cotações (RFQ)"
      subtitle="Cotação multifornecedor com mapa comparativo"
      icon={FileSpreadsheet}
      table="purchase_quotations"
      orderBy="created_at"
      emptyText="Nenhuma cotação aberta — RFQs são criadas a partir de necessidades do MRP."
      newButtonLabel="Nova Cotação"
      newButtonOnClick={() => toast.info('Editor de cotação em breve — adicione itens via MRP')}
      columns={[
        { key: 'quotation_number', label: 'Nº', width: '120px', render: r => <span className="font-mono font-bold text-xs">{r.quotation_number}</span> },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS_COLOR[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
        { key: 'requested_at', label: 'Solicitada', render: r => <span className="text-xs">{r.requested_at ? format(new Date(r.requested_at), 'dd/MM/yy') : '—'}</span> },
        { key: 'deadline', label: 'Prazo', render: r => <span className="text-xs">{r.deadline ? format(new Date(r.deadline), 'dd/MM/yy') : '—'}</span> },
        { key: 'notes', label: 'Observações', render: r => <span className="text-xs text-muted-foreground line-clamp-1">{r.notes || '—'}</span> },
      ]}
    />
  );
}
