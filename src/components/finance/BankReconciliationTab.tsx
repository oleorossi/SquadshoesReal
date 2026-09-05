import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bank as Landmark, Upload, CheckCircle as CheckCircle2, Warning as AlertTriangle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListPagination } from '@/components/ui/list-pagination';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAccountsPayable, useAccountsReceivable } from '@/hooks/useFinance';
import { useCan } from '@/hooks/useAccessControl';
import { useAuth } from '@/hooks/useAuth';
import {
  useBankReconciliationItems,
  useBankReconciliationSession,
  useBankReconciliationSessions,
  useImportOfxStatement,
  useMatchBankReconciliationItems,
  useReconciliationBankAccounts,
  useUnmatchBankReconciliationItems,
  type BankReconciliationSession,
} from '@/hooks/useBankReconciliation';
import { readOfxFile } from '@/lib/ofxFileImport';
import {
  assertOfxMatchesBankAccount,
  findBankStatementMatches,
  listBankStatementEligibleTargets,
  maskedBankIdentity,
  type PersistedBankStatementLine,
  type ReconciliationBankAccount,
  type ReconciliationMatchCandidate,
} from '@/lib/bankReconciliation';
import type { OfxStatement } from '@/lib/ofxStatement';
import { todayISO } from '@/lib/date';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { toast } from 'sonner';

const fmt = (value: number | null | undefined) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'R$ —';
  return number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

