import { useEffect, useMemo, useState } from 'react';
import {
  CircleNotch as Loader2,
  Database,
  LockKey,
  ShoppingBag,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  useArtisanalStrapCatalog,
  useResolveTechnicalStrapContext,
} from '@/hooks/useArtisanalStraps';
import {
  strapIdentityBasis,
  type StrapIdentityBasis,
} from '@/lib/strapIdentity';
import { isUuid } from '@/lib/technicalStrapLines';

export interface StrapCatalogResolutionLine {
  id?: string | null;
  technical_strap_line_id?: string | null;
  label?: string | null;
  group_id?: string | null;
  group_name?: string | null;
  strap_type_id?: string | null;
  measure_id?: string | null;
  identity_basis?: StrapIdentityBasis | null;
  identity_group_id?: string | null;
  internal_production_enabled?: boolean | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  referenceId: string;
  referenceLabel?: string | null;
  referenceUpdatedAt?: string | null;
  lines: StrapCatalogResolutionLine[];
  suggestedBaseGroupId?: string | null;
  onResolved: (strapColors: Array<Record<string, unknown>>) => void;
}

interface LineGroup {
  key: string;
  label: string;
  ordinals: number[];
  strapTypeIds: string[];
  initialMeasureId: string;
  requiresReferenceBase: boolean;
  hasPurchasedReady: boolean;
}

function lineGroupKey(line: StrapCatalogResolutionLine, ordinal: number): string {
  if (isUuid(line.measure_id)) return `measure:${line.measure_id}`;
  const groupIdentity = line.group_id || line.group_name?.trim();
  if (groupIdentity) return `group:${groupIdentity}`;
  const label = line.label?.trim();
  return label ? `label:${label}` : `line:${ordinal}`;
}

function buildLineGroups(lines: StrapCatalogResolutionLine[]): LineGroup[] {
  const groups = new Map<string, {
    label: string;
    ordinals: number[];
    strapTypeIds: Set<string>;
    measureIds: Set<string>;
    requiresReferenceBase: boolean;
    hasPurchasedReady: boolean;
  }>();

  lines.forEach((line, ordinal) => {
    const key = lineGroupKey(line, ordinal);
    const current = groups.get(key) || {
      label: line.group_name?.trim() || line.label?.trim() || `Linha ${ordinal + 1}`,
      ordinals: [],
      strapTypeIds: new Set<string>(),
      measureIds: new Set<string>(),
      requiresReferenceBase: false,
      hasPurchasedReady: false,
    };
    current.ordinals.push(ordinal);
    if (isUuid(line.strap_type_id)) current.strapTypeIds.add(line.strap_type_id);
    if (isUuid(line.measure_id)) current.measureIds.add(line.measure_id);
    current.requiresReferenceBase ||= strapIdentityBasis(line) === 'reference_base';
    current.hasPurchasedReady ||= strapIdentityBasis(line) === 'finished_product_group';
    groups.set(key, current);
  });

  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    label: group.label,
    ordinals: group.ordinals,
    strapTypeIds: Array.from(group.strapTypeIds),
    initialMeasureId: group.measureIds.size === 1 ? Array.from(group.measureIds)[0] : '',
    requiresReferenceBase: group.requiresReferenceBase,
    hasPurchasedReady: group.hasPurchasedReady,
  }));
}

