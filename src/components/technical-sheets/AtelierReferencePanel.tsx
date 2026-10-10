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
  ATELIER_KIT_COMPONENTS,
  ATELIER_SECTOR_LABEL,
  ATELIER_SECTOR_STAGE,
  ATELIER_STREET_SECTORS,
  atelierDefaultKit,
  atelierSheetSupport,
  type AtelierSector,
  type AtelierSheetFields,
} from '@/lib/atelier';
import {
  useAtelierLots,
  useAtelierReferenceConfig,
  useSaveAtelierReferenceSector,
  type AtelierLotRow,
  type AtelierReferenceSectorRow,
} from '@/hooks/useAtelier';
import { ReferenceTerceirizacoesPanel } from '@/components/technical-sheets/ReferenceTerceirizacoesPanel';

interface Props {
  /** Ficha SALVA — o cadastro do Ateliê é validado no banco contra ela. */
  sheet: AtelierSheetFields & { id: string; production_sectors?: string[] | null };
  /** Há alteração não salva na ficha (material/aviamento podem mudar a validação). */
  dirty?: boolean;
  onGoToMaterials?: () => void;
}

const SECTOR_HINT: Record<AtelierSector, string> = {
  corte_cabedal: '',
  costura_cabedal: 'O cabedal é cortado na fila do Ateliê e costurado pelo prestador.',
  aviamento: 'O aviamento é feito pelo prestador antes da montagem. A tira continua com o Hub de Tiras.',
};

/**
 * Aba "Ateliê" da ficha técnica: onde a referência é marcada como complexa,
 * setor por setor. A rota mostra o desvio pela rua; cada setor diz por que
 * está indisponível quando a ficha não sustenta (mesma regra do gatilho
 * `trg_atelier_catalog_validate`).
 */
