import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Calendar, Truck, Warning as AlertTriangle, ShoppingCart, CircleNotch as Loader2,
  FloppyDisk as Save, XCircle, Money, Storefront,
} from '@phosphor-icons/react';
import { MaterialAvailabilityResult, MaterialShortage } from '@/lib/materialAvailability';
import { SubmitFlowStepper } from './SubmitFlowStepper';
import { useUpsertOpenPurchaseOrder } from '@/hooks/usePurchaseOrders';
import { useSuppliers } from '@/hooks/useSuppliers';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency, formatMoney, formatNumber, cn } from '@/lib/utils';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: MaterialAvailabilityResult | null;
  /** ID do PV que está sendo criado/editado — vinculado nas OCs/OSs geradas. */
  saleOrderId?: string | null;
  /** Called when user confirms with the action chosen. */
  onConfirm: (action: 'with_po' | 'without_po' | 'draft') => void;
}

/** Fornecedor atribuído aqui na tela, ainda não refletido no `result` do pai. */
interface SupplierOverride {
  supplier_id: string;
  supplier_name: string;
  lead_time_days: number;
}

const NO_SUPPLIER = '__sem_fornecedor__';

/**
 * A linha como o usuário a lê E como ela será gravada na OC — os mesmos campos
 * que `handleGeneratePOs` manda pro `upsert_open_purchase_order`.
 *
 * ⚠ Antes a tabela mostrava `suggested_qty` (unidade de CONSUMO: m, kg) enquanto
 * a OC gravava `suggested_purchase_qty` (unidade de COMPRA: rolo, saco). Com
 * `conversion_rate != 1` o número aprovado na tela não era o número comprado.
 * Aqui a resolução é feita UMA vez e alimenta tela e gravação.
 */
interface PurchaseLine {
  shortage: MaterialShortage;
  supplierId: string | null;
  supplierName: string;
  leadTimeDays: number;
  /** Quantidade que vai pro item da OC. */
  qty: number;
  /** Unidade dessa quantidade. */
  unit: string;
  /** Preço na MESMA unidade de `qty`. */
  price: number;
  /** qty × price. */
  total: number;
  /**
   * Quanto falta de verdade, na unidade de consumo. Preenchido só quando o
   * número de compra NÃO é o que falta — por MOQ, por arredondamento pra
   * unidade fechada, ou por conversão de unidade. É o que restou da coluna
   * "Faltam": ela era idêntica a "Necessário" na maioria das linhas (estoque
   * zerado), então só aparece onde de fato explica alguma coisa.
   */
  shortfallLabel: string | null;
}

/** Quantidade: sem casas quando é inteiro (120 un), 2 casas quando fracionária. */
function qtyLabel(value: number): string {
  return Number.isInteger(value) ? formatNumber(value, 0) : formatNumber(value, 2);
}

function resolveLine(s: MaterialShortage, override?: SupplierOverride): PurchaseLine {
  const qty = s.suggested_purchase_qty ?? s.suggested_qty;
  const price = s.purchase_unit_price ?? s.unit_price;
  const unit = s.purchase_unit ?? s.unit;
  const consumptionUnit = s.consumption_unit ?? s.unit;
  // Mostra a falta só quando o número de compra não a revela sozinho: unidade
  // diferente, ou quantidade diferente (MOQ e o CEIL de unidade discreta em
  // `enrichMaterialShortages`). Sem isso a linha repetiria "Necessário".
  const explains = unit !== consumptionUnit || Number(qty) !== Number(s.shortage);
  return {
    shortage: s,
    supplierId: override?.supplier_id ?? s.supplier_id,
    supplierName: override?.supplier_name ?? s.supplier_name,
    leadTimeDays: override?.lead_time_days ?? s.lead_time_days,
    qty,
    unit,
    price,
    total: (Number(qty) || 0) * (Number(price) || 0),
    shortfallLabel: explains
      ? `${qtyLabel(s.shortage)} ${consumptionUnit}`
      : null,
  };
}

