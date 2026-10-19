import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CaretDown,
  Check,
  CircleNotch as Loader2,
  Handshake,
  Scissors,
  Truck,
  Warning,
} from '@phosphor-icons/react';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  ATELIER_SECTOR_LABEL,
  ATELIER_SECTOR_STAGE,
  ATELIER_SECTORS,
  ATELIER_STREET_SECTORS,
  atelierSheetSupport,
  type AtelierSector,
  type AtelierSheetFields,
} from '@/lib/atelier';
import {
  useAtelierLots,
  useAtelierReferenceConfig,
  useAtelierSheetKitCandidates,
  useSaveAtelierReferenceSector,
  type AtelierLotRow,
  type AtelierReferenceSectorRow,
} from '@/hooks/useAtelier';
import { ReferenceTerceirizacoesPanel } from '@/components/technical-sheets/ReferenceTerceirizacoesPanel';
import { GroupMaterialSelect } from '@/components/technical-sheets/sheetSelectors';

interface MaterialDraft {
  upper_material?: string | null;
  upper_material_group_id?: string | null;
  upper_consumption?: number | string | null;
  /** Presente pra o guard noScalarOnlyConsumption — o bloco edita o escalar do cadastro. */
  upper_consumption_per_size?: unknown;
  upper_corte_a_fio?: boolean | null;
  has_straps?: boolean | null;
}

interface Props {
  /** Ficha SALVA — o cadastro do Ateliê é validado no banco contra ela. */
  sheet: AtelierSheetFields & { id: string; production_sectors?: string[] | null };
  /** Rascunho do formulário (materiais) — edita junto com o Ateliê. */
  draft?: MaterialDraft;
  onDraftChange?: (patch: Partial<MaterialDraft>) => void;
  /** Há alteração não salva na ficha (material/aviamento podem mudar a validação). */
  dirty?: boolean;
  onGoToMaterials?: () => void;
  onSaveSheet?: () => void;
}

const SECTOR_HINT: Record<AtelierSector, string> = {
  corte_cabedal: 'Corte na fábrica, na fila do Ateliê — sem envio ao prestador.',
  costura_cabedal:
    'Depois do corte: interno (em realização → concluído) ou prestador (enviado → realizado → conferido).',
  aviamento:
    'Depois do corte: interno (em realização → concluído) ou prestador (enviado → realizado → conferido).',
};

/**
 * Aba "Ateliê" da ficha técnica: marca quais etapas o cabedal complexo tem
 * (Corte / Costura / Aviamento), preenche o material necessário e explica o
 * fluxo de cada setor.
 */
