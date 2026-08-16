import { useState } from 'react';
import { CheckCircle, ClockCounterClockwise, LockKey, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import {
  type ArtisanalStrapMigrationCutover,
  type ArtisanalStrapMigrationDryRunResult,
  useApplyArtisanalStrapMigration,
  useArtisanalStrapMigrationCutovers,
  usePreviewArtisanalStrapMigrationRollback,
  useRollbackArtisanalStrapMigration,
} from '@/hooks/useArtisanalStraps';
import { StrapStatusBadge } from './StrapStatusBadge';

function dateTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR');
}

function json(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function ArtisanalStrapMigrationControl({
  canResolve,
  dryRun,
  dryRunPending,
  onRequestDryRun,
}: {
  canResolve: boolean;
  dryRun?: ArtisanalStrapMigrationDryRunResult;
  dryRunPending: boolean;
  onRequestDryRun: () => void;
}) {
  const cutoversQuery = useArtisanalStrapMigrationCutovers(canResolve);
  const applyMigration = useApplyArtisanalStrapMigration();
  const previewRollback = usePreviewArtisanalStrapMigrationRollback();
  const rollbackMigration = useRollbackArtisanalStrapMigration();
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyReason, setApplyReason] = useState('');
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const [previewCutoverId, setPreviewCutoverId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ArtisanalStrapMigrationCutover | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false);
  const cutovers = cutoversQuery.data || [];
  const activeCutover = cutovers.find((cutover) => ['applying', 'applied', 'applied_with_review'].includes(cutover.status));
  const preview = previewRollback.data?.cutover_id === previewCutoverId
    ? previewRollback.data
    : undefined;

  const closeApply = () => {
    setApplyOpen(false);
    setApplyReason('');
    setApplyConfirmed(false);
  };
  const closeRollback = () => {
    setRollbackTarget(null);
    setRollbackReason('');
    setRollbackConfirmed(false);
  };

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="MIGRAÇÃO CONSERVATIVA"
        title="Dry-run, corte e checksums"
        subtitle="O dry-run congela a revisão; o corte revalida o mesmo checksum antes de tocar saldo ou documentos."
        actions={canResolve ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onRequestDryRun} disabled={dryRunPending}>{dryRunPending ? 'Executando…' : 'Executar dry-run'}</Button>
            <Button size="sm" onClick={() => setApplyOpen(true)} disabled={!dryRun || Boolean(activeCutover) || applyMigration.isPending}>Aplicar migração</Button>
          </div>
        ) : undefined}
      >
        {!canResolve ? (
          <EmptyState icon={LockKey} title="Ação exclusiva do Administrador" description="Consulta não concede autoridade para ratear, aplicar ou reverter a migração." size="sm" />
        ) : dryRun ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><StrapStatusBadge status={dryRun.status} /><Badge variant="outline">{dryRun.review_required_count} revisão(ões)</Badge><Badge variant="outline">{dryRun.report.checks?.length || 0} checks</Badge></div>
            <p className="break-all font-mono text-[10px] text-muted-foreground">run_id: {dryRun.run_id}</p>
            <p className="break-all font-mono text-[10px] text-muted-foreground">checksum do dry-run: {dryRun.overall_checksum}</p>
            {activeCutover && <Alert><Warning className="h-4 w-4" /><AlertTitle>Já existe um corte ativo</AlertTitle><AlertDescription>Valide ou reverta {activeCutover.cutover_id} antes de aplicar outro dry-run.</AlertDescription></Alert>}
          </div>
        ) : (
          <EmptyState icon={ClockCounterClockwise} title="Nenhum dry-run nesta sessão" description="Execute novamente depois de cada resolução; o servidor rejeita checksum antigo." size="sm" />
        )}
      </Panel>

      <Panel
        eyebrow="ROLLBACK CONTROLADO"
        title="Cutovers e manifestos"
        subtitle="O preflight bloqueia a reversão depois de qualquer fato operacional ou drift de snapshot."
      >
        {cutoversQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando histórico de cutovers…</p>
        ) : cutoversQuery.isError ? (
          <Alert variant="destructive"><Warning className="h-4 w-4" /><AlertTitle>Histórico indisponível</AlertTitle><AlertDescription>Não aplique nem reverta até a view administrativa responder.</AlertDescription></Alert>
        ) : cutovers.length === 0 ? (
          <EmptyState icon={ClockCounterClockwise} title="Nenhum cutover registrado" size="sm" />
        ) : (
          <div className="space-y-3">
            {cutovers.map((cutover) => {
              const isPreviewed = previewCutoverId === cutover.cutover_id && preview;
              return (
                <article key={cutover.cutover_id} className="space-y-3 rounded-md border border-border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StrapStatusBadge status={cutover.status} /><span className="font-mono text-xs">{cutover.cutover_id}</span></div><p className="mt-1 text-xs text-muted-foreground">Aplicado {dateTime(cutover.applied_at)} · {cutover.reason}</p></div>
                    {['applied', 'applied_with_review'].includes(cutover.status) && <Button size="sm" variant="outline" disabled={previewRollback.isPending} onClick={() => { setPreviewCutoverId(cutover.cutover_id); previewRollback.mutate({ cutoverId: cutover.cutover_id }); }}>Verificar rollback</Button>}
                  </div>
                  <div className="grid gap-1 font-mono text-[9px] text-muted-foreground"><p className="break-all">dry-run: {cutover.dry_run_checksum}</p><p className="break-all">pré: {cutover.pre_state_checksum}</p><p className="break-all">pós: {cutover.post_state_checksum || '—'}</p></div>
                  <details className="rounded-md bg-muted/30 p-2"><summary className="cursor-pointer text-xs font-semibold">Manifesto do corte</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{json(cutover.manifest)}</pre></details>
                  {cutover.rollback_manifest && <details className="rounded-md bg-muted/30 p-2"><summary className="cursor-pointer text-xs font-semibold">Manifesto do rollback</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{json(cutover.rollback_manifest)}</pre></details>}
                  {isPreviewed && (
                    <Alert variant={preview.can_rollback ? 'default' : 'destructive'}>
                      {preview.can_rollback ? <CheckCircle className="h-4 w-4" /> : <Warning className="h-4 w-4" />}
                      <AlertTitle>{preview.can_rollback ? 'Rollback ainda reversível' : 'Rollback bloqueado'}</AlertTitle>
                      <AlertDescription className="space-y-2">
                        <p>{preview.policy}</p>
                        <p className="break-all font-mono text-[9px]">esperado: {preview.expected_post_checksum} · atual: {preview.current_checksum}</p>
                        {preview.blockers.map((blocker, index) => <p key={`${String(blocker.code)}-${index}`} className="font-mono text-[10px]">{json(blocker)}</p>)}
                        {preview.can_rollback && <Button size="sm" variant="destructive" onClick={() => setRollbackTarget(cutover)}>Reverter este cutover</Button>}
                      </AlertDescription>
                    </Alert>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      <Dialog open={applyOpen} onOpenChange={(open) => { if (!open) closeApply(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Aplicar migração canônica</DialogTitle><DialogDescription>O servidor reexecutará o relatório e abortará tudo se run_id ou checksum estiverem stale.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <p className="break-all font-mono text-[10px] text-muted-foreground">{dryRun?.run_id}<br />{dryRun?.overall_checksum}</p>
            <div className="space-y-1.5"><Label>Motivo do corte *</Label><Textarea value={applyReason} onChange={(event) => setApplyReason(event.target.value)} /></div>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={applyConfirmed} onCheckedChange={(value) => setApplyConfirmed(value === true)} /><span>Confirmo que revisei o dry-run e que este checksum representa o estado que será migrado.</span></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeApply}>Cancelar</Button><Button disabled={!dryRun || !applyReason.trim() || !applyConfirmed || applyMigration.isPending} onClick={async () => { if (!dryRun) return; try { await applyMigration.mutateAsync({ runId: dryRun.run_id, expectedChecksum: dryRun.overall_checksum, reason: applyReason.trim() }); closeApply(); } catch { /* mantém confirmação aberta com erro do hook */ } }}>{applyMigration.isPending ? 'Aplicando…' : 'Aplicar com checksum'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(rollbackTarget)} onOpenChange={(open) => { if (!open) closeRollback(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Reverter cutover por fatos compensatórios</DialogTitle><DialogDescription>O preflight será repetido dentro da mesma transação. Se houver fato posterior, nenhuma linha será alterada.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <p className="break-all font-mono text-[10px] text-muted-foreground">cutover: {rollbackTarget?.cutover_id}<br />checksum pós-corte: {preview?.expected_post_checksum}</p>
            <div className="space-y-1.5"><Label>Motivo do rollback *</Label><Textarea value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} /></div>
            <label className="flex items-start gap-2 text-sm"><Checkbox checked={rollbackConfirmed} onCheckedChange={(value) => setRollbackConfirmed(value === true)} /><span>Confirmo que o preflight está livre de blockers e que os movimentos serão compensatórios, sem apagar histórico.</span></label>
          </div>
          <DialogFooter><Button variant="outline" onClick={closeRollback}>Cancelar</Button><Button variant="destructive" disabled={!rollbackTarget || !preview?.can_rollback || !preview.expected_post_checksum || !rollbackReason.trim() || !rollbackConfirmed || rollbackMigration.isPending} onClick={async () => { if (!rollbackTarget || !preview?.expected_post_checksum) return; try { await rollbackMigration.mutateAsync({ cutoverId: rollbackTarget.cutover_id, expectedPostChecksum: preview.expected_post_checksum, reason: rollbackReason.trim() }); closeRollback(); } catch { /* mantém confirmação aberta com blockers do hook */ } }}>{rollbackMigration.isPending ? 'Revertendo…' : 'Executar rollback seguro'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
