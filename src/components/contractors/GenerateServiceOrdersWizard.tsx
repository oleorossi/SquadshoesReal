import { useEffect, useMemo, useState } from 'react';
import {
  Storefront, Handshake, PaperPlaneTilt, CaretDown, CheckCircle, Warning,
  CurrencyDollar, Package,
} from '@phosphor-icons/react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Checkbox } from '@/components/ui/checkbox';
import { SearchableSelect, type SearchableOption } from '@/components/ui/searchable-select';
import { EmptyState } from '@/components/ui/empty-state';
import { toast } from 'sonner';
import { formatCurrency, cn } from '@/lib/utils';
import { useContractors } from '@/hooks/useContractors';
import { useSaleOrders } from '@/hooks/useSaleOrders';
import {
  usePvOutsourceableLines, useGenerateOpServiceOrders, fetchContractorRate,
  type OutsourceableLine,
} from '@/hooks/useGenerateOpServiceOrders';

/**
 * Assistente "Gerar OS por Pedido" — 3 passos:
 *   1. Pedido (PV)
 *   2. Serviços e OPs — por setor terceirizável, escolhe contratada + R$/par e
 *      marca as OPs que vão pra rua
 *   3. Revisão — gera UMA OS por (OP × setor) atrelada à OP (order_id)
 *
 * Substitui o fluxo antigo de terceirização por item (checkbox no PV). Ver
 * `src/hooks/useGenerateOpServiceOrders.ts` + migration 20260703120000.
 */

export interface GenerateServiceOrdersWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PV pré-selecionado (ex.: abrir a partir da tela do pedido). */
  initialSaleOrderId?: string;
  onGenerated?: () => void;
}

const keyOf = (l: { order_id: string; sector: string }) => `${l.order_id}::${l.sector}`;
const STEPS = ['Pedido', 'Serviços e OPs', 'Revisão'] as const;