export function AtelierReferencePanel({
  sheet,
  draft,
  onDraftChange,
  dirty,
  onGoToMaterials,
  onSaveSheet,
}: Props) {
  const { data: config, isLoading } = useAtelierReferenceConfig(sheet.id);
  const rows = useMemo(() => config?.rows ?? [], [config]);
  const hasKitColumns = !!config?.hasKitColumns;
  const { data: lots = [] } = useAtelierLots();

  const liveSheet: AtelierSheetFields = {
    ...sheet,
    upper_material: draft?.upper_material ?? sheet.upper_material,
    upper_material_group_id: draft?.upper_material_group_id ?? sheet.upper_material_group_id,
    upper_consumption: draft?.upper_consumption ?? sheet.upper_consumption,
    upper_corte_a_fio: draft?.upper_corte_a_fio ?? sheet.upper_corte_a_fio,
    has_straps: draft?.has_straps ?? sheet.has_straps,
  };

  const bySector = useMemo(() => {
    const m = new Map<AtelierSector, AtelierReferenceSectorRow>();
    for (const r of rows) m.set(r.sector, r);
    return m;
  }, [rows]);

  const activeSectors = useMemo(
    () =>
      new Set(
        ATELIER_SECTORS.filter((s) => bySector.get(s)?.active && atelierSheetSupport(liveSheet, s).ok),
      ),
    [bySector, liveSheet],
  );

  const streetActive = useMemo(
    () => new Set(ATELIER_STREET_SECTORS.filter((s) => activeSectors.has(s))),
    [activeSectors],
  );

  const myLots = useMemo(
    () => lots.filter((l) => l.reference_id === sheet.id),
    [lots, sheet.id],
  );

  const needsCabedal =
    activeSectors.has('corte_cabedal') ||
    activeSectors.has('costura_cabedal') ||
    bySector.get('corte_cabedal')?.active ||
    bySector.get('costura_cabedal')?.active;

  return (
    <div className="space-y-5">
      <header className="max-w-3xl space-y-1">
        <h3 className="text-base font-bold text-foreground">
          {activeSectors.size > 0
            ? 'Cabedal complexo — preparado no Ateliê antes da OP'
            : 'Esta referência ainda não é Ateliê'}
        </h3>
        <p className="text-sm text-muted-foreground">
          Marque só as etapas que este modelo tem. Corte é sempre na fábrica. Costura e Aviamento
          podem ser internos ou com prestador — a escolha fica no pedido e no relatório. Em cada
          setor, marque manualmente quais itens da ficha entram no kit (nada vem pré-marcado).
        </p>
      </header>

      {dirty && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Há alterações não salvas na ficha. O Ateliê confere a ficha salva — salve antes de ligar setores.
          </span>
          {onSaveSheet && (
            <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onSaveSheet}>
              Salvar ficha
            </Button>
          )}
        </p>
      )}

      <Checklist
        sheet={liveSheet}
        bySector={bySector}
        activeSectors={activeSectors}
        onGoToMaterials={onGoToMaterials}
      />

      <RouteRail stages={sheet.production_sectors ?? []} streetActive={streetActive} />

      {needsCabedal && onDraftChange && (
        <CabedalMaterialsBlock draft={liveSheet} onDraftChange={onDraftChange} />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {ATELIER_SECTORS.map((sector) => (
          <SectorCard
            key={sector}
            sector={sector}
            sheet={{ ...liveSheet, id: sheet.id }}
            row={bySector.get(sector) ?? null}
            loading={isLoading}
            disabled={!!dirty}
            hasKitColumns={hasKitColumns}
            costuraActive={!!bySector.get('costura_cabedal')?.active}
            onGoToMaterials={onGoToMaterials}
          />
        ))}
      </div>

      <LotsSection lots={myLots} active={activeSectors.size > 0} />

      <Collapsible className="rounded-lg border border-border bg-card">
        <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Handshake className="h-4 w-4 text-muted-foreground" />
            Capacidade e rateio por prestador
          </span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Planejamento de capacidade</span>
            <CaretDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t border-border p-4">
          <ReferenceTerceirizacoesPanel sheetId={sheet.id} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function Checklist({
  sheet,
  bySector,
  activeSectors,
  onGoToMaterials,
}: {
  sheet: AtelierSheetFields;
  bySector: Map<AtelierSector, AtelierReferenceSectorRow>;
  activeSectors: Set<AtelierSector>;
  onGoToMaterials?: () => void;
}) {
  const items: { ok: boolean; label: string; fix?: () => void }[] = [];
  for (const sector of ATELIER_SECTORS) {
    const row = bySector.get(sector);
    if (!row?.active) continue;
    const support = atelierSheetSupport(sheet, sector);
    items.push({
      ok: support.ok,
      label: support.ok
        ? `${ATELIER_SECTOR_LABEL[sector]} pronto`
        : `${ATELIER_SECTOR_LABEL[sector]}: ${support.reason}`,
      fix: !support.ok && (sector === 'costura_cabedal' || sector === 'corte_cabedal')
        ? onGoToMaterials
        : undefined,
    });
  }
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        Nenhuma etapa ligada. Escolha Corte, Costura e/ou Aviamento nos cartões abaixo.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5 rounded-lg border border-border bg-card p-3">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-2 text-xs">
          {item.ok ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" weight="bold" />
          ) : (
            <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          )}
          <span className={cn('flex-1', item.ok ? 'text-foreground' : 'text-amber-700 dark:text-amber-400')}>
            {item.label}
            {!item.ok && item.fix && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={item.fix}
                  className="font-medium underline underline-offset-2 hover:text-primary"
                >
                  Abrir materiais
                </button>
              </>
            )}
          </span>
        </li>
      ))}
      {activeSectors.size > 0 && (
        <li className="pt-1 text-[11px] text-muted-foreground">
          {activeSectors.has('corte_cabedal') && 'Corte: OK só na fábrica. '}
          {(activeSectors.has('costura_cabedal') || activeSectors.has('aviamento')) &&
            'Costura/Aviamento: interno ou prestador (escolha no PV/relatório).'}
        </li>
      )}
    </ul>
  );
}

