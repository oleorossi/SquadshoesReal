import { useState } from 'react';
import { FileText, ArrowsClockwise as RefreshCw, Download, CircleNotch as Loader2, CheckCircle, XCircle, Clock, WarningCircle as AlertCircle, Eye } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useNfeEmitidas, useCheckNfeStatus, type NfeEmitida } from '@/hooks/useNfe';
import { NfeViewerDialog } from '@/components/nfe/NfeViewerDialog';
import { format, parseISO } from 'date-fns';

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  processando: { label: 'Processando', icon: <Clock className="h-3 w-3" />, className: 'bg-amber-500/15 text-amber-700 border-amber-500/30' },
  autorizada: { label: 'Autorizada', icon: <CheckCircle className="h-3 w-3" />, className: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30' },
  rejeitada: { label: 'Rejeitada', icon: <XCircle className="h-3 w-3" />, className: 'bg-destructive/15 text-destructive border-destructive/30' },
  cancelada: { label: 'Cancelada', icon: <AlertCircle className="h-3 w-3" />, className: 'bg-muted text-muted-foreground border-muted' },
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function InvoicesSaidaTab() {
  const { data: nfes = [], isLoading } = useNfeEmitidas();
  const checkStatus = useCheckNfeStatus();
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [viewerNfe, setViewerNfe] = useState<NfeEmitida | null>(null);

  const handleCheckStatus = async (id: string) => {
    setCheckingId(id);
    await checkStatus.mutateAsync(id);
    setCheckingId(null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Notas Fiscais de Saída (NF-e)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : nfes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground font-medium">Nenhuma NF-e emitida</p>
            <p className="text-sm text-muted-foreground mt-1">
              As notas de saída serão geradas a partir dos pedidos de venda faturados.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Série</TableHead>
                <TableHead>Chave de Acesso</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nfes.map((nfe: any) => {
                const cfg = STATUS_CONFIG[nfe.status] || STATUS_CONFIG.processando;
                return (
                  <TableRow key={nfe.id}>
                    <TableCell className="font-mono font-bold">{nfe.numero || '—'}</TableCell>
                    <TableCell>{nfe.serie || '—'}</TableCell>
                    <TableCell className="font-mono text-xs max-w-[200px] truncate" title={nfe.chave_acesso}>
                      {nfe.chave_acesso || '—'}
                    </TableCell>
                    <TableCell className="font-mono">{fmt(Number(nfe.valor_total))}</TableCell>
                    <TableCell>{nfe.data_emissao ? format(parseISO(nfe.data_emissao), 'dd/MM/yyyy HH:mm') : '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
                        {cfg.icon} {cfg.label}
                      </Badge>
                      {nfe.status === 'rejeitada' && nfe.motivo_rejeicao && (
                        <p className="text-xs text-destructive mt-1 max-w-[200px] truncate" title={nfe.motivo_rejeicao}>
                          {nfe.motivo_rejeicao}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {nfe.status === 'processando' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCheckStatus(nfe.id)}
                            disabled={checkingId === nfe.id}
                          >
                            {checkingId === nfe.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                        {nfe.chave_acesso && (
                          <Button size="sm" variant="outline" onClick={() => setViewerNfe(nfe as NfeEmitida)}>
                            <Eye className="h-3.5 w-3.5 mr-1" /> Visualizar
                          </Button>
                        )}
                        {nfe.xml_url && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={nfe.xml_url} target="_blank" rel="noopener noreferrer">
                              <Download className="h-3.5 w-3.5 mr-1" /> XML
                            </a>
                          </Button>
                        )}
                        {nfe.danfe_url && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={nfe.danfe_url} target="_blank" rel="noopener noreferrer">
                              <Download className="h-3.5 w-3.5 mr-1" /> DANFE
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <NfeViewerDialog
        nfe={viewerNfe}
        open={!!viewerNfe}
        onOpenChange={(v) => { if (!v) setViewerNfe(null); }}
      />
    </Card>
  );
}
