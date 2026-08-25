import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Buildings,
  CurrencyDollar,
  Factory,
  Gauge,
  Handshake,
  Package,
  PencilSimple,
  Plus,
  Warning,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { formatCurrency } from '@/lib/utils';
import {
  SERVICE_ORDER_MATERIAL_COMPONENTS,
  REFERENCE_OUTSOURCE_SECTORS,
  hasValidServiceOrderMaterialComponents,
  isServiceOrderReturnAllowed,
  serviceOrderActivityDefaults,
  serviceOrderReturnOptions,
  serviceOrderReturnSectorsFromSettings,
  MAX_OUTSOURCE_CAPACITY_PAIRS_PER_DAY,
  isValidOutsourceCapacity,
  isValidOutsourceRate,
  serviceOrderReturnSectorLabel,
  serviceOrderSectorLabel,
  type ReferenceOutsourceSector,
  type ServiceOrderMaterialComponent,
} from '@/lib/serviceOrderSectors';
import { useContractors } from '@/hooks/useContractors';
import { useSectorSettings } from '@/hooks/useProductionEngine';
import {
  normalizeReferenceMaterialComponents,
  normalizeReferenceReturnSector,
  useReferenceTerceirizacoes,
  useCreateReferenceTerceirizacao,
  useUpdateReferenceTerceirizacao,
  useDeleteReferenceTerceirizacao,
  type ReferenceTerceirizacao,
} from '@/hooks/useReferenceTerceirizacoes';

/**
 * Aba "Terceirizados" da ficha técnica. Define a atividade externa, o
 * prestador, a capacidade e o ponto de retorno, além dos componentes incluídos
 * no cálculo. A remessa física continua explícita no despacho da OS.
 */
