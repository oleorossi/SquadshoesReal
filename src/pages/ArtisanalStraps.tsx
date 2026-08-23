import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowsClockwise as RefreshCw,
  Calculator,
  CheckCircle,
  ClockCounterClockwise,
  Factory,
  ListChecks,
  LockKey,
  Package,
  Palette,
  PaperPlaneTilt,
  PencilSimple as Pencil,
  Plus,
  Printer,
  Scissors,
  TreeStructure,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { ArtisanalStrapEditor, type ArtisanalStrapEditorMode, type ArtisanalStrapEditorOrigin } from '@/components/artisanal-straps/ArtisanalStrapEditor';
import { ArtisanalStrapConversionEditor } from '@/components/artisanal-straps/ArtisanalStrapConversionEditor';
import { ArtisanalStrapBatchMatrix } from '@/components/artisanal-straps/ArtisanalStrapBatchMatrix';
import { ArtisanalStrapMigrationResolutionDialog } from '@/components/artisanal-straps/ArtisanalStrapMigrationDialogs';
import { ArtisanalStrapLegacyProductMigrationDialog } from '@/components/artisanal-straps/ArtisanalStrapLegacyProductMigrationDialog';
import { ArtisanalStrapIncrementalApplyDialog } from '@/components/artisanal-straps/ArtisanalStrapIncrementalApplyDialog';
import { ArtisanalStrapMigrationControl } from '@/components/artisanal-straps/ArtisanalStrapMigrationControl';
import { ArtisanalStrapPlanningConfig } from '@/components/artisanal-straps/ArtisanalStrapPlanningConfig';
import { ArtisanalStrapPerformanceHistory } from '@/components/artisanal-straps/ArtisanalStrapPerformanceHistory';
import {
  ArtisanalStrapExternalOperations,
  type ReceiptTarget,
  StrapCancelBatchDialog,
  StrapReceiptDialog,
  StrapSuspendDialog,
} from '@/components/artisanal-straps/ArtisanalStrapExternalOperations';
import { StrapIdentityTrail } from '@/components/artisanal-straps/StrapIdentityTrail';
import { StrapStatusBadge } from '@/components/artisanal-straps/StrapStatusBadge';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { HubTabsList } from '@/components/layout/HubTabs';
import { TableSkeleton } from '@/components/layout/PageSkeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Panel } from '@/components/ui/panel';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useContractors } from '@/hooks/useContractors';
import { cn } from '@/lib/utils';
import {
  type ArtisanalStrapCatalog,
  type ArtisanalStrapCatalogDiagnostic,
  type ArtisanalStrapIdentityBasis,
  type ArtisanalStrapLegacyMigrationDiagnostic,
  type ArtisanalStrapRecipe,
  type ArtisanalStrapVariant,
  type CanonicalStrapColorAlias,
  type OperationalStrapDemand,
  type StrapProductionBatch,
  type StrapProductionBatchItem,
  useApproveArtisanalStrapRecipe,
  useApproveCanonicalColorAlias,
  useArtisanalStrapCatalog,
  useArtisanalStrapCatalogDiagnostics,
  useArtisanalStrapLegacyMigrationDiagnostics,
  useArtisanalStrapCostVariance,
  useArtisanalStrapDemands,
  useArtisanalStrapExternalOperations,
  useArtisanalStrapProduction,
  useArtisanalStrapRealYieldHistory,
  useDesignateBaseMaterialOfficialProduct,
  useSaveCanonicalColorAlias,
  useSaveCanonicalStrapColor,
  useRunArtisanalStrapMigrationDryRun,
  useRetryArtisanalStrapDemandJob,
  useReplanArtisanalStrapProductionBatch,
  useResumeArtisanalStrapOperation,
  useStartArtisanalStrapProductionBatch,
  useResolveTechnicalStrapLineMigration,
  useScheduleArtisanalStrapBatchItem,
  useSubmitArtisanalStrapRecipe,
} from '@/hooks/useArtisanalStraps';
import { printArtisanalStrapBatch } from '@/lib/printArtisanalStrapBatch';
import { useUpdateGroup } from '@/hooks/useGroups';
import StrapCalculator from './StrapCalculator';

const TAB_VALUES = [
  'operacao',
  'configuracao',
  'controle',
  'demandas',
  'producao',
  'cadastro',
  'receitas',
  'variantes',
  'calculadora',
  'desempenho',
  'diagnostico',
] as const;

type HubTab = (typeof TAB_VALUES)[number];
type PrimaryTab = 'operacao' | 'configuracao' | 'controle';
type OperationView = 'demandas' | 'producao';
type ConfigurationView = 'cadastro' | 'variantes' | 'ferramentas';
type ControlView = 'desempenho' | 'diagnostico';

const PRIMARY_TAB_BY_HUB_TAB: Record<HubTab, PrimaryTab> = {
  operacao: 'operacao',
  configuracao: 'configuracao',
  controle: 'controle',
  demandas: 'operacao',
  producao: 'operacao',
  cadastro: 'configuracao',
  receitas: 'configuracao',
  variantes: 'configuracao',
  calculadora: 'configuracao',
  desempenho: 'controle',
  diagnostico: 'controle',
};

interface WorkspaceNavItem<T extends string> {
  value: T;
  label: string;
  description: string;
  icon: PhosphorIcon;
  badge?: number;
}

function WorkspaceSectionNav<T extends string>({
  eyebrow,
  title,
  value,
  items,
  onChange,
}: {
  eyebrow: string;
  title: string;
  value: T;
  items: WorkspaceNavItem<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-label={title}>
      <div className="border-b border-border px-4 py-3">
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{eyebrow}</p>
        <h2 className="mt-0.5 text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className={cn('grid gap-px bg-border', items.length === 2 ? 'sm:grid-cols-2' : 'lg:grid-cols-3')} role="tablist">
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.value)}
              className={cn(
                'flex min-h-16 items-start gap-3 bg-card px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50',
              )}
            >
              <item.icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} weight={selected ? 'bold' : 'regular'} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  {item.label}
                  {item.badge ? <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{item.badge}</Badge> : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const EMPTY_CATALOG: ArtisanalStrapCatalog = {
  types: [],
  measures: [],
  colors: [],
  aliases: [],
  width_profiles: [],
  official_products: [],
  variants: [],
  recipes: [],
  legacy_recipes: [],
  products: [],
  groups: [],
  capabilities: {
    manage_strap_catalog: false,
    administer_strap_operations: false,
    approve_strap_recipe: false,
    execute_strap_batch: false,
    resolve_strap_migration: false,
    can_see_financial_values: false,
  },
};

function formatMeters(value: unknown, maximumFractionDigits = 2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return `${parsed.toLocaleString('pt-BR', { maximumFractionDigits })} m`;
}

function formatCurrencyValue(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parsed);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR');
}

function includesSearch(search: string, ...values: unknown[]) {
  const normalized = search.trim().toLocaleLowerCase('pt-BR');
  if (!normalized) return true;
  const terms = normalized.split(/\s+/).filter(Boolean);
  const haystack = values.filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
  return terms.every((term) => haystack.includes(term));
}

function mapsFor(catalog: ArtisanalStrapCatalog) {
  return {
    types: new Map(catalog.types.map((item) => [item.id, item])),
    measures: new Map(catalog.measures.map((item) => [item.id, item])),
    colors: new Map(catalog.colors.map((item) => [item.id, item])),
    groups: new Map(catalog.groups.map((item) => [item.id, item])),
    products: new Map(catalog.products.map((item) => [item.id, item])),
    variants: new Map(catalog.variants.map((item) => [item.id, item])),
  };
}

function identityForVariant(catalog: ArtisanalStrapCatalog, variant: ArtisanalStrapVariant | undefined) {
  const maps = mapsFor(catalog);
  const measure = variant ? maps.measures.get(variant.measure_id) : undefined;
  const type = measure ? maps.types.get(measure.strap_type_id) : undefined;
  return {
    typeName: type?.name,
    measureName: measure?.display_name,
    baseName: variant ? maps.groups.get(variant.base_group_id)?.name : undefined,
    colorName: variant ? maps.colors.get(variant.color_id)?.name : undefined,
  };
}

interface ReasonDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (reason: string) => Promise<unknown>;
}