function CabedalMaterialsBlock({
  draft,
  onDraftChange,
}: {
  draft: AtelierSheetFields;
  onDraftChange: (patch: Partial<MaterialDraft>) => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header className="space-y-0.5">
        <h4 className="text-sm font-bold text-foreground">Material do cabedal</h4>
        <p className="text-xs text-muted-foreground">
          Preencha aqui o que o Ateliê precisa para ligar Corte/Costura. Salve a ficha depois.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <GroupMaterialSelect
          label="Grupo de cabedal"
          value={String(draft.upper_material ?? '')}
          onChange={(name) => onDraftChange({ upper_material: name || null })}
          onGroupSelect={(g) =>
            onDraftChange({
              upper_material: g.name,
              upper_material_group_id: g.id,
            })
          }
          sector="Cabedal"
        />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Consumo por par (dm²)</Label>
          <NumberInput
            value={draft.upper_consumption == null ? null : Number(draft.upper_consumption)}
            onChange={(v) => onDraftChange({ upper_consumption: Number.isFinite(v) ? v : null })}
            decimals={4}
            step="0.01"
            className="h-9"
            placeholder="0"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-foreground">
        <Switch
          checked={!!draft.upper_corte_a_fio}
          onCheckedChange={(v) => onDraftChange({ upper_corte_a_fio: v })}
        />
        Corte a fio (não passa por Costura)
      </label>
    </section>
  );
}

