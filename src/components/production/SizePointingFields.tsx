import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { NumberInput } from '@/components/ui/number-input';
import { supabase } from '@/integrations/supabase/client';
import { useOrderPointings } from '@/hooks/useOrderPointings';
import { useSectorSettings } from '@/hooks/useProductionEngine';
import { sameStage } from '@/lib/production/stageFlow';
import {
  clampSizeQuantity,
  KNIFE_RANGE_MISSING,
  knifeOverMessage,
  knifeRangePlan,
  knownSizesFromPointings,
  pointingSizeBalance,
  sectorPointingMode,
  sizeBreakdownFromEntries,
  sizeLaunchMeter,
  sumSizes,
  type SizeBalance,
  type SizeMap,
} from '@/lib/production/sizePointing';

export interface SizeLaunchState {
  /** off = setor comum; loading = ainda lendo; grid = faixa ou numeração; total = ficha sem faixa; fallback = sem grade. */
  mode: 'off' | 'loading' | 'grid' | 'fallback' | 'total';
  /** Pares deste lançamento (sempre ≥ 0; o estorno troca o sinal na gravação). */
  quantity: number;
  /** Numeração ou faixa deste lançamento, valores positivos. null quando o total é digitado à mão. */
  breakdown: SizeMap | null;
}

export function pointingShowsManualQuantity(mode: SizeLaunchState['mode']): boolean {
  return mode === 'off' || mode === 'fallback' || mode === 'total';
}

interface FieldsProps {
  balance: SizeBalance;
  backward: boolean;
  value: SizeMap;
  readOnly?: boolean;
  kind?: 'size' | 'knife';
  hints?: Record<string, string>;
  onChange: (size: string, quantity: number, blocked: boolean) => void;
}

/**
 * Uma célula por numeração. O operador vê, enquanto digita, "lançado/falta":
 * a falta vai em âmbar; zerou, o número fica verde como concluído.
 */