function ReasonDialog({
  state,
  onClose,
}: {
  state: ReasonDialogState | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    if (submitting) return;
    setReason('');
    onClose();
  };

  const confirm = async () => {
    if (!state || !reason.trim()) return;
    setSubmitting(true);
    try {
      await state.onConfirm(reason.trim());
      close();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>{state?.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="strap-reason">Motivo *</Label>
          <Textarea
            id="strap-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Registre o motivo para a auditoria."
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button onClick={confirm} disabled={!reason.trim() || submitting}>
            {submitting ? 'Confirmando…' : state?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColorDialog({
  open,
  catalog,
  onClose,
}: {
  open: boolean;
  catalog: ArtisanalStrapCatalog;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [colorId, setColorId] = useState('');
  const [alias, setAlias] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState<'color' | 'alias'>('color');
  const saveColor = useSaveCanonicalStrapColor();
  const saveAlias = useSaveCanonicalColorAlias();
  const pending = saveColor.isPending || saveAlias.isPending;

  const close = () => {
    if (pending) return;
    setName('');
    setColorId('');
    setAlias('');
    setReason('');
    setKind('color');
    onClose();
  };

  const valid = kind === 'color'
    ? Boolean(name.trim() && reason.trim())
    : Boolean(colorId && alias.trim() && reason.trim());

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cores padronizadas</DialogTitle>
          <DialogDescription>Cadastre uma cor ou proponha um alias para revisão administrativa.</DialogDescription>
        </DialogHeader>
        <Select value={kind} onValueChange={(value) => setKind(value as 'color' | 'alias')}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="color">Nova cor padronizada</SelectItem>
            <SelectItem value="alias">Novo alias</SelectItem>
          </SelectContent>
        </Select>
        {kind === 'color' ? (
          <div className="space-y-1.5">
            <Label>Nome da cor *</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: OFF WHITE" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label>Cor padronizada *</Label>
              <Select value={colorId} onValueChange={setColorId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {catalog.colors.filter((item) => item.active).map((item) => (
                    <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Alias *</Label>
              <Input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Ex.: CURA OF WHITE" />
            </div>
          </>
        )}
        <div className="space-y-1.5">
          <Label>Motivo *</Label>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!valid || pending}
            onClick={async () => {
              if (kind === 'color') {
                await saveColor.mutateAsync({ name: name.trim(), reason: reason.trim() });
              } else {
                await saveAlias.mutateAsync({ colorId, alias: alias.trim(), reason: reason.trim() });
              }
              close();
            }}
          >
            {pending ? 'Salvando…' : kind === 'color' ? 'Salvar cor' : 'Enviar alias'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OfficialProductDialog({
  open,
  catalog,
  onClose,
}: {
  open: boolean;
  catalog: ArtisanalStrapCatalog;
  onClose: () => void;
}) {
  const [baseGroupId, setBaseGroupId] = useState('');
  const [colorId, setColorId] = useState('');
  const [productId, setProductId] = useState('');
  const [reason, setReason] = useState('');
  const designate = useDesignateBaseMaterialOfficialProduct();
  const eligibleGroupIds = new Set([
    ...catalog.products.map((item) => item.group_id).filter((id): id is string => Boolean(id)),
    ...catalog.official_products.map((item) => item.base_group_id),
  ]);
  const groups = catalog.groups.filter((item) => eligibleGroupIds.has(item.id));
  const products = catalog.products.filter((item) => item.group_id === baseGroupId && item.active !== false);

  useEffect(() => {
    if (!open) return;
    setBaseGroupId('');
    setColorId('');
    setProductId('');
    setReason('');
  }, [open]);

  const close = () => {
    if (!designate.isPending) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Definir produto-base oficial</DialogTitle>
          <DialogDescription>
            Define uma única napa física para a combinação exata de grupo e cor padronizada.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Napa-base *</Label>
            <Select
              value={baseGroupId}
              onValueChange={(value) => {
                setBaseGroupId(value);
                setProductId('');
              }}
            >
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {groups.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Cor padronizada *</Label>
            <Select value={colorId} onValueChange={setColorId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {catalog.colors.filter((item) => item.active).map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Produto físico oficial *</Label>
            <Select value={productId} onValueChange={setProductId} disabled={!baseGroupId}>
              <SelectTrigger><SelectValue placeholder={baseGroupId ? 'Selecione o SKU' : 'Escolha a napa-base primeiro'} /></SelectTrigger>
              <SelectContent>
                {products.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}{item.sku ? ` · ${item.sku}` : ''}{item.color ? ` · ${item.color}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {baseGroupId && products.length === 0 && (
              <p className="text-xs text-destructive">Cadastre um produto ativo em metros neste grupo antes de designá-lo.</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Motivo *</Label>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!baseGroupId || !colorId || !productId || !reason.trim() || designate.isPending}
            onClick={async () => {
              await designate.mutateAsync({
                baseGroupId,
                colorId,
                officialProductId: productId,
                reason: reason.trim(),
              });
              close();
            }}
          >
            {designate.isPending ? 'Definindo…' : 'Definir oficial'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface OpenEditorArgs {
  purpose?: 'conversion' | 'stock_variant';
  mode?: ArtisanalStrapEditorMode;
  origin?: ArtisanalStrapEditorOrigin;
  recipeId?: string;
  variantId?: string;
  identityBasis?: ArtisanalStrapIdentityBasis;
  measureId?: string;
  baseGroupId?: string;
  colorId?: string;
  finishedProductId?: string;
  buyReadyReviewId?: string;
  suggestedRecipeId?: string;
  suggestedYieldMPerM?: number;
  legacyRecipeId?: string;
}

function TechnicalLineMigrationDialog({
  mapId,
  catalog,
  onClose,
}: {
  mapId: string | null;
  catalog: ArtisanalStrapCatalog;
  onClose: () => void;
}) {
  const [measureId, setMeasureId] = useState('');
  const [reason, setReason] = useState('');
  const resolveLine = useResolveTechnicalStrapLineMigration();
  const maps = useMemo(() => mapsFor(catalog), [catalog]);

  useEffect(() => {
    if (!mapId) return;
    setMeasureId('');
    setReason('');
  }, [mapId]);

  const close = () => {
    if (!resolveLine.isPending) onClose();
  };

  return (
    <Dialog open={Boolean(mapId)} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolver linha técnica legada</DialogTitle>
          <DialogDescription>
            Escolha a medida por evidência do cadastro. O sistema não infere identidade pelo nome ou pela posição da linha.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Família e medida padronizadas *</Label>
            <Select value={measureId} onValueChange={setMeasureId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {catalog.measures.filter((measure) => measure.active).map((measure) => (
                  <SelectItem key={measure.id} value={measure.id}>
                    {maps.types.get(measure.strap_type_id)?.name || 'Família'} · {measure.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Motivo e evidência *</Label>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Registre por que esta medida é a correspondência correta."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancelar</Button>
          <Button
            disabled={!mapId || !measureId || !reason.trim() || resolveLine.isPending}
            onClick={async () => {
              if (!mapId) return;
              await resolveLine.mutateAsync({ mapId, measureId, reason: reason.trim() });
              close();
            }}
          >
            {resolveLine.isPending ? 'Resolvendo…' : 'Vincular medida'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ArtisanalStraps() {
  const { value: activeTab, setValue: setActiveTab } = useUrlTabState<HubTab>({
    values: TAB_VALUES,
    defaultValue: 'operacao',
    aliases: {
      recipes: 'receitas',
      optimizer: 'calculadora',
      stock: 'variantes',
      historico: 'desempenho',
      history: 'desempenho',
    },
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const activeArea = PRIMARY_TAB_BY_HUB_TAB[activeTab];
  const operationView: OperationView = activeTab === 'producao' ? 'producao' : 'demandas';
  const configurationView: ConfigurationView = activeTab === 'variantes'
    ? 'variantes'
    : activeTab === 'receitas' || activeTab === 'calculadora'
      ? 'ferramentas'
      : 'cadastro';
  const controlView: ControlView = activeTab === 'diagnostico' ? 'diagnostico' : 'desempenho';
  const [reasonDialog, setReasonDialog] = useState<ReasonDialogState | null>(null);
  const [colorDialog, setColorDialog] = useState(false);
  const [officialProductDialog, setOfficialProductDialog] = useState(false);
  const [technicalLineMapId, setTechnicalLineMapId] = useState<string | null>(null);
  const [migrationDiagnostic, setMigrationDiagnostic] = useState<ArtisanalStrapCatalogDiagnostic | ArtisanalStrapLegacyMigrationDiagnostic | null>(null);
  const [legacyProductDiagnostic, setLegacyProductDiagnostic] = useState<ArtisanalStrapLegacyMigrationDiagnostic | null>(null);
  const [incrementalApplyDiagnostic, setIncrementalApplyDiagnostic] = useState<ArtisanalStrapLegacyMigrationDiagnostic | null>(null);

  const catalogQuery = useArtisanalStrapCatalog(true);
  const catalog = catalogQuery.data || EMPTY_CATALOG;
  const demandsQuery = useArtisanalStrapDemands(true);
  const productionQuery = useArtisanalStrapProduction(operationView === 'producao' || controlView === 'diagnostico');
  const externalOperationsQuery = useArtisanalStrapExternalOperations(operationView === 'producao' && activeArea === 'operacao');
  const catalogDiagnosticsQuery = useArtisanalStrapCatalogDiagnostics(activeArea === 'controle' && controlView === 'diagnostico');
  const legacyMigrationDiagnosticsQuery = useArtisanalStrapLegacyMigrationDiagnostics(
    activeArea === 'controle' && controlView === 'diagnostico' && catalog.capabilities.resolve_strap_migration,
  );
  const realYieldQuery = useArtisanalStrapRealYieldHistory(activeArea === 'controle' && controlView === 'desempenho');
  const costVarianceQuery = useArtisanalStrapCostVariance(activeArea === 'controle' && controlView === 'desempenho');

  const submitRecipe = useSubmitArtisanalStrapRecipe();
  const approveRecipe = useApproveArtisanalStrapRecipe();
  const approveAlias = useApproveCanonicalColorAlias();
  const runMigrationDryRun = useRunArtisanalStrapMigrationDryRun();

  const editorOpen = searchParams.get('editor') === '1';
  const editorMode = (['create', 'edit', 'review'].includes(searchParams.get('mode') || '')
    ? searchParams.get('mode')
    : 'create') as ArtisanalStrapEditorMode;
  const editorOrigin = (['hub', 'estoque', 'grupos', 'compras', 'terceirizados', 'pv'].includes(searchParams.get('origin') || '')
    ? searchParams.get('origin')
    : 'hub') as ArtisanalStrapEditorOrigin;
  const editorPurpose = searchParams.get('purpose') === 'conversion'
    || (!searchParams.get('purpose') && activeArea === 'configuracao' && configurationView !== 'variantes')
    ? 'conversion'
    : 'stock_variant';

  const openEditor = (args: OpenEditorArgs = {}) => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set('editor', '1');
      params.set('mode', args.mode || 'create');
      params.set('origin', args.origin || 'hub');
      params.set('purpose', args.purpose || (
        activeArea === 'configuracao' && configurationView !== 'variantes' ? 'conversion' : 'stock_variant'
      ));
      const values: Array<[string, string | undefined]> = [
        ['recipeId', args.recipeId],
        ['variantId', args.variantId],
        ['identityBasis', args.identityBasis],
        ['measureId', args.measureId],
        ['baseGroupId', args.baseGroupId],
        ['colorId', args.colorId],
        ['finishedProductId', args.finishedProductId],
        ['buyReadyReviewId', args.buyReadyReviewId],
        ['suggestedRecipeId', args.suggestedRecipeId],
        ['suggestedYieldMPerM', args.suggestedYieldMPerM == null ? undefined : String(args.suggestedYieldMPerM)],
        ['legacyRecipeId', args.legacyRecipeId],
      ];
      for (const [key, value] of values) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      return params;
    });
  };

  const closeEditor = () => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      ['editor', 'mode', 'origin', 'purpose', 'recipeId', 'variantId', 'identityBasis', 'measureId', 'baseGroupId',
        'colorId', 'finishedProductId', 'buyReadyReviewId', 'suggestedRecipeId',
        'suggestedYieldMPerM', 'legacyRecipeId'].forEach((key) => params.delete(key));
      return params;
    }, { replace: true });
  };

  const reviewCount = catalog.variants.filter((item) => item.status === 'review_required' || item.status === 'suspended').length;
  const pendingRecipes = catalog.recipes.filter((item) => item.status === 'pending_approval').length;
  const legacyRecipeCount = catalog.legacy_recipes.length;
  const activeVariants = catalog.variants.filter((item) => item.status === 'active').length;
  const openDemands = demandsQuery.data?.demands.filter((item) => !['fulfilled', 'cancelled', 'superseded'].includes(item.status)).length;
  const focusDemand = demandsQuery.data?.demands.find((item) => !['fulfilled', 'cancelled', 'superseded'].includes(item.status));
  const focusVariant = catalog.variants.find((item) => item.id === focusDemand?.strap_variant_id)
    || catalog.variants.find((item) => item.status === 'active')
    || catalog.variants[0];
  const focusIdentity = focusVariant ? identityForVariant(catalog, focusVariant) : null;
  const focusProduct = focusVariant
    ? catalog.products.find((item) => item.id === focusVariant.finished_product_id)
    : null;

  const tabs: WorkspaceNavItem<PrimaryTab>[] = [
    { value: 'operacao', label: 'Operação', description: 'Demandas e produção', icon: Factory, badge: openDemands || undefined },
    { value: 'configuracao', label: 'Configuração', description: 'Rendimento, origem e estoque', icon: TreeStructure, badge: reviewCount || pendingRecipes || undefined },
    { value: 'controle', label: 'Controle', description: 'Desempenho e integridade', icon: Wrench },
  ];

  if (catalogQuery.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-24 w-full" />
        <TableSkeleton rows={7} />
      </div>
    );
  }

  if (catalogQuery.isError) {
    return (
      <div className="flex min-h-[420px] items-center justify-center px-4">
        <Alert variant="destructive" className="max-w-xl">
          <Warning className="h-4 w-4" />
          <AlertTitle>Não foi possível abrir Tiras</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>O cadastro de tiras não respondeu. Tente novamente antes de criar ou editar uma variante.</p>
            <Button size="sm" variant="outline" onClick={() => catalogQuery.refetch()} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · TIRAS"
        title="Tiras"
        description="Da necessidade do pedido à tira pronta: rendimento, estoque, produção e terceirização no mesmo fluxo."
        meta={(
          <>
            <strong>{activeVariants}</strong> variantes ativas · <strong>{catalog.recipes.length}</strong> conversões canônicas
            {legacyRecipeCount > 0 && <> · <strong>{legacyRecipeCount}</strong> no histórico</>}
          </>
        )}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                catalogQuery.refetch();
                demandsQuery.refetch();
                if (operationView === 'producao' || controlView === 'diagnostico') productionQuery.refetch();
                if (activeArea === 'controle' && controlView === 'desempenho') {
                  realYieldQuery.refetch();
                  costVarianceQuery.refetch();
                }
              }}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" /> Atualizar
            </Button>
            {catalog.capabilities.manage_strap_catalog && (
              <Button
                size="sm"
                onClick={() => openEditor({
                  purpose: activeArea === 'configuracao' && configurationView === 'variantes'
                    ? 'stock_variant'
                    : 'conversion',
                })}
                className="gap-2"
              >
                <Plus className="h-4 w-4" />
                {activeArea === 'configuracao' && configurationView === 'variantes'
                  ? 'Nova variante de estoque'
                  : configurationView === 'ferramentas' && activeArea === 'configuracao'
                    ? 'Nova conversão'
                    : 'Configurar tira'}
              </Button>
            )}
          </>
        }
        kpis={
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
            {[
              ['Demandas abertas', openDemands ?? '—'],
              ['Variantes ativas', activeVariants],
              ['Aguardando revisão', reviewCount],
              ['Receitas pendentes', pendingRecipes],
            ].map(([label, value]) => (
              <div key={label} className="bg-card px-3 py-3">
                <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                <p className="font-mono text-xl font-bold tabular-nums text-foreground">{value}</p>
              </div>
            ))}
          </div>
        }
      />

      {focusIdentity && (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-l-4 border-primary px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Tira em foco · {focusDemand ? 'primeira demanda aberta' : 'variante ativa'}
              </p>
              <StrapIdentityTrail {...focusIdentity} compact className="mt-2" />
            </div>
            <div className="shrink-0 text-left sm:text-right">
              <p className="max-w-64 truncate text-xs font-semibold text-foreground">{focusProduct?.name || 'Produto acabado'}</p>
              <p className="font-mono text-[10px] text-muted-foreground">{focusProduct?.sku || focusVariant?.id}</p>
            </div>
          </div>
        </div>
      )}

      <Tabs value={activeArea} onValueChange={(value) => setActiveTab(value as PrimaryTab)} className="space-y-4">
        <HubTabsList tabs={tabs} ariaLabel="Áreas de Tiras" />

        <TabsContent value="operacao" className="mt-0 space-y-4">
          <WorkspaceSectionNav<OperationView>
            eyebrow="ROTINA"
            title="Da necessidade ao lote pronto"
            value={operationView}
            onChange={(value) => setActiveTab(value)}
            items={[
              { value: 'demandas', label: 'Demandas', description: 'Necessidades de PV e reposição', icon: ListChecks, badge: openDemands || undefined },
              { value: 'producao', label: 'Produção e planejamento', description: 'Lotes, capacidade e terceirização', icon: Factory },
            ]}
          />
          {operationView === 'demandas'
            ? <DemandsTab catalog={catalog} query={demandsQuery} />
            : <ProductionTab catalog={catalog} query={productionQuery} externalQuery={externalOperationsQuery} />}
        </TabsContent>

        <TabsContent value="configuracao" className="mt-0 space-y-4">
          <ConfigurationRail
            canManage={catalog.capabilities.manage_strap_catalog}
            onConfigureYield={() => openEditor({ purpose: 'conversion', mode: 'create' })}
            onConfigureStock={() => openEditor({ purpose: 'stock_variant', mode: 'create' })}
          />
          <WorkspaceSectionNav<ConfigurationView>
            eyebrow="CENTRAL DE CONFIGURAÇÃO"
            title="Tudo que define uma tira"
            value={configurationView}
            onChange={(value) => setActiveTab(value === 'ferramentas' ? 'receitas' : value)}
            items={[
              { value: 'cadastro', label: 'Tipos e rendimento', description: 'Material-base e conversão sem cor', icon: TreeStructure },
              { value: 'variantes', label: 'Origem e estoque', description: 'Produção interna ou compra pronta', icon: Package, badge: reviewCount || undefined },
              { value: 'ferramentas', label: 'Histórico e simulação', description: 'Versões técnicas e calculadora', icon: Calculator, badge: pendingRecipes || undefined },
            ]}
          />

          {configurationView === 'cadastro' && <CatalogTab catalog={catalog} openEditor={openEditor} />}

          {configurationView === 'variantes' && (
            <VariantsTab
              catalog={catalog}
              openEditor={openEditor}
              onOpenColor={() => setColorDialog(true)}
              onOpenOfficialProduct={() => setOfficialProductDialog(true)}
              onApproveAlias={(alias) => setReasonDialog({
                title: `Aprovar alias “${alias.alias}”`,
                description: 'Depois da aprovação, esse nome alternativo passa a identificar a cor padronizada.',
                confirmLabel: 'Aprovar alias',
                onConfirm: (reason) => approveAlias.mutateAsync({ aliasId: alias.id, reason }),
              })}
            />
          )}

          {configurationView === 'ferramentas' && (
            <div className="space-y-6">
              <RecipesTab
                catalog={catalog}
                openEditor={openEditor}
                onSubmit={(recipe) => setReasonDialog({
                  title: 'Enviar receita para aprovação',
                  description: 'O rendimento permanecerá indisponível para novos PVs até ser aprovado.',
                  confirmLabel: 'Enviar',
                  onConfirm: (reason) => submitRecipe.mutateAsync({ recipeId: recipe.id, reason }),
                })}
                onApprove={(recipe) => setReasonDialog({
                  title: 'Aprovar rendimento confirmado',
                  description: `A versão ${recipe.version} valerá para os próximos pedidos; pedidos e lotes já registrados não mudam.`,
                  confirmLabel: 'Aprovar receita',
                  onConfirm: (reason) => approveRecipe.mutateAsync({ recipeId: recipe.id, reason }),
                })}
              />
              <CalculatorTab catalog={catalog} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="controle" className="mt-0 space-y-4">
          <WorkspaceSectionNav<ControlView>
            eyebrow="CONTROLE"
            title="Resultado e integridade do fluxo"
            value={controlView}
            onChange={(value) => setActiveTab(value)}
            items={[
              { value: 'desempenho', label: 'Desempenho', description: 'Rendimento real e variação de custo', icon: ClockCounterClockwise },
              { value: 'diagnostico', label: 'Diagnóstico', description: 'Pendências de cadastro e migração', icon: Warning },
            ]}
          />
          {controlView === 'desempenho' ? (
            <PerformanceTab
              catalog={catalog}
              realYieldQuery={realYieldQuery}
              costVarianceQuery={costVarianceQuery}
              openEditor={openEditor}
            />
          ) : (
            <DiagnosticsTab
              catalog={catalog}
              demandsQuery={demandsQuery}
              productionQuery={productionQuery}
              catalogDiagnosticsQuery={catalogDiagnosticsQuery}
              legacyMigrationDiagnosticsQuery={legacyMigrationDiagnosticsQuery}
              migrationDryRun={runMigrationDryRun}
              openEditor={openEditor}
              onRequestDryRun={() => setReasonDialog({
                title: 'Executar dry-run da migração',
                description: 'O relatório cria checksums e pendências de revisão, sem alterar saldos, PVs, OCs ou OSs legadas.',
                confirmLabel: 'Executar dry-run',
                onConfirm: (reason) => runMigrationDryRun.mutateAsync({ reason }),
              })}
              onResolveTechnicalLine={setTechnicalLineMapId}
              onResolveMigrationItem={setMigrationDiagnostic}
              onResolveLegacyProduct={setLegacyProductDiagnostic}
              onApplyIncrementalResolution={setIncrementalApplyDiagnostic}
            />
          )}
        </TabsContent>
      </Tabs>

      {editorPurpose === 'conversion' ? (
        <ArtisanalStrapConversionEditor
          open={editorOpen}
          onOpenChange={(open) => { if (!open) closeEditor(); }}
          catalog={catalog}
          capabilities={catalog.capabilities}
          mode={editorMode}
          origin={editorOrigin}
          recipeId={searchParams.get('recipeId')}
          measureId={searchParams.get('measureId')}
          baseGroupId={searchParams.get('baseGroupId')}
          suggestedRecipeId={searchParams.get('suggestedRecipeId')}
          suggestedYieldMPerM={searchParams.get('suggestedYieldMPerM') == null
            ? null
            : Number(searchParams.get('suggestedYieldMPerM'))}
          legacyRecipeId={searchParams.get('legacyRecipeId')}
        />
      ) : (
        <ArtisanalStrapEditor
          open={editorOpen}
          onOpenChange={(open) => { if (!open) closeEditor(); }}
          catalog={catalog}
          capabilities={catalog.capabilities}
          mode={editorMode}
          origin={editorOrigin}
          variantId={searchParams.get('variantId')}
          identityBasis={searchParams.get('identityBasis') === 'finished_product_group'
            ? 'finished_product_group'
            : null}
          measureId={searchParams.get('measureId')}
          baseGroupId={searchParams.get('baseGroupId')}
          colorId={searchParams.get('colorId')}
          finishedProductId={searchParams.get('finishedProductId')}
          buyReadyReviewId={searchParams.get('buyReadyReviewId')}
          suggestedRecipeId={searchParams.get('suggestedRecipeId')}
          suggestedYieldMPerM={searchParams.get('suggestedYieldMPerM') == null
            ? null
            : Number(searchParams.get('suggestedYieldMPerM'))}
        />
      )}

      <ReasonDialog state={reasonDialog} onClose={() => setReasonDialog(null)} />
      <ColorDialog open={colorDialog} catalog={catalog} onClose={() => setColorDialog(false)} />
      <OfficialProductDialog open={officialProductDialog} catalog={catalog} onClose={() => setOfficialProductDialog(false)} />
      <TechnicalLineMigrationDialog mapId={technicalLineMapId} catalog={catalog} onClose={() => setTechnicalLineMapId(null)} />
      <ArtisanalStrapMigrationResolutionDialog
        diagnostic={migrationDiagnostic}
        catalog={catalog}
        onClose={() => setMigrationDiagnostic(null)}
      />
      <ArtisanalStrapLegacyProductMigrationDialog
        diagnostic={legacyProductDiagnostic}
        catalog={catalog}
        onClose={() => setLegacyProductDiagnostic(null)}
      />
      <ArtisanalStrapIncrementalApplyDialog
        diagnostic={incrementalApplyDiagnostic}
        onClose={() => setIncrementalApplyDiagnostic(null)}
      />
    </div>
  );
}

function ConfigurationRail({
  canManage,
  onConfigureYield,
  onConfigureStock,
}: {
  canManage: boolean;
  onConfigureYield: () => void;
  onConfigureStock: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card" aria-labelledby="strap-configuration-flow">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-primary">FLUXO DA TIRA</p>
          <h2 id="strap-configuration-flow" className="mt-0.5 text-base font-bold text-foreground">Configure em duas etapas</h2>
        </div>
        <p className="max-w-xl text-xs text-muted-foreground">
          O rendimento é único por tipo e material. Cor e SKU entram somente quando a tira pronta realmente existir no estoque.
        </p>
      </div>
      <ol className="grid items-stretch gap-px bg-border md:grid-cols-[minmax(0,1fr)_80px_minmax(0,1fr)]">
        <li className="bg-card p-4">
          <button
            type="button"
            disabled={!canManage}
            onClick={onConfigureYield}
            className="group flex h-full w-full items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-xs font-bold text-primary-foreground">1</span>
            <span>
              <span className="block text-sm font-semibold text-foreground">Tipo, material e rendimento</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Um formulário lê as medidas físicas da napa, confirma a conversão e salva sem criar cores.
              </span>
              <span className="mt-2 block text-xs font-semibold text-primary group-hover:underline">Abrir cadastro-base</span>
            </span>
          </button>
        </li>
        <li aria-hidden="true" className="hidden bg-card md:flex md:flex-col md:items-center md:justify-center">
          <span className="h-px w-10 bg-border" />
          <span className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">depois</span>
        </li>
        <li className="bg-card p-4">
          <button
            type="button"
            disabled={!canManage}
            onClick={onConfigureStock}
            className="group flex h-full w-full items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted font-mono text-xs font-bold text-foreground">2</span>
            <span>
              <span className="block text-sm font-semibold text-foreground">Origem, cor e estoque</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                Escolha produção interna ou compra pronta e crie a cor somente quando houver necessidade real.
              </span>
              <span className="mt-2 block text-xs font-semibold text-primary group-hover:underline">Abrir variante de estoque</span>
            </span>
          </button>
        </li>
      </ol>
    </section>
  );
}

function CalculatorTab({ catalog }: { catalog: ArtisanalStrapCatalog }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
        <Calculator className="mt-0.5 h-5 w-5 shrink-0 text-primary" weight="bold" />
        <div>
          <p className="text-sm font-semibold text-foreground">Simulação livre de novas medidas</p>
          <p className="text-xs text-muted-foreground">
            Preencha largura, banda, rendimento real ou perda para testar cenários. Os valores são temporários e não são salvos nem alteram receitas do sistema.
          </p>
        </div>
      </div>

      <StrapCalculator
        embedded
        canShowFinancialValues={catalog.capabilities.can_see_financial_values === true}
      />
    </div>
  );
}

function CatalogTab({
  catalog,
  openEditor,
}: {
  catalog: ArtisanalStrapCatalog;
  openEditor: (args?: OpenEditorArgs) => void;
}) {
  const [search, setSearch] = useState('');
  const maps = useMemo(() => mapsFor(catalog), [catalog]);
  const currentRecipes = catalog.recipes.filter((recipe) => (
    recipe.status === 'approved' && !recipe.valid_to
  ));
  const visibleMeasures = catalog.measures
    .filter((measure) => {
      const type = maps.types.get(measure.strap_type_id);
      const materials = currentRecipes
        .filter((recipe) => recipe.measure_id === measure.id)
        .map((recipe) => maps.groups.get(recipe.base_group_id)?.name);
      return includesSearch(search, type?.name, measure.display_name, ...materials);
    })
    .sort((left, right) => {
      const leftType = maps.types.get(left.strap_type_id)?.name || '';
      const rightType = maps.types.get(right.strap_type_id)?.name || '';
      return `${leftType} ${left.display_name}`.localeCompare(`${rightType} ${right.display_name}`, 'pt-BR');
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          className="w-full sm:max-w-sm"
          value={search}
          onChange={setSearch}
          placeholder="Buscar tipo ou material…"
          resultCount={visibleMeasures.length}
          totalCount={catalog.measures.length}
        />
        {catalog.capabilities.manage_strap_catalog && (
          <Button
            size="sm"
            onClick={() => openEditor({ purpose: 'conversion', mode: 'create' })}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Cadastrar tipo e material
          </Button>
        )}
      </div>

      <Panel
        eyebrow="CADASTRO"
        title="Tipos de tira e materiais possíveis"
        subtitle="Escolha o tipo, vincule os materiais que podem originá-lo e confirme o rendimento. Cor e estoque de tira pronta ficam fora deste cadastro."
      >
        {visibleMeasures.length === 0 ? (
          <EmptyState
            icon={TreeStructure}
            title={search ? 'Nenhum tipo ou material encontrado' : 'Nenhum tipo de tira cadastrado'}
            description={search
              ? 'Ajuste os termos da busca.'
              : 'Cadastre o tipo, escolha um material do estoque e confirme o primeiro rendimento.'}
            action={search
              ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
              : catalog.capabilities.manage_strap_catalog
                ? <Button size="sm" onClick={() => openEditor({ purpose: 'conversion' })}>Cadastrar primeiro tipo</Button>
                : undefined}
            size="sm"
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {visibleMeasures.map((measure) => {
              const type = maps.types.get(measure.strap_type_id);
              const materialRecipes = currentRecipes
                .filter((recipe) => recipe.measure_id === measure.id)
                .sort((left, right) => (
                  (maps.groups.get(left.base_group_id)?.name || '').localeCompare(
                    maps.groups.get(right.base_group_id)?.name || '',
                    'pt-BR',
                  )
                ));
              return (
                <article key={measure.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Tipo de tira</p>
                      <h3 className="text-base font-bold text-foreground">
                        {type?.name || 'Tipo'} · {measure.display_name}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Largura final {Number(measure.finished_width_mm).toLocaleString('pt-BR')} mm
                      </p>
                    </div>
                    <Badge variant={type?.active && measure.active ? 'default' : 'secondary'}>
                      {type?.active && measure.active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Materiais possíveis
                    </p>
                    {materialRecipes.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                        Nenhum material confirmado.
                      </p>
                    ) : materialRecipes.map((recipe) => (
                      <button
                        key={recipe.id}
                        type="button"
                        onClick={() => openEditor({
                          purpose: 'conversion',
                          mode: 'edit',
                          recipeId: recipe.id,
                        })}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold">
                            {maps.groups.get(recipe.base_group_id)?.name || 'Material-base'}
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            Ficha física {Number(recipe.usable_base_width_mm_snapshot).toLocaleString('pt-BR')} mm
                            {' · '}banda {Number(recipe.cut_band_width_mm).toLocaleString('pt-BR')} mm
                          </span>
                        </span>
                        <span className="text-right">
                          <span className="block font-mono text-sm font-bold text-primary">
                            {Number(recipe.confirmed_yield_m_per_m).toLocaleString('pt-BR')} m/m
                          </span>
                          <span className="block text-[10px] text-muted-foreground">
                            {recipe.status === 'approved' ? 'Confirmado' : 'Em revisão'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {catalog.capabilities.manage_strap_catalog && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full gap-2"
                      onClick={() => openEditor({
                        purpose: 'conversion',
                        mode: 'create',
                        measureId: measure.id,
                      })}
                    >
                      <Plus className="h-4 w-4" /> Adicionar material possível
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function RecipesTab({
  catalog,
  openEditor,
  onSubmit,
  onApprove,
}: {
  catalog: ArtisanalStrapCatalog;
  openEditor: (args?: OpenEditorArgs) => void;
  onSubmit: (recipe: ArtisanalStrapRecipe) => void;
  onApprove: (recipe: ArtisanalStrapRecipe) => void;
}) {
  const [search, setSearch] = useState('');
  const { data: contractors = [] } = useContractors();
  const maps = useMemo(() => mapsFor(catalog), [catalog]);
  const contractorNames = useMemo(
    () => new Map(contractors.map((contractor) => [contractor.id, contractor.name])),
    [contractors],
  );
  const recipes = catalog.recipes
    .filter((recipe) => {
      const measure = maps.measures.get(recipe.measure_id);
      const type = measure ? maps.types.get(measure.strap_type_id) : undefined;
      return includesSearch(search, type?.name, measure?.display_name, maps.groups.get(recipe.base_group_id)?.name, recipe.status);
    })
    .sort((a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')));
  const legacyRecipes = catalog.legacy_recipes.filter((recipe) => includesSearch(
    search,
    recipe.name,
    recipe.artisanal_product_name,
    recipe.base_product_name,
    recipe.active ? 'ativa' : 'inativa',
    recipe.migration_status,
  ));
  const filteredCount = recipes.length + legacyRecipes.length;
  const totalCount = catalog.recipes.length + catalog.legacy_recipes.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          className="w-full sm:max-w-sm"
          value={search}
          onChange={setSearch}
          placeholder="Buscar conversão, medida, base ou status…"
          resultCount={filteredCount}
          totalCount={totalCount}
        />
        {catalog.capabilities.manage_strap_catalog && (
          <Button
            size="sm"
            onClick={() => openEditor({ purpose: 'conversion', mode: 'create' })}
            className="gap-2"
          >
            <Plus className="h-4 w-4" /> Nova conversão
          </Button>
        )}
      </div>
      <Panel
        flush
        eyebrow="RENDIMENTO"
        title="Conversões canônicas versionadas"
        subtitle="Uma conversão por família, medida e napa-base, compartilhada por todas as cores."
      >
        {recipes.length === 0 ? (
          <EmptyState
            icon={Scissors}
            title={search ? 'Nenhuma conversão canônica encontrada' : 'Nenhuma conversão canônica cadastrada'}
            description={catalog.legacy_recipes.length > 0
              ? 'Os cadastros anteriores continuam disponíveis no histórico abaixo.'
              : undefined}
            size="sm"
          />
        ) : (
          <div className="divide-y divide-border">
            {recipes.map((recipe) => {
              const measure = maps.measures.get(recipe.measure_id);
              const type = measure ? maps.types.get(measure.strap_type_id) : undefined;
              const base = maps.groups.get(recipe.base_group_id);
              const theoretical = Number(recipe.theoretical_yield_m_per_m);
              const confirmed = Number(recipe.confirmed_yield_m_per_m);
              const executorLabel = recipe.executor_type === 'factory'
                ? 'Fábrica'
                : contractorNames.get(recipe.default_contractor_id || '') || 'Terceirizado não identificado';
              return (
                <article key={recipe.id} className="p-4 hover:bg-muted/20">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{type?.name || 'Família'} · {measure?.display_name || 'Medida'} · {base?.name || 'Base'}</h3>
                        <StrapStatusBadge status={recipe.status} />
                        <Badge variant="outline">v{recipe.version}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Banda</p>
                          <p className="font-mono font-semibold">{recipe.cut_band_width_mm} mm</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Teórico</p>
                          <p className="font-mono font-semibold">{theoretical || '—'} m/m</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Confirmado</p>
                          <p className="font-mono font-semibold text-primary">{confirmed || '—'} m/m</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Executor</p>
                          <p className="font-semibold">{executorLabel}</p>
                        </div>
                        {catalog.capabilities.can_see_financial_values && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Transformação</p>
                            <p className="font-mono font-semibold">{formatCurrencyValue(recipe.transformation_cost_per_m)}/m</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditor({
                          purpose: 'conversion',
                          mode: 'edit',
                          recipeId: recipe.id,
                        })}
                        className="gap-2"
                      >
                        <Pencil className="h-4 w-4" /> {catalog.capabilities.manage_strap_catalog ? 'Editar' : 'Consultar'}
                      </Button>
                      {recipe.status === 'draft' && catalog.capabilities.manage_strap_catalog && (
                        <Button size="sm" onClick={() => onSubmit(recipe)} className="gap-2">
                          <PaperPlaneTilt className="h-4 w-4" /> Enviar
                        </Button>
                      )}
                      {recipe.status === 'pending_approval' && catalog.capabilities.approve_strap_recipe && (
                        <Button size="sm" onClick={() => onApprove(recipe)} className="gap-2">
                          <CheckCircle className="h-4 w-4" /> Aprovar
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      {catalog.legacy_recipes.length > 0 && (
        <Panel
          flush
          eyebrow="HISTÓRICO"
          title={`Cadastros do sistema anterior · ${catalog.legacy_recipes.length}`}
          subtitle="Os registros antigos são preservados. Reaproveitar cria uma conversão canônica somente depois da sua conferência."
        >
          {legacyRecipes.length === 0 ? (
            <EmptyState
              icon={ClockCounterClockwise}
              title="Nenhuma conversão anterior encontrada"
              description="Ajuste a busca para consultar os cadastros preservados."
              size="sm"
            />
          ) : (
            <div className="divide-y divide-border">
              {legacyRecipes.map((recipe) => {
                const executorLabel = recipe.default_contractor_id
                  ? contractorNames.get(recipe.default_contractor_id) || 'Terceirizado não identificado'
                  : 'Sem executor padrão';
                const linkedToCanonical = Boolean(recipe.canonical_recipe_id);
                const canReuse = catalog.capabilities.manage_strap_catalog
                  && catalog.capabilities.approve_strap_recipe
                  && catalog.capabilities.resolve_strap_migration
                  && catalog.capabilities.can_see_financial_values === true;
                return (
                  <article key={recipe.id} className="p-4 hover:bg-muted/20">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">
                            {recipe.artisanal_product_name} · {recipe.base_product_name}
                          </h3>
                          <Badge variant={linkedToCanonical ? 'secondary' : 'outline'}>
                            {linkedToCanonical ? 'Vinculada ao catálogo' : 'Histórico legado'}
                          </Badge>
                          <Badge variant="outline">{recipe.active ? 'Ativa no sistema anterior' : 'Inativa'}</Badge>
                        </div>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{recipe.name}</p>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3 lg:grid-cols-5">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Banda</p>
                            <p className="font-mono font-semibold">
                              {recipe.cut_width_mm ? `${recipe.cut_width_mm} mm` : '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Rendimento</p>
                            <p className="font-mono font-semibold text-primary">{Number(recipe.yield_per_meter) || '—'} m/m</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Executor</p>
                            <p className="truncate font-semibold">{executorLabel}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Atualizada em</p>
                            <p className="font-mono font-semibold">{formatDate(recipe.updated_at)}</p>
                          </div>
                          {catalog.capabilities.can_see_financial_values && (
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Mão de obra</p>
                              <p className="font-mono font-semibold">{formatCurrencyValue(recipe.labor_cost_per_meter)}/m</p>
                            </div>
                          )}
                        </div>
                      </div>
                      {linkedToCanonical ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => openEditor({
                            purpose: 'conversion',
                            mode: 'edit',
                            recipeId: recipe.canonical_recipe_id || undefined,
                          })}
                        >
                          <Pencil className="h-4 w-4" /> Abrir conversão
                        </Button>
                      ) : canReuse ? (
                        <Button
                          size="sm"
                          className="gap-2"
                          onClick={() => openEditor({
                            purpose: 'conversion',
                            mode: 'create',
                            legacyRecipeId: recipe.id,
                          })}
                        >
                          <ClockCounterClockwise className="h-4 w-4" /> Reaproveitar
                        </Button>
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <LockKey className="h-4 w-4" /> Histórico preservado
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function VariantsTab({
  catalog,
  openEditor,
  onOpenColor,
  onOpenOfficialProduct,
  onApproveAlias,
}: {
  catalog: ArtisanalStrapCatalog;
  openEditor: (args?: OpenEditorArgs) => void;
  onOpenColor: () => void;
  onOpenOfficialProduct: () => void;
  onApproveAlias: (alias: CanonicalStrapColorAlias) => void;
}) {
  const [search, setSearch] = useState('');
  const maps = useMemo(() => mapsFor(catalog), [catalog]);
  const pendingAliases = catalog.aliases.filter((item) => item.status === 'pending');
  const variants = catalog.variants.filter((variant) => {
    const identity = identityForVariant(catalog, variant);
    const product = maps.products.get(variant.finished_product_id);
    const sourceLabel = variant.identity_basis === 'reference_base' && variant.internal_production_enabled
      ? 'produção interna artesanal'
      : 'comprada pronta';
    return includesSearch(search, identity.typeName, identity.measureName, identity.baseName, identity.colorName, product?.sku, variant.status, sourceLabel);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          className="w-full sm:max-w-sm"
          value={search}
          onChange={setSearch}
          placeholder="Buscar variante, base, cor ou SKU…"
          resultCount={variants.length}
          totalCount={catalog.variants.length}
        />
        {catalog.capabilities.manage_strap_catalog && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onOpenColor} className="gap-2">
              <Palette className="h-4 w-4" /> Cores e aliases
            </Button>
            {catalog.capabilities.resolve_strap_migration && (
              <Button variant="outline" size="sm" onClick={onOpenOfficialProduct} className="gap-2">
                <CheckCircle className="h-4 w-4" /> Napa oficial por cor
              </Button>
            )}
            <ArtisanalStrapBatchMatrix catalog={catalog} />
            <Button size="sm" onClick={() => openEditor({ purpose: 'stock_variant' })} className="gap-2">
              <Plus className="h-4 w-4" /> Nova tira no estoque
            </Button>
          </div>
        )}
      </div>

      <Alert>
        <Package className="h-4 w-4" />
        <AlertTitle>Defina a modalidade da tira no estoque</AlertTitle>
        <AlertDescription>
          Produção interna (artesanal) debita o material-base e gera a tira pronta. Comprada pronta, como STRASS, movimenta diretamente o SKU acabado e não usa rendimento de napa.
        </AlertDescription>
      </Alert>

      {variants.length === 0 ? (
        <Panel><EmptyState icon={Package} title={search ? 'Nenhuma variante encontrada' : 'Nenhuma variante cadastrada'} size="sm" /></Panel>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {variants.map((variant) => {
            const identity = identityForVariant(catalog, variant);
            const product = maps.products.get(variant.finished_product_id);
            const stock = Number(product?.quantity) || 0;
            const minimum = Number(variant.min_stock_m) || 0;
            const belowFloor = stock < minimum;
            const internallyProduced = variant.identity_basis === 'reference_base'
              && variant.internal_production_enabled;
            return (
              <article key={variant.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{product?.name || 'Produto acabado sem rótulo'}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">{product?.sku || variant.id}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StrapStatusBadge status={variant.status} />
                    <Badge variant={internallyProduced ? 'default' : 'secondary'}>
                      {internallyProduced ? 'Produção interna' : 'Comprada pronta'}
                    </Badge>
                  </div>
                </div>
                <StrapIdentityTrail {...identity} compact className="mt-3" />
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-md bg-muted/40 px-2.5 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Saldo</p>
                    <p className="font-mono text-sm font-bold">{formatMeters(stock)}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2.5 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Mínimo</p>
                    <p className="font-mono text-sm font-bold">{formatMeters(minimum)}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2.5 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Piso</p>
                    <p className="text-xs font-semibold">{variant.min_stock_replenishment_mode === 'internal' ? 'Interno' : 'Compra pronta'}</p>
                  </div>
                  <div className="rounded-md bg-muted/40 px-2.5 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Compra</p>
                    <p className="text-xs font-semibold">{variant.purchase_enabled ? 'Habilitada' : 'Desabilitada'}</p>
                  </div>
                </div>
                {belowFloor && (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning-foreground">
                    <Warning className="h-4 w-4 shrink-0" /> Saldo abaixo do estoque mínimo.
                  </div>
                )}
                {variant.review_reason && (
                  <p className="mt-3 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">{variant.review_reason}</p>
                )}
                <div className="mt-4 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditor({
                      mode: variant.status === 'active' ? 'edit' : 'review',
                      variantId: variant.id,
                    })}
                    className="gap-2"
                  >
                    <Pencil className="h-4 w-4" /> {catalog.capabilities.manage_strap_catalog ? 'Editar' : 'Consultar'}
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingAliases.length > 0 && (
        <Panel
          eyebrow="CORES DO ESTOQUE"
          title={`Aliases aguardando revisão · ${pendingAliases.length}`}
          subtitle="O alias só passa a identificar uma cor depois da aprovação administrativa."
        >
          <div className="space-y-2">
            {pendingAliases.map((alias) => (
              <div key={alias.id} className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">{alias.alias}</p>
                  <p className="text-xs text-muted-foreground">
                    Sugestão para {maps.colors.get(alias.canonical_color_id)?.name || 'cor não encontrada'}
                  </p>
                </div>
                {catalog.capabilities.resolve_strap_migration && (
                  <Button size="sm" onClick={() => onApproveAlias(alias)}>Revisar e aprovar</Button>
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function DemandsTab({
  catalog,
  query,
}: {
  catalog: ArtisanalStrapCatalog;
  query: ReturnType<typeof useArtisanalStrapDemands>;
}) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<'all' | 'internal' | 'buy_ready'>('all');
  const maps = useMemo(() => mapsFor(catalog), [catalog]);
  const demands = (query.data?.demands || []).filter((demand) => {
    const variant = maps.variants.get(demand.strap_variant_id);
    const identity = identityForVariant(catalog, variant);
    const sourceMatches = source === 'all' || demand.source_mode === source;
    return sourceMatches && includesSearch(
      search,
      demand.origin_label,
      demand.sale_order_id,
      demand.origin_type === 'stock_floor' ? 'Reposição de estoque mínimo' : 'Pedido de venda',
      identity.typeName,
      identity.measureName,
      identity.baseName,
      identity.colorName,
      demand.status,
    );
  });

  if (query.isLoading) return <TableSkeleton rows={7} />;
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <Warning className="h-4 w-4" />
        <AlertTitle>Demandas indisponíveis</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>Os dados de pedidos e reposição não responderam. Tente novamente para conferir as necessidades abertas.</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Recarregar demandas
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          className="w-full sm:max-w-sm"
          value={search}
          onChange={setSearch}
          placeholder="Buscar PV, variante ou status…"
          resultCount={demands.length}
          totalCount={query.data?.demands.length || 0}
        />
        <Select value={source} onValueChange={(value) => setSource(value as typeof source)}>
          <SelectTrigger className="w-full sm:w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as origens</SelectItem>
            <SelectItem value="internal">Produção interna</SelectItem>
            <SelectItem value="buy_ready">Compra pronta</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Panel
        eyebrow="NECESSIDADE E COBERTURA"
        title="Demandas abertas"
        subtitle="Pedidos de venda e reposição do estoque mínimo continuam separados, mesmo quando compartilham lote ou ordem de compra."
      >
        {demands.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nenhuma demanda encontrada" description="Ajuste os filtros ou aguarde o processamento dos novos pedidos." size="sm" />
        ) : (
          <div className="space-y-3">
            {demands.map((demand) => (
              <DemandCard key={`${demand.origin_type}-${demand.id}`} demand={demand} catalog={catalog} />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function DemandCard({ demand, catalog }: { demand: OperationalStrapDemand; catalog: ArtisanalStrapCatalog }) {
  const variant = catalog.variants.find((item) => item.id === demand.strap_variant_id);
  const identity = identityForVariant(catalog, variant);
  const required = Number(demand.required_m) || 0;
  const allocated = (Number(demand.fulfilled_m) || 0)
    + (Number(demand.finished_stock_reserved_m) || 0)
    + (Number(demand.committed_finished_inbound_m) || 0);
  const shortage = Number(demand.replenishment_required_m) || 0;
  const criticality = demand.criticality || 'Normal';

  return (
    <article className="rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={demand.origin_type === 'stock_floor' ? 'outline' : 'secondary'}>
              {demand.origin_type === 'stock_floor'
                ? 'Reposição de estoque mínimo'
                : demand.origin_label || 'Pedido de venda'}
            </Badge>
            <Badge variant="outline">
              {demand.source_mode === 'internal' ? 'Produzir com napa própria' : 'Comprar tira pronta'}
            </Badge>
            <StrapStatusBadge status={demand.status} />
            {String(criticality).toLowerCase() !== 'normal' && (
              <Badge variant="outline" className="border-warning/50 bg-warning/10 text-warning-foreground">{criticality}</Badge>
            )}
          </div>
          <StrapIdentityTrail {...identity} compact className="mt-3" />
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-md border border-border bg-muted/20 p-1 lg:min-w-[300px]">
          <div className="rounded bg-card px-2 py-2 text-center">
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Necessário</p>
            <p className="font-mono text-sm font-bold">{formatMeters(required)}</p>
          </div>
          <div className="rounded bg-card px-2 py-2 text-center">
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Alocado</p>
            <p className="font-mono text-sm font-bold">{formatMeters(allocated)}</p>
          </div>
          <div className="rounded bg-card px-2 py-2 text-center">
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Falta</p>
            <p className="font-mono text-sm font-bold">{formatMeters(shortage)}</p>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>Início principal: <strong className="text-foreground">{formatDate(demand.main_production_start)}</strong></span>
        <span>Necessidade: <strong className="text-foreground">{formatDate(demand.needed_at)}</strong></span>
        <span>Revisão: <strong className="text-foreground">{demand.schedule_revision}</strong></span>
      </div>
    </article>
  );
}

function ProductionTab({
  catalog,
  query,
  externalQuery,
}: {
  catalog: ArtisanalStrapCatalog;
  query: ReturnType<typeof useArtisanalStrapProduction>;
  externalQuery: ReturnType<typeof useArtisanalStrapExternalOperations>;
}) {
  const [search, setSearch] = useState('');
  const batches = (query.data?.batches || []).filter((batch) => includesSearch(
    search,
    batch.batch_id,
    batch.batch_number,
    batch.target_week,
    batch.executor_type,
    batch.status,
    batch.criticality,
  ));

  if (query.isLoading) return <TableSkeleton rows={6} />;
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <Warning className="h-4 w-4" />
        <AlertTitle>Planejamento indisponível</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>Os dados de lotes não responderam. Nenhuma quantidade foi recalculada nesta tela.</p>
          <Button size="sm" variant="outline" onClick={() => query.refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Recarregar lotes
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ArtisanalStrapPlanningConfig />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          className="w-full sm:max-w-sm"
          value={search}
          onChange={setSearch}
          placeholder="Buscar semana, executor ou status…"
          resultCount={batches.length}
          totalCount={query.data?.batches.length || 0}
        />
        <Button variant="outline" size="sm" asChild className="gap-2">
          <Link to="/terceirizados?tab=orders"><Wrench className="h-4 w-4" /> Ordens terceirizadas</Link>
        </Button>
      </div>

      {batches.length === 0 ? (
        <Panel><EmptyState icon={Factory} title="Nenhum lote encontrado" description="Demandas internas compatíveis aparecerão consolidadas por semana e executor." size="sm" /></Panel>
      ) : (
        <div className="space-y-3">
          {batches.map((batch) => (
            <ProductionBatchCard
              key={batch.batch_id}
              batch={batch}
              catalog={catalog}
              items={(query.data?.items || []).filter((item) => item.batch_id === batch.batch_id)}
            />
          ))}
        </div>
      )}
      <ArtisanalStrapExternalOperations
        data={externalQuery.data}
        catalog={catalog}
        isLoading={externalQuery.isLoading}
        isError={externalQuery.isError}
        onRetry={() => externalQuery.refetch()}
      />
    </div>
  );
}

function ProductionBatchCard({
  batch,
  catalog,
  items,
}: {
  batch: StrapProductionBatch;
  catalog: ArtisanalStrapCatalog;
  items: StrapProductionBatchItem[];
}) {
  const scheduleItem = useScheduleArtisanalStrapBatchItem();
  const resumeOperation = useResumeArtisanalStrapOperation();
  const startBatch = useStartArtisanalStrapProductionBatch();
  const replanBatch = useReplanArtisanalStrapProductionBatch();
  const [receiptTarget, setReceiptTarget] = useState<ReceiptTarget | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ entityType: 'batch'; entityId: string; title: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ entityType: 'batch'; entityId: string; title: string } | null>(null);
  const [operationReasonDialog, setOperationReasonDialog] = useState<ReasonDialogState | null>(null);
  const criticality = batch.criticality || 'Normal';
  const planned = Number(batch.planned_m) || items.reduce((sum, item) => sum + (Number(item.planned_finished_m) || 0), 0);
  const scheduled = Number(batch.scheduled_m) || items.reduce((sum, item) => sum + (Number(item.scheduled_m) || 0), 0);
  const unscheduled = Number(batch.unscheduled_m) || items.reduce((sum, item) => sum + (Number(item.unscheduled_m) || 0), 0);

  const handlePrint = async () => {
    try {
      await printArtisanalStrapBatch({
        number: batch.batch_number,
        targetWeek: batch.target_week,
        executor: batch.executor_type === 'factory' ? 'Fábrica' : 'Terceirizado',
        productionStart: batch.production_start_date || '',
        deadline: batch.deadline || '',
        status: batch.status,
        criticality: String(criticality),
        lines: items.map((item) => {
          const variant = catalog.variants.find((candidate) => candidate.id === item.strap_variant_id);
          const identity = identityForVariant(catalog, variant);
          const baseProduct = catalog.products.find((product) => product.id === item.base_product_id);
          return {
            identity: [identity.typeName, identity.measureName, identity.baseName, identity.colorName].filter(Boolean).join(' · '),
            baseProduct: baseProduct?.name || item.base_product_id,
            confirmedYield: Number(item.confirmed_yield_snapshot) || 0,
            plannedFinishedM: Number(item.planned_finished_m) || 0,
            plannedBaseM: Number(item.planned_base_m) || 0,
            contributions: (item.contributions || []).map((contribution) => ({
              label: contribution.label,
              originType: contribution.origin_type,
              plannedM: Number(contribution.planned_m) || 0,
            })),
          };
        }),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível abrir a impressão do lote.');
    }
  };

  return (
    <Panel
      eyebrow={`LOTE · SEMANA ${batch.target_week || 'A DEFINIR'}`}
      title={batch.executor_type === 'factory' ? 'Fábrica' : 'Terceirizado'}
      subtitle={`Início ${formatDate(batch.production_start_date)} · Prazo ${formatDate(batch.deadline)} · Revisão ${batch.schedule_revision}`}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer className="h-4 w-4" /> Imprimir lote
          </Button>
          {catalog.capabilities.administer_strap_operations && (batch.status === 'suspended'
            ? (
              <Button variant="outline" size="sm" disabled={resumeOperation.isPending} onClick={() => resumeOperation.mutate({ entityType: 'batch', entityId: batch.batch_id })}>
                Retomar
              </Button>
            ) : !['completed', 'cancelled'].includes(batch.status) ? (
              <Button variant="outline" size="sm" onClick={() => setSuspendTarget({ entityType: 'batch', entityId: batch.batch_id, title: `Lote ${batch.batch_number}` })}>
                Pausar
              </Button>
            ) : null)}
          {catalog.capabilities.execute_strap_batch && ['planned', 'scheduled'].includes(batch.status) && (
            <Button size="sm" disabled={startBatch.isPending} onClick={() => setOperationReasonDialog({
              title: 'Iniciar lote de produção',
              description: 'O início compromete capacidade e libera os fatos físicos do lote. Registre o motivo operacional.',
              confirmLabel: 'Iniciar lote',
              onConfirm: (reason) => startBatch.mutateAsync({ batchId: batch.batch_id, reason }),
            })}>Iniciar</Button>
          )}
          {catalog.capabilities.execute_strap_batch && !['completed', 'cancelled', 'suspended'].includes(batch.status) && (
            <Button variant="outline" size="sm" disabled={replanBatch.isPending} onClick={() => setOperationReasonDialog({
              title: 'Replanejar lote inteiro',
              description: 'A capacidade e o calendário vigentes serão reaplicados; o motivo fica na trilha operacional.',
              confirmLabel: 'Replanejar lote',
              onConfirm: (reason) => replanBatch.mutateAsync({ batchId: batch.batch_id, reason }),
            })}>Replanejar lote</Button>
          )}
          {catalog.capabilities.administer_strap_operations && ['planned', 'scheduled'].includes(batch.status) && (
            <Button variant="destructive" size="sm" onClick={() => setCancelTarget({ entityType: 'batch', entityId: batch.batch_id, title: `Lote ${batch.batch_number}` })}>Cancelar</Button>
          )}
          <Badge variant={String(criticality).toLowerCase() === 'normal' ? 'secondary' : 'outline'} className={String(criticality).toLowerCase() === 'normal' ? undefined : 'border-warning/50 bg-warning/10 text-warning-foreground'}>
            {criticality}
          </Badge>
          <StrapStatusBadge status={batch.status} />
        </div>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        {[
          ['Planejado', planned],
          ['Agendado', scheduled],
          ['Sem capacidade', unscheduled],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-md bg-muted/40 px-2 py-2 text-center">
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="font-mono text-sm font-bold">{formatMeters(value)}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">Nenhuma linha operacional retornada para este lote.</p>
        ) : items.map((item) => {
          const variant = catalog.variants.find((candidate) => candidate.id === item.strap_variant_id);
          const identity = identityForVariant(catalog, variant);
          const contributions = Array.isArray(item.contributions) ? item.contributions : [];
          const itemTerminal = ['completed', 'cancelled'].includes(item.status);
          const operationSuspended = item.status === 'suspended' || batch.status === 'suspended';
          const hasPhysicalCommitment = Boolean(item.started_at || batch.started_at) || Number(item.delivered_m || 0) > 0;
          const canReceiveFactory = catalog.capabilities.execute_strap_batch
            && batch.executor_type === 'factory'
            && !itemTerminal
            && !['completed', 'cancelled'].includes(batch.status)
            && (!operationSuspended || hasPhysicalCommitment);
          return (
            <article key={item.id} className="rounded-md border border-border p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <StrapIdentityTrail {...identity} compact className="flex-1" />
                <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
                  <span className="font-mono font-semibold">{formatMeters(item.scheduled_m)}</span>
                  {Number(item.unscheduled_m) > 0 && <Badge variant="outline">{formatMeters(item.unscheduled_m)} sem agenda</Badge>}
                  {catalog.capabilities.execute_strap_batch && Number(item.unscheduled_m) > 0
                    && !itemTerminal && !operationSuspended && !['completed', 'cancelled'].includes(batch.status) && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={scheduleItem.isPending}
                      onClick={() => setOperationReasonDialog({
                        title: 'Agendar linha sem capacidade',
                        description: 'A linha será recolocada no calendário disponível com revisão auditada.',
                        confirmLabel: 'Agendar linha',
                        onConfirm: (reason) => scheduleItem.mutateAsync({ batchItemId: item.id, reason }),
                      })}
                    >
                      Replanejar
                    </Button>
                  )}
                  {canReceiveFactory && (
                    <Button
                      size="sm"
                      onClick={() => setReceiptTarget({
                        kind: 'factory',
                        id: item.id,
                        title: `Lote ${batch.batch_number} · ${identity.measureName || 'tira'}`,
                        remainingM: Math.max(0, Number(item.planned_finished_m || 0) - Number(item.approved_m || 0)),
                        contributions: contributions
                          .filter((contribution) => ['planned', 'in_progress', 'partial', 'suspended'].includes(String(contribution.status || '').toLowerCase()))
                          .filter((contribution) => Math.max(0, Number(contribution.planned_m || 0) - Number(contribution.delivered_m || 0)) > 0)
                          .map((contribution) => ({
                            contributionId: contribution.id,
                            originType: contribution.origin_type,
                            label: contribution.label,
                            remainingM: Math.max(0, Number(contribution.planned_m || 0) - Number(contribution.delivered_m || 0)),
                            priority: contribution.priority,
                          })),
                      })}
                    >Receber parcial</Button>
                  )}
                </div>
              </div>
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                {contributions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem abertura de contribuições.</p>
                ) : contributions.map((contribution, index) => (
                  <div key={contribution.id || `${contribution.origin_type}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-muted-foreground">
                      {contribution.origin_type === 'stock_floor'
                        ? 'Reposição de estoque mínimo'
                        : contribution.label || 'Pedido de venda'}
                    </span>
                    <span className="shrink-0 font-mono font-semibold text-foreground">
                      {formatMeters(contribution.planned_m)}
                    </span>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <StrapReceiptDialog target={receiptTarget} onClose={() => setReceiptTarget(null)} />
      <StrapSuspendDialog target={suspendTarget} onClose={() => setSuspendTarget(null)} />
      <StrapCancelBatchDialog target={cancelTarget} onClose={() => setCancelTarget(null)} />
      <ReasonDialog state={operationReasonDialog} onClose={() => setOperationReasonDialog(null)} />
    </Panel>
  );
}

const DIAGNOSTIC_COPY: Record<string, { title: string; correction: string }> = {
  variant_product_status_divergence: {
    title: 'Status da variante diverge do produto',
    correction: 'Revise a variante e salve novamente para sincronizar o produto acabado.',
  },
  purchase_enabled_invalid_commercial_data: {
    title: 'Compra pronta com cadastro incompleto',
    correction: 'Complete preço, unidade, conversão, MOQ, múltiplo e dias de preparo.',
  },
  active_internal_variant_without_current_recipe: {
    title: 'Variante interna sem receita vigente',
    correction: 'Crie, envie e aprove uma receita exata para a medida e napa-base.',
  },
  official_base_width_divergence: {
    title: 'Largura do produto oficial divergente',
    correction: 'Corrija a ficha do produto-base ou aprove um perfil de largura compatível.',
  },
  legacy_technical_line_review_required: {
    title: 'Linha técnica legada sem identidade canônica',
    correction: 'Resolva família, medida, napa-base e cor sem inferir pelo nome.',
  },
  legacy_recipe_map_review_required: {
    title: 'Receita legada sem versão canônica',
    correction: 'Escolha explicitamente a receita versionada que representa este cadastro legado.',
  },
  migration_review_item_required: {
    title: 'Item legado exige decisão administrativa',
    correction: 'Use a ação concreta indicada pelo tipo da revisão. Somente a origem do piso aceita resolução administrativa genérica.',
  },
  finished_strap_group_unflagged: {
    title: 'Grupo de tira acabada ainda sem a flag',
    correction: 'Confirme e marque como tira acabada. Isso tira o grupo da lista de napa-base. Se houver ficha de componente com largura de napa, apague-a antes — o banco recusa a flag.',
  },
  strap_component_sheet_looks_like_napa: {
    title: 'Ficha de componente copiada de napa em grupo de tira',
    correction: 'Apague a ficha (tira não converte área). Não normalize para 5 mm: o cadastro 1370×1000 é cópia, não a largura da tira.',
  },
  napa_width_inverted: {
    title: 'Largura do produto linear invertida em relação à ficha',
    correction: 'Espelhe a largura da ficha de componente (1370 mm) no produto. Não use GREATEST. Palmilha 1000×1500 fica de fora.',
  },
  buy_ready_line_without_variant: {
    title: 'Linha comprada pronta sem variante no catálogo',
    correction: 'Cadastre a variante finished_product_group com o SKU e o preço reais. O sistema não inventa identidade.',
  },
  internal_recipe_missing: {
    title: 'Receita interna ausente para medida × napa-base',
    correction: 'Informe o rendimento confirmado (m/m) e aprove a receita. O teto geométrico não substitui o número do dono.',
  },
  missing_base_color_sku: {
    title: 'Napa-base sem SKU linear na cor da ficha',
    correction: 'Crie o SKU da cor que falta neste grupo. Não infira a cor pelo nome da tira.',
  },
};

const HYGIENE_ISSUE_CODES = new Set([
  'finished_strap_group_unflagged',
  'strap_component_sheet_looks_like_napa',
  'napa_width_inverted',
  'buy_ready_line_without_variant',
  'internal_recipe_missing',
  'missing_base_color_sku',
]);

const LEGACY_MIGRATION_COPY: Record<string, { title: string; correction: string }> = {
  legacy_product_mapping_required: {
    title: 'Produto legado exige rateio conservativo',
    correction: 'Divida o saldo e atribua nominalmente reservas, OCs editáveis e OS abertas às variantes exatas.',
  },
  resolved_technical_line_not_persisted: {
    title: 'Linha técnica resolvida não foi persistida',
    correction: 'Reabra a resolução da medida; UUID, medida e família precisam estar no JSON da ficha.',
  },
  resolved_product_mapping_blocked: {
    title: 'Rateio resolvido deixou de conservar',
    correction: 'Documentos ou saldos mudaram. Refaça o rateio antes de gerar outro dry-run.',
  },
  resolved_product_mapping_ready_to_apply: {
    title: 'Rateio resolvido pronto para aplicação',
    correction: 'Aplique explicitamente este mapa no cutover ativo usando o checksum de escopo retornado pelo servidor.',
  },
  resolved_product_mapping_incremental_blocked: {
    title: 'Aplicação incremental do rateio bloqueada',
    correction: 'Revise os blockers do escopo e refaça o rateio quando necessário; o sistema não aplica parcialmente.',
  },
  resolved_recipe_missing_on_service_order: {
    title: 'OS histórica não recebeu a ponte de receita',
    correction: 'Revise o mapa de receita e a compatibilidade da variante da linha.',
  },
  legacy_replenishment_source_unavailable: {
    title: 'Origem de reposição indisponível',
    correction: 'Escolha uma origem atualmente disponível para a variante exata; a identidade não pode ser trocada aqui.',
  },
  ambiguous_variant_demand_not_suspended: {
    title: 'Demanda ambígua continua operacional',
    correction: 'Suspenda e resolva somente a variante afetada antes do corte.',
  },
  migrated_product_reserved_stock_mismatch: {
    title: 'Reservado migrado não confere com reservas abertas',
    correction: 'Não ajuste o bolo manualmente; reconcilie as linhas nominais de reserva.',
  },
  cutover_state_checksum_drift: {
    title: 'Estado mudou depois do cutover',
    correction: 'Execute o preflight de rollback; o checksum divergente impede reversão cega.',
  },
  stock_transfer_movement_pair_missing: {
    title: 'Transferência de saldo sem par de movimentos',
    correction: 'Bloqueio de auditoria: confira o manifesto e os movimentos compensatórios.',
  },
  legacy_base_debit_trigger_present: {
    title: 'Gatilho legado de baixa ainda está ativo',
    correction: 'Não aplique o corte enquanto o segundo escritor existir.',
  },
};

function PerformanceTab({
  catalog,
  realYieldQuery,
  costVarianceQuery,
  openEditor,
}: {
  catalog: ArtisanalStrapCatalog;
  realYieldQuery: ReturnType<typeof useArtisanalStrapRealYieldHistory>;
  costVarianceQuery: ReturnType<typeof useArtisanalStrapCostVariance>;
  openEditor: (args?: OpenEditorArgs) => void;
}) {
  return (
    <ArtisanalStrapPerformanceHistory
      catalog={catalog}
      yieldQuery={realYieldQuery}
      costQuery={costVarianceQuery}
      onSuggestYield={(row) => openEditor({
        purpose: 'conversion',
        mode: 'edit',
        origin: 'hub',
        recipeId: row.recipe_id,
        suggestedRecipeId: row.recipe_id,
        suggestedYieldMPerM: Number(row.actual_yield_m_per_m),
      })}
    />
  );
}

function DiagnosticsTab({
  catalog,
  demandsQuery,
  productionQuery,
  catalogDiagnosticsQuery,
  legacyMigrationDiagnosticsQuery,
  migrationDryRun,
  openEditor,
  onRequestDryRun,
  onResolveTechnicalLine,
  onResolveMigrationItem,
  onResolveLegacyProduct,
  onApplyIncrementalResolution,
}: {
  catalog: ArtisanalStrapCatalog;
  demandsQuery: ReturnType<typeof useArtisanalStrapDemands>;
  productionQuery: ReturnType<typeof useArtisanalStrapProduction>;
  catalogDiagnosticsQuery: ReturnType<typeof useArtisanalStrapCatalogDiagnostics>;
  legacyMigrationDiagnosticsQuery: ReturnType<typeof useArtisanalStrapLegacyMigrationDiagnostics>;
  migrationDryRun: ReturnType<typeof useRunArtisanalStrapMigrationDryRun>;
  openEditor: (args?: OpenEditorArgs) => void;
  onRequestDryRun: () => void;
  onResolveTechnicalLine: (mapId: string) => void;
  onResolveMigrationItem: (diagnostic: ArtisanalStrapCatalogDiagnostic | ArtisanalStrapLegacyMigrationDiagnostic) => void;
  onResolveLegacyProduct: (diagnostic: ArtisanalStrapLegacyMigrationDiagnostic) => void;
  onApplyIncrementalResolution: (diagnostic: ArtisanalStrapLegacyMigrationDiagnostic) => void;
}) {
  const jobs = demandsQuery.data?.jobs || [];
  const catalogIssues = catalogDiagnosticsQuery.data || [];
  const hygieneIssues = catalogIssues.filter((issue) => HYGIENE_ISSUE_CODES.has(issue.issue_code));
  const otherCatalogIssues = catalogIssues.filter((issue) => !HYGIENE_ISSUE_CODES.has(issue.issue_code));
  const legacyMigrationIssues = legacyMigrationDiagnosticsQuery.data || [];
  const reviewVariants = catalog.variants.filter((item) => item.status === 'review_required' || item.status === 'suspended');
  const archivedRecipes = catalog.recipes.filter((item) => item.status === 'superseded' || item.status === 'archived');
  const failedJobs = jobs.filter((item) => item.status === 'dead_letter' || item.status === 'error');
  const retryJob = useRetryArtisanalStrapDemandJob();
  const updateGroup = useUpdateGroup();
  const queryClient = useQueryClient();

  const flagFinishedStrapGroup = async (groupId: string) => {
    try {
      await updateGroup.mutateAsync({ id: groupId, data: { is_artisanal_strap: true } });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
    } catch {
      /* toast pelo hook */
    }
  };

  if (demandsQuery.isLoading || productionQuery.isLoading || catalogDiagnosticsQuery.isLoading
    || (catalog.capabilities.resolve_strap_migration && legacyMigrationDiagnosticsQuery.isLoading)) {
    return <TableSkeleton rows={7} />;
  }

  return (
    <div className="space-y-4">
      {(demandsQuery.isError || productionQuery.isError || catalogDiagnosticsQuery.isError
        || legacyMigrationDiagnosticsQuery.isError) && (
        <Alert variant="destructive">
          <Warning className="h-4 w-4" />
          <AlertTitle>Diagnóstico parcial</AlertTitle>
          <AlertDescription>Uma das fontes de dados não respondeu. Os blocos disponíveis permanecem somente leitura.</AlertDescription>
        </Alert>
      )}

      <Panel
        eyebrow="HIGIENE DO CADASTRO"
        title="Inventário para o dono confirmar"
        subtitle="Sugestão, nunca correção automática. A elegibilidade de napa-base continua só por UUID e pela flag is_artisanal_strap."
        actions={<Badge variant={hygieneIssues.length ? 'outline' : 'secondary'}>{hygieneIssues.length} {hygieneIssues.length === 1 ? 'ocorrência' : 'ocorrências'}</Badge>}
      >
        {catalogDiagnosticsQuery.isError ? (
          <EmptyState
            icon={Warning}
            title="Inventário indisponível"
            description="Recarregue a consulta; o hub não infere grupo pelo nome."
            action={<Button variant="outline" size="sm" onClick={() => catalogDiagnosticsQuery.refetch()}>Tentar novamente</Button>}
            size="sm"
          />
        ) : hygieneIssues.length === 0 ? (
          <EmptyState icon={CheckCircle} title="Nenhuma pendência de higiene" description="Grupos de tira, fichas de componente e larguras de napa estão coerentes com as regras atuais." size="sm" />
        ) : (
          <div className="space-y-2">
            {hygieneIssues.slice(0, 80).map((issue) => {
              const copy = DIAGNOSTIC_COPY[issue.issue_code] || {
                title: issue.issue_code,
                correction: 'Confirme o cadastro pelo UUID; o hub não inventa rendimento, SKU nem preço.',
              };
              const groupName = typeof issue.details?.group_name === 'string'
                ? issue.details.group_name
                : typeof issue.details?.base_group_name === 'string'
                  ? issue.details.base_group_name
                  : typeof issue.details?.identity_group_name === 'string'
                    ? issue.details.identity_group_name
                    : '';
              const canFlagGroup = issue.issue_code === 'finished_strap_group_unflagged'
                && catalog.capabilities.manage_strap_catalog
                && typeof issue.details?.group_id === 'string';
              const looksLikeNapaBase = issue.details?.eligible_as_napa_base === true;
              return (
                <div key={`${issue.issue_code}-${issue.entity_id}`} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{copy.title}{groupName ? ` · ${groupName}` : ''}</p>
                    <p className="text-xs text-muted-foreground">{copy.correction}</p>
                    {looksLikeNapaBase && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Este grupo ainda aparece como napa-base. Marcar a flag o remove da lista — e passa a governar compra/ajuste dos SKUs lineares.
                      </p>
                    )}
                    <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">{issue.entity_id}</p>
                    <details className="mt-2 rounded-md bg-muted/30 p-2">
                      <summary className="cursor-pointer text-xs font-semibold">Detalhes do servidor</summary>
                      <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{JSON.stringify(issue.details, null, 2)}</pre>
                    </details>
                  </div>
                  {canFlagGroup && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updateGroup.isPending}
                      onClick={() => flagFinishedStrapGroup(String(issue.details.group_id))}
                    >
                      Marcar como tira acabada
                    </Button>
                  )}
                </div>
              );
            })}
            {hygieneIssues.length > 80 && (
              <p className="text-xs text-muted-foreground">Mais {hygieneIssues.length - 80} ocorrências permanecem no relatório do servidor.</p>
            )}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
        <Panel
          eyebrow="INTEGRIDADE DOS DADOS"
          title="Diagnósticos acionáveis"
          subtitle="O servidor aponta a combinação exata; o hub nunca corrige ou infere dados automaticamente."
          actions={<Badge variant={otherCatalogIssues.length ? 'outline' : 'secondary'}>{otherCatalogIssues.length} {otherCatalogIssues.length === 1 ? 'pendência' : 'pendências'}</Badge>}
        >
          {catalogDiagnosticsQuery.isError ? (
            <EmptyState
              icon={Warning}
              title="Diagnóstico indisponível"
              description="Recarregue a consulta; não use cadastros legados como fallback."
              action={<Button variant="outline" size="sm" onClick={() => catalogDiagnosticsQuery.refetch()}>Tentar novamente</Button>}
              size="sm"
            />
          ) : otherCatalogIssues.length === 0 ? (
            <EmptyState icon={CheckCircle} title="Nenhuma inconsistência detectada" description="As regras do catálogo estão coerentes." size="sm" />
          ) : (
            <div className="space-y-2">
              {otherCatalogIssues.slice(0, 60).map((issue) => {
                const copy = DIAGNOSTIC_COPY[issue.issue_code] || {
                  title: issue.issue_code,
                  correction: 'Abra o cadastro relacionado e saneie a origem da inconsistência.',
                };
                const variant = catalog.variants.find((item) => item.id === issue.entity_id);
                const migrationEntityType = String(issue.details?.entity_type || '');
                const requiredFinishedProductId = typeof issue.details?.required_finished_product_id === 'string'
                  ? issue.details.required_finished_product_id
                  : '';
                const requiredIdentityGroupId = typeof issue.details?.required_identity_group_id === 'string'
                  ? issue.details.required_identity_group_id
                  : '';
                const buyReadyReviewId = typeof issue.details?.review_id === 'string'
                  ? issue.details.review_id
                  : '';
                const canResolveFloorReview = issue.issue_code === 'migration_review_item_required'
                  && ['legacy_replenishment_mode', 'legacy_replenishment_source_unavailable'].includes(migrationEntityType);
                const canResolveBuyReadyReview = migrationEntityType === 'buy_ready_strap_product'
                  && issue.details?.action_required === 'review_existing_variant'
                  && catalog.capabilities.manage_strap_catalog
                  && catalog.capabilities.resolve_strap_migration;
                const buyReadyReviewHasOperationalBlockers = migrationEntityType === 'buy_ready_strap_product'
                  && issue.details?.action_required === 'clear_operational_blockers_before_review';
                const canCreateBuyReadyVariant = issue.issue_code === 'migration_review_item_required'
                  && migrationEntityType === 'buy_ready_strap_product'
                  && issue.details?.action_required === 'create_variant_with_bundle'
                  && Boolean(requiredFinishedProductId && requiredIdentityGroupId && buyReadyReviewId)
                  && catalog.capabilities.manage_strap_catalog
                  && catalog.capabilities.resolve_strap_migration;
                return (
                  <div key={`${issue.issue_code}-${issue.entity_id}`} className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{copy.title}</p>
                      <p className="text-xs text-muted-foreground">{copy.correction}</p>
                      {buyReadyReviewHasOperationalBlockers && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          Concilie ou encerre as demandas, lotes e compras abertas antes de revisar e ativar a tira.
                        </p>
                      )}
                      <p className="mt-1 truncate font-mono text-[9px] text-muted-foreground">{issue.entity_id}</p>
                      {issue.issue_code === 'migration_review_item_required' && !canResolveFloorReview && (
                        <details className="mt-2 rounded-md bg-muted/30 p-2">
                          <summary className="cursor-pointer text-xs font-semibold">
                            {migrationEntityType === 'buy_ready_strap_product'
                              ? 'Revisão de tira comprada pronta'
                              : 'Revisão somente informativa'} · {migrationEntityType || 'tipo não informado'}
                          </summary>
                          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{JSON.stringify(issue.details, null, 2)}</pre>
                        </details>
                      )}
                    </div>
                    {variant && (
                      migrationEntityType !== 'buy_ready_strap_product' || canResolveBuyReadyReview
                    ) && (
                      <Button variant="outline" size="sm" onClick={() => openEditor({ mode: 'review', variantId: variant.id })}>
                        Revisar variante
                      </Button>
                    )}
                    {canCreateBuyReadyVariant && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEditor({
                          mode: 'create',
                          origin: 'hub',
                          identityBasis: 'finished_product_group',
                          baseGroupId: requiredIdentityGroupId,
                          finishedProductId: requiredFinishedProductId,
                          buyReadyReviewId,
                        })}
                      >
                        Cadastrar tira comprada
                      </Button>
                    )}
                    {issue.issue_code === 'legacy_technical_line_review_required'
                      && catalog.capabilities.resolve_strap_migration && (
                        <Button variant="outline" size="sm" onClick={() => onResolveTechnicalLine(issue.entity_id)}>
                          Vincular medida
                        </Button>
                      )}
                    {(issue.issue_code === 'legacy_recipe_map_review_required' || canResolveFloorReview)
                      && catalog.capabilities.resolve_strap_migration && (
                        <Button variant="outline" size="sm" onClick={() => onResolveMigrationItem(issue)}>
                          {canResolveFloorReview ? 'Confirmar origem do piso' : 'Vincular receita'}
                        </Button>
                      )}
                  </div>
                );
              })}
              {otherCatalogIssues.length > 60 && (
                <p className="text-xs text-muted-foreground">Mais {otherCatalogIssues.length - 60} pendências permanecem no relatório do servidor.</p>
              )}
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="LEGADO ACIONÁVEL"
          title="Rateios e bloqueios do corte"
          subtitle="Somente fatos nominais do RPC 03300; produto legado nunca é resolvido pelo marcador genérico."
          actions={catalog.capabilities.resolve_strap_migration
            ? <Badge variant={legacyMigrationIssues.length ? 'outline' : 'secondary'}>{legacyMigrationIssues.length} ocorrência(s)</Badge>
            : undefined}
        >
          {!catalog.capabilities.resolve_strap_migration ? (
            <EmptyState icon={LockKey} title="Diagnóstico exclusivo do Administrador" description="A função inclui saldos e documentos abertos usados no rateio." size="sm" />
          ) : legacyMigrationDiagnosticsQuery.isError ? (
            <EmptyState icon={Warning} title="Diagnóstico legado indisponível" description="Não use o resolvedor genérico nem aplique o corte." action={<Button size="sm" variant="outline" onClick={() => legacyMigrationDiagnosticsQuery.refetch()}>Tentar novamente</Button>} size="sm" />
          ) : legacyMigrationIssues.length === 0 ? (
            <EmptyState icon={CheckCircle} title="Nenhum bloqueio legado detectado" description="Gere um novo dry-run para congelar este estado." size="sm" />
          ) : (
            <div className="space-y-2">
              {legacyMigrationIssues.slice(0, 80).map((issue) => {
                const copy = LEGACY_MIGRATION_COPY[issue.issue_code] || { title: issue.issue_code, correction: 'Analise os detalhes retornados pelo diagnóstico administrativo.' };
                const issueDetails = issue.details as Record<string, unknown>;
                return (
                  <div key={`${issue.issue_code}-${issue.entity_id}`} className="space-y-2 rounded-md border border-border p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div><p className="text-sm font-semibold">{copy.title}</p><p className="text-xs text-muted-foreground">{copy.correction}</p><p className="mt-1 font-mono text-[9px] text-muted-foreground">{issue.entity_id}</p></div>
                      {['legacy_product_mapping_required', 'resolved_product_mapping_blocked'].includes(issue.issue_code) && (
                        <Button size="sm" variant="outline" onClick={() => onResolveLegacyProduct(issue)}>
                          {issue.issue_code === 'resolved_product_mapping_blocked' ? 'Refazer rateio' : 'Ratear saldo e documentos'}
                        </Button>
                      )}
                      {issue.issue_code === 'resolved_product_mapping_ready_to_apply' && (
                        <Button size="sm" onClick={() => onApplyIncrementalResolution(issue)}>
                          Aplicar resolução
                        </Button>
                      )}
                      {issue.issue_code === 'resolved_technical_line_not_persisted' && (
                        <Button size="sm" variant="outline" onClick={() => onResolveTechnicalLine(issue.entity_id)}>Persistir medida novamente</Button>
                      )}
                      {issue.issue_code === 'resolved_recipe_missing_on_service_order' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResolveMigrationItem({
                            issue_code: 'legacy_recipe_map_review_required',
                            entity_id: String(issueDetails.legacy_recipe_id || issue.entity_id),
                            details: issueDetails,
                          })}
                        >Reaplicar ponte de receita</Button>
                      )}
                      {issue.issue_code === 'legacy_replenishment_source_unavailable' && (
                        <Button size="sm" variant="outline" onClick={() => onResolveMigrationItem(issue)}>
                          Escolher origem disponível
                        </Button>
                      )}
                    </div>
                    <details className="rounded-md bg-muted/30 p-2"><summary className="cursor-pointer text-xs font-semibold">Detalhes e blockers</summary><pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">{JSON.stringify(issue.details, null, 2)}</pre></details>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <ArtisanalStrapMigrationControl
        canResolve={catalog.capabilities.resolve_strap_migration}
        dryRun={migrationDryRun.data}
        dryRunPending={migrationDryRun.isPending}
        onRequestDryRun={onRequestDryRun}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          eyebrow="AÇÃO CADASTRAL"
          title="Variantes em revisão ou suspensas"
          subtitle="Somente a combinação afetada fica bloqueada; o restante do catálogo continua operando."
        >
          {reviewVariants.length === 0 ? (
            <EmptyState icon={CheckCircle} title="Nenhuma variante bloqueada" size="sm" />
          ) : (
            <div className="space-y-2">
              {reviewVariants.map((variant) => {
                const identity = identityForVariant(catalog, variant);
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => openEditor({ mode: 'review', variantId: variant.id })}
                    className="w-full rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{[identity.typeName, identity.measureName, identity.baseName, identity.colorName].filter(Boolean).join(' · ')}</p>
                      <StrapStatusBadge status={variant.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{variant.review_reason || 'Revisão cadastral necessária.'}</p>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel
          eyebrow="WORKER"
          title="Fila e dead-letter"
          subtitle="Retries preservam a mesma chave idempotente e correlation_id."
        >
          {jobs.length === 0 ? (
            <EmptyState icon={CheckCircle} title="Fila sem pendências" description="Jobs concluídos e cancelados ficam fora desta view diagnóstica." size="sm" />
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <div key={job.id} className="rounded-md border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StrapStatusBadge status={job.status} />
                      <span className="font-mono text-xs">{job.attempts}/{job.max_attempts ?? '—'} tentativas</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Próxima: {formatDate(job.next_attempt_at)}</span>
                  </div>
                  {job.last_error && <p className="mt-2 break-words text-xs text-destructive">{job.last_error}</p>}
                  {job.correlation_id && <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">correlation_id: {job.correlation_id}</p>}
                  {catalog.capabilities.administer_strap_operations && ['dead_letter', 'retry'].includes(job.status) && (
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        disabled={retryJob.isPending}
                        onClick={() => retryJob.mutate({ jobId: job.id })}
                      >
                        <RefreshCw className="h-4 w-4" /> Reprocessar
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        eyebrow="HISTÓRICO IMUTÁVEL"
        title="Versões substituídas e indicadores"
        subtitle="Os registros permanecem vinculados às versões realmente usadas em cada operação."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Receitas substituídas</p>
            <p className="font-mono text-2xl font-bold">{archivedRecipes.length}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Jobs em intervenção</p>
            <p className="font-mono text-2xl font-bold">{failedJobs.length}</p>
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lotes retornados</p>
            <p className="font-mono text-2xl font-bold">{productionQuery.data?.batches.length || 0}</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
