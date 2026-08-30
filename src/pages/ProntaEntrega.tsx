import { useMemo, useState } from 'react';
import ReadyStockBoard from '@/components/inventory/ReadyStockBoard';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  useReadyStockInquiries,
  useReadyStockPublicLink,
  useRotateReadyStockPublicLink,
  useUpdateReadyStockInquiryStatus,
} from '@/hooks/useReadyStockPublic';
import { toast } from 'sonner';

export default function ProntaEntregaPage() {
  const [tab, setTab] = useState<'estoque' | 'pedidos'>('estoque');
  const link = useReadyStockPublicLink();
  const rotate = useRotateReadyStockPublicLink();
  const inquiries = useReadyStockInquiries();
  const updateStatus = useUpdateReadyStockInquiryStatus();

  const publicUrl = useMemo(() => {
    if (!link.data?.token || typeof window === 'undefined') return '';
    return `${window.location.origin}/vitrine/${link.data.token}`;
  }, [link.data?.token]);

  const copyLink = async () => {
    if (!publicUrl) {
      toast.error('Link ainda não disponível. A migration da vitrine precisa estar no banco.');
      return;
    }
    await navigator.clipboard.writeText(publicUrl);
    toast.success('Link da vitrine copiado.');
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="COMERCIAL · ESTOQUE"
        title="Pronta Entrega"
        description="Estoque físico de PA. O cliente vê o saldo ao vivo pelo link, monta o carrinho e o pedido cai nesta inbox — sem virar PV automático."
      />

      <Card>
        <CardContent className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Link público</p>
            <p className="text-sm font-mono truncate">{publicUrl || 'Gere o link depois que a tabela da vitrine existir no banco.'}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={copyLink} disabled={!publicUrl}>Copiar link</Button>
            <Button size="sm" variant="ghost" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
              Renovar
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button size="sm" variant={tab === 'estoque' ? 'default' : 'outline'} onClick={() => setTab('estoque')}>
          Estoque
        </Button>
        <Button size="sm" variant={tab === 'pedidos' ? 'default' : 'outline'} onClick={() => setTab('pedidos')}>
          Pedidos da vitrine
          {inquiries.data?.some((row) => row.status === 'novo') && (
            <Badge className="ml-2" variant="secondary">
              {inquiries.data.filter((row) => row.status === 'novo').length}
            </Badge>
          )}
        </Button>
      </div>

      {tab === 'estoque' ? (
        <ReadyStockBoard />
      ) : (
        <div className="space-y-3">
          {(inquiries.data || []).length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                Nenhum pedido da vitrine ainda.
              </CardContent>
            </Card>
          ) : (
            (inquiries.data || []).map((row) => (
              <Card key={row.id}>
                <CardContent className="py-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{row.customer_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.customer_phone || row.customer_email || 'sem contato'} · {row.total_pairs} pares · {new Date(row.created_at).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{row.status}</Badge>
                      {row.status === 'novo' && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: row.id, status: 'lido' })}>
                          Marcar lido
                        </Button>
                      )}
                      {row.status !== 'atendido' && (
                        <Button size="sm" onClick={() => updateStatus.mutate({ id: row.id, status: 'atendido' })}>
                          Atendido
                        </Button>
                      )}
                    </div>
                  </div>
                  {row.notes && <p className="text-xs">{row.notes}</p>}
                  <pre className="text-[11px] whitespace-pre-wrap bg-muted/50 rounded p-2 overflow-x-auto">
                    {JSON.stringify(row.items, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