export function AtelierReferencePanel({ sheet, dirty, onGoToMaterials }: Props) {
  const { data: rows = [], isLoading } = useAtelierReferenceConfig(sheet.id);
  const { data: lots = [] } = useAtelierLots();

  const bySector = useMemo(() => {
    const m = new Map<AtelierSector, AtelierReferenceSectorRow>();
    for (const r of rows) m.set(r.sector, r);
    return m;
  }, [rows]);

  const streetActive = useMemo(
    () =>
      new Set(
        ATELIER_STREET_SECTORS.filter(
          (s) => bySector.get(s)?.active && atelierSheetSupport(sheet, s).ok,
        ),
      ),
    [bySector, sheet],
  );

  const myLots = useMemo(
    () => lots.filter((l) => l.reference_id === sheet.id),
    [lots, sheet.id],
  );

  return (
    <div className="space-y-5">
      <header className="max-w-3xl space-y-1">
        <h3 className="text-base font-bold text-foreground">
          {streetActive.size > 0
            ? 'Esta referência é preparada no Ateliê antes da produção'
            : 'Esta referência é feita inteira na fábrica'}
        </h3>
        <p className="text-sm text-muted-foreground">
          Quando um pedido é aprovado, cada cor entra num lote do Ateliê. O lote é cortado aqui,
          vai ao prestador e, quando volta, a OP nasce com essas etapas já feitas.
        </p>
      </header>

      {dirty && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Warning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Há alterações não salvas na ficha. O Ateliê confere a ficha salva — salve antes de mudar os setores.
        </p>
      )}

      <RouteRail stages={sheet.production_sectors ?? []} streetActive={streetActive} />

      <div className="grid gap-4 lg:grid-cols-2">
        {ATELIER_STREET_SECTORS.map((sector) => (
          <SectorCard
            key={sector}
            sector={sector}
            sheet={sheet}
            row={bySector.get(sector) ?? null}
            loading={isLoading}
            disabled={!!dirty}
            onGoToMaterials={onGoToMaterials}
          />
        ))}
      </div>

      <LotsSection lots={myLots} active={streetActive.size > 0} />

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
                  // A linha da fábrica pula esta etapa: tracejado no lugar do posto.
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

/* ── Cartão por setor de rua ───────────────────────────────────────────────── */
function SectorCard({
  sector,
  sheet,
  row,
  loading,
  disabled,
  onGoToMaterials,
}: {
  sector: AtelierSector;
  sheet: AtelierSheetFields & { id: string };
  row: AtelierReferenceSectorRow | null;
  loading: boolean;
  disabled: boolean;
  onGoToMaterials?: () => void;
}) {
  const save = useSaveAtelierReferenceSector();
  const support = atelierSheetSupport(sheet, sector);
  const active = !!row?.active;
  const orphan = active && !support.ok;
  const kit = row?.material_components?.length ? row.material_components : atelierDefaultKit(sector);

  const [price, setPrice] = useState<number | null>(row?.value_per_pair ?? null);
  useEffect(() => setPrice(row?.value_per_pair ?? null), [row?.value_per_pair]);

  const busy = save.isPending;
  const id = `atelie-${sector}`;

  const toggle = (next: boolean) =>
    save.mutate({ referenceId: sheet.id, sector, active: next });

  const toggleKit = (c: string) => {
    const next = kit.includes(c) ? kit.filter((k) => k !== c) : [...kit, c];
    save.mutate({ referenceId: sheet.id, sector, active: true, materialComponents: next });
  };

  const savePrice = () => {
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
          <h4 id={`${id}-title`} className="text-sm font-bold text-foreground">
            {ATELIER_SECTOR_LABEL[sector]}
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">{SECTOR_HINT[sector]}</p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          <Label htmlFor={`${id}-switch`} className="sr-only">
            Mandar {ATELIER_SECTOR_LABEL[sector]} para o Ateliê
          </Label>
          <Switch
            id={`${id}-switch`}
            checked={active}
            disabled={loading || busy || disabled || (!support.ok && !active)}
            onCheckedChange={toggle}
          />
        </div>
      </div>

      {!support.ok && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Warning className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', orphan && 'text-amber-600')} />
          <div className="space-y-1">
            <p className={cn(orphan && 'text-amber-700 dark:text-amber-400')}>
              {orphan
                ? `Está ligado, mas não gera lote: ${support.reason?.charAt(0).toLowerCase()}${support.reason?.slice(1)}`
                : support.reason}
            </p>
            {sector === 'costura_cabedal' && onGoToMaterials && (
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

      {active && support.ok && (
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
              <span className="text-xs text-muted-foreground">sugerido no envio</span>
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-foreground">O que vai no kit do lote</legend>
            <div className="flex flex-wrap gap-1.5">
              {ATELIER_KIT_COMPONENTS.map((c) => {
                const on = kit.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    disabled={busy || disabled || (on && kit.length === 1)}
                    onClick={() => toggleKit(c)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                      on
                        ? 'border-foreground/60 bg-muted/50 font-medium text-foreground'
                        : 'border-dashed border-border bg-background text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    {on && <Check className="h-3 w-3" weight="bold" />}
                    {c}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Esses materiais saem do estoque quando o lote é cortado. O resto é debitado pela OP.
            </p>
          </fieldset>

          <p className="text-[11px] text-muted-foreground">O prestador é escolhido em cada envio.</p>
        </div>
      )}
    </section>
  );
}

/* ── Lotes desta referência ───────────────────────────────────────────────── */
function lotStage(lot: AtelierLotRow): string {
  if (lot.status === 'open') return 'Aguardando corte';
  const st = lot.jobs.map((j) => j.pipeline_status);
  if (st.length && st.every((s) => s === 'received_at_factory')) return 'Voltou do prestador';
  if (st.some((s) => s === 'sent_to_contractor')) return 'No prestador';
  return 'Cortado, pronto para envio';
}

function LotsSection({ lots, active }: { lots: AtelierLotRow[]; active: boolean }) {
  if (!active && lots.length === 0) return null;
  return (
    <section aria-labelledby="atelie-lotes" className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h4 id="atelie-lotes" className="text-sm font-bold text-foreground">Lotes desta referência</h4>
        <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
          <Link to="/atelie?view=fila">Abrir fila do Ateliê</Link>
        </Button>
      </div>
      {lots.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          Nenhum lote ainda. Quando um pedido desta referência for aprovado, cada cor entra num lote.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {lots.map((lot) => (
            <li key={lot.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{lot.lot_number}</span>
              <span className="font-semibold text-foreground">{lot.color || 'Sem cor'}</span>
              <span className="tabular-nums text-muted-foreground">{lot.pairs} pares</span>
              <span className="text-xs text-muted-foreground">
                {lot.orders.map((o) => o.order_number).join(', ')}
              </span>
              <span
                className={cn(
                  'ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
                  lot.status === 'open' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
                )}
              >
                {lot.status === 'open' ? <Scissors className="h-3 w-3" /> : <Truck className="h-3 w-3" />}
                {lotStage(lot)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