export default function StrapCatalogResolutionDrawer({
  open,
  onOpenChange,
  referenceId,
  referenceLabel,
  referenceUpdatedAt,
  lines,
  suggestedBaseGroupId,
  onResolved,
}: Props) {
  const { data: catalog, isLoading, error: catalogError } = useArtisanalStrapCatalog(false);
  const resolveContext = useResolveTechnicalStrapContext();
  const lineGroups = useMemo(() => buildLineGroups(lines), [lines]);
  const requiresReferenceBase = useMemo(
    () => lines.some((line) => strapIdentityBasis(line) === 'reference_base'),
    [lines],
  );
  const allPurchasedReady = lines.length > 0 && !requiresReferenceBase;
  const missingFinishedGroupLines = useMemo(
    () => lines.filter((line) => (
      strapIdentityBasis(line) === 'finished_product_group'
      && !isUuid(line.identity_group_id)
    )),
    [lines],
  );
  const [baseGroupId, setBaseGroupId] = useState('');
  const [measureByGroup, setMeasureByGroup] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [validationError, setValidationError] = useState('');

  const eligibleBaseGroupIds = useMemo(() => {
    const approvedWidthGroups = new Set(
      (catalog?.width_profiles || [])
        .filter((profile) => profile.status === 'approved' && !profile.valid_to)
        .map((profile) => profile.base_group_id),
    );
    return new Set(
      (catalog?.official_products || [])
        .filter((entry) => entry.status === 'active'
          && approvedWidthGroups.has(entry.base_group_id)
          && catalog?.products.some((product) => product.id === entry.official_product_id
            && product.active !== false
            && product.group_id === entry.base_group_id))
        .map((entry) => entry.base_group_id),
    );
  }, [catalog?.official_products, catalog?.products, catalog?.width_profiles]);
  const groups = useMemo(
    () => (catalog?.groups || [])
      .filter((group) => eligibleBaseGroupIds.has(group.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    [catalog?.groups, eligibleBaseGroupIds],
  );

  useEffect(() => {
    if (!open) return;
    setBaseGroupId(
      requiresReferenceBase
        && isUuid(suggestedBaseGroupId)
        && eligibleBaseGroupIds.has(suggestedBaseGroupId)
        ? suggestedBaseGroupId
        : '',
    );
    setMeasureByGroup(Object.fromEntries(
      lineGroups.map((group) => [group.key, group.initialMeasureId]),
    ));
    setReason('');
    setValidationError('');
  }, [eligibleBaseGroupIds, lineGroups, open, referenceId, requiresReferenceBase, suggestedBaseGroupId]);
  const typeNameById = useMemo(
    () => new Map((catalog?.types || []).map((type) => [type.id, type.name])),
    [catalog?.types],
  );
  const activeMeasures = useMemo(
    () => (catalog?.measures || [])
      .filter((measure) => measure.active !== false)
      .sort((a, b) => {
        const typeCompare = (typeNameById.get(a.strap_type_id) || '').localeCompare(
          typeNameById.get(b.strap_type_id) || '',
          'pt-BR',
        );
        return typeCompare || a.finished_width_mm - b.finished_width_mm
          || a.display_name.localeCompare(b.display_name, 'pt-BR');
      }),
    [catalog?.measures, typeNameById],
  );
  const canResolve = catalog?.capabilities.resolve_strap_migration === true;

  const measuresForGroup = (group: LineGroup) => {
    if (group.strapTypeIds.length !== 1) return activeMeasures;
    const matching = activeMeasures.filter((measure) => measure.strap_type_id === group.strapTypeIds[0]);
    return matching.length > 0 ? matching : activeMeasures;
  };

  const handleResolve = async () => {
    setValidationError('');
    if (!canResolve) {
      setValidationError('Seu perfil não possui permissão para corrigir este cadastro.');
      return;
    }
    if (!isUuid(referenceId)) {
      setValidationError('Selecione uma referência válida antes de corrigir as tiras.');
      return;
    }
    if (!referenceUpdatedAt) {
      setValidationError('Recarregue a referência antes de confirmar a correção.');
      return;
    }
    if (missingFinishedGroupLines.length > 0) {
      setValidationError('Grupo acabado ausente. Vincule o grupo na ficha técnica antes de corrigir as medidas.');
      return;
    }
    if (requiresReferenceBase
        && (!isUuid(baseGroupId) || !groups.some((group) => group.id === baseGroupId))) {
      setValidationError('Selecione a napa-base canônica da referência.');
      return;
    }
    if (lineGroups.length === 0) {
      setValidationError('A referência não possui linhas técnicas para corrigir.');
      return;
    }
    const unresolvedGroup = lineGroups.find((group) => {
      const measureId = measureByGroup[group.key];
      return !isUuid(measureId)
        || !measuresForGroup(group).some((measure) => measure.id === measureId);
    });
    if (unresolvedGroup) {
      setValidationError(`Selecione a medida canônica de “${unresolvedGroup.label}”.`);
      return;
    }
    if (!reason.trim()) {
      setValidationError('Informe o motivo da correção para a auditoria.');
      return;
    }

    try {
      const result = await resolveContext.mutateAsync({
        p_reference_id: referenceId,
        p_base_group_id: requiresReferenceBase ? baseGroupId : null,
        p_lines: lineGroups
          .flatMap((group) => group.ordinals.map((ordinal) => ({
            ordinal,
            measure_id: measureByGroup[group.key],
          })))
          .sort((a, b) => a.ordinal - b.ordinal),
        p_reason: reason.trim(),
        p_expected_updated_at: referenceUpdatedAt,
      });
      onResolved(result.strap_colors);
      onOpenChange(false);
    } catch {
      // O hook mantém o drawer aberto e já apresenta o erro retornado pelo RPC.
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!resolveContext.isPending) onOpenChange(nextOpen);
      }}
    >
      <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
        <div className="flex min-h-full flex-col">
          <SheetHeader className="border-b border-border px-4 pb-4 pt-5 pr-12 sm:px-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Database className="h-3.5 w-3.5" /> Estoque
              </Badge>
              <Badge variant="secondary">
                {lines.length} linha{lines.length === 1 ? '' : 's'} · {lineGroups.length} medida{lineGroups.length === 1 ? '' : 's'}
              </Badge>
            </div>
            <SheetTitle>Corrigir contexto das tiras</SheetTitle>
            <SheetDescription>
              {allPurchasedReady
                ? 'Vincule as medidas canônicas sem sair do pedido. Estas tiras são compradas prontas e não usam napa-base.'
                : 'Vincule a napa-base das linhas que seguem a referência e as medidas canônicas sem sair do pedido. A correção atualiza a ficha e volta para este item.'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6">
            <section className="rounded-lg border border-border bg-muted/20 p-3" aria-label="Referência afetada">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Referência afetada</p>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {referenceLabel || referenceId}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Esta ação corrige a origem estrutural compartilhada pela ficha; as cores continuam sendo escolhidas no pedido.
              </p>
            </section>

            {isLoading && (
              <div className="flex items-center gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando catálogo canônico…
              </div>
            )}

            {catalogError && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Catálogo indisponível</AlertTitle>
                <AlertDescription>Não foi possível carregar as opções canônicas. Feche e tente novamente.</AlertDescription>
              </Alert>
            )}

            {!isLoading && catalog && !canResolve && (
              <Alert>
                <LockKey className="h-4 w-4" />
                <AlertTitle>Correção protegida</AlertTitle>
                <AlertDescription>Solicite a correção ao administrador.</AlertDescription>
              </Alert>
            )}

            {!isLoading && catalog && (
              <>
                {missingFinishedGroupLines.length > 0 && (
                  <Alert variant="destructive">
                    <Warning className="h-4 w-4" />
                    <AlertTitle>Grupo acabado ausente</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>
                        Vincule o grupo do produto acabado na ficha técnica. Esta correção não infere grupos por nome e só poderá ajustar as medidas depois desse vínculo.
                      </p>
                      <Button asChild type="button" variant="outline" size="sm">
                        <a
                          href={`/fichas-tecnicas?ref=${encodeURIComponent(referenceId)}&tab=range-aviamento`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir ficha técnica
                        </a>
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}

                {requiresReferenceBase ? (
                  <section className="space-y-2" aria-labelledby="strap-base-group-label">
                    <Label id="strap-base-group-label">Napa-base da referência *</Label>
                    <Select value={baseGroupId || undefined} onValueChange={setBaseGroupId} disabled={!canResolve}>
                      <SelectTrigger aria-invalid={!!validationError && !isUuid(baseGroupId)}>
                        <SelectValue placeholder="Selecione o grupo da napa-base" />
                      </SelectTrigger>
                      <SelectContent
                        searchable
                        searchPlaceholder="Buscar grupo de napa…"
                        searchLabel="Localizar napa-base"
                        searchEmptyText="Nenhum grupo encontrado."
                      >
                        {groups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      A base vale somente para linhas com identidade pela referência. Linhas por grupo acabado não usam este campo.
                    </p>
                    {groups.length === 0 && (
                      <Alert>
                        <Warning className="h-4 w-4" />
                        <AlertTitle>Nenhuma napa-base apta</AlertTitle>
                        <AlertDescription>
                          O Estoque precisa ter ao menos uma base com perfil de largura aprovado e produto oficial ativo.
                        </AlertDescription>
                      </Alert>
                    )}
                  </section>
                ) : (
                  <Alert className="border-primary/30 bg-primary/5">
                    <ShoppingBag className="h-4 w-4 text-primary" />
                    <AlertTitle>Compra pronta — napa-base não se aplica</AlertTitle>
                    <AlertDescription>
                      O estoque baixa o SKU acabado da cor escolhida. Nenhuma napa será reservada, debitada ou enviada para produção interna.
                    </AlertDescription>
                  </Alert>
                )}

                <section className="space-y-3" aria-labelledby="strap-measures-label">
                  <div className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-primary" />
                    <h3 id="strap-measures-label" className="text-sm font-bold">Medidas por linha técnica</h3>
                  </div>
                  {lineGroups.map((group) => {
                    const options = measuresForGroup(group);
                    return (
                      <div key={group.key} className="space-y-2 rounded-lg border border-border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-foreground">{group.label}</p>
                            <p className="text-xs text-muted-foreground">
                              {group.ordinals.map((ordinal) => `Linha ${ordinal + 1}`).join(', ')}
                            </p>
                          </div>
                          <Badge variant="outline">
                            {group.ordinals.length} ocorrência{group.ordinals.length === 1 ? '' : 's'}
                          </Badge>
                          <Badge variant={group.requiresReferenceBase ? 'secondary' : 'outline'}>
                            {group.requiresReferenceBase && group.hasPurchasedReady
                              ? 'Identidade mista'
                              : group.requiresReferenceBase
                                ? 'Base da referência'
                                : 'Produto acabado'}
                          </Badge>
                        </div>
                        <Select
                          value={measureByGroup[group.key] || undefined}
                          onValueChange={(measureId) => setMeasureByGroup((current) => ({
                            ...current,
                            [group.key]: measureId,
                          }))}
                          disabled={!canResolve}
                        >
                          <SelectTrigger aria-invalid={!!validationError && !isUuid(measureByGroup[group.key])}>
                            <SelectValue placeholder="Selecione a medida canônica" />
                          </SelectTrigger>
                          <SelectContent
                            searchable="auto"
                            searchPlaceholder="Buscar tipo ou medida…"
                            searchLabel="Localizar medida"
                            searchEmptyText="Nenhuma medida encontrada."
                          >
                            {options.map((measure) => (
                              <SelectItem key={measure.id} value={measure.id}>
                                {typeNameById.get(measure.strap_type_id) || 'Tira'} · {measure.display_name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </section>

                {canResolve && (
                  <section className="space-y-1.5" aria-labelledby="strap-resolution-reason">
                    <Label id="strap-resolution-reason">Motivo da correção *</Label>
                    <Textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Explique por que a ficha precisa deste vínculo."
                      rows={3}
                    />
                  </section>
                )}
              </>
            )}

            {validationError && (
              <Alert variant="destructive">
                <Warning className="h-4 w-4" />
                <AlertTitle>Revise a correção</AlertTitle>
                <AlertDescription>{validationError}</AlertDescription>
              </Alert>
            )}
          </div>

          <SheetFooter className="sticky bottom-0 border-t border-border bg-background px-4 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={resolveContext.isPending}>
              Fechar
            </Button>
            {canResolve && (
              <Button
                type="button"
                className="gap-2"
                onClick={handleResolve}
                disabled={resolveContext.isPending || isLoading || !!catalogError || missingFinishedGroupLines.length > 0}
              >
                {resolveContext.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Wrench className="h-4 w-4" />}
                {resolveContext.isPending ? 'Corrigindo…' : 'Corrigir no estoque'}
              </Button>
            )}
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
