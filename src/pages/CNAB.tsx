import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  gerado: 'bg-blue-100 text-blue-700',
  enviado: 'bg-amber-100 text-amber-700',
  retornado: 'bg-indigo-100 text-indigo-700',
  processado: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-destructive/10 text-destructive',
};

export default function CNAB() {
  return (
    <DataListPage
      title="CNAB · Boletos Remessa/Retorno"
      subtitle="Arquivos CNAB 240/400 — remessa de boletos ao banco e processamento de retorno"
      icon={FileSpreadsheet}
      table="cnab_remittance_files"
      orderBy="generated_at"
      emptyText="Nenhum arquivo CNAB gerado"
      newButtonLabel="Gerar Remessa"
      newButtonOnClick={() => toast.info('Selecione AR pendentes pra gerar arquivo de remessa')}
      columns={[
        { key: 'filename', label: 'Arquivo', render: r => <span className="font-mono text-xs">{r.filename}</span> },
        { key: 'cnab_layout', label: 'Layout', render: r => <Badge variant="outline" className="text-[10px]">{r.cnab_layout}</Badge> },
        { key: 'generated_at', label: 'Gerado', render: r => <span className="text-xs">{format(new Date(r.generated_at), 'dd/MM/yy HH:mm')}</span> },
        { key: 'total_records', label: 'Registros', align: 'right' },
        { key: 'total_value', label: 'Valor Total', align: 'right', render: r => <span className="font-mono text-xs font-bold">R$ {Number(r.total_value || 0).toFixed(2)}</span> },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
      ]}
    />
  );
}