export function ReferenceTerceirizacoesPanel({ sheetId }: { sheetId: string }) {
  const {
    data: entries = [],
    isLoading,
    isError,
    refetch,
  } = useReferenceTerceirizacoes(sheetId);
  const del = useDeleteReferenceTerceirizacao();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReferenceTerceirizacao | null>(null);

  const openAdd = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (entry: ReferenceTerceirizacao) => {
    setEditing(entry);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold">
            <Handshake className="h-4 w-4 text-primary" />
            Atividades externas
          </h3>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Configure quem executa cada atividade, quantos pares entrega por dia,
            quando o lote precisa voltar e quais componentes entram no cálculo de necessidade.
            A remessa física é registrada separadamente no despacho da OS.
          </p>
        </div>
        <Button onClick={openAdd} size="sm" className="h-9 shrink-0 gap-1.5" disabled={isLoading || isError}>
          <Plus className="h-4 w-4" /> Adicionar
        </Button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-xs text-muted-foreground">Carregando…</div>
      ) : isError ? (
        <EmptyState
          icon={Warning}
          title="Não foi possível carregar as atividades externas"
          description="Tente novamente antes de adicionar ou alterar uma configuração desta ficha."
          action={(
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Tentar novamente
            </Button>
          )}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Nenhuma atividade externa cadastrada"
          description="Adicione uma atividade, o prestador, sua capacidade diária e os componentes incluídos no cálculo."
          action={(
            <Button onClick={openAdd} size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" /> Adicionar atividade
            </Button>
          )}
        />
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border lg:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr className="text-left text-xs uppercase tracking-wide">
                    <th scope="col" className="px-3 py-2 font-semibold">Atividade</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Prestador</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-right">Capacidade</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Retorno</th>
                    <th scope="col" className="px-3 py-2 font-semibold">Materiais</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-right">Valor/par</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-center">Status</th>
                    <th scope="col" className="px-3 py-2 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="align-top hover:bg-muted/30">
                      <td className="px-3 py-3">
                        <Badge variant="secondary" className="whitespace-nowrap">
                          {serviceOrderSectorLabel(entry.sector)}
                        </Badge>
                      </td>
                      <td className="max-w-[220px] px-3 py-3">
                        <p className="font-medium">
                          {entry.contractors?.trade_name || entry.contractors?.name || '—'}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {entry.description}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        <CapacityValue value={entry.capacity_pairs_per_day} />
                      </td>
                      <td className="px-3 py-3">
                        <ReturnValue value={entry.return_before_sector} />
                      </td>
                      <td className="max-w-[280px] px-3 py-3">
                        <MaterialBadges components={entry.material_components} />
                      </td>
                      <td className="px-3 py-3 text-right font-mono tabular-nums">
                        {formatCurrency(entry.value_per_pair)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <StatusBadge active={entry.active} />
                      </td>
                      <td className="px-3 py-3">
                        <EntryActions
                          entry={entry}
                          onEdit={() => openEdit(entry)}
                          onDelete={() => del.mutate(entry.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="space-y-3 lg:hidden">
            {entries.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-border bg-card p-3 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Badge variant="secondary">
                      {serviceOrderSectorLabel(entry.sector)}
                    </Badge>
                    <p className="mt-2 truncate text-sm font-semibold">
                      {entry.contractors?.trade_name || entry.contractors?.name || 'Prestador não encontrado'}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{entry.description}</p>
                  </div>
                  <StatusBadge active={entry.active} />
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2 text-xs">
                  <div>
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5" /> Capacidade
                    </dt>
                    <dd className="mt-0.5 font-mono font-semibold tabular-nums">
                      <CapacityValue value={entry.capacity_pairs_per_day} />
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-muted-foreground">
                      <ArrowRight className="h-3.5 w-3.5" /> Retorno
                    </dt>
                    <dd className="mt-0.5 font-semibold">
                      <ReturnValue value={entry.return_before_sector} />
                    </dd>
                  </div>
                </dl>

                <div className="mt-3">
                  <p className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Package className="h-3.5 w-3.5" /> Componentes calculados
                  </p>
                  <MaterialBadges components={entry.material_components} />
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {formatCurrency(entry.value_per_pair)}<span className="text-xs font-normal text-muted-foreground">/par</span>
                  </span>
                  <EntryActions
                    entry={entry}
                    onEdit={() => openEdit(entry)}
                    onDelete={() => del.mutate(entry.id)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <TerceirizacaoFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        sheetId={sheetId}
        editing={editing}
        entries={entries}
      />
    </div>
  );
}

function CapacityValue({ value }: { value: number | null | undefined }) {
  const capacity = Number(value);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    return <span className="font-sans text-xs font-medium text-warning">Não configurada</span>;
  }
  return <>{capacity.toLocaleString('pt-BR')} pares/dia</>;
}

function ReturnValue({ value }: { value: string | null | undefined }) {
  const normalized = normalizeReferenceReturnSector(value);
  if (!normalized) return <span className="text-xs font-medium text-warning">Não configurado</span>;
  return <>{serviceOrderReturnSectorLabel(normalized)}</>;
}

function MaterialBadges({ components }: { components: unknown }) {
  const normalized = normalizeReferenceMaterialComponents(components);
  if (normalized.length === 0) {
    return <span className="text-xs font-medium text-warning">Não configurados</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {normalized.map((component) => (
        <Badge key={component} variant="outline" className="h-5 px-1.5 text-[10px] font-medium">
          {component}
        </Badge>
      ))}
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">
      Ativa
    </Badge>
  ) : (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">Inativa</Badge>
  );
}

function EntryActions({
  entry,
  onEdit,
  onDelete,
}: {
  entry: ReferenceTerceirizacao;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={onEdit}
        aria-label={`Editar ${serviceOrderSectorLabel(entry.sector)}`}
      >
        <PencilSimple className="h-4 w-4" />
      </Button>
      <DeleteConfirmButton
        onConfirm={onDelete}
        title="Remover atividade externa?"
        description={`"${entry.description}" deixará de aparecer no planejamento e na geração de novas OS.`}
      />
    </div>
  );
}

function TerceirizacaoFormDialog({
  open, onOpenChange, sheetId, editing, entries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sheetId: string;
  editing: ReferenceTerceirizacao | null;
  entries: ReferenceTerceirizacao[];
}) {
  const {
    data: contractors = [],
    isLoading: loadingContractors,
    isError: contractorsFailed,
    refetch: refetchContractors,
  } = useContractors();
  const {
    data: sectorSettings = [],
    isLoading: loadingSectorSettings,
    isError: sectorSettingsFailed,
    refetch: refetchSectorSettings,
  } = useSectorSettings();
  const create = useCreateReferenceTerceirizacao();
  const update = useUpdateReferenceTerceirizacao();

  const [sector, setSector] = useState<ReferenceOutsourceSector | ''>('costura');
  const [contractorId, setContractorId] = useState('');
  const [capacityPairsPerDay, setCapacityPairsPerDay] = useState(0);
  const [returnBeforeSector, setReturnBeforeSector] = useState('');
  const [materialComponents, setMaterialComponents] = useState<ServiceOrderMaterialComponent[]>([]);
  const [description, setDescription] = useState('');
  const [valuePerPair, setValuePerPair] = useState(0);
  const [active, setActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    const savedSector = REFERENCE_OUTSOURCE_SECTORS.some((option) => option.value === editing?.sector)
      ? editing!.sector as ReferenceOutsourceSector
      : '';
    // Registro legado sem atividade precisa de escolha explícita. Assumir
    // Costura ao editar reclassificaria o serviço sem o usuário perceber.
    const nextSector = editing ? savedSector : 'costura';
    const defaults = nextSector ? serviceOrderActivityDefaults(nextSector) : null;
    const savedReturnSector = normalizeReferenceReturnSector(editing?.return_before_sector);
    const savedMaterials = normalizeReferenceMaterialComponents(editing?.material_components);

    setSector(nextSector);
    setContractorId(editing?.contractor_id || '');
    setCapacityPairsPerDay(Number(editing?.capacity_pairs_per_day) || 0);
    setReturnBeforeSector(savedReturnSector || defaults?.return_before_sector || '');
    setMaterialComponents(savedMaterials.length > 0 ? savedMaterials : defaults?.material_components || []);
    setDescription(editing?.description || '');
    setValuePerPair(Number(editing?.value_per_pair) || 0);
    setActive(editing?.active ?? true);
  }, [open, editing]);

  const activeContractors = useMemo(
    () => contractors.filter((contractor) => contractor.active === true || contractor.id === contractorId),
    [contractors, contractorId],
  );
  const selectedContractor = contractors.find((contractor) => contractor.id === contractorId);
  const contractorCanActivate = selectedContractor?.active === true;
  const usedActiveSectors = useMemo(
    () => new Set(entries
      .filter((entry) => entry.active && entry.id !== editing?.id && !!entry.sector)
      .map((entry) => entry.sector)),
    [editing?.id, entries],
  );
  const sectorAlreadyConfigured = usedActiveSectors.has(sector);
  const liveReturnSectors = useMemo(
    () => serviceOrderReturnSectorsFromSettings(sectorSettings),
    [sectorSettings],
  );
  const returnOptions = serviceOrderReturnOptions(sector, liveReturnSectors);
  const returnSectorAllowed = isServiceOrderReturnAllowed(
    sector,
    returnBeforeSector,
    liveReturnSectors,
  );
  const sectorSettingsReady = !loadingSectorSettings
    && !sectorSettingsFailed
    && sectorSettings.length > 0;
  const contractorsReady = !loadingContractors && !contractorsFailed;

  const fullConfigurationValid = !!sector
    && sectorSettingsReady
    && (!active || !sectorAlreadyConfigured)
    && !!contractorId
    && contractorsReady
    && (!active || contractorCanActivate)
    && isValidOutsourceCapacity(capacityPairsPerDay)
    && returnSectorAllowed
    && hasValidServiceOrderMaterialComponents(materialComponents)
    && !!description.trim()
    && isValidOutsourceRate(valuePerPair);
  const canDeactivateIncomplete = !!editing && editing.active && !active;
  const usingDeactivationFallback = canDeactivateIncomplete && !fullConfigurationValid;
  const canSubmit = fullConfigurationValid || canDeactivateIncomplete;
  const isPending = create.isPending || update.isPending;

  const changeSector = (value: string) => {
    const nextSector = value as ReferenceOutsourceSector;
    const defaults = serviceOrderActivityDefaults(nextSector);
    setSector(nextSector);
    setReturnBeforeSector(defaults.return_before_sector);
    setMaterialComponents(defaults.material_components);
  };

  const toggleMaterialComponent = (component: ServiceOrderMaterialComponent, checked: boolean) => {
    setMaterialComponents((current) => checked
      ? [...current, component].filter((value, index, all) => all.indexOf(value) === index)
      : current.filter((value) => value !== component));
  };

  const submit = () => {
    if (!canSubmit) return;
    if (usingDeactivationFallback) {
      update.mutate(
        { id: editing!.id, active: false },
        { onSuccess: () => onOpenChange(false) },
      );
      return;
    }
    const configuration = {
      contractor_id: contractorId,
      sector,
      capacity_pairs_per_day: capacityPairsPerDay,
      return_before_sector: returnBeforeSector,
      material_components: materialComponents,
      description,
      value_per_pair: valuePerPair,
      active,
    };
    if (editing) {
      update.mutate(
        { id: editing.id, ...configuration },
        { onSuccess: () => onOpenChange(false) },
      );
    } else {
      create.mutate(
        { reference_id: sheetId, ...configuration },
        { onSuccess: () => onOpenChange(false) },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Handshake className="h-5 w-5 text-primary" />
            {editing ? 'Editar atividade externa' : 'Nova atividade externa'}
          </DialogTitle>
          <DialogDescription>
            A capacidade e o ponto de retorno determinam a antecedência sugerida.
            Os componentes selecionados formam o recorte de materiais da OS.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="flex items-center gap-1 text-xs" htmlFor="terc-sector">
              <Factory className="h-3.5 w-3.5" /> Atividade *
            </Label>
            <Select value={sector} onValueChange={changeSector}>
              <SelectTrigger id="terc-sector" className="mt-1 h-10">
                <SelectValue placeholder="Selecionar atividade…" />
              </SelectTrigger>
              <SelectContent>
                {REFERENCE_OUTSOURCE_SECTORS.map((option) => (
                  <SelectItem
                    key={option.value}
                    value={option.value}
                    disabled={active && usedActiveSectors.has(option.value)}
                  >
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {editing && !sector && (
              <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                Esta linha legada não tem atividade reconhecida. Escolha uma antes de reativar/salvar.
              </p>
            )}
            {active && sectorAlreadyConfigured && (
              <p className="mt-1 text-xs font-medium text-destructive">
                Esta atividade já tem um prestador ativo; edite a configuração existente.
              </p>
            )}
          </div>

          <div>
            <Label className="flex items-center gap-1 text-xs" htmlFor="terc-contractor">
              <Buildings className="h-3.5 w-3.5" /> Prestador *
            </Label>
            <Select
              value={contractorId}
              onValueChange={setContractorId}
              disabled={!contractorsReady}
            >
              <SelectTrigger id="terc-contractor" className="mt-1 h-10">
                <SelectValue placeholder="Selecionar prestador…" />
              </SelectTrigger>
              <SelectContent>
                {contractors.length === 0 && (
                  <div className="flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground">
                    <Warning className="h-3.5 w-3.5" /> Nenhum prestador cadastrado.
                  </div>
                )}
                {activeContractors.map((contractor) => (
                  <SelectItem key={contractor.id} value={contractor.id}>
                    {contractor.trade_name || contractor.name}
                    {contractor.service_type && (
                      <Badge variant="outline" className="ml-2 h-4 text-[10px]">
                        {contractor.service_type}
                      </Badge>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {active && !contractorCanActivate && (
              <p className="mt-1 text-xs font-medium text-destructive">
                Reative o prestador ou deixe esta atividade inativa.
              </p>
            )}
            {!loadingContractors && contractorsFailed && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                <span>Não foi possível carregar os prestadores.</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetchContractors()}>
                  Tentar novamente
                </Button>
              </div>
            )}
          </div>

          <div>
            <Label className="flex items-center gap-1 text-xs" htmlFor="terc-capacity">
              <Gauge className="h-3.5 w-3.5" /> Capacidade pares/dia *
            </Label>
            <NumberInput
              id="terc-capacity"
              value={capacityPairsPerDay}
              onChange={setCapacityPairsPerDay}
              step="1"
              min={1}
              decimals={0}
              className="mt-1 h-10"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Use um número inteiro de 1 a {MAX_OUTSOURCE_CAPACITY_PAIRS_PER_DAY.toLocaleString('pt-BR')} pares/dia.
            </p>
            {capacityPairsPerDay !== 0 && !isValidOutsourceCapacity(capacityPairsPerDay) && (
              <p className="mt-1 text-xs font-medium text-destructive">Capacidade fora do intervalo permitido.</p>
            )}
          </div>

          <div>
            <Label className="flex items-center gap-1 text-xs" htmlFor="terc-return-sector">
              <ArrowRight className="h-3.5 w-3.5" /> Retornar antes de *
            </Label>
            <Select
              value={returnBeforeSector}
              onValueChange={setReturnBeforeSector}
              disabled={!sectorSettingsReady}
            >
              <SelectTrigger id="terc-return-sector" className="mt-1 h-10">
                <SelectValue placeholder="Selecionar etapa…" />
              </SelectTrigger>
              <SelectContent>
                {returnOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">Etapa interna que depende da devolução do lote.</p>
            {!!returnBeforeSector && !returnSectorAllowed && (
              <p className="mt-1 text-xs font-medium text-destructive">
                Escolha uma etapa posterior à atividade terceirizada.
              </p>
            )}
            {!loadingSectorSettings && (sectorSettingsFailed || sectorSettings.length === 0) && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                <span>Não foi possível carregar o fluxo vivo de produção.</span>
                <Button type="button" variant="outline" size="sm" onClick={() => void refetchSectorSettings()}>
                  Tentar novamente
                </Button>
              </div>
            )}
          </div>

          <fieldset className="sm:col-span-2">
            <legend className="flex items-center gap-1 text-xs font-medium">
              <Package className="h-3.5 w-3.5" /> Componentes incluídos no cálculo *
            </legend>
            <p className="mt-1 text-[11px] text-muted-foreground">
              O snapshot calcula somente os componentes marcados. A remessa física é registrada no despacho da OS.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {SERVICE_ORDER_MATERIAL_COMPONENTS.map((option) => {
                const id = `terc-material-${normalizeId(option.value)}`;
                const checked = materialComponents.includes(option.value);
                return (
                  <label
                    key={option.value}
                    htmlFor={id}
                    className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs transition-colors hover:bg-muted/50"
                  >
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(value) => toggleMaterialComponent(option.value, value === true)}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
            {materialComponents.length === 0 && (
              <p className="mt-1.5 text-xs font-medium text-destructive">Selecione ao menos um componente.</p>
            )}
          </fieldset>

          <div className="sm:col-span-2">
            <Label className="text-xs" htmlFor="terc-description">Descrição *</Label>
            <Textarea
              id="terc-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={`Ex.: ${serviceOrderSectorLabel(sector)} completa`}
              rows={2}
              className="mt-1 text-sm"
            />
          </div>

          <div>
            <Label className="flex items-center gap-1 text-xs" htmlFor="terc-value">
              <CurrencyDollar className="h-3.5 w-3.5" /> Valor/par (R$) *
            </Label>
            <NumberInput
              id="terc-value"
              value={valuePerPair}
              onChange={setValuePerPair}
              step="0.01"
              min={0}
              decimals={2}
              className="mt-1 h-10"
            />
          </div>

          <div className="flex min-h-10 items-center gap-2 self-end rounded-md border border-border px-3">
            <Switch id="terc-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="terc-active" className="cursor-pointer text-xs">Ativa</Label>
          </div>

          {usingDeactivationFallback && (
            <p className="sm:col-span-2 text-xs font-medium text-warning">
              A configuração está incompleta. Ao salvar, somente a desativação será aplicada;
              os demais campos permanecerão como estavam.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit || isPending}>
            {isPending ? 'Salvando…' : editing ? 'Salvar' : 'Adicionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeId(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}
