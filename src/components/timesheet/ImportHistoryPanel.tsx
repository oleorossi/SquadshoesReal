import { useMemo, useState } from 'react';
import {
  Archive as ArchiveBox,
  ArrowsClockwise as RefreshCw,
  CheckCircle as CheckCircle2,
  CircleNotch as Loader2,
  Download,
  Eye,
  FileXls as FileSpreadsheet,
  LockKey,
  MagnifyingGlass,
  Warning as AlertTriangle,
  XCircle,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { downloadImportFile, TimeImportLog, useTimeImportLogs } from '@/hooks/useTimeImportLogs';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const fmtSize = (bytes?: number | null) => {
  if (!bytes) return 'Tamanho não registrado';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const fmtPeriod = (start: string | null, end: string | null) => {
  if (!start || !end) return 'Período não registrado';
  return `${start.split('-').reverse().join('/')} a ${end.split('-').reverse().join('/')}`;
};

const isAvailable = (log: TimeImportLog) =>
  log.archive_status === 'available' || (!log.archive_status && !!log.file_path);

const archiveBadge = (log: TimeImportLog) => {
  if (isAvailable(log)) {
    return (
      <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success">
        <LockKey className="h-3 w-3" /> Original preservado
      </Badge>
    );
  }
  if (log.archive_status === 'pending') {
    return (
      <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-warning">
        <Loader2 className="h-3 w-3 animate-spin" /> Arquivando
      </Badge>
    );
  }
  if (log.archive_status === 'failed') {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/30 bg-destructive/10 text-destructive">
        <XCircle className="h-3 w-3" /> Arquivo não armazenado
      </Badge>
    );
  }
  return <Badge variant="secondary">Importação antiga sem original</Badge>;
};

const statusBadge = (status: TimeImportLog['status']) => {
  if (status === 'processing') {
    return <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Processando</Badge>;
  }
  if (status === 'success') {
    return <Badge variant="outline" className="gap-1 border-success/30 bg-success/10 text-success"><CheckCircle2 className="h-3 w-3" /> Concluída</Badge>;
  }
  if (status === 'partial') {
    return <Badge variant="outline" className="gap-1 border-warning/30 bg-warning/10 text-warning"><AlertTriangle className="h-3 w-3" /> Parcial</Badge>;
  }
  return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Erro</Badge>;
};

export default function ImportHistoryPanel() {
  const { data: logs = [], isLoading, refetch, isFetching } = useTimeImportLogs();
  const [selected, setSelected] = useState<TimeImportLog | null>(null);
  const [search, setSearch] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => searchMatchesAllTerms(
      search,
      log.file_name,
      log.batch_id,
      log.start_date,
      log.end_date,
      log.status,
    ));
  }, [logs, search]);

  const availableFiles = useMemo(() => logs.filter(isAvailable).length, [logs]);

  const handleDownload = async (log: TimeImportLog) => {
    if (!log.file_path || !isAvailable(log)) return;
    setDownloadingId(log.id);
    try {
      await downloadImportFile(log.file_path, log.file_name);
      toast.success('Download do arquivo original iniciado');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      toast.error(`Não foi possível baixar o arquivo: ${message}`);
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <ArchiveBox className="h-4 w-4" /> Arquivo de auditoria do ponto
          </p>
          <h3 className="text-xl font-semibold">Arquivos originais do relógio de ponto</h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Cada importação nova guarda o arquivo original antes de aplicar qualquer batida. Os documentos não podem ser excluídos e permanecem disponíveis para conferência e download.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="h-8 gap-1.5 border-success/30 bg-success/10 px-3 text-success">
            <LockKey className="h-3.5 w-3.5" /> {availableFiles} de {logs.length} preservados
          </Badge>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      <SearchInput
        className="max-w-xl"
        value={search}
        onChange={setSearch}
        placeholder="Buscar por arquivo, lote, período ou status…"
        resultCount={filteredLogs.length}
        totalCount={logs.length}
        aria-label="Buscar no histórico de arquivos de ponto"
      />

      {logs.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FileSpreadsheet}
              title="Nenhum arquivo importado"
              description="O primeiro arquivo confirmado na aba Importar ficará preservado aqui antes de as batidas serem aplicadas."
            />
          </CardContent>
        </Card>
      ) : filteredLogs.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={MagnifyingGlass}
              title="Nenhum arquivo encontrado"
              description="Altere a busca para localizar outra importação."
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recebido em</TableHead>
                  <TableHead>Documento original</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead>Processamento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLogs.map(log => (
                  <TableRow key={log.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{fmtDate(log.created_at)}</TableCell>
                    <TableCell>
                      <div className="min-w-56 space-y-1.5">
                        <p className="flex max-w-80 items-center gap-1.5 truncate text-sm font-semibold" title={log.file_name}>
                          <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" /> {log.file_name}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {archiveBadge(log)}
                          <span className="text-xs text-muted-foreground">{fmtSize(log.file_size_bytes)}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtPeriod(log.start_date, log.end_date)}</TableCell>
                    <TableCell>
                      <p className="font-mono text-sm">
                        {log.inserted_count + log.updated_count}
                        <span className="ml-1 text-xs text-muted-foreground">aplicados</span>
                      </p>
                      {log.skipped_count > 0 && <p className="text-xs text-muted-foreground">{log.skipped_count} já existentes</p>}
                    </TableCell>
                    <TableCell>{statusBadge(log.status)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1.5">
                        <Button variant="ghost" size="sm" className="h-8 gap-1" onClick={() => setSelected(log)}>
                          <Eye className="h-3.5 w-3.5" /> Detalhes
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                          disabled={!log.file_path || !isAvailable(log) || downloadingId === log.id}
                          onClick={() => handleDownload(log)}
                          title={isAvailable(log) ? `Baixar ${log.file_name}` : 'O original não está disponível para esta importação'}
                        >
                          {downloadingId === log.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          Baixar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" /> {selected?.file_name}
            </DialogTitle>
            <DialogDescription>Protocolo permanente e resultado do processamento do arquivo.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Documento original</p>
                    <p className="mt-1 font-medium">{selected.file_name}</p>
                    <p className="text-xs text-muted-foreground">{fmtSize(selected.file_size_bytes)} · recebido em {fmtDate(selected.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-start gap-2 sm:items-end">
                    {archiveBadge(selected)}
                    <Button
                      size="sm"
                      className="gap-1.5"
                      disabled={!selected.file_path || !isAvailable(selected) || downloadingId === selected.id}
                      onClick={() => handleDownload(selected)}
                    >
                      {downloadingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      Baixar original
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Período</p><p className="font-mono">{fmtPeriod(selected.start_date, selected.end_date)}</p></div>
                <div><p className="text-xs text-muted-foreground">Status</p><div className="mt-1">{statusBadge(selected.status)}</div></div>
                <div><p className="text-xs text-muted-foreground">Aplicados</p><p className="font-mono">{selected.inserted_count + selected.updated_count}</p></div>
                <div><p className="text-xs text-muted-foreground">Ignorados</p><p className="font-mono">{selected.skipped_count}</p></div>
              </div>

              {selected.status === 'partial' && (
                <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
                  <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> Importação parcial</p>
                  <p className="mt-1">As linhas válidas foram aplicadas. Corrija apenas os itens descritos abaixo e importe novamente se necessário.</p>
                </div>
              )}

              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" /> Mensagens do processamento
                </h4>
                {!selected.error_messages || selected.error_messages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum erro registrado para este arquivo.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader><TableRow><TableHead className="text-xs">Etapa</TableHead><TableHead className="text-xs">Mensagem</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {selected.error_messages.map((message, index) => (
                          <TableRow key={`${message.row}-${index}`}>
                            <TableCell className="font-mono text-xs">{message.row}</TableCell>
                            <TableCell className="text-xs text-destructive">{message.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>

              {selected.batch_id && <p className="break-all font-mono text-xs text-muted-foreground">Protocolo: {selected.batch_id}</p>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
