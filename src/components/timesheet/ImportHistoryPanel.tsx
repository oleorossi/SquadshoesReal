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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/search-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  downloadImportFile,
  TimeImportLog,
  TimeImportQuarantineEntry,
  useDismissTimeImportQuarantine,
  useResolveTimeImportQuarantine,
  useTimeImportLogs,
  useTimeImportQuarantine,
  useTimeImportQuarantineHistory,
} from '@/hooks/useTimeImportLogs';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

const fmtSize = (bytes?: number | null) => {
  if (!bytes) return 'Tamanho não registrado';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

const fmtDateOnly = (date: string) => date.split('-').reverse().join('/');

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'erro desconhecido';
};

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

const coverageBadge = (log: TimeImportLog) => {
  if (log.coverage_scope === 'all_employees') {
    return <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Quadro completo</Badge>;
  }
  if (log.coverage_scope === 'listed_employees') {
    return <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Funcionários selecionados</Badge>;
  }
  return <Badge variant="secondary">Escopo legado não comprovado</Badge>;
};

export default function ImportHistoryPanel() {
  const { data: logs = [], isLoading, refetch, isFetching } = useTimeImportLogs();
  const {
    data: quarantine = [],
    error: quarantineError,
    isLoading: isLoadingQuarantine,
    isFetching: isFetchingQuarantine,
    refetch: refetchQuarantine,
  } = useTimeImportQuarantine();
  const {
    data: quarantineHistory = [],
    error: quarantineHistoryError,
    isLoading: isLoadingQuarantineHistory,
    isFetching: isFetchingQuarantineHistory,
    refetch: refetchQuarantineHistory,
  } = useTimeImportQuarantineHistory();
  const resolveQuarantine = useResolveTimeImportQuarantine();
  const dismissQuarantine = useDismissTimeImportQuarantine();
  const [selected, setSelected] = useState<TimeImportLog | null>(null);
  const [resolutionTarget, setResolutionTarget] = useState<TimeImportQuarantineEntry | null>(null);
  const [dismissTarget, setDismissTarget] = useState<TimeImportQuarantineEntry | null>(null);
  const [dismissReason, setDismissReason] = useState('');
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
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => {
              void refetch();
              void refetchQuarantine();
              void refetchQuarantineHistory();
            }}
            disabled={isFetching || isFetchingQuarantine || isFetchingQuarantineHistory}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching || isFetchingQuarantine || isFetchingQuarantineHistory ? 'animate-spin' : ''}`} /> Atualizar
          </Button>
        </div>
      </div>

      <Card className={quarantine.length > 0 ? 'border-warning/40' : ''}>
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h4 className="text-sm font-semibold">Pendências de vínculo da importação</h4>
                <Badge variant={quarantine.length > 0 ? 'outline' : 'secondary'} className={quarantine.length > 0 ? 'border-warning/30 bg-warning/10 text-warning' : ''}>
                  {quarantine.length}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Matrículas sem cadastro vigente ficam fora do ponto e da folha até serem resolvidas.
              </p>
            </div>
          </div>

          {isLoadingQuarantine ? (
            <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando pendências…
            </div>
          ) : quarantineError ? (
            <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-destructive">
                Não foi possível carregar as pendências: {getErrorMessage(quarantineError)}
              </p>
              <Button size="sm" variant="outline" onClick={() => void refetchQuarantine()} disabled={isFetchingQuarantine}>
                Tentar novamente
              </Button>
            </div>
          ) : quarantine.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-success" /> Nenhuma matrícula aguarda vínculo.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matrícula</TableHead>
                    <TableHead>Funcionário informado</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="w-72 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quarantine.map(entry => {
                    const isResolving = resolveQuarantine.isPending && resolveQuarantine.variables === entry.id;
                    const isDismissing = dismissQuarantine.isPending
                      && dismissQuarantine.variables?.quarantineId === entry.id;
                    return (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap font-mono text-sm font-semibold">{entry.employee_external_id}</TableCell>
                        <TableCell>
                          <p className="font-medium">{entry.employee_name || 'Nome não informado'}</p>
                          {entry.department && <p className="text-xs text-muted-foreground">{entry.department}</p>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{fmtDateOnly(entry.record_date)}</TableCell>
                        <TableCell className="min-w-64 text-sm text-muted-foreground">{entry.reason}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={resolveQuarantine.isPending || dismissQuarantine.isPending}
                            onClick={() => setResolutionTarget(entry)}
                          >
                            {isResolving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {isResolving ? 'Resolvendo…' : 'Tentar resolver'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 text-destructive hover:text-destructive"
                            disabled={resolveQuarantine.isPending || dismissQuarantine.isPending}
                            onClick={() => {
                              setDismissReason('');
                              setDismissTarget(entry);
                            }}
                          >
                            {isDismissing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            {isDismissing ? 'Classificando…' : 'Não pertence ao quadro'}
                          </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <ArchiveBox className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold">Histórico de vínculos e classificações</h4>
              <Badge variant="secondary">{quarantineHistory.length}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Decisões concluídas permanecem visíveis com data, resultado e justificativa.
            </p>
          </div>

          {isLoadingQuarantineHistory ? (
            <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico…
            </div>
          ) : quarantineHistoryError ? (
            <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-destructive">
                Não foi possível carregar o histórico: {getErrorMessage(quarantineHistoryError)}
              </p>
              <Button size="sm" variant="outline" onClick={() => void refetchQuarantineHistory()} disabled={isFetchingQuarantineHistory}>
                Tentar novamente
              </Button>
            </div>
          ) : quarantineHistory.length === 0 ? (
            <div className="px-4 py-5 text-sm text-muted-foreground">Nenhuma decisão de vínculo foi concluída ainda.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Matrícula</TableHead>
                    <TableHead>Funcionário informado</TableHead>
                    <TableHead>Data da batida</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead>Concluído em</TableHead>
                    <TableHead>Justificativa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {quarantineHistory.map(entry => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold">{entry.employee_external_id}</TableCell>
                      <TableCell>{entry.employee_name || 'Nome não informado'}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{fmtDateOnly(entry.record_date)}</TableCell>
                      <TableCell>
                        {entry.resolution_status === 'linked' ? (
                          <Badge variant="outline" className="border-success/30 bg-success/10 text-success">Vinculada ao ponto</Badge>
                        ) : (
                          <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">Fora do quadro</Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {entry.resolved_at ? fmtDate(entry.resolved_at) : 'Não registrada'}
                      </TableCell>
                      <TableCell className="min-w-64 text-sm text-muted-foreground">
                        {entry.resolution_reason || 'Vínculo canônico aplicado às batidas.'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
                          {coverageBadge(log)}
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
                      {log.skipped_count > 0 && <p className="text-xs text-muted-foreground">{log.skipped_count} ignorados no processamento</p>}
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

      <AlertDialog
        open={!!resolutionTarget}
        onOpenChange={open => {
          if (!open && !resolveQuarantine.isPending) setResolutionTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tentar resolver esta pendência?</AlertDialogTitle>
            <AlertDialogDescription>
              O sistema tentará localizar uma ficha vigente para a matrícula{' '}
              <span className="font-mono font-semibold text-foreground">{resolutionTarget?.employee_external_id}</span>{' '}
              e aplicar as batidas de {resolutionTarget ? fmtDateOnly(resolutionTarget.record_date) : ''}.
              Se o vínculo ainda não existir, nada será alterado e a pendência continuará nesta lista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resolveQuarantine.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={!resolutionTarget || resolveQuarantine.isPending}
              onClick={event => {
                event.preventDefault();
                if (!resolutionTarget) return;
                resolveQuarantine.mutate(resolutionTarget.id, {
                  onSuccess: () => setResolutionTarget(null),
                });
              }}
            >
              {resolveQuarantine.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {resolveQuarantine.isPending ? 'Resolvendo…' : 'Confirmar tentativa'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!dismissTarget}
        onOpenChange={open => {
          if (!open && !dismissQuarantine.isPending) {
            setDismissTarget(null);
            setDismissReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Classificar como linha externa ao quadro?</AlertDialogTitle>
            <AlertDialogDescription>
              Use somente para crachá de teste, terceiro ou pessoa sem vínculo vigente na data.
              A linha não será apagada: arquivo, batidas, autoria e justificativa continuarão no histórico.
              Se a matrícula possuir uma ficha vigente, o sistema recusará esta ação e exigirá o vínculo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="quarantine-dismiss-reason" className="text-sm font-medium">
              Justificativa obrigatória
            </label>
            <Textarea
              id="quarantine-dismiss-reason"
              value={dismissReason}
              onChange={event => setDismissReason(event.target.value)}
              placeholder="Ex.: crachá de teste do equipamento"
              rows={3}
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dismissQuarantine.isPending}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!dismissTarget || dismissReason.trim().length < 4 || dismissQuarantine.isPending}
              onClick={event => {
                event.preventDefault();
                if (!dismissTarget || dismissReason.trim().length < 4) return;
                dismissQuarantine.mutate(
                  { quarantineId: dismissTarget.id, reason: dismissReason },
                  {
                    onSuccess: () => {
                      setDismissTarget(null);
                      setDismissReason('');
                    },
                  },
                );
              }}
            >
              {dismissQuarantine.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Preservar e classificar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  <p className="mt-1">As linhas válidas foram aplicadas. Para matrículas sem vínculo, corrija o cadastro em Pessoas e use “Tentar resolver” na lista de pendências.</p>
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