export function GenerateServiceOrdersWizard({
  open, onOpenChange, initialSaleOrderId, onGenerated,
}: GenerateServiceOrdersWizardProps) {
  const { data: saleOrders = [] } = useSaleOrders();
  const { data: contractors = [] } = useContractors();
  const generate = useGenerateOpServiceOrders();

  const [step, setStep] = useState(0);
  const [saleOrderId, setSaleOrderId] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({});
  const [contractorBySector, setContractorBySector] = useState<Record<string, string>>({});
  const [rateBySector, setRateBySector] = useState<Record<string, number>>({});
  const [openSectors, setOpenSectors] = useState<Record<string, boolean>>({});

  const { data: lines = [], isLoading: loadingLines } = usePvOutsourceableLines(saleOrderId || null);

  // Reset ao abrir. Com PV pré-selecionado (atalho no pedido), começa direto no
  // passo "Serviços e OPs" — o passo Pedido fica acessível voltando no stepper.
  useEffect(() => {
    if (open) {
      setStep(initialSaleOrderId ? 1 : 0);
      setSaleOrderId(initialSaleOrderId || '');
      setSelectedKeys(new Set());
      setQtyByKey({});
      setContractorBySector({});
      setRateBySector({});
      setOpenSectors({});
    }
  }, [open, initialSaleOrderId]);

  // Troca de PV zera as escolhas
  useEffect(() => {
    setSelectedKeys(new Set());
    setQtyByKey({});
    setContractorBySector({});
    setRateBySector({});
    setOpenSectors({});
  }, [saleOrderId]);

  // Agrupa por setor, preservando a ordem que o RPC devolve
  const groups = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, OutsourceableLine[]>();
    for (const l of lines) {
      if (!map.has(l.sector)) { map.set(l.sector, []); order.push(l.sector); }
      map.get(l.sector)!.push(l);
    }
    return order.map((sector) => ({ sector, label: map.get(sector)![0].sector_label, lines: map.get(sector)! }));
  }, [lines]);

  // Pré-preenche contratada + tarifa por setor a partir do catálogo (defaults do RPC)
  useEffect(() => {
    if (!groups.length) return;
    setContractorBySector((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (next[g.sector]) continue;
        const withDefault = g.lines.find((l) => l.default_contractor_id);
        if (withDefault?.default_contractor_id) next[g.sector] = withDefault.default_contractor_id;
      }
      return next;
    });
    setRateBySector((prev) => {
      const next = { ...prev };
      for (const g of groups) {
        if (next[g.sector] != null) continue;
        const withRate = g.lines.find((l) => l.default_rate != null && Number(l.default_rate) > 0);
        if (withRate?.default_rate != null) next[g.sector] = Number(withRate.default_rate);
      }
      return next;
    });
    setOpenSectors((prev) => (Object.keys(prev).length ? prev : { [groups[0].sector]: true }));
  }, [groups]);

  const opAgg = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (!m.has(l.order_id)) m.set(l.order_id, l.quantity);
    return m;
  }, [lines]);

  const pvOptions: SearchableOption[] = useMemo(() =>
    saleOrders
      .filter((so: any) => !['Cancelado', 'cancelado', 'Rascunho'].includes(so.status))
      .map((so: any) => ({
        value: so.id,
        label: `${so.order_number || 'PV'}${so.client_name ? ` · ${so.client_name}` : ''}`,
        description: [so.status, so.delivery_deadline ? `entrega ${new Date(so.delivery_deadline + 'T00:00:00').toLocaleDateString('pt-BR')}` : null].filter(Boolean).join(' · '),
        keywords: `${so.order_number} ${so.client_name || ''} ${so.client_cnpj || ''}`,
      })), [saleOrders]);

  const contractorOptions: SearchableOption[] = useMemo(() =>
    contractors.map((c) => ({
      value: c.id,
      label: c.trade_name || c.name,
      description: c.service_type || undefined,
      keywords: `${c.name} ${c.trade_name || ''} ${c.service_type || ''}`,
    })), [contractors]);

  const isEligible = (l: OutsourceableLine) => !l.already_has_os;
  const qtyOf = (l: OutsourceableLine) => qtyByKey[keyOf(l)] ?? l.quantity;

  const toggleOp = (l: OutsourceableLine) => {
    if (!isEligible(l)) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = keyOf(l);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const toggleServiceAll = (sector: string) => {
    const g = groups.find((x) => x.sector === sector);
    if (!g) return;
    const eligible = g.lines.filter(isEligible);
    const allOn = eligible.length > 0 && eligible.every((l) => selectedKeys.has(keyOf(l)));
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const l of eligible) { if (allOn) next.delete(keyOf(l)); else next.add(keyOf(l)); }
      return next;
    });
  };

  const onContractorChange = async (sector: string, cid: string) => {
    setContractorBySector((p) => ({ ...p, [sector]: cid }));
    if (cid) {
      const r = await fetchContractorRate(cid, sector);
      if (r != null && r > 0) setRateBySector((p) => ({ ...p, [sector]: r }));
    }
  };

  // Linhas escolhidas (com contratada/tarifa/qtd resolvidos por setor)
  const chosen = useMemo(() => {
    const out: Array<{ line: OutsourceableLine; contractorId: string; rate: number; qty: number; ready: boolean }> = [];
    for (const g of groups) {
      const cid = contractorBySector[g.sector] || '';
      const rate = rateBySector[g.sector] ?? 0;
      for (const l of g.lines) {
        if (!selectedKeys.has(keyOf(l))) continue;
        const qty = qtyOf(l);
        out.push({ line: l, contractorId: cid, rate, qty, ready: !!cid && rate > 0 && qty > 0 });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedKeys, qtyByKey, contractorBySector, rateBySector]);

  const ready = chosen.filter((c) => c.ready);
  const blockedCount = chosen.length - ready.length;
  const totalPairs = ready.reduce((s, c) => s + c.qty, 0);
  const totalValue = ready.reduce((s, c) => s + c.qty * c.rate, 0);

  const contractorLabel = (id: string) => {
    const c = contractors.find((x) => x.id === id);
    return c ? (c.trade_name || c.name) : '—';
  };

  const doGenerate = () => {
    const payload = ready.map((c) => ({
      order_id: c.line.order_id,
      sector: c.line.sector,
      contractor_id: c.contractorId,
      unit_price: c.rate,
      quantity: c.qty,
    }));
    if (payload.length === 0) return;
    generate.mutate({ saleOrderId, lines: payload }, {
      onSuccess: (res) => {
        const created = res.filter((r) => r.action === 'created' || r.action === 'reactivated').length;
        const exists = res.filter((r) => r.action === 'exists').length;
        toast.success(
          `${created} ${created === 1 ? 'OS gerada' : 'OS geradas'}${exists ? ` · ${exists} já existiam` : ''}.`,
        );
        onGenerated?.();
        onOpenChange(false);
      },
      onError: (err: any) => toast.error(err?.message || 'Falha ao gerar OS.'),
    });
  };

  const canNext = step === 0 ? !!saleOrderId : step === 1 ? chosen.length > 0 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Storefront className="h-5 w-5 text-primary" />
            Gerar Ordem de Serviço
          </DialogTitle>
          <DialogDescription>
            Terceirização por pedido: escolha o PV, os serviços que vão pra rua e as OPs de
            cada serviço. Cada OS nasce atrelada à OP correta.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => {
            const state = i < step ? 'done' : i === step ? 'active' : 'future';
            return (
              <button
                key={label}
                type="button"
                onClick={() => i < step && setStep(i)}
                className={cn('flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  i < step ? 'cursor-pointer hover:bg-muted/50' : 'cursor-default')}
              >
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  state === 'active' ? 'bg-primary text-primary-foreground'
                    : state === 'done' ? 'bg-green-500/15 text-green-700 dark:text-green-400'
                    : 'bg-muted text-muted-foreground')}>
                  {state === 'done' ? <CheckCircle className="h-4 w-4" weight="fill" /> : i + 1}
                </span>
                <span className={cn('text-xs truncate', state === 'active' ? 'text-foreground font-medium' : 'text-muted-foreground')}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="min-h-[280px] py-1">
          {/* ── Passo 1: Pedido ─────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Pedido de venda *</Label>
                <SearchableSelect
                  value={saleOrderId}
                  onChange={setSaleOrderId}
                  options={pvOptions}
                  placeholder="Selecionar pedido..."
                  searchPlaceholder="Buscar por número, cliente..."
                  heading="Pedidos"
                  className="mt-1"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Aparecem os serviços das OPs já geradas para este pedido.
                </p>
              </div>

              {saleOrderId && (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
                  {loadingLines ? (
                    <span className="text-muted-foreground text-xs">Carregando OPs e serviços...</span>
                  ) : lines.length === 0 ? (
                    <span className="text-amber-700 dark:text-amber-400 text-xs flex items-center gap-1.5">
                      <Warning className="h-3.5 w-3.5" /> Este pedido não tem OPs com setores terceirizáveis.
                    </span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span><strong className="text-foreground font-mono">{opAgg.size}</strong> OPs</span>
                      <span><strong className="text-foreground font-mono">{[...opAgg.values()].reduce((s, v) => s + v, 0).toLocaleString('pt-BR')}</strong> pares</span>
                      <span><strong className="text-foreground font-mono">{groups.length}</strong> serviços terceirizáveis</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Passo 2: Serviços e OPs ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-2.5">
              {loadingLines ? (
                <div className="py-10 text-center text-sm text-muted-foreground">Carregando serviços e OPs...</div>
              ) : groups.length === 0 ? (
                <EmptyState icon={Handshake} title="Nada a terceirizar" description="Este pedido não tem OPs com setores terceirizáveis." />
              ) : groups.map((g) => {
                const selCount = g.lines.filter((l) => selectedKeys.has(keyOf(l))).length;
                const cid = contractorBySector[g.sector] || '';
                const rate = rateBySector[g.sector] ?? 0;
                const isOpen = !!openSectors[g.sector];
                const eligible = g.lines.filter(isEligible);
                const allOn = eligible.length > 0 && eligible.every((l) => selectedKeys.has(keyOf(l)));
                return (
                  <div key={g.sector} className="rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenSectors((p) => ({ ...p, [g.sector]: !p[g.sector] }))}
                      className={cn('flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors',
                        selCount > 0 ? 'bg-primary/5' : 'bg-muted/40 hover:bg-muted/60')}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Handshake className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">{g.label}</span>
                        {selCount > 0 && (
                          <Badge variant="outline" className="h-5 text-[10px] bg-primary/10 text-primary border-primary/30">
                            {selCount} {selCount === 1 ? 'OP' : 'OPs'}
                          </Badge>
                        )}
                      </div>
                      <CaretDown className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', isOpen && 'rotate-180')} />
                    </button>

                    {isOpen && (
                      <div className="px-3 py-3 space-y-3 border-t border-border">
                        {/* Contratada + tarifa (por serviço) */}
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px] gap-2">
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide">Contratada</Label>
                            <SearchableSelect
                              value={cid}
                              onChange={(v) => onContractorChange(g.sector, v)}
                              options={contractorOptions}
                              placeholder="Selecionar contratada..."
                              searchPlaceholder="Buscar contratada..."
                              className="mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                              <CurrencyDollar className="h-3 w-3" /> R$/par
                            </Label>
                            <NumberInput
                              value={rate}
                              onChange={(v) => setRateBySector((p) => ({ ...p, [g.sector]: v }))}
                              step="0.01" min={0} className="mt-1 h-9"
                            />
                          </div>
                        </div>
                        {!cid && (
                          <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                            <Warning className="h-3 w-3" /> Escolha a contratada — sem ela essas OPs não são geradas.
                          </p>
                        )}

                        {/* OPs do serviço */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                              <Package className="h-3 w-3" /> Ordens de produção
                            </span>
                            {eligible.length > 0 && (
                              <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => toggleServiceAll(g.sector)}>
                                {allOn ? 'Limpar' : 'Marcar todas'}
                              </button>
                            )}
                          </div>
                          {g.lines.map((l) => {
                            const k = keyOf(l);
                            const checked = selectedKeys.has(k);
                            const done = (l.sector_status || '').toLowerCase() === 'concluido';
                            return (
                              <div
                                key={k}
                                className={cn('flex items-center gap-2.5 rounded-md border px-2.5 py-2',
                                  checked ? 'border-green-500/40 bg-green-500/5'
                                    : l.already_has_os ? 'border-border bg-muted/20 opacity-70'
                                    : 'border-border/60 hover:bg-muted/30')}
                              >
                                <Checkbox checked={checked} disabled={l.already_has_os} onCheckedChange={() => toggleOp(l)} />
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-foreground truncate">
                                    <span className="font-mono">{l.op_number}</span>
                                    <span className="text-muted-foreground"> · {l.ref_code || '—'}{l.color ? ` · ${l.color}` : ''}</span>
                                  </div>
                                  {l.already_has_os ? (
                                    <div className="text-[10px] text-amber-700 dark:text-amber-400">OS já gerada para esta OP/serviço</div>
                                  ) : done ? (
                                    <div className="text-[10px] text-muted-foreground">setor já concluído internamente</div>
                                  ) : null}
                                </div>
                                <div className="shrink-0 w-[92px]">
                                  <NumberInput
                                    value={qtyOf(l)}
                                    onChange={(v) => setQtyByKey((p) => ({ ...p, [k]: Math.max(0, Math.min(l.quantity, Math.round(v))) }))}
                                    step="1" min={0} disabled={!checked} className="h-8 text-xs"
                                  />
                                </div>
                                <span className="text-[10px] text-muted-foreground shrink-0 w-9 text-right">/{l.quantity}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Passo 3: Revisão ────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Cada OS nasce atrelada à OP e ao pedido, entra em <span className="text-foreground">"Na Rua"</span> e segue o fluxo de envio/retorno/pagamento.
              </p>
              {blockedCount > 0 && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1">
                  <Warning className="h-3 w-3" /> {blockedCount} {blockedCount === 1 ? 'linha ficará de fora' : 'linhas ficarão de fora'} (sem contratada ou sem preço).
                </p>
              )}
              <div className="rounded-lg border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr className="text-left text-[11px] uppercase tracking-wide">
                      <th className="px-3 py-2 font-semibold">Serviço · Contratada</th>
                      <th className="px-3 py-2 font-semibold">OP · Ref · Cor</th>
                      <th className="px-3 py-2 font-semibold text-right">Pares</th>
                      <th className="px-3 py-2 font-semibold text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ready.map((c) => (
                      <tr key={keyOf(c.line)}>
                        <td className="px-3 py-2">
                          <div className="text-xs text-foreground">{c.line.sector_label}</div>
                          <div className="text-[10px] text-muted-foreground">{contractorLabel(c.contractorId)} · {formatCurrency(c.rate)}/par</div>
                        </td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap">
                          <span className="font-mono">{c.line.op_number}</span>
                          <span className="text-muted-foreground"> · {c.line.ref_code || '—'}{c.line.color ? ` · ${c.line.color}` : ''}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{c.qty.toLocaleString('pt-BR')}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-xs">{formatCurrency(c.qty * c.rate)}</td>
                      </tr>
                    ))}
                    <tr className="bg-primary/5">
                      <td className="px-3 py-2 text-xs font-semibold" colSpan={2}>{ready.length} {ready.length === 1 ? 'OS' : 'OS'} · {ready.length} {ready.length === 1 ? 'OP atrelada' : 'OPs atreladas'}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-xs font-semibold">{totalPairs.toLocaleString('pt-BR')}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-xs font-semibold text-primary">{formatCurrency(totalValue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between gap-2">
          <div className="text-[11px] text-muted-foreground mr-auto">
            {chosen.length > 0 && (
              <>{ready.length} {ready.length === 1 ? 'OP' : 'OPs'} · {totalPairs.toLocaleString('pt-BR')} pares · <span className="text-foreground font-mono">{formatCurrency(totalValue)}</span></>
            )}
          </div>
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={generate.isPending}>
              Voltar
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canNext}>
              Continuar
            </Button>
          ) : (
            <Button onClick={doGenerate} disabled={ready.length === 0 || generate.isPending}>
              {generate.isPending ? 'Gerando...' : (
                <><PaperPlaneTilt className="h-3.5 w-3.5 mr-1" /> Gerar {ready.length} {ready.length === 1 ? 'OS' : 'OS'}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