/* ── Rota: as etapas da ficha numa linha; o que vai pra rua desce do trilho ── */
function RouteRail({ stages, streetActive }: { stages: string[]; streetActive: Set<AtelierSector> }) {
  const streetStage = new Map<string, AtelierSector>(
    ATELIER_STREET_SECTORS.map((s) => [ATELIER_SECTOR_STAGE[s], s]),
  );
  if (stages.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        A ficha ainda não tem rota de produção. Defina os setores na aba Produção para ver o desvio pelo Ateliê.
      </p>
    );
  }
  return (
    <figure className="rounded-lg border border-border bg-card px-4 pb-3 pt-4">
      <figcaption className="sr-only">Rota de produção desta referência</figcaption>
      <ol className="flex flex-wrap items-start gap-y-4">
        {stages.map((stage, i) => {
          const sector = streetStage.get(stage);
          const onStreet = !!sector && streetActive.has(sector);
          return (
            <li key={`${stage}-${i}`} className="flex items-start">
              {i > 0 && (
                <span aria-hidden className="mt-[13px] h-px w-3 bg-border sm:w-5" />
              )}
              <span className="relative flex flex-col items-center">
                {onStreet && (
                  <span aria-hidden className="absolute inset-x-0 top-[13px] border-t border-dashed border-primary/60" />
                )}
                <span
                  className={cn(
                    'whitespace-nowrap rounded-full border px-2.5 py-1 text-xs',
                    onStreet
                      ? 'translate-y-5 border-dashed border-primary bg-primary/10 font-semibold text-primary'
                      : 'border-border bg-muted/40 text-muted-foreground',
                  )}
                >
                  {onStreet && <Truck className="mr-1 inline h-3 w-3 -translate-y-px" />}
                  {stage}
                </span>
                {onStreet && (
                  <span className="mt-6 text-[11px] text-primary">no prestador</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/* ── Cartão por setor ─────────────────────────────────────────────────────── */
function SectorCard({
  sector,
  sheet,
  row,
  loading,
  disabled,
  hasKitColumns,
  costuraActive,
  onGoToMaterials,
}: {
  sector: AtelierSector;
  sheet: AtelierSheetFields & { id?: string };
  row: AtelierReferenceSectorRow | null;
  loading: boolean;
  disabled: boolean;
  hasKitColumns: boolean;
  /** Costura ligada nesta ficha — bloqueia desligar Corte (Q13-a). */
  costuraActive: boolean;
  onGoToMaterials?: () => void;
}) {
  const isStreet = ATELIER_STREET_SECTORS.includes(sector);
  const save = useSaveAtelierReferenceSector();
  const { data: candidates = [], isLoading: candLoading } = useAtelierSheetKitCandidates(
    sheet.id,
    isStreet ? sector : null,
  );
  const support = atelierSheetSupport(sheet, sector);
  const active = !!row?.active;
  const orphan = active && !support.ok;
  const [kitGroupIds, setKitGroupIds] = useState<string[]>(row?.kit_group_ids ?? []);
  const [price, setPrice] = useState<number | null>(row?.value_per_pair ?? null);

  useEffect(() => {
    setKitGroupIds(row?.kit_group_ids ?? []);
  }, [row?.kit_group_ids]);
  useEffect(() => setPrice(row?.value_per_pair ?? null), [row?.value_per_pair]);

  const busy = save.isPending;
  const id = `atelie-${sector}`;
  const corteLockedByCostura = sector === 'corte_cabedal' && costuraActive && active;

  const toggle = (next: boolean) => {
    if (!sheet.id) return;
    if (sector === 'corte_cabedal' && !next && costuraActive) return;
    save.mutate({ referenceId: sheet.id, sector, active: next });
  };

  const toggleKitGroup = (groupId: string) => {
    if (!sheet.id) return;
    const next = kitGroupIds.includes(groupId)
      ? kitGroupIds.filter((k) => k !== groupId)
      : [...kitGroupIds, groupId];
    setKitGroupIds(next);
    save.mutate({
      referenceId: sheet.id,
      sector,
      active: true,
      kitGroupIds: next,
      materialComponents: next.length ? ['Componente Direto'] : null,
    });
  };

  const savePrice = () => {
    if (!sheet.id) return;
    const current = row?.value_per_pair ?? null;
    if (price === current) return;
    save.mutate({ referenceId: sheet.id, sector, active: true, valuePerPair: price });
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className={cn(
        'rounded-lg border bg-card p-4 transition-colors',
        active && support.ok ? 'border-primary/50' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 id={`${id}-title`} className="flex items-center gap-1.5 text-sm font-bold text-foreground">
            {sector === 'corte_cabedal' ? (
              <Scissors className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Truck className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            {ATELIER_SECTOR_LABEL[sector]}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{SECTOR_HINT[sector]}</p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Label htmlFor={`${id}-switch`} className="sr-only">
            Incluir {ATELIER_SECTOR_LABEL[sector]} no Ateliê
          </Label>
          <Switch
            id={`${id}-switch`}
            checked={active}
            disabled={
              loading
              || busy
              || disabled
              || corteLockedByCostura
              || (!active && (!support.ok || (isStreet && !hasKitColumns)))
            }
            onCheckedChange={toggle}
          />
        </div>
      </div>

      {corteLockedByCostura && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Costura ligada — Corte fica obrigatório (corte a fio sozinho: desligue a Costura).
        </p>
      )}

      {!support.ok && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Warning className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', orphan && 'text-amber-600')} />
          <div className="space-y-1">
            <p className={cn(orphan && 'text-amber-700 dark:text-amber-400')}>
              {orphan
                ? `Está ligado, mas não gera lote: ${support.reason?.charAt(0).toLowerCase()}${support.reason?.slice(1)}`
                : support.reason}
            </p>
            {(sector === 'costura_cabedal' || sector === 'corte_cabedal') && onGoToMaterials && (
              <button
                type="button"
                onClick={onGoToMaterials}
                className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
              >
                Abrir Materiais & Consumo
              </button>
            )}
          </div>
        </div>
      )}

      {sector === 'corte_cabedal' && active && support.ok && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Quando o pedido for aprovado, a cor entra no lote. O OK de corte é na fila/relatório do Ateliê — não vai ao prestador.
        </p>
      )}

      {isStreet && support.ok && !hasKitColumns && !loading && (
        <p className="mt-3 text-xs text-muted-foreground">
          Valor por par e kit do lote ficam disponíveis quando o corte em lote do Ateliê estiver ativo no banco.
        </p>
      )}

      {isStreet && active && support.ok && hasKitColumns && (
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-price`} className="text-xs">Valor pago ao prestador por par</Label>
            <div className="flex items-center gap-2" onBlur={savePrice}>
              <span className="text-sm text-muted-foreground">R$</span>
              <NumberInput
                id={`${id}-price`}
                value={price}
                onChange={(v) => setPrice(Number.isFinite(v) && v > 0 ? v : null)}
                decimals={2}
                step="0.01"
                placeholder="0,00"
                className="h-9 w-32"
                disabled={busy || disabled}
              />
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">
              Kit deste setor — grupos de COMPONENTES (nada pré-marcado)
            </legend>
            {candLoading ? (
              <p className="text-[11px] text-muted-foreground">Carregando componentes da ficha…</p>
            ) : candidates.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Nenhum componente na ficha. Cadastre na seção COMPONENTES (Engenharia) — só o grupo;
                a cor resolve no pedido.
              </p>
            ) : (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {candidates.map((c) => {
                  const gid = c.group_id;
                  const on = !!gid && kitGroupIds.includes(gid);
                  return (
                    <li key={gid || c.product_id || c.group_name}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={busy || disabled || !gid}
                        onClick={() => gid && toggleKitGroup(gid)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                          on
                            ? 'border-foreground/60 bg-muted/50 font-medium text-foreground'
                            : 'border-dashed border-border bg-background text-muted-foreground hover:bg-muted/40',
                        )}
                      >
                        {on && <Check className="h-3 w-3 shrink-0" weight="bold" />}
                        <span className="min-w-0 flex-1 truncate">{c.group_name || c.product_name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                          {c.quantity_per_unit != null
                            ? `${Number(c.quantity_per_unit).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${c.unit ? ` ${c.unit}` : ''}/par`
                            : c.component}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              Cabedal (napa) entra automático no corte. Os grupos marcados debitam na{' '}
              <strong className="text-foreground">liberação</strong>, com a cor do pedido.
              {sector === 'aviamento' && ' Aviamento inclui metragem de tiras no relatório.'}
            </p>
          </fieldset>
        </div>
      )}
    </section>
  );
}

/* ── Lotes desta referência ───────────────────────────────────────────────── */
function lotStage(lot: AtelierLotRow): string {
  if (lot.status === 'open') return 'Aguardando corte';
  const st = lot.jobs.map((j) => j.pipeline_status);
  if (st.length && st.every((s) => s === 'received_at_factory' || s === 'done')) {
    return 'Conferido / concluído';
  }
  if (st.some((s) => s === 'in_progress')) return 'Em realização (interno)';
  if (st.some((s) => s === 'realized')) return 'Realizado no prestador';
  if (st.some((s) => s === 'sent_to_contractor')) return 'Enviado ao prestador';
  return 'Cortado, pronto para envio / realização';
}

function LotsSection({ lots, active }: { lots: AtelierLotRow[]; active: boolean }) {
  if (!active && lots.length === 0) return null;
  return (
    <section aria-labelledby="atelie-lotes" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="atelie-lotes" className="text-sm font-bold text-foreground">Lotes desta referência</h4>
        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
          <Link to="/atelie?view=relatorio">Abrir relatório do Ateliê</Link>
        </Button>
      </div>
      {lots.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          Nenhum lote ainda. Quando um pedido desta referência for aprovado, cada cor entra num lote.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {lots.map((lot) => (
            <li key={lot.id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-xs">
              <span className="font-medium text-foreground">
                {lot.lot_number} · {lot.color ?? 'Sem cor'}
              </span>
              <span className="text-muted-foreground">{lotStage(lot)}</span>
              <span className="font-mono tabular-nums text-foreground">{Number(lot.pairs)} pares</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