export function MaterialPurchaseConfirmDialog({ open, onOpenChange, result, saleOrderId, onConfirm }: Props) {
  const upsertPO = useUpsertOpenPurchaseOrder();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, SupplierOverride>>({});
  /**
   * Grupos já gravados com sucesso nesta sessão do diálogo. Antes, um erro no
   * meio do loop deixava as OCs anteriores criadas e o botão pronto pra rodar
   * tudo de novo — a segunda tentativa somava quantidade nas mesmas OCs abertas.
   */
  const generatedSuppliers = useRef<Set<string>>(new Set());

  // Cada abertura é uma decisão nova: o pedido pode ter mudado entre uma
  // tentativa e outra. Sem isto, um fornecedor gravado na abertura anterior
  // continuaria na lista de "já gerados" e seria pulado em silêncio agora.
  useEffect(() => {
    if (open) {
      generatedSuppliers.current = new Set();
      setOverrides({});
    }
  }, [open]);

  // Só busca a lista de fornecedores quando o diálogo está aberto — a tela de
  // PV não deve pagar essa query no caminho feliz (sem falta de material).
  const { data: allSuppliers = [] } = useSuppliers(open);
  const suppliers = useMemo(
    () => allSuppliers
      .filter(s => s.active !== false)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')),
    [allSuppliers],
  );

  const assignSupplier = useMutation({
    mutationFn: async ({ productId, supplierId }: { productId: string; supplierId: string }) => {
      const { error } = await supabase.from('products').update({ supplier_id: supplierId }).eq('id', productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const shortages = useMemo(() => result?.shortages ?? [], [result]);

  /**
   * Agrupado por fornecedor — a MESMA chave que `upsert_open_purchase_order`
   * usa, então cada card na tela é exatamente uma OC. Sem fornecedor vem
   * primeiro: é o que trava a geração e o que o usuário precisa resolver.
   */
  const {
    groups, blocked, artisanalCount, generableCount, generableTotal,
    blockedTotal, missingPriceCount, generableLeadDays,
  } = useMemo(() => {
    // Tiras artesanais nunca são materializadas por este diálogo. A escolha
    // produzir/comprar do PV é reconciliada pelo worker canônico, que conhece
    // variante, napa, receita, semana e contribuição exatas. Mantê-las aqui
    // criava uma segunda OS por nome/cor e podia debitar a napa errada.
    const artisanal = shortages.filter(s => s.is_artisanal);
    const lines = shortages
      .filter(s => !s.is_artisanal)
      .map(s => resolveLine(s, overrides[s.product_id]));

    const map = new Map<string, PurchaseLine[]>();
    for (const line of lines) {
      const key = line.supplierId || NO_SUPPLIER;
      const arr = map.get(key) || [];
      arr.push(line);
      map.set(key, arr);
    }

    const built = [...map.entries()].map(([key, items]) => ({
      key,
      supplierId: key === NO_SUPPLIER ? null : key,
      supplierName: key === NO_SUPPLIER ? 'Sem fornecedor definido' : items[0].supplierName,
      leadTimeDays: Math.max(...items.map(i => i.leadTimeDays || 0)),
      total: items.reduce((sum, i) => sum + i.total, 0),
      items: [...items].sort((a, b) => a.shortage.product_name.localeCompare(b.shortage.product_name, 'pt-BR')),
    }));

    const blockedGroup = built.find(g => g.supplierId === null) || null;
    // Ordem por consequência: o fornecedor que puxa mais dinheiro primeiro —
    // é a variável da decisão. Desempate por nome pra a lista não dançar entre
    // uma abertura e outra.
    const ready = built
      .filter(g => g.supplierId !== null)
      .sort((a, b) => b.total - a.total || a.supplierName.localeCompare(b.supplierName, 'pt-BR'));

    return {
      groups: blockedGroup ? [blockedGroup, ...ready] : ready,
      blocked: blockedGroup,
      artisanalCount: artisanal.length,
      generableCount: ready.length,
      generableTotal: ready.reduce((sum, g) => sum + g.total, 0),
      blockedTotal: blockedGroup?.total ?? 0,
      // Sem preço de cadastro a linha entra no total como zero e o subtotal
      // mente pra baixo. Contamos pra poder avisar em vez de somar em silêncio.
      missingPriceCount: ready.reduce(
        (count, g) => count + g.items.filter(i => !(Number(i.price) > 0)).length,
        0,
      ),
      // Só o que de fato vai ser comprado — o lead time dos materiais sem
      // fornecedor não vira prazo de nada.
      generableLeadDays: ready.reduce((max, g) => Math.max(max, g.leadTimeDays || 0), 0),
    };
  }, [shortages, overrides]);

  if (!result) return null;
  const { maxLeadTimeDays, minPurchaseDateISO } = result;

  const formattedDate = minPurchaseDateISO
    ? new Date(minPurchaseDateISO + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

  const blockedCount = blocked?.items.length ?? 0;
  // Só as linhas que entram na compra: as artesanais não são materializadas
  // aqui, então avisar sobre arredondamento delas apontaria pra número nenhum.
  const roundedForMoq = shortages.some(s => !s.is_artisanal && s.suggested_qty > s.shortage);

  const handleAssignSupplier = (productId: string, supplierId: string) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    if (!supplier) return;
    const previous = overrides[productId];
    setOverrides(prev => ({
      ...prev,
      [productId]: {
        supplier_id: supplier.id,
        supplier_name: supplier.name || 'Fornecedor',
        lead_time_days: Number(supplier.lead_time_days) || 0,
      },
    }));
    // Persiste no cadastro do produto pra o próximo PV já nascer resolvido.
    // Se falhar, desfaz o override — a tela não pode prometer uma OC que a
    // geração não vai conseguir agrupar.
    assignSupplier.mutate(
      { productId, supplierId },
      {
        onError: (err: Error) => {
          setOverrides(prev => {
            const next = { ...prev };
            if (previous) next[productId] = previous;
            else delete next[productId];
            return next;
          });
          toast.error(`Não foi possível salvar o fornecedor: ${err.message}`);
        },
      },
    );
  };

  const handleGeneratePOs = async () => {
    setGenerating(true);
    const failures: string[] = [];
    let ocCount = 0;
    try {
      for (const group of groups) {
        if (!group.supplierId) continue;
        if (generatedSuppliers.current.has(group.key)) continue;
        try {
          // O3: usa suggested_purchase_qty + purchase_unit (já convertidos pra
          // unidade do fornecedor: m → rolo, kg → saco). Sem conversão, vira
          // OC em unidade interna e o comprador refaz manualmente.
          // Auditoria 2026-09-25: o preço tem que vir na MESMA unidade da
          // quantidade — usar `unit_price` (R$/unidade de estoque) junto de
          // `suggested_purchase_qty` (unidade de compra) subfaturava a OC pelo
          // conversion_rate. `purchase_unit_price` já é R$/unidade de compra.
          // Os valores vêm de `resolveLine`, os MESMOS exibidos na tabela.
          await upsertPO.mutateAsync({
            supplier_id: group.supplierId,
            supplier_name: group.supplierName,
            sale_order_id: saleOrderId || null,
            notes: `Itens adicionados automaticamente pelo PV.`,
            items: group.items.map(line => ({
              product_id: line.shortage.product_id,
              quantity: line.qty,
              unit_price: line.price,
              unit: line.unit,
              current_stock: line.shortage.available,
              min_stock: line.shortage.min_stock,
              // Antes: 0 hardcoded — toda OC gerada por PV nascia sem teto de
              // estoque. Agora vem do cadastro do produto.
              max_stock: line.shortage.max_stock ?? 0,
              // Solados saem com cor + grade preenchidos pra fornecedor entregar
              // a matriz de tamanhos correta. Materiais sem variação por cor
              // (forros/tiras/etc.) vêm com color=null/grade=null do
              // enrichMaterialShortages que colapsa cores nesses casos.
              color: line.shortage.color ?? null,
              grade: line.shortage.grade ?? null,
            })),
          });
          generatedSuppliers.current.add(group.key);
          ocCount++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failures.push(`${group.supplierName}: ${message || 'erro desconhecido'}`);
        }
      }

      if (failures.length > 0) {
        // Não avança o fluxo com OC faltando — o usuário decide entre tentar de
        // novo (os grupos já gravados são pulados) ou salvar sem OC.
        toast.error(
          `${failures.length} ${failures.length === 1 ? 'OC não foi gerada' : 'OCs não foram geradas'}.`,
          { description: failures.join(' · ') },
        );
        return;
      }
      if (ocCount > 0) {
        // "fornecedor", não "OC": a RPC pode ter agregado numa OC já aberta em
        // vez de criar uma nova — o número de OCs novas não é conhecido aqui.
        toast.success(
          ocCount === 1
            ? 'Compra enviada para 1 fornecedor.'
            : `Compra enviada para ${ocCount} fornecedores.`,
        );
      }
      onConfirm('with_po');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `overflow-hidden` aqui derruba o `overflow-y-auto` do DialogContent base
          (verificado: o tailwind-merge trata `overflow` e `overflow-y` como
          grupos conflitantes). Quem rola é só a faixa do meio. */}
      <DialogContent className="w-[95vw] max-w-6xl max-h-[92dvh] p-0 sm:p-0 gap-0 sm:gap-0 flex flex-col overflow-hidden">
        {/* ── Cabeçalho fixo: contexto e decisão nunca saem da tela ──
            Antes o DialogContent inteiro rolava, então título, etapa, prazo e
            rodapé sumiam assim que a lista passava de meia dúzia de linhas. */}
        {/* Cabeçalho enxuto de propósito: num 1366×768 cada 20px aqui é uma
            linha a menos de material visível na faixa que rola. */}
        <div className="shrink-0 border-b border-border px-4 sm:px-6 pt-3 pb-2.5 pr-12 space-y-2">
          <SubmitFlowStepper current="material" />
          <div className="space-y-0.5">
            <DialogTitle className="flex items-center gap-2 text-lg sm:text-xl">
              <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
              Materiais insuficientes
            </DialogTitle>
            {/* ⚠ "vira uma OC" seria falso: `upsert_open_purchase_order` procura
                uma OC ABERTA do fornecedor e agrega nela; só cria OC nova quando
                não existe nenhuma. Por isso o texto (e o botão) falam em
                fornecedor, não em número de OCs criadas. */}
            <DialogDescription className="text-sm">
              Revise o que será comprado e de quem. Cada card vira uma ordem de compra — ou
              entra na OC que o fornecedor já tem aberta.
            </DialogDescription>
          </div>

          {/* ── Barra de decisão ──
              O que o usuário precisa saber ANTES de autorizar: quantas OCs, quanto
              custa, quando chega, e o que está travado. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <SummaryTile
              icon={ShoppingCart}
              label="Fornecedores"
              value={String(generableCount)}
              hint={generableCount === 1 ? 'uma compra' : 'uma compra cada'}
            />
            <SummaryTile
              icon={Money}
              label="Valor estimado"
              value={formatMoney(generableTotal)}
              hint={missingPriceCount > 0
                ? `${missingPriceCount} sem preço — soma abaixo do real`
                : 'preço de cadastro'}
              tone={missingPriceCount > 0 ? 'destructive' : 'default'}
            />
            <SummaryTile
              icon={Calendar}
              label="Chegada estimada"
              value={formattedDate}
              // A data vem do resultado (nível do pedido, considera TODOS os
              // materiais). O lead exibido é o dos que vão ser comprados de
              // fato — quando os dois divergem, a dica diz por quê.
              hint={blockedCount > 0
                ? `${generableLeadDays}d o que dá pra comprar · ${maxLeadTimeDays}d com os travados`
                : `maior lead time: ${maxLeadTimeDays} dias`}
            />
            <SummaryTile
              icon={blockedCount > 0 ? XCircle : Truck}
              label="Sem fornecedor"
              value={String(blockedCount)}
              hint={blockedCount > 0
                ? `${formatMoney(blockedTotal)} fora da compra`
                : 'tudo pronto pra comprar'}
              tone={blockedCount > 0 ? 'destructive' : 'default'}
            />
          </div>
        </div>

        {/* ── Corpo rolável ── */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
          {blockedCount > 0 && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertTitle>
                {blockedCount === 1
                  ? '1 material não tem fornecedor e não entra na compra'
                  : `${blockedCount} materiais não têm fornecedor e não entram na compra`}
              </AlertTitle>
              <AlertDescription className="text-xs">
                Escolha o fornecedor na própria linha para incluir na OC — a escolha também fica
                salva no cadastro do produto.
              </AlertDescription>
            </Alert>
          )}

          {artisanalCount > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Tiras seguem o planejamento automático</AlertTitle>
              <AlertDescription className="text-xs">
                As {artisanalCount === 1 ? 'tira' : `${artisanalCount} tiras`} deste pedido serão
                consolidadas no lote interno, na OS terceirizada ou na OC de tira pronta conforme a
                origem escolhida em cada linha — não aparecem nas OCs abaixo.
              </AlertDescription>
            </Alert>
          )}

          {groups.map(group => {
            const isBlocked = group.supplierId === null;
            return (
              <section
                key={group.key}
                className={cn(
                  'rounded-lg border overflow-hidden bg-card',
                  isBlocked ? 'border-destructive/50' : 'border-border',
                )}
              >
                <header
                  className={cn(
                    'flex flex-wrap items-center gap-x-2 gap-y-1 px-3 sm:px-4 py-2.5 border-b',
                    isBlocked ? 'bg-destructive/10 border-destructive/30' : 'bg-muted/50 border-border',
                  )}
                >
                  {isBlocked
                    ? <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    : <Storefront className="h-4 w-4 text-primary shrink-0" />}
                  <h3 className={cn('text-sm font-bold uppercase tracking-wide', isBlocked && 'text-destructive')}>
                    {group.supplierName}
                  </h3>
                  <Badge variant="outline" className="text-xs">
                    {group.items.length} {group.items.length === 1 ? 'item' : 'itens'}
                  </Badge>
                  {!isBlocked && (
                    <>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Truck className="h-3 w-3" />{group.leadTimeDays}d
                      </span>
                      <span className="ml-auto text-sm font-bold font-mono tabular-nums">
                        {formatMoney(group.total)}
                      </span>
                    </>
                  )}
                  {isBlocked && (
                    <span className="ml-auto flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
                      <span className="font-mono tabular-nums normal-case">{formatMoney(group.total)}</span>
                      Não será comprado
                    </span>
                  )}
                </header>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="text-left font-semibold px-3 sm:px-4 py-2">Material</th>
                        {/* "Estoque" saiu como coluna: com estoque zerado — o caso
                            de 121 dos 206 produtos ativos — ela repetia o par
                            Necessário/Comprar. Vira sub-linha no material só quando
                            existe cobertura de verdade. */}
                        <th className="text-right font-semibold px-2 py-2 whitespace-nowrap">Necessário</th>
                        <th className="text-right font-semibold px-2 py-2 whitespace-nowrap">Comprar</th>
                        {isBlocked ? (
                          <th className="text-left font-semibold px-2 sm:px-4 py-2 whitespace-nowrap">Fornecedor</th>
                        ) : (
                          <>
                            <th className="text-right font-semibold px-2 py-2 whitespace-nowrap">Preço un.</th>
                            <th className="text-right font-semibold px-3 sm:px-4 py-2 whitespace-nowrap">Total</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {group.items.map(line => {
                        const s = line.shortage;
                        const extraRefs = s.reference_labels.length - 3;
                        return (
                          <tr key={`${s.product_id}-${s.color ?? ''}`} className="align-top">
                            <td className="px-3 sm:px-4 py-2">
                              <div className="font-medium leading-tight">{s.product_name}</div>
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {s.product_sku && (
                                  <Badge variant="outline" className="font-mono text-xs">{s.product_sku}</Badge>
                                )}
                                {s.color && <Badge variant="secondary" className="text-xs">{s.color}</Badge>}
                                {s.reference_labels.slice(0, 3).map((label, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs font-normal">{label}</Badge>
                                ))}
                                {extraRefs > 0 && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs font-normal"
                                    title={s.reference_labels.join(' · ')}
                                  >
                                    +{extraRefs}
                                  </Badge>
                                )}
                                {s.moq > 0 && (
                                  <span className="text-xs text-muted-foreground">MOQ {qtyLabel(s.moq)} {s.unit}</span>
                                )}
                              </div>
                              {Number(s.available) > 0 && (
                                <div className="text-xs text-muted-foreground font-mono mt-0.5">
                                  em estoque: {qtyLabel(s.available)} {s.unit}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                              {qtyLabel(s.required)}
                              <span className="text-xs text-muted-foreground ml-1">{s.unit}</span>
                            </td>
                            <td className="px-2 py-2 text-right whitespace-nowrap">
                              <div className="font-mono tabular-nums font-bold">
                                {qtyLabel(line.qty)}
                                <span className="text-xs text-muted-foreground ml-1 font-normal">{line.unit}</span>
                              </div>
                              {/* NÃO usar "=": `suggested_purchase_qty` leva CEIL
                                  em unidade discreta, então o comprado é >= o
                                  que falta. Dizer "180 saco = 8.959,06 kg" seria
                                  aritmeticamente falso. */}
                              {line.shortfallLabel && (
                                <div className="text-xs text-muted-foreground font-mono">
                                  falta {line.shortfallLabel}
                                </div>
                              )}
                            </td>
                            {isBlocked ? (
                              <td className="px-2 sm:px-4 py-2 w-[220px]">
                                <Select
                                  value={line.supplierId ?? NO_SUPPLIER}
                                  onValueChange={(value) => handleAssignSupplier(s.product_id, value)}
                                  disabled={generating}
                                >
                                  <SelectTrigger className="h-8 text-xs" aria-label={`Fornecedor de ${s.product_name}`}>
                                    <SelectValue placeholder="Escolher fornecedor" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {suppliers.length === 0 && (
                                      <SelectItem value={NO_SUPPLIER} disabled>
                                        Nenhum fornecedor cadastrado
                                      </SelectItem>
                                    )}
                                    {suppliers.map(sup => (
                                      <SelectItem key={sup.id} value={sup.id} className="text-xs">
                                        {sup.name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                            ) : (
                              <>
                                {/* Preço UNITÁRIO usa formatCurrency (mantém a
                                    precisão cadastrada, até 4 casas); o total
                                    fechado usa formatMoney (2 casas). */}
                                <td
                                  className={cn(
                                    'px-2 py-2 text-right font-mono tabular-nums whitespace-nowrap',
                                    Number(line.price) > 0 ? 'text-muted-foreground' : 'text-destructive',
                                  )}
                                >
                                  {Number(line.price) > 0 ? formatCurrency(line.price) : 'sem preço'}
                                </td>
                                <td
                                  className={cn(
                                    'px-3 sm:px-4 py-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap',
                                    Number(line.price) > 0 ? undefined : 'text-destructive',
                                  )}
                                >
                                  {formatMoney(line.total)}
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}

          {/* Pedido só de tira artesanal: nada é comprado por este diálogo, de
              propósito. Sem isto o corpo ficava vazio e os tiles zerados sem
              dizer por quê. */}
          {groups.length === 0 && (
            <EmptyState
              icon={ShoppingCart}
              title="Nada a comprar neste pedido"
              description="As faltas deste PV são todas de tiras artesanais, que seguem o planejamento automático. Salve o pedido e o lote interno ou a OS terceirizada cuidam delas."
              size="sm"
            />
          )}

          {/* A coluna "Faltam" saiu (era idêntica a "Necessário" sempre que o
              estoque está zerado). Então a nota explica o desvio em termos das
              colunas que continuam visíveis. */}
          {roundedForMoq && (
            <p className="text-xs text-muted-foreground">
              ⚠ <strong>Comprar</strong> pode passar do que falta: a quantidade é arredondada
              para o MOQ do fornecedor e para a unidade fechada de compra.
            </p>
          )}
          {missingPriceCount > 0 && (
            <p className="text-xs text-destructive">
              ⚠ {missingPriceCount === 1
                ? '1 material está sem preço de cadastro e entra como R$ 0,00'
                : `${missingPriceCount} materiais estão sem preço de cadastro e entram como R$ 0,00`}
              {' '}— o valor estimado está <strong>abaixo</strong> do que será pago.
            </p>
          )}
        </div>

        {/* ── Rodapé fixo ── */}
        <div className="shrink-0 border-t border-border bg-background px-4 sm:px-6 py-3">
          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>
              Cancelar
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:flex-wrap sm:justify-end">
              <Button variant="secondary" onClick={() => onConfirm('draft')} disabled={generating} className="gap-1.5">
                <Save className="h-4 w-4" />
                Salvar Rascunho
              </Button>
              <Button variant="outline" onClick={() => onConfirm('without_po')} disabled={generating}>
                Salvar pedido sem OC
              </Button>
              {/* O rótulo diz o número REAL de OCs que serão criadas. Antes o botão
                  prometia "Gerar OCs" e pulava em silêncio todo material sem
                  fornecedor, avisando só por toast depois do fato. */}
              <Button
                onClick={handleGeneratePOs}
                disabled={generating || generableCount === 0}
                className="gap-2"
                title={generableCount === 0 ? 'Nenhum material tem fornecedor definido' : undefined}
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                {generating
                  ? 'Gerando...'
                  : generableCount === 0
                    // Nada comprável tem duas causas diferentes, e dizer "sem
                    // fornecedor" quando o pedido só tem tira artesanal culpa
                    // um cadastro que está certo.
                    ? (blockedCount > 0 ? 'Sem fornecedor para comprar' : 'Nada a comprar aqui')
                    : `Comprar de ${generableCount} ${generableCount === 1 ? 'fornecedor' : 'fornecedores'} e salvar`}
              </Button>
            </div>
          </div>
          {blockedCount > 0 && generableCount > 0 && (
            <p className="text-xs text-destructive mt-2 sm:text-right">
              {blockedCount === 1 ? '1 material ficará' : `${blockedCount} materiais ficarão`} de fora
              por falta de fornecedor.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  icon: Icon, label, value, hint, tone = 'default',
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'destructive' | 'ok';
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-2.5 py-1.5',
        tone === 'destructive' ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/30',
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            'h-3 w-3 shrink-0',
            tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
          )}
        />
        <span
          className={cn(
            'text-xs font-semibold uppercase tracking-wide truncate',
            tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {label}
        </span>
      </div>
      <div
        className={cn(
          'font-mono tabular-nums font-bold leading-tight text-sm',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </div>
      {hint && <div className="text-[10px] leading-tight text-muted-foreground truncate" title={hint}>{hint}</div>}
    </div>
  );
}