export function SizePointingFields({
  balance, backward, value, readOnly = false, kind = 'size', hints, onChange,
}: FieldsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState<{ label: string; attempted: number } | null>(null);
  const caps = backward ? balance.known : balance.pending;
  const sizes = balance.sizes.filter(size => (backward ? (balance.known[size] || 0) : true));
  const totalCap = sumSizes(caps);
  const totalTyped = sizes.reduce((sum, size) => sum + clampSizeQuantity(value[size] || 0, caps[size] || 0), 0);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    const inputs = [...(scrollerRef.current?.querySelectorAll('input') ?? [])];
    const index = inputs.indexOf(event.target as HTMLInputElement);
    if (index < 0 || index >= inputs.length - 1) return;
    event.preventDefault();
    inputs[index + 1].focus();
  };

  if (sizes.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-foreground">
          {backward
            ? (kind === 'knife' ? 'Estorno por faixa' : 'Estorno por numeração')
            : (kind === 'knife' ? 'Lançamento por faixa' : 'Lançamento por numeração')}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {totalTyped}/{Math.max(0, totalCap - totalTyped)} neste lançamento
        </p>
      </div>
      <div
        ref={scrollerRef}
        onKeyDown={onKeyDown}
        data-testid="size-pointing-grid"
        className="grid min-w-0 grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12"
      >
        {sizes.map(size => {
          const cap = caps[size] || 0;
          const typed = clampSizeQuantity(value[size] || 0, cap);
          const meter = sizeLaunchMeter(typed, cap);
          const already = balance.known[size] || 0;
          const stillOwed = Math.max(0, (balance.target[size] || 0) - already);
          const finishedSize = !backward && cap === 0 && stillOwed === 0;
          const heldForLater = !backward && cap === 0 && stillOwed > 0;
          return (
            <div key={size} className="flex min-w-0 flex-col gap-1">
              <span className="text-center font-mono text-sm font-semibold text-foreground">{size}</span>
              {hints?.[size] && (
                <span className="text-center text-[10px] leading-tight text-muted-foreground">{hints[size]}</span>
              )}
              <NumberInput
                aria-label={kind === 'knife' ? `Faixa ${size}` : `Numeração ${size}`}
                inputMode="numeric"
                decimals={0}
                min={0}
                value={typed}
                disabled={readOnly || cap === 0}
                max={cap}
                onClamp={attempted => setBlocked({ label: size, attempted })}
                onChange={next => {
                  setBlocked(current => (current?.label === size ? null : current));
                  onChange(size, next, false);
                }}
                className="h-11 px-1 text-center md:h-10"
              />
              {finishedSize || heldForLater ? (
                <p className={`text-center text-[10px] font-semibold ${finishedSize ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                  {finishedSize ? 'concluído' : 'agora 0'}
                </p>
              ) : (
                <p className="text-center font-mono text-xs" aria-live="polite">
                  <span className="text-foreground">{meter.launched}</span>
                  <span className="text-muted-foreground">/</span>
                  <span className={meter.done ? 'font-semibold text-green-600 dark:text-green-400' : 'font-semibold text-amber-600 dark:text-amber-400'}>
                    {meter.falta}
                  </span>
                </p>
              )}
              {meter.done && cap > 0 && (
                <p className="text-center text-[10px] font-semibold text-green-600 dark:text-green-400">concluído</p>
              )}
              {meter.over && (
                <p role="alert" className="text-center text-[10px] font-semibold text-destructive">acima</p>
              )}
              {!backward && already > 0 && cap > 0 && (
                <p className="text-center text-[10px] text-muted-foreground">já {already}</p>
              )}
            </div>
          );
        })}
      </div>
      {blocked && (caps[blocked.label] || 0) > 0 && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {kind === 'knife'
            ? knifeOverMessage(blocked.label, blocked.attempted, caps[blocked.label] || 0)
            : `O ${blocked.label} só tem ${caps[blocked.label]} pares neste saldo. O campo voltou para ${caps[blocked.label]}.`}
        </p>
      )}
      {balance.legacyUnallocated > 0 && (
        <p className="text-[11px] leading-snug text-muted-foreground">
          {balance.legacyUnallocated} pares deste setor já foram lançados sem numeração.
          O saldo de cada número foi ajustado para fechar o que ainda falta.
        </p>
      )}
    </div>
  );
}

interface LaunchProps {
  orderId: string;
  stageName: string;
  quantityTotal: number;
  quantityProcessed: number;
  launchablePairs: number;
  backward: boolean;
  readOnly?: boolean;
  onState: (state: SizeLaunchState) => void;
}

/**
 * Liga a grade quando o cadastro do setor tem `point_by_size`.
 * Sem grade na OP, devolve fallback e a janela continua pelo total.
 */
export function SizePointingLaunch({
  orderId,
  stageName,
  quantityTotal,
  quantityProcessed,
  launchablePairs,
  backward,
  readOnly = false,
  onState,
}: LaunchProps) {
  const { data: sectors = [], isLoading: sectorsLoading } = useSectorSettings();
  const detailMode = sectorPointingMode(sectors, stageName, sameStage);
  const enabled = detailMode != null && !!orderId;
  const gradeQuery = useQuery({
    queryKey: ['order-size-grade', orderId, detailMode],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('grade, quantity, reference_id')
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      const order = data as { grade: SizeMap | null; quantity: number; reference_id: string | null } | null;
      let ranges: unknown = null;
      let stages: { stage_name: string; quantity_processed: number }[] = [];
      if (detailMode === 'knife_range') {
        if (order?.reference_id) {
          const sheet = await supabase
            .from('technical_sheets')
            .select('knife_size_ranges')
            .eq('id', order.reference_id)
            .maybeSingle();
          if (sheet.error) throw sheet.error;
          ranges = sheet.data?.knife_size_ranges ?? null;
        }
        const stageRows = await supabase
          .from('order_stages')
          .select('stage_name, quantity_processed')
          .eq('order_id', orderId);
        if (stageRows.error) throw stageRows.error;
        stages = (stageRows.data ?? []) as { stage_name: string; quantity_processed: number }[];
      }
      return { grade: order?.grade ?? null, ranges, stages };
    },
  });
  const pointings = useOrderPointings(enabled ? orderId : null);
  const knife = useMemo(() => {
    if (detailMode !== 'knife_range' || !gradeQuery.data) return null;
    const me = sectors.find(sector => sameStage(sector.sector, stageName) && sector.point_by_size_mode === 'knife_range');
    const onOrder = (sectorName: string) => (gradeQuery.data?.stages ?? []).some(stage => sameStage(stage.stage_name, sectorName));
    const upstream = me && me.check_prev_sector_limit !== false
      ? (sameStage(stageName, 'Costura Cabedal')
        ? sectors.find(sector => sameStage(sector.sector, 'Corte Cabedal') && onOrder(sector.sector))
        : sectors
          .filter(sector => sector.point_by_size_mode === 'knife_range'
            && sector.flow_order < me.flow_order
            && onOrder(sector.sector))
          .sort((a, b) => b.flow_order - a.flow_order)[0])
      : undefined;
    let upstreamKnown: SizeMap | null = null;
    if (upstream) {
      const known = knownSizesFromPointings(pointings.data ?? [], upstream.sector, sameStage);
      const processed = (gradeQuery.data.stages ?? [])
        .find(stage => sameStage(stage.stage_name, upstream.sector))?.quantity_processed ?? 0;
      upstreamKnown = sumSizes(known) === 0 && processed > 0 ? null : known;
    }
    return knifeRangePlan({
      grade: gradeQuery.data.grade,
      rangesRaw: gradeQuery.data.ranges,
      quantityTotal,
      quantityProcessed,
      known: knownSizesFromPointings(pointings.data ?? [], stageName, sameStage),
      launchablePairs,
      upstreamKnown,
    });
  }, [detailMode, gradeQuery.data, sectors, stageName, pointings.data, quantityTotal, quantityProcessed, launchablePairs]);
  const balance = useMemo(() => {
    if (detailMode === 'knife_range') return knife?.balance ?? null;
    if (detailMode !== 'size') return null;
    return pointingSizeBalance({
      grade: (gradeQuery.data?.grade as SizeMap | null) ?? null,
      quantityTotal,
      quantityProcessed,
      known: knownSizesFromPointings(pointings.data ?? [], stageName, sameStage),
      launchablePairs,
    });
  }, [detailMode, knife, gradeQuery.data, quantityTotal, quantityProcessed, pointings.data, stageName, launchablePairs]);

  const caps = useMemo(
    () => (balance ? (backward ? balance.known : balance.pending) : {}),
    [balance, backward],
  );
  const [entries, setEntries] = useState<SizeMap>({});
  const dirty = useRef(false);
  const signature = `${orderId}:${stageName}:${backward}:${JSON.stringify(caps)}`;

  useEffect(() => {
    dirty.current = false;
  }, [orderId, stageName, backward]);

  useEffect(() => {
    if (!balance) return;
    setEntries(prev => {
      if (!dirty.current) {
        const next: SizeMap = {};
        for (const size of balance.sizes) next[size] = backward ? 0 : (balance.pending[size] || 0);
        return next;
      }
      const next: SizeMap = {};
      for (const size of balance.sizes) {
        next[size] = clampSizeQuantity(prev[size] || 0, caps[size] || 0);
      }
      return next;
    });
    // A assinatura já cobre caps/etapa. balance entra só pra ler o pré-preenchimento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const breakdown = useMemo(
    () => (balance ? sizeBreakdownFromEntries(entries, caps) : {}),
    [balance, entries, caps],
  );
  const quantity = sumSizes(breakdown);
  const loading = detailMode != null && (sectorsLoading || gradeQuery.isLoading || pointings.isLoading);
  const mode: SizeLaunchState['mode'] = detailMode == null
    ? 'off'
    : loading
      ? 'loading'
      : detailMode === 'knife_range' && knife?.warning
        ? 'total'
        : balance && balance.sizes.length > 0
          ? 'grid'
          : 'fallback';
  const reported = useRef('');

  useEffect(() => {
    const payload: SizeLaunchState = {
      mode,
      quantity: mode === 'grid' ? quantity : 0,
      breakdown: mode === 'grid' ? breakdown : null,
    };
    const key = JSON.stringify(payload);
    if (reported.current === key) return;
    reported.current = key;
    onState(payload);
  }, [onState, mode, quantity, breakdown]);

  if (!detailMode) return null;
  if (mode === 'loading') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando a grade da OP…
      </p>
    );
  }
  if (mode === 'total') {
    return (
      <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
        {KNIFE_RANGE_MISSING}. O lançamento segue pelo total de pares.
      </p>
    );
  }
  if (mode === 'fallback' || !balance) {
    return (
      <p className="text-[11px] leading-snug text-muted-foreground">
        {detailMode === 'knife_range'
          ? 'Esta OP não tem grade para distribuir nas faixas. O lançamento segue pelo total de pares.'
          : 'Este setor lança por numeração, mas esta OP não tem grade. O lançamento segue pelo total de pares.'}
      </p>
    );
  }

  const hints = Object.fromEntries((knife?.ranges ?? []).map(range => [range.label, range.sizes.join('·')]));

  return (
    <SizePointingFields
      balance={balance}
      backward={backward}
      readOnly={readOnly}
      kind={detailMode === 'knife_range' ? 'knife' : 'size'}
      hints={detailMode === 'knife_range' ? hints : undefined}
      value={entries}
      onChange={(size, next) => {
        dirty.current = true;
        const cap = caps[size] || 0;
        setEntries(prev => ({ ...prev, [size]: clampSizeQuantity(next, cap) }));
      }}
    />
  );
}