function dateBR(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '—';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function candidateKey(candidate: Pick<ReconciliationMatchCandidate, 'kind' | 'accountId'>): string {
  return `${candidate.kind}:${candidate.accountId}`;
}

function sessionLabel(session: BankReconciliationSession): string {
  const bank = session.bank_accounts?.name || session.bank_id || 'Conta bancária';
  return `${dateBR(session.reconciliation_date)} · ${bank} · ${session.matched_count}/${session.transaction_count}`;
}

interface UnmatchDraft {
  item: PersistedBankStatementLine;
  reversedOn: string;
  reason: string;
}

interface AutoMatchDraft {
  reconciliationId: string;
  entries: Array<{
    line: PersistedBankStatementLine;
    candidate: ReconciliationMatchCandidate;
  }>;
}

interface ManualMatchDraft {
  item: PersistedBankStatementLine;
  search: string;
}

export default function BankReconciliationTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const reconciliationId = searchParams.get('reconciliation');
  const [page, setPage] = useState(1);
  const [statements, setStatements] = useState<OfxStatement[]>([]);
  const [selectedBanks, setSelectedBanks] = useState<Record<number, string>>({});
  const [fileError, setFileError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState<Record<string, string>>({});
  const [autoMatchDraft, setAutoMatchDraft] = useState<AutoMatchDraft | null>(null);
  const [manualMatchDraft, setManualMatchDraft] = useState<ManualMatchDraft | null>(null);
  const [unmatch, setUnmatch] = useState<UnmatchDraft | null>(null);
  const fileGeneration = useRef(0);
  const { user } = useAuth();
  const finPerm = useCan('/financeiro');
  const canOperate = !!user && finPerm.canEdit && (finPerm.isAdmin || finPerm.roles.includes('gerente'));

  const sessions = useBankReconciliationSessions();
  const session = useBankReconciliationSession(reconciliationId);
  const items = useBankReconciliationItems(reconciliationId, page);
  const bankAccountsQuery = useReconciliationBankAccounts();
  const { data: payables = [], isFetching: payablesFetching, isError: payablesError } = useAccountsPayable();
  const { data: receivables = [], isFetching: receivablesFetching, isError: receivablesError } = useAccountsReceivable();
  const importStatement = useImportOfxStatement(user?.id);
  const matchItems = useMatchBankReconciliationItems(user?.id);
  const unmatchItems = useUnmatchBankReconciliationItems(user?.id);
  const mutating = importStatement.isPending || matchItems.isPending || unmatchItems.isPending;

  const bankAccounts = useMemo(() => (bankAccountsQuery.isError
    ? [] : (bankAccountsQuery.data || []) as ReconciliationBankAccount[])
    .filter(account => account.active), [bankAccountsQuery.data, bankAccountsQuery.isError]);

  useEffect(() => {
    setPage(1);
    setSelectedMatches({});
    setAutoMatchDraft(null);
    setManualMatchDraft(null);
    setUnmatch(null);
  }, [reconciliationId]);

  const rowsWithMatches = useMemo(() => (items.isError ? [] : items.data?.rows || []).map(line => ({
    line,
    matches: line.status === 'nao_conciliado' && !payablesError && !receivablesError
      ? findBankStatementMatches(line, payables, receivables)
      : [],
  })), [items.data?.rows, items.isError, payables, receivables, payablesError, receivablesError]);

  const autoMatchable = useMemo(() => {
    const proposals = rowsWithMatches.flatMap(({ line, matches }) => {
      const high = matches.filter(candidate => candidate.confidence === 'alta');
      return high.length === 1 ? [{ line, candidate: high[0] }] : [];
    });
    const targetCounts = new Map<string, number>();
    for (const proposal of proposals) {
      const key = candidateKey(proposal.candidate);
      targetCounts.set(key, (targetCounts.get(key) || 0) + 1);
    }
    return proposals.filter(proposal => targetCounts.get(candidateKey(proposal.candidate)) === 1).slice(0, 200);
  }, [rowsWithMatches]);

  const manualCandidates = useMemo(() => {
    if (!manualMatchDraft || items.isError || payablesError || receivablesError) return [];
    return listBankStatementEligibleTargets(
      manualMatchDraft.item,
      payables,
      receivables,
    ).filter(candidate => searchMatchesAllTerms(
      manualMatchDraft.search,
      candidate.party, candidate.description, candidate.accountId, candidate.dueDate, dateBR(candidate.dueDate),
    ));
  }, [manualMatchDraft, items.isError, payables, receivables, payablesError, receivablesError]);

  function selectSession(id: string) {
    const next = new URLSearchParams(searchParams);
    next.set('reconciliation', id);
    setSearchParams(next, { replace: true });
  }

  async function readFile(file: File | undefined) {
    const generation = ++fileGeneration.current;
    setStatements([]);
    setSelectedBanks({});
    setFileError('');
    if (!file) return;
    setReadingFile(true);
    try {
      const parsed = await readOfxFile(file);
      if (generation !== fileGeneration.current) return;
      setStatements(parsed);
    } catch (failure) {
      if (generation !== fileGeneration.current) return;
      setFileError(failure instanceof Error ? failure.message : 'Não foi possível ler o arquivo OFX.');
    } finally {
      if (generation === fileGeneration.current) setReadingFile(false);
    }
  }

  async function persistStatement(index: number) {
    const statement = statements[index];
    const bank = bankAccounts.find(account => account.id === selectedBanks[index]);
    if (!statement || !bank || !canOperate || mutating) return;
    try {
      assertOfxMatchesBankAccount(bank, statement);
      const result = await importStatement.mutateAsync({ bankAccount: bank, statement });
      selectSession(result.reconciliation_id);
      toast.success(result.reused ? 'Este extrato já estava importado; a sessão existente foi aberta.' : 'Extrato OFX importado sem duplicar lançamentos.');
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Falha ao importar o extrato OFX.');
    }
  }

  function selectedCandidate(line: PersistedBankStatementLine, matches: ReconciliationMatchCandidate[]) {
    const selected = selectedMatches[line.id];
    if (selected) return matches.find(candidate => candidateKey(candidate) === selected) || null;
    return matches.length === 1 ? matches[0] : null;
  }

  async function reconcileOne(line: PersistedBankStatementLine, candidate: ReconciliationMatchCandidate): Promise<boolean> {
    const current = items.data?.rows.find(row => row.id === line.id);
    if (!reconciliationId || !canOperate || mutating || items.isError || items.isFetching
      || payablesError || receivablesError || payablesFetching || receivablesFetching
      || !current || current.reconciliation_id !== reconciliationId
      || current.status !== 'nao_conciliado' || current.revision !== line.revision) {
      toast.error('A linha ou os saldos mudaram. Atualize antes de conciliar.');
      return false;
    }
    try {
      await matchItems.mutateAsync({
        reconciliationId,
        entries: [{ item_id: line.id, expected_revision: line.revision, kind: candidate.kind, account_id: candidate.accountId }],
      });
      setSelectedMatches(previous => {
        const next = { ...previous };
        delete next[line.id];
        return next;
      });
      toast.success(`Linha conciliada: ${fmt(line.amount)}.`);
      return true;
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Não foi possível conciliar a linha.');
      return false;
    }
  }

  async function reconcileManual(candidate: ReconciliationMatchCandidate) {
    if (!manualMatchDraft) return;
    if (await reconcileOne(manualMatchDraft.item, candidate)) setManualMatchDraft(null);
  }

  async function reconcileHighConfidence() {
    const draft = autoMatchDraft;
    if (!draft || !reconciliationId || draft.reconciliationId !== reconciliationId
      || !canOperate || mutating || items.isError || items.isFetching
      || payablesError || receivablesError || payablesFetching || receivablesFetching) {
      setAutoMatchDraft(null);
      toast.error('Os dados mudaram ou não puderam ser confirmados. Atualize e revise o lote.');
      return;
    }
    const live = new Map(autoMatchable.map(proposal => [proposal.line.id, proposal]));
    const draftIsCurrent = draft.entries.every(({ line, candidate }) => {
      const current = live.get(line.id);
      return current?.line.revision === line.revision
        && candidateKey(current.candidate) === candidateKey(candidate);
    });
    if (!draft.entries.length || !draftIsCurrent) {
      setAutoMatchDraft(null);
      toast.error('As sugestões mudaram. Revise o lote atualizado antes de confirmar.');
      return;
    }
    try {
      await matchItems.mutateAsync({
        reconciliationId,
        entries: draft.entries.map(({ line, candidate }) => ({
          item_id: line.id, expected_revision: line.revision, kind: candidate.kind, account_id: candidate.accountId,
        })),
      });
      setSelectedMatches({});
      toast.success(`${draft.entries.length} linha(s) conciliada(s) atomicamente.`);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'O lote inteiro foi recusado; nenhuma linha foi conciliada.');
    } finally {
      setAutoMatchDraft(null);
    }
  }

  async function confirmUnmatch() {
    if (!reconciliationId || !unmatch || !canOperate || mutating) return;
    try {
      await unmatchItems.mutateAsync({
        reconciliationId,
        entries: [{
          item_id: unmatch.item.id,
          expected_revision: unmatch.item.revision,
          reversed_on: unmatch.reversedOn,
          reason: unmatch.reason,
        }],
      });
      setUnmatch(null);
      toast.success('Conciliação desfeita e evento financeiro estornado na mesma operação.');
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Não foi possível desfazer a conciliação.');
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-primary" /> Conciliação bancária por OFX
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Importe o arquivo original do banco. FITID, data e centavos ficam persistidos; nenhuma baixa nasce de texto colado ou da data de hoje.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canOperate && !finPerm.loading && (
            <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              Você pode consultar conciliações, mas somente administradores e gerentes com permissão de edição podem importar, conciliar ou desfazer.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="bank-reconciliation-ofx">Arquivo OFX do banco</Label>
              <Input id="bank-reconciliation-ofx" type="file" accept=".ofx,application/x-ofx"
                disabled={!canOperate || readingFile || mutating}
                onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  void readFile(file);
                  event.currentTarget.value = '';
                }} />
            </div>
            <Button type="button" variant="outline" disabled={readingFile || mutating}
              onClick={() => { sessions.refetch(); if (reconciliationId) { session.refetch(); items.refetch(); } }}>
              <RefreshCw className="mr-1 h-4 w-4" /> Atualizar
            </Button>
          </div>
          {readingFile && <p role="status" className="text-sm text-muted-foreground">Lendo e validando todos os bytes do OFX…</p>}
          {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}

          {statements.map((statement, index) => {
            const incoming = statement.transactions.filter(row => row.amountCents > 0)
              .reduce((sum, row) => sum + row.amountCents, 0) / 100;
            const outgoing = statement.transactions.filter(row => row.amountCents < 0)
              .reduce((sum, row) => sum + Math.abs(row.amountCents), 0) / 100;
            return (
              <div key={`${maskedBankIdentity(statement)}:${index}`} className="rounded-md border p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">Extrato {index + 1} · {maskedBankIdentity(statement)}</p>
                    <p className="text-xs text-muted-foreground">
                      {statement.transactions.length} lançamento(s) · entradas {fmt(incoming)} · saídas {fmt(outgoing)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {statement.balance && <Badge variant="outline">Saldo {fmt(statement.balance.amountCents / 100)} em {dateBR(statement.balance.asOfDate)}</Badge>}
                    {statement.duplicateCount > 0 && <Badge variant="outline">{statement.duplicateCount} duplicado(s) removido(s)</Badge>}
                    {statement.pendingCount > 0 && <Badge variant="outline">{statement.pendingCount} pendente(s) não importado(s)</Badge>}
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="space-y-1">
                    <Label>Conta cadastrada correspondente</Label>
                    <Select value={selectedBanks[index] || ''}
                      onValueChange={value => setSelectedBanks(previous => ({ ...previous, [index]: value }))}
                      disabled={!canOperate || mutating || bankAccountsQuery.isPending}>
                      <SelectTrigger><SelectValue placeholder="Selecione e confira conta/agência" /></SelectTrigger>
                      <SelectContent>
                        {bankAccounts.map(account => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name} · ag {account.agency || 'não cadastrada'} · conta {account.account_number || 'não cadastrada'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" disabled={!canOperate || !selectedBanks[index] || mutating}
                    onClick={() => void persistStatement(index)}>
                    <Upload className="mr-1 h-4 w-4" /> {importStatement.isPending ? 'Importando…' : 'Importar extrato'}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Sessão persistida</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Select value={reconciliationId || ''} onValueChange={selectSession} disabled={sessions.isPending || mutating}>
            <SelectTrigger aria-label="Sessão de conciliação"><SelectValue placeholder="Selecione uma importação OFX" /></SelectTrigger>
            <SelectContent searchable="auto" searchPlaceholder="Buscar data ou conta…">
              {(sessions.isError ? [] : sessions.data || []).map(row => <SelectItem key={row.id} value={row.id}>{sessionLabel(row)}</SelectItem>)}
            </SelectContent>
          </Select>
          {sessions.isError && <p role="alert" className="text-sm text-destructive">Não foi possível consultar as sessões: {sessions.error.message}</p>}
          {!session.isError && session.data && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">{session.data.bank_accounts?.name || session.data.bank_id}</Badge>
              <Badge variant="outline">{session.data.transaction_count} linha(s)</Badge>
              <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">{session.data.matched_count} conciliada(s)</Badge>
              {session.data.unmatched_count > 0 && <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">{session.data.unmatched_count} pendente(s)</Badge>}
              <Badge variant="outline">Créditos {fmt(session.data.total_credits)}</Badge>
              <Badge variant="outline">Débitos {fmt(session.data.total_debits)}</Badge>
            </div>
          )}
          {session.isError && <p role="alert" className="text-sm text-destructive">{session.error.message}</p>}
        </CardContent>
      </Card>

      {reconciliationId && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">Linhas do extrato</CardTitle>
              {autoMatchable.length > 0 && canOperate && (
                <Button size="sm" disabled={mutating || items.isFetching || payablesFetching || receivablesFetching}
                  onClick={() => setAutoMatchDraft({
                    reconciliationId,
                    entries: autoMatchable.map(proposal => ({
                      line: { ...proposal.line },
                      candidate: { ...proposal.candidate },
                    })),
                  })}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Conciliar {autoMatchable.length} de alta confiança
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(items.isPending || payablesFetching || receivablesFetching) && <p role="status" className="text-sm text-muted-foreground">Atualizando extrato e saldos dos títulos…</p>}
            {(payablesError || receivablesError) && <p role="alert" className="text-sm text-destructive">Não foi possível confirmar os saldos atuais de contas a pagar/receber. Nenhum match está disponível.</p>}
            {items.isError && <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{items.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => items.refetch()}>Tentar novamente</Button>
            </div>}
            {!items.isError && items.data && (
              <>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Data / FITID</TableHead><TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead><TableHead>Vínculo</TableHead>
                    <TableHead className="text-right">Ação</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {rowsWithMatches.map(({ line, matches }) => {
                      const candidate = selectedCandidate(line, matches);
                      const income = line.movement_type === 'credito';
                      return (
                        <TableRow key={line.id} className="align-top">
                          <TableCell className="text-xs whitespace-nowrap">
                            <p>{dateBR(line.movement_date)}</p>
                            <p className="font-mono text-muted-foreground" title={line.fit_id}>{line.fit_id.slice(0, 18)}</p>
                          </TableCell>
                          <TableCell className="max-w-[280px] text-xs">
                            <p className="truncate" title={line.description || ''}>{line.description || '(sem descrição)'}</p>
                            <p className="text-muted-foreground">rev. {line.revision}</p>
                          </TableCell>
                          <TableCell className={`text-right font-mono text-xs ${income ? 'text-green-600' : 'text-destructive'}`}>
                            {income ? '+' : '-'}{fmt(line.amount)}
                          </TableCell>
                          <TableCell className="min-w-[260px]">
                            {line.status === 'conciliado' ? (
                              <div className="text-xs space-y-1">
                                <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">Conciliado</Badge>
                                <p>{line.matched_to_type === 'payable' ? 'Conta a pagar' : 'Conta a receber'} · <span className="font-mono">{line.matched_to_id?.slice(0, 8)}</span></p>
                              </div>
                            ) : matches.length === 0 ? (
                              <span className="text-xs text-muted-foreground italic">Sem candidato seguro nesta página de títulos</span>
                            ) : (
                              <Select value={selectedMatches[line.id] || (matches.length === 1 ? candidateKey(matches[0]) : '')}
                                onValueChange={value => setSelectedMatches(previous => ({ ...previous, [line.id]: value }))}
                                disabled={!canOperate || mutating || items.isFetching || payablesFetching || receivablesFetching}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={`${matches.length} candidatos — escolha um`} /></SelectTrigger>
                                <SelectContent searchable="auto" searchPlaceholder="Buscar candidato…">
                                  {matches.map(option => (
                                    <SelectItem key={candidateKey(option)} value={candidateKey(option)}>
                                      {option.confidence} · {option.kind === 'payable' ? 'AP' : 'AR'} · {option.party} · {fmt(option.settlementAmount)}{option.isPartial ? ' (parcial)' : ''}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {line.status === 'conciliado' ? (
                              canOperate && <Button size="sm" variant="outline" disabled={mutating || items.isFetching}
                                onClick={() => setUnmatch({ item: line, reversedOn: todayISO(), reason: '' })}>Desfazer</Button>
                            ) : (
                              <div className="flex justify-end gap-1">
                                {candidate && <Button size="sm" variant={candidate.confidence === 'alta' ? 'default' : 'outline'}
                                  disabled={!canOperate || mutating || items.isFetching || payablesFetching || receivablesFetching}
                                  onClick={() => void reconcileOne(line, candidate)}>Conciliar</Button>}
                                {canOperate && <Button size="sm" variant="outline"
                                  disabled={mutating || items.isFetching || payablesFetching || receivablesFetching || payablesError || receivablesError}
                                  onClick={() => setManualMatchDraft({ item: { ...line }, search: '' })}>
                                  Escolher título
                                </Button>}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                {items.data.rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Este extrato não contém lançamentos contabilizados.</p>}
                <ListPagination page={items.data.page} total={items.data.count} totalPages={items.data.totalPages}
                  showPager={items.data.totalPages > 1} pageSize={items.data.pageSize} itemLabel="linhas" onPageChange={setPage} />
              </>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!autoMatchDraft} onOpenChange={open => !open && !mutating && setAutoMatchDraft(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Conciliar {autoMatchDraft?.entries.length || 0} linha(s) de alta confiança?</AlertDialogTitle>
            <AlertDialogDescription>
              O lote é atômico: se qualquer saldo, revisão ou vínculo mudar, nenhuma linha será baixada. Alvos repetidos foram excluídos da sugestão automática.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={mutating} onClick={event => { event.preventDefault(); void reconcileHighConfidence(); }}>
              {mutating ? 'Conciliando…' : 'Confirmar lote'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!manualMatchDraft} onOpenChange={open => { if (!open && !mutating) setManualMatchDraft(null); }}>
        <DialogContent hideCloseButton={mutating}>
          <DialogHeader>
            <DialogTitle>Escolher título para a linha OFX</DialogTitle>
            <DialogDescription>
              A direção e o valor disponível são filtrados aqui; o servidor confirma novamente saldo, revisão e concorrência sob lock.
            </DialogDescription>
          </DialogHeader>
          {manualMatchDraft && <div className="space-y-3">
            <p className="rounded-md border p-3 text-sm">
              {dateBR(manualMatchDraft.item.movement_date)} · {fmt(manualMatchDraft.item.amount)} · FITID <span className="font-mono">{manualMatchDraft.item.fit_id}</span>
            </p>
            <div className="space-y-1">
              <Label htmlFor="bank-manual-search">Buscar por nome, descrição, vencimento ou ID</Label>
              <SearchInput id="bank-manual-search" autoFocus value={manualMatchDraft.search}
                placeholder="Buscar por nome, descrição, vencimento ou ID"
                onChange={search => setManualMatchDraft(current => current ? { ...current, search } : current)} />
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {manualCandidates.slice(0, 100).map(candidate => (
                <button key={candidateKey(candidate)} type="button" disabled={mutating}
                  aria-label={`Vincular ${candidate.kind === 'payable' ? 'AP' : 'AR'} ${candidate.party} ${candidate.description}`}
                  className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted disabled:opacity-50"
                  onClick={() => void reconcileManual(candidate)}>
                  <span className="block font-medium">{candidate.party} · {candidate.description}</span>
                  <span className="block text-xs text-muted-foreground">
                    vence {dateBR(candidate.dueDate)} · saldo {fmt(candidate.openAmount)} · baixa {fmt(candidate.settlementAmount)}{candidate.isPartial ? ' parcial' : ' integral'}
                  </span>
                </button>
              ))}
              {manualCandidates.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Nenhum título aberto comporta este valor.</p>}
              {manualCandidates.length > 100 && <p className="text-xs text-muted-foreground">Mostrando 100 resultados. Refine a busca para localizar o título correto.</p>}
            </div>
          </div>}
          <DialogFooter><Button variant="outline" disabled={mutating} onClick={() => setManualMatchDraft(null)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!unmatch} onOpenChange={open => { if (!open && !mutating) setUnmatch(null); }}>
        <DialogContent hideCloseButton={mutating}>
          <DialogHeader>
            <DialogTitle>Desfazer conciliação OFX</DialogTitle>
            <DialogDescription>
              O movimento financeiro será estornado e esta linha voltará a ficar disponível. O extrato e o histórico não serão apagados.
            </DialogDescription>
          </DialogHeader>
          {unmatch && <div className="space-y-3">
            <p className="rounded-md border p-3 text-sm">{dateBR(unmatch.item.movement_date)} · {fmt(unmatch.item.amount)} · FITID <span className="font-mono">{unmatch.item.fit_id}</span></p>
            <div className="space-y-1">
              <Label htmlFor="bank-unmatch-date">Data real do estorno</Label>
              <Input id="bank-unmatch-date" type="date" max={todayISO()} disabled={mutating}
                value={unmatch.reversedOn} onChange={event => setUnmatch({ ...unmatch, reversedOn: event.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bank-unmatch-reason">Motivo obrigatório</Label>
              <Textarea id="bank-unmatch-reason" maxLength={4000} disabled={mutating}
                value={unmatch.reason} onChange={event => setUnmatch({ ...unmatch, reason: event.target.value })} />
            </div>
          </div>}
          <DialogFooter>
            <Button variant="outline" disabled={mutating} onClick={() => setUnmatch(null)}>Cancelar</Button>
            <Button disabled={mutating || !unmatch?.reason.trim() || !unmatch.reversedOn} onClick={() => void confirmUnmatch()}>
              {mutating ? 'Estornando…' : 'Estornar e liberar linha'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!reconciliationId && statements.length === 0 && !readingFile && !fileError && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Upload className="h-6 w-6 mx-auto mb-2 opacity-40" />
          Importe um OFX ou selecione uma sessão já persistida. Baixas manuais continuam disponíveis na aba Contas.
        </CardContent></Card>
      )}
      {reconciliationId && items.data && autoMatchable.length === 0 && items.data.rows.some(row => row.status === 'nao_conciliado') && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-4 w-4" /> Linhas sem match único continuam pendentes para escolha humana; nenhum vínculo é inventado.
        </p>
      )}
    </div>
  );
}
