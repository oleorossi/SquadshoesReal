import { useEffect, useState } from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  type ApplyLegacyStrapIncrementalResult,
  type ArtisanalStrapLegacyMigrationDiagnostic,
  type LegacyStrapIncrementalApplicationDetails,
  useApplyResolvedLegacyStrapProductMappingIncremental,
} from '@/hooks/useArtisanalStraps';
import {
  createLegacyStrapIncrementalIdempotencyKey,
  isLegacyStrapScopeChecksum,
} from '@/lib/legacyStrapIncrementalApply';

function detailsOf(diagnostic: ArtisanalStrapLegacyMigrationDiagnostic | null) {
  if (diagnostic?.issue_code !== 'resolved_product_mapping_ready_to_apply') return null;
  const details = diagnostic.details as LegacyStrapIncrementalApplicationDetails;
  if (!details?.cutover_id || !details.mapping_id || !details.legacy_product_id) return null;
  return details;
}

function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Falha não identificada na aplicação incremental.';
}

export function ArtisanalStrapIncrementalApplyDialog({
  diagnostic,
  onClose,
}: {
  diagnostic: ArtisanalStrapLegacyMigrationDiagnostic | null;
  onClose: () => void;
}) {
  const details = detailsOf(diagnostic);
  const applyIncremental = useApplyResolvedLegacyStrapProductMappingIncremental();
  const [reason, setReason] = useState('');
  const [attemptReason, setAttemptReason] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [result, setResult] = useState<ApplyLegacyStrapIncrementalResult | null>(null);
  const [attemptError, setAttemptError] = useState<string | null>(null);
  const targetKey = details ? `${details.cutover_id}:${details.mapping_id}:${details.scope_checksum}` : '';

  useEffect(() => {
    setReason('');
    setAttemptReason(null);
    setResult(null);
    setAttemptError(null);
    setIdempotencyKey(details
      ? createLegacyStrapIncrementalIdempotencyKey({
        cutoverId: details.cutover_id,
        mappingId: details.mapping_id,
      })
      : '');
  }, [details, targetKey]);

  const blockers = details?.blockers || [];
  const checksumValid = isLegacyStrapScopeChecksum(details?.scope_checksum);
  const close = () => {
    if (!applyIncremental.isPending) onClose();
  };

  const submit = async () => {
    if (!details || blockers.length > 0 || !checksumValid || !idempotencyKey) return;
    const stableReason = attemptReason || reason.trim();
    if (!stableReason) return;
    if (!attemptReason) setAttemptReason(stableReason);
    setAttemptError(null);
    try {
      const nextResult = await applyIncremental.mutateAsync({
        cutoverId: details.cutover_id,
        mappingId: details.mapping_id,
        expectedScopeChecksum: details.scope_checksum,
        reason: stableReason,
        idempotencyKey,
      });
      setResult(nextResult);
    } catch (error) {
      setAttemptError(messageOf(error));
    }
  };

  return (
    <Dialog open={Boolean(details)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Aplicar resolução no cutover ativo</DialogTitle>
          <DialogDescription>
            Esta ação aplica somente o mapa resolvido e os UUIDs do seu escopo. Outras pendências da migração não são reabertas.
          </DialogDescription>
        </DialogHeader>

        {details && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{details.affected_variant_ids?.length || 0} variante(s)</Badge>
              <Badge variant="secondary">Mapa pronto</Badge>
            </div>
            <div className="space-y-1 rounded-md bg-muted/30 p-3 font-mono text-[10px] text-muted-foreground">
              <p className="break-all">cutover: {details.cutover_id}</p>
              <p className="break-all">mapping: {details.mapping_id}</p>
              <p className="break-all">checksum do escopo: {details.scope_checksum}</p>
              <p className="break-all">checksum do rateio: {details.allocation_checksum}</p>
            </div>

            {(blockers.length > 0 || !checksumValid) && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Aplicação incremental bloqueada</AlertTitle>
                <AlertDescription>
                  {!checksumValid && <p>O diagnóstico não trouxe um checksum SHA-256 válido.</p>}
                  {blockers.map((blocker, index) => <p key={`${String(blocker.code)}-${index}`} className="font-mono text-[10px]">{JSON.stringify(blocker)}</p>)}
                </AlertDescription>
              </Alert>
            )}

            {!result && (
              <div className="space-y-1.5">
                <Label>Motivo auditável *</Label>
                <Textarea
                  value={attemptReason || reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={Boolean(attemptReason)}
                  placeholder="Explique por que este rateio está pronto para entrar no cutover."
                  rows={3}
                />
                {attemptReason && <p className="text-xs text-muted-foreground">Motivo e chave idempotente foram congelados para repetir esta mesma tentativa com segurança.</p>}
              </div>
            )}

            {attemptError && !result && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Aplicação não confirmada</AlertTitle>
                <AlertDescription>{attemptError} Atualize os diagnósticos se o checksum tiver mudado.</AlertDescription>
              </Alert>
            )}

            {result && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertTitle>{result.idempotent_replay ? 'Replay idempotente confirmado' : 'Resolução aplicada'}</AlertTitle>
                <AlertDescription className="space-y-1">
                  <p>{result.affected_variant_ids?.length || 0} variante(s) reconciliada(s) e {result.enqueued_job_ids?.length || 0} job(s) enfileirado(s).</p>
                  <p className="break-all font-mono text-[10px]">application_id: {result.application_id} · correlation_id: {result.correlation_id}</p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={applyIncremental.isPending}>{result ? 'Fechar' : 'Cancelar'}</Button>
          {!result && (
            <Button
              onClick={submit}
              disabled={!details || blockers.length > 0 || !checksumValid || !(attemptReason || reason.trim()) || applyIncremental.isPending}
            >
              {applyIncremental.isPending ? 'Aplicando…' : attemptError ? 'Repetir mesma tentativa' : 'Aplicar resolução'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
