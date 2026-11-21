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
  knownSizesFromPointings,
  pointingSizeBalance,
  sizeBreakdownFromEntries,
  sizeLaunchMeter,
  sumSizes,
  type SizeBalance,
  type SizeMap,
} from '@/lib/production/sizePointing';

export interface SizeLaunchState {
  /** off = setor comum; loading = ainda lendo a grade; grid = por numeração; fallback = sem grade, fica o total. */
  mode: 'off' | 'loading' | 'grid' | 'fallback';
  /** Pares deste lançamento (sempre ≥ 0; o estorno troca o sinal na gravação). */
  quantity: number;
  /** Numeração deste lançamento, valores positivos. null quando não é grade. */
  breakdown: SizeMap | null;
}

interface FieldsProps {
  balance: SizeBalance;
  backward: boolean;
  value: SizeMap;
  readOnly?: boolean;
  onChange: (size: string, quantity: number, blocked: boolean) => void;
}

/**
 * Uma célula por numeração. O operador vê, enquanto digita, "lançado/falta":
 * a falta vai em âmbar; zerou, o número fica verde como concluído.
 */
export function SizePointingFields({ balance, backward, value, readOnly = false, onChange }: FieldsProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [blockedSize, setBlockedSize] = useState<string | null>(null);
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
          {backward ? 'Estorno por numeração' : 'Lançamento por numeração'}
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          {totalTyped}/{Math.max(0, totalCap - totalTyped)} neste lançamento
        </p>
      </div>
      <div
        ref={scrollerRef}
        onKeyDown={onKeyDown}
        className="flex gap-2 overflow-x-auto pb-1"
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
            <div key={size} className="flex w-[4.75rem] shrink-0 flex-col gap-1">
              <span className="text-center font-mono text-sm font-semibold text-foreground">{size}</span>
              <NumberInput
                aria-label={`Numeração ${size}`}
                inputMode="numeric"
                decimals={0}
                min={0}
                value={typed}
                disabled={readOnly || cap === 0}
                max={cap}
                onClamp={() => setBlockedSize(size)}
                onChange={next => {
                  setBlockedSize(current => (current === size ? null : current));
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
      {blockedSize && (caps[blockedSize] || 0) > 0 && (
        <p role="alert" className="text-xs font-medium text-destructive">
          O {blockedSize} só tem {caps[blockedSize]} pares neste saldo. O campo voltou para {caps[blockedSize]}.
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
  const pointBySize = sectors.some(sector => sector.point_by_size && sameStage(sector.sector, stageName));
  const enabled = pointBySize && !!orderId;
  const gradeQuery = useQuery({
    queryKey: ['order-size-grade', orderId],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('grade, quantity')
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      return data as { grade: SizeMap | null; quantity: number } | null;
    },
  });
  const pointings = useOrderPointings(enabled ? orderId : null);
  const balance = useMemo(() => {
    if (!pointBySize) return null;
    return pointingSizeBalance({
      grade: (gradeQuery.data?.grade as SizeMap | null) ?? null,
      quantityTotal,
      quantityProcessed,
      known: knownSizesFromPointings(pointings.data ?? [], stageName, sameStage),
      launchablePairs,
    });
  }, [pointBySize, gradeQuery.data, quantityTotal, quantityProcessed, pointings.data, stageName, launchablePairs]);

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
  const mode: SizeLaunchState['mode'] = !pointBySize
    ? 'off'
    : (sectorsLoading || gradeQuery.isLoading || pointings.isLoading)
      ? 'loading'
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

  if (!pointBySize) return null;
  if (mode === 'loading') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Carregando a grade da OP…
      </p>
    );
  }
  if (mode === 'fallback' || !balance) {
    return (
      <p className="text-[11px] leading-snug text-muted-foreground">
        Este setor lança por numeração, mas esta OP não tem grade. O lançamento segue pelo total de pares.
      </p>
    );
  }

  return (
    <SizePointingFields
      balance={balance}
      backward={backward}
      readOnly={readOnly}
      value={entries}
      onChange={(size, next, blocked) => {
        dirty.current = true;
        const cap = caps[size] || 0;
        setEntries(prev => ({ ...prev, [size]: blocked ? cap : clampSizeQuantity(next, cap) }));
      }}
    />
  );
}
