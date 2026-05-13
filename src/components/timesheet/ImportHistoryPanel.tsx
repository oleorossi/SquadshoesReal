import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CircleNotch as Loader2, FileXls as FileSpreadsheet, Warning as AlertTriangle, CheckCircle as CheckCircle2, XCircle, Eye, ClockCounterClockwise as History, ArrowsClockwise as RefreshCw, Download } from '@phosphor-icons/react';
import { useTimeImportLogs, useDeleteTimeImportLog, getImportFileUrl, TimeImportLog } from '@/hooks/useTimeImportLogs';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { EmptyState } from '@/components/ui/EmptyState';
import { toast } from 'sonner';

const fmtSize = (bytes?: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const downloadFile = async (filePath: string, fileName: string) => {
  try {
    const url = await getImportFileUrl(filePath, 60);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err: any) {
    toast.error(`Falha ao baixar arquivo: ${err.message}`);
  }
};

const statusBadge = (s: TimeImportLog['status']) => {
  if (s === 'success') return <Badge className="bg-green-500/10 text-green-600 border-green-500/20 gap-1"><CheckCircle2 className="h-3 w-3" /> Sucesso</Badge>;
  if (s === 'partial') return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 gap-1"><AlertTriangle className="h-3 w-3" /> Parcial</Badge>;
  return <Badge className="bg-red-500/10 text-red-600 border-red-500/20 gap-1"><XCircle className="h-3 w-3" /> Erro</Badge>;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const fmtPeriod = (s: string | null, e: string | null) => {
  if (!s || !e) return '—';
  return `${s.split('-').reverse().join('/')} a ${e.split('-').reverse().join('/')}`;
};

export default function ImportHistoryPanel() {
  const { data: logs = [], isLoading, refetch, isFetching } = useTimeImportLogs();
  const deleteLog = useDeleteTimeImportLog();
  const [selected, setSelected] = useState<TimeImportLog | null>(null);

  const totals = useMemo(() => {
    return logs.reduce(
      (acc, l) => ({
        files: acc.files + 1,
        inserted: acc.inserted + (l.inserted_count || 0),
        updated: acc.updated + (l.updated_count || 0),
        errors: acc.errors + (l.error_count || 0),
      }),
      { files: 0, inserted: 0, updated: 0, errors: 0 },
    );
  }, [logs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <History className="h-5 w-5" /> Histórico de Importações
          </h3>
          <p className="text-xs text-muted-foreground">
            Acompanhe cada arquivo importado, com contagem de inserções, atualizações e erros.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Arquivos</p>
            <p className="display text-2xl tabular-nums mt-1 font-mono">{totals.files}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Inseridos</p>
            <p className="display text-2xl tabular-nums mt-1 font-mono text-green-600">{totals.inserted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Atualizados</p>
            <p className="display text-2xl tabular-nums mt-1 font-mono text-blue-600">{totals.updated}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Linhas com erro</p>
            <p className="display text-2xl tabular-nums mt-1 font-mono text-destructive">{totals.errors}</p>
          </CardContent>
        </Card>
      </div>

      {logs.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhuma importação registrada"
              description="Quando você importar um arquivo de relógio de ponto, ele aparecerá aqui com os totais e mensagens detalhadas."
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Inseridos</TableHead>
                  <TableHead className="text-right">Atualizados</TableHead>
                  <TableHead className="text-right">Erros</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id} className="hover:bg-muted/40">
                    <TableCell className="font-mono text-xs whitespace-nowrap">{fmtDate(l.created_at)}</TableCell>
                    <TableCell className="text-sm font-medium max-w-[260px] truncate" title={l.file_name}>
                      <span className="inline-flex items-center gap-1.5">
                        <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
                        {l.file_name}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {fmtPeriod(l.start_date, l.end_date)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-green-600">{l.inserted_count}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-blue-600">{l.updated_count}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-destructive">{l.error_count}</TableCell>
                    <TableCell>{statusBadge(l.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {l.file_path && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-primary"
                            onClick={() => downloadFile(l.file_path!, l.file_name)}
                            title={`Baixar arquivo bruto (${fmtSize(l.file_size_bytes)})`}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelected(l)} title="Ver detalhes">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <DeleteConfirmButton onConfirm={() => deleteLog.mutate(l.id)} title="Remover este registro do histórico?" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Details Dialog */}
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              {selected?.file_name}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Importado em</p>
                  <p className="font-mono">{fmtDate(selected.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Período</p>
                  <p className="font-mono">{fmtPeriod(selected.start_date, selected.end_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <div className="mt-1">{statusBadge(selected.status)}</div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total processado</p>
                  <p className="font-mono">{selected.total_rows}</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-green-600 font-semibold">Inseridos</p>
                  <p className="display text-2xl tabular-nums font-mono text-green-600">{selected.inserted_count}</p>
                </div>
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-blue-600 font-semibold">Atualizados</p>
                  <p className="display text-2xl tabular-nums font-mono text-blue-600">{selected.updated_count}</p>
                </div>
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-destructive font-semibold">Erros</p>
                  <p className="display text-2xl tabular-nums font-mono text-destructive">{selected.error_count}</p>
                </div>
              </div>

              {/* R5 (audit): banner explicativo quando status=partial. Antes:
                  badge "Parcial" exibia mas usuário não sabia o que isso
                  significava em termos de dados — agora a explicação é
                  contextual e diz que dados válidos JÁ FORAM aplicados. */}
              {selected.status === 'partial' && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
                  <p className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> Importação parcial
                  </p>
                  <p className="text-amber-700/80 dark:text-amber-300/80 mt-1">
                    {selected.inserted_count + selected.updated_count} linha(s) válida(s)
                    {' '}foram aplicadas com sucesso. As {selected.error_count} linha(s) abaixo
                    {' '}foram <strong>ignoradas</strong> e não impactam o relógio de ponto.
                    Corrija o arquivo e reimporte se necessário — duplicatas serão atualizadas.
                  </p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  Mensagens detalhadas
                </h4>
                {!selected.error_messages || selected.error_messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Sem erros registrados para este arquivo.</p>
                ) : (
                  <div className="border rounded-md max-h-72 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Linha</TableHead>
                          <TableHead className="text-xs">Mensagem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selected.error_messages.map((m, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono text-xs">{m.row}</TableCell>
                            <TableCell className="text-xs text-destructive">{m.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {selected.batch_id && (
                <p className="text-[10px] text-muted-foreground font-mono">Lote: {selected.batch_id}</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}