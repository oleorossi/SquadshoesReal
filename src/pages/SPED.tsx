import { DataListPage } from '@/components/ui/data-list-page';
import { Badge } from '@/components/ui/badge';
import { FileText } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

const STATUS: Record<string, string> = {
  gerado: 'bg-blue-100 text-blue-700',
  validado: 'bg-amber-100 text-amber-700',
  transmitido: 'bg-indigo-100 text-indigo-700',
  aceito: 'bg-emerald-100 text-emerald-700',
  rejeitado: 'bg-destructive/10 text-destructive',
};

export default function SPED() {
  return (
    <DataListPage
      title="SPED · Escrituração Digital"
      subtitle="EFD ICMS/IPI · EFD Contribuições · ECD · ECF · EFD-Reinf"
      icon={FileText}
      table="sped_exports"
      orderBy="period_start"
      emptyText="Nenhum SPED exportado"
      newButtonLabel="Gerar SPED"
      newButtonOnClick={() => toast.info('Selecione tipo (FISCAL/CONTRIBUICOES/CONTABIL) e período pra gerar TXT')}
      columns={[
        { key: 'sped_type', label: 'Tipo', render: r => <Badge variant="outline" className="text-[10px]">{r.sped_type}</Badge> },
        { key: 'period', label: 'Período', render: r => <span className="text-xs">{format(new Date(r.period_start), 'MM/yy')} – {format(new Date(r.period_end), 'MM/yy')}</span> },
        { key: 'filename', label: 'Arquivo', render: r => <span className="font-mono text-xs">{r.filename}</span> },
        { key: 'generated_at', label: 'Gerado em', render: r => <span className="text-xs">{format(new Date(r.generated_at), 'dd/MM/yy HH:mm')}</span> },
        { key: 'total_records', label: 'Registros', align: 'right' },
        { key: 'status', label: 'Status', render: r => <Badge variant="outline" className={`${STATUS[r.status]} text-[10px] capitalize`}>{r.status}</Badge> },
      ]}
    />
  );
}
