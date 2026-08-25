import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowCounterClockwise as RotateCcw,
  CircleNotch as Loader2,
  LockKey as Lock,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useEmitNfeDevolucao, useNfeDevolucoes } from '@/hooks/useNfe';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  nfeId: string;
  nfeNumero?: string | null;
  saleOrderId: string | null;
  clientName?: string;
}

interface AvailableReturnItem {
  item_id: string;
  reference_id: string | null;
  product_id: string | null;
  material_variant_id: string | null;
  color: string;
  quantity: number;
  unit_price: number;
  qty_devolvida: number;
  original_grade: Record<string, number>;
  available_grade: Record<string, number>;
  available_quantity: number;
  technical_code: string | null;
  technical_name: string | null;
}

interface StoredReturnIntent {
  requestId: string;
  motivo: string;
  gradeQtyMap: Record<string, Record<string, number>>;
  submitted: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function gradeEntries(grade: Record<string, number> | null | undefined) {
  return Object.entries(grade || {})
    .filter(([size, quantity]) => !size.startsWith('_') && Number(quantity) > 0)
    .map(([size, quantity]) => [size, Number(quantity)] as const)
    .sort(([left], [right]) => left.localeCompare(right, 'pt-BR', { numeric: true }));
}

/**
 * Emite NF-e de entrada por devolução. A seleção é por numeração porque o
 * estoque de produto acabado também é gradeado; um total agregado não informa
 * quais pares voltaram fisicamente.
 */
export function NfeDevolucaoDialog({
  open,
  onOpenChange,
  nfeId,
  nfeNumero,
  clientName,
}: Props) {
  const emitDevolucao = useEmitNfeDevolucao();
  const { data: devolucoesPrevias = [] } = useNfeDevolucoes(nfeId);
  const storageKey = useMemo(() => `nfe-devolucao-intent:${nfeId}`, [nfeId]);
  const [requestId, setRequestId] = useState('');
  const [gradeQtyMap, setGradeQtyMap] = useState<Record<string, Record<string, number>>>({});
  const [motivo, setMotivo] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setHydratedKey(null);
    let stored: StoredReturnIntent | null = null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      stored = raw ? JSON.parse(raw) as StoredReturnIntent : null;
    } catch {
      stored = null;
    }
    if (stored && UUID_RE.test(stored.requestId)) {
      setRequestId(stored.requestId);
      setMotivo(stored.motivo || '');
      setGradeQtyMap(stored.gradeQtyMap || {});
      setSubmitted(stored.submitted === true);
      setHydratedKey(storageKey);
      return;
    }
    const nextRequestId = createRequestId();
    setRequestId(nextRequestId);
    setMotivo('');
    setGradeQtyMap({});
    setSubmitted(false);
    sessionStorage.setItem(storageKey, JSON.stringify({
      requestId: nextRequestId,
      motivo: '',
      gradeQtyMap: {},
      submitted: false,
    } satisfies StoredReturnIntent));
    setHydratedKey(storageKey);
  }, [open, storageKey]);

  useEffect(() => {
    if (!open || hydratedKey !== storageKey || !UUID_RE.test(requestId)) return;
    sessionStorage.setItem(storageKey, JSON.stringify({
      requestId,
      motivo,
      gradeQtyMap,
      submitted,
    } satisfies StoredReturnIntent));
  }, [gradeQtyMap, hydratedKey, motivo, open, requestId, storageKey, submitted]);

  const {
    data: items = [],
    error: itemsError,
    isLoading,
  } = useQuery({
    queryKey: ['nfe_devolucao_available_items', nfeId, requestId],
    enabled: open && UUID_RE.test(requestId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        'get_nfe_devolucao_available_items' as never,
        { p_nfe_original_id: nfeId, p_request_id: requestId } as never,
      );
      if (error) throw error;
      return (data || []) as AvailableReturnItem[];
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const itemsWithBalance = useMemo(() => items.map(item => ({
    ...item,
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    qty_devolvida: Number(item.qty_devolvida || 0),
    available_quantity: Number(item.available_quantity || 0),
    gradeEntries: gradeEntries(item.available_grade),
  })), [items]);

  const selection = useMemo(() => {
    let pairs = 0;
    let value = 0;
    const payload: Array<{
      sale_order_item_id: string;
      qty: number;
      grade: Record<string, number>;
    }> = [];
    for (const item of itemsWithBalance) {
      const grade: Record<string, number> = {};
      let itemQuantity = 0;
      for (const [size, available] of item.gradeEntries) {
        const requested = Math.trunc(Number(gradeQtyMap[item.item_id]?.[size] || 0));
        const quantity = Math.max(0, Math.min(available, requested));
        if (quantity > 0) grade[size] = quantity;
        itemQuantity += quantity;
      }
      if (itemQuantity > 0) {
        payload.push({ sale_order_item_id: item.item_id, qty: itemQuantity, grade });
        pairs += itemQuantity;
        value += itemQuantity * item.unit_price;
      }
    }
    return { pairs, value, payload };
  }, [gradeQtyMap, itemsWithBalance]);

  const validMotivo = motivo.trim().length >= 15;
  const canSubmit = selection.pairs > 0
    && validMotivo
    && UUID_RE.test(requestId)
    && !emitDevolucao.isPending;

  const clearTerminalIntent = () => {
    sessionStorage.removeItem(storageKey);
    setRequestId('');
    setGradeQtyMap({});
    setMotivo('');
    setSubmitted(false);
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    const frozenIntent: StoredReturnIntent = {
      requestId,
      motivo,
      gradeQtyMap,
      submitted: true,
    };
    // Persiste antes da chamada: mesmo reload/timeout retoma o MESMO request.
    sessionStorage.setItem(storageKey, JSON.stringify(frozenIntent));
    setSubmitted(true);
    try {
      const result = await emitDevolucao.mutateAsync({
        nfeOriginalId: nfeId,
        requestId,
        itens: selection.payload,
        motivo,
      });
      if (result?.success) {
        clearTerminalIntent();
        onOpenChange(false);
      }
    } catch (error) {
      const commandError = error as Error & { terminalRejected?: boolean };
      if (commandError.terminalRejected) {
        clearTerminalIntent();
        onOpenChange(false);
      }
      // O hook mostra o motivo. Em qualquer resultado ambíguo, a intenção fica
      // congelada e o operador nunca gera outro request acidentalmente.
    }
  };

  return (
    <Dialog open={open} onOpenChange={value => !emitDevolucao.isPending && onOpenChange(value)}>
      <DialogContent className="w-[95vw] max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-primary" />
            Emitir NF-e de Devolução
          </DialogTitle>
          <DialogDescription>
            NF original <strong>#{nfeNumero || '—'}</strong> · {clientName || 'Cliente'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-1 py-2">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold text-amber-700 dark:text-amber-300">Devolução de NF emitida</p>
              <p className="text-muted-foreground">
                Será emitida uma <strong>NF-e de entrada (modelo 55, finalidade 4)</strong>.
                Informe a numeração física que retornou; estoque, saldo devolvido e financeiro
                serão confirmados juntos somente após a autorização fiscal.
              </p>
            </div>
          </div>

          {submitted && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs flex items-start gap-2">
              <Lock className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Intenção fiscal congelada</p>
                <p className="text-muted-foreground">
                  Um envio já foi tentado. Valores e grade ficam bloqueados; “Retomar comando”
                  consulta/conclui a mesma NF sem criar uma duplicata.
                </p>
              </div>
            </div>
          )}

          {devolucoesPrevias.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-semibold mb-2">Devoluções anteriores nessa NF:</p>
              <div className="space-y-1">
                {devolucoesPrevias.map((returnNfe) => (
                  <div key={returnNfe.id} className="flex items-center justify-between text-xs">
                    <span className="font-mono">#{returnNfe.numero || '—'} · {returnNfe.status}</span>
                    <span className="font-mono">{formatCurrency(Number(returnNfe.valor_total || 0))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <Label className="text-xs font-bold uppercase text-muted-foreground mb-2 block">Itens e numerações a devolver</Label>
            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin inline-block mr-2" /> Carregando…
              </div>
            ) : itemsError ? (
              <div className="py-8 text-center text-destructive text-sm">
                Não foi possível calcular o saldo canônico: {(itemsError as Error).message}
              </div>
            ) : itemsWithBalance.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground text-sm">Nenhum item disponível nessa NF.</div>
            ) : (
              <div className="rounded-lg border overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Ref / Cor</th>
                      <th className="text-right px-3 py-2 font-semibold">Original</th>
                      <th className="text-right px-3 py-2 font-semibold">Já devolvido</th>
                      <th className="text-right px-3 py-2 font-semibold">Saldo</th>
                      <th className="text-left px-3 py-2 font-semibold">Grade a devolver</th>
                      <th className="text-right px-3 py-2 font-semibold">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itemsWithBalance.map(item => {
                      const selected = selection.payload.find(entry => entry.sale_order_item_id === item.item_id)?.qty || 0;
                      const blocked = item.available_quantity <= 0;
                      return (
                        <tr key={item.item_id} className={`border-t ${blocked ? 'opacity-50' : ''}`}>
                          <td className="px-3 py-2 align-top">
                            <div className="font-semibold">{item.technical_code || '—'}</div>
                            <div className="text-muted-foreground">{item.color || '—'}</div>
                          </td>
                          <td className="px-3 py-2 text-right font-mono align-top">{item.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono text-amber-600 align-top">{item.qty_devolvida}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold align-top">{item.available_quantity}</td>
                          <td className="px-3 py-2">
                            {item.gradeEntries.length === 0 ? (
                              <span className="text-muted-foreground">Sem saldo por numeração</span>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {item.gradeEntries.map(([size, available]) => (
                                  <label key={size} className="flex items-center gap-1 rounded-md border bg-background px-1.5 py-1">
                                    <span className="min-w-6 text-center font-semibold">{size}</span>
                                    <Input
                                      aria-label={`Quantidade ${item.technical_code || item.item_id}, número ${size}`}
                                      type="number"
                                      min="0"
                                      max={available}
                                      step="1"
                                      value={gradeQtyMap[item.item_id]?.[size] ?? ''}
                                      onChange={event => {
                                        const parsed = event.target.value === ''
                                          ? 0
                                          : Math.trunc(Number(event.target.value));
                                        const quantity = Number.isFinite(parsed)
                                          ? Math.max(0, Math.min(available, parsed))
                                          : 0;
                                        setGradeQtyMap(previous => ({
                                          ...previous,
                                          [item.item_id]: {
                                            ...(previous[item.item_id] || {}),
                                            [size]: quantity,
                                          },
                                        }));
                                      }}
                                      disabled={blocked || submitted}
                                      className="h-7 w-16 text-right font-mono"
                                      placeholder="0"
                                    />
                                    <span className="text-muted-foreground">/{available}</span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono align-top">
                            {selected > 0 ? formatCurrency(selected * item.unit_price) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/40 border-t">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right font-bold">Total:</td>
                      <td className="px-3 py-2 text-right font-mono font-bold">{selection.pairs} pares</td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-primary">{formatCurrency(selection.value)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div>
            <Label htmlFor="motivo-dev" className="text-xs font-bold uppercase text-muted-foreground mb-1 block">
              Motivo <span className="text-destructive">*</span>{' '}
              <span className="font-normal normal-case text-xs">(mínimo 15 caracteres)</span>
            </Label>
            <Textarea
              id="motivo-dev"
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              placeholder="Ex: Cliente devolveu por defeito de costura. Produto retornará ao estoque para revenda."
              rows={3}
              disabled={submitted}
              className={!validMotivo && motivo.length > 0 ? 'border-destructive' : ''}
            />
            <div className="text-xs text-muted-foreground mt-1">
              {motivo.trim().length}/15 caracteres mínimos
              {validMotivo && (
                <Badge variant="outline" className="ml-2 h-4 text-xs bg-emerald-500/15 text-emerald-700 border-emerald-500/30">
                  OK
                </Badge>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={emitDevolucao.isPending}>
            Fechar
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
            {emitDevolucao.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RotateCcw className="h-4 w-4" />}
            {submitted ? 'Retomar comando' : 'Emitir devolução'} ({selection.pairs} pares · {formatCurrency(selection.value)})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
