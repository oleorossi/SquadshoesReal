import { Fragment, useMemo, useState } from 'react';
import { computePurchaseBaseTotal, isSuspectUnrolledArtisanal } from '@/lib/baseMaterialTotal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  CircleNotch as Loader2,
  Warning as AlertTriangle,
  CaretDown as ChevronDown,
  Package,
  ShoppingCart,
  FileText,
  Files,
} from '@phosphor-icons/react';
import { formatCurrency, formatMoney } from '@/lib/utils';
import { useMaterialsPerPv, useGeneratePerPvPurchaseOrders } from '@/hooks/usePerPvPurchasing';
import { useProducts } from '@/hooks/useProducts';
import { useGroups } from '@/hooks/useGroups';
import { effectivePurchaseMultiple } from '@/lib/purchaseMultiple';
import { effectiveConversionFactorStrict } from '@/lib/purchaseConversion';
import { normalizeUnit } from '@/lib/unitConversion';
import { buildPerPvPurchaseOrders, summarizePerPvDrafts, collectPvNeedWarnings, NO_SUPPLIER_LABEL } from '@/lib/perPvPurchasing';
import { printPerPvMaterials } from '@/lib/printPerPvMaterials';
import { printPerPvOcPdf } from '@/lib/printPerPvOcPdf';
import CreateStrapProductDialog from '@/components/sale-orders/CreateStrapProductDialog';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Quantidade de material base em pt-BR — mesma grafia da faixa de Material
 *  base do modal de Consumo, pra quem cruza as duas telas ver o mesmo número. */
const formatBaseQty = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** PV ids alvo (1 = single-PV; N = seleção da lista). */
  pvIds: string[];
  /** Rótulos dos PVs ("PV-2026-00144") pra header + notas das OCs. */
  pvNumbers?: string[];
  /** Disparado após gerar com sucesso (ex.: abrir aba "Compras deste PV"). */
  onGenerated?: (createdIds: string[]) => void;
};

/**
 * Modal do canal "Compras por Pedido". Mostra os materiais necessários do(s)
 * PV(s) agrupados por fornecedor (+ balde "Sem Fornecedor") e gera uma OC por
 * grupo com source_type='per_pv'. Não interfere no MRP/ondas.
 */
export default function GeneratePurchaseOrdersDialog({ open, onOpenChange, pvIds, pvNumbers, onGenerated }: Props) {
  // Default LIGADO: numa ordem de compra você quer comprar a FALTA, não a
  // necessidade bruta — senão recompra material que já está em estoque (ex.:
  // cola/binóculo). O usuário pode desligar pra ver o bruto.
  const [netOfStock, setNetOfStock] = useState(true);
  // GUARD: cor não cadastrada bloqueia gerar OC; override consciente p/ casos benignos.
  const [overrideColorMismatch, setOverrideColorMismatch] = useState(false);
  // GUARD: aviso da RPC (tira sem napa, largura faltando) bloqueia gerar — a OC
  // sairia comprando A MENOS. Override consciente pelo mesmo padrão da cor.
  const [overrideNeedWarnings, setOverrideNeedWarnings] = useState(false);
  const { data: needs = [], isLoading, isError, error } = useMaterialsPerPv(open ? pvIds : null);
  const { data: products = [] } = useProducts();
  const { data: groups = [] } = useGroups();
  const generate = useGeneratePerPvPurchaseOrders();
  const qc = useQueryClient();
  // Cadastro 1-clique da cor faltante: resolve o grupo a partir do produto (material_id).
  const [createTarget, setCreateTarget] = useState<{ groupId: string; groupName: string; color: string } | null>(null);
  const resolveGroupForMaterial = (materialId: string): { groupId: string; groupName: string } | null => {
    const prod = (products as any[]).find((p) => p.id === materialId);
    if (!prod?.group_id) return null;
    const grp = (groups as any[]).find((g) => g.id === prod.group_id);
    return grp ? { groupId: grp.id, groupName: grp.name } : null;
  };

  // Enriquece cada necessidade com o múltiplo de compra efetivo (item→grupo),
  // pra buildPerPvPurchaseOrders arredondar a quantidade pra cima (187 → 200).
  const multipleByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products as any[]) {
      m.set(p.id, effectivePurchaseMultiple(p.purchase_multiple, p.product_groups?.purchase_multiple));
    }
    return m;
  }, [products]);

  // Conversão estoque→compra por produto (mesmo fator do recebimento da OC):
  // PLACA EVA vira placa, cola/napa ficam como estão. Sem regra segura, a
  // geração fica bloqueada: nunca rebaixa a conversão para 1:1.
  const conversionByProduct = useMemo(() => {
    const m = new Map<string, { purchase_unit: string | null; conversion_factor: number | null; conversion_warning: string | null }>();
    for (const p of products as any[]) {
      const purchaseUnit = p.purchase_unit || p.purchase_order_unit;
      const ctx = {
        unit: p.unit,
        purchase_unit: purchaseUnit,
        conversion_rate: p.conversion_rate,
        dimensions_width: p.dimensions_width,
        dimensions_unit: p.dimensions_unit,
      };
      const factor = effectiveConversionFactorStrict(ctx);
      const differs = purchaseUnit && normalizeUnit(purchaseUnit) !== normalizeUnit(p.unit);
      if (differs && (factor == null || factor <= 0)) {
        m.set(p.id, {
          purchase_unit: null,
          conversion_factor: null,
          conversion_warning: `"${p.name}": conversão de ${purchaseUnit} para ${p.unit} inválida. Informe uma taxa maior que zero e, para área, largura com unidade.`,
        });
      } else {
        m.set(p.id, {
          purchase_unit: differs ? purchaseUnit : null,
          conversion_factor: differs ? factor : 1,
          conversion_warning: null,
        });
      }
    }
    return m;
  }, [products]);

  const conversionWarnings = useMemo(
    () => [...new Set(needs
      .map((n: any) => conversionByProduct.get(n.material_id)?.conversion_warning)
      .filter((warning): warning is string => !!warning))],
    [needs, conversionByProduct],
  );

  // Avisos que vêm do BANCO (compute_materials_per_pv → conversion_warning),
  // não do cadastro lido aqui. Ficavam ignorados: a linha bloqueada chega com
  // needed_qty 0, buildPerPvPurchaseOrders descarta item de quantidade 0 e o
  // material sumia da tela sem explicação — exatamente o silêncio que o motor
  // único de tira artesanal existe pra acabar (spec §2.4). A mensagem já vem
  // pronta e acionável do banco; aqui só a exibimos.
  const needWarnings = useMemo(() => collectPvNeedWarnings(needs as any[]), [needs]);
  /** Bloqueio TOTAL: nada dessa linha entra na OC (needed_qty 0). */
  const blockedWarnings = useMemo(() => needWarnings.filter((w) => w.needed_qty <= 0), [needWarnings]);

  // Identificação do item pro fornecedor: código (SKU) + descrição técnica. Nos
  // materiais comprados o SKU já É o código do fornecedor, e a technical_name
  // carrega a especificação que o nome curto não tem (acabamento, embalagem,
  // bitola, ONU). Sem isso a OC ia só com "Binóculo 10mm" — ambíguo quando o
  // fornecedor tem várias versões da mesma peça.
  const identityByProduct = useMemo(() => {
    const m = new Map<string, { sku: string | null; technical_name: string | null; color: string | null }>();
    for (const p of products as any[]) {
      m.set(p.id, {
        sku: (p.sku || '').trim() || null,
        technical_name: (p.technical_name || '').trim() || null,
        color: (p.color || '').trim() || null,
      });
    }
    return m;
  }, [products]);

  const enrichedNeeds = useMemo(
    () => needs.filter((n: any) => !conversionByProduct.get(n.material_id)?.conversion_warning).map((n: any) => {
      const conv = conversionByProduct.get(n.material_id);
      const ident = identityByProduct.get(n.material_id);
      return {
        ...n,
        // Cor: a do consumo manda; na falta dela cai no cadastro do produto.
        // Materiais sem cor cadastrada seguem sem cor — a especificação vai na
        // descrição técnica. NÃO se adivinha cor a partir do nome: descrições
        // como "ABS MARROM 12MM /DOURADO" têm duas, e chutar uma na OC é o
        // erro que esta tela existe pra evitar.
        color: (n.color || '').trim() || ident?.color || '',
        sku: ident?.sku ?? null,
        technical_name: ident?.technical_name ?? null,
        purchase_multiple: multipleByProduct.get(n.material_id) ?? null,
        purchase_unit: conv?.purchase_unit ?? null,
        conversion_factor: conv?.conversion_factor,
      };
    }),
    [needs, multipleByProduct, conversionByProduct, identityByProduct],
  );

  const drafts = useMemo(
    () => buildPerPvPurchaseOrders(enrichedNeeds, { netOfStock }),
    [enrichedNeeds, netOfStock],
  );
  const summary = useMemo(() => summarizePerPvDrafts(drafts), [drafts]);

  // ── Material base (napa) — mesma leitura da faixa de Material base do Consumo ─
  // O grupo do produto é o que diz se a linha é napa; a RPC não manda essa
  // informação, mas o cadastro já está carregado aqui.
  const groupNameByProduct = useMemo(() => {
    const byId = new Map((groups as any[]).map((g) => [g.id, (g.name || '').trim()]));
    const m = new Map<string, string>();
    // `useProducts` já embute product_groups(name) — prefere o embutido pra não
    // depender da query de grupos ter resolvido antes desta render.
    for (const p of products as any[]) {
      m.set(p.id, ((p.product_groups?.name as string) || byId.get(p.group_id) || '').trim());
    }
    return m;
  }, [products, groups]);

  /** Quantos produtos ARTESANAIS cada grupo tem — base da suspeita de tira que
   *  escapou do rollup (um irmão sem a flag no meio de um grupo artesanal). */
  const artisanalCountByGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products as any[]) {
      if (p.is_artisanal && p.group_id) m.set(p.group_id, (m.get(p.group_id) || 0) + 1);
    }
    return m;
  }, [products]);

  const productById = useMemo(
    () => new Map((products as any[]).map((p) => [p.id, p])),
    [products],
  );

  // Usa a quantidade A COMPRAR (líquida de estoque e já no múltiplo de compra),
  // não a necessidade bruta: nesta tela todo número é o que vai na OC — o
  // "Total estimado" ao lado é o dinheiro dessa mesma quantidade. Por isso o
  // valor acompanha o toggle "Descontar estoque" e pode ficar ABAIXO do total
  // que o modal de Consumo mostra, que é consumo, não compra.
  const baseInputsFor = (items: any[]) => items.map((it) => ({
    groupName: groupNameByProduct.get(it.material_id) || '',
    unit: it.purchase_unit || it.unit,
    qty: Number(it.quantity) || 0,
  }));

  const baseTotal = useMemo(
    () => computePurchaseBaseTotal(baseInputsFor(drafts.flatMap((d) => d.items))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, groupNameByProduct],
  );

  /** Linhas que deveriam ter virado napa e não viraram (flag faltando no
   *  produto) — a OC compraria tira pronta sem avisar ninguém. */
  const unrolledSuspects = useMemo(
    () => drafts.flatMap((d) => d.items).filter((it) =>
      isSuspectUnrolledArtisanal(productById.get(it.material_id) || {}, artisanalCountByGroup)),
    [drafts, productById, artisanalCountByGroup],
  );

  // O título SEMPRE nomeia os PVs do escopo. Antes, multi-PV virava "N pedidos"
  // e a tela mostrava quantidades somadas sem dizer de quais pedidos — dava pra
  // ler o consumo de um PV achando que era de outro (o 4.416 de fivela do
  // PV-00145 lido como se fosse do PV-00147). Acima de 4 PVs corta a lista pra
  // não estourar o cabeçalho, mas mantém os primeiros nomeados.
  const titleScope = useMemo(() => {
    const nums = (pvNumbers || []).filter(Boolean);
    if (nums.length === 0) return pvIds.length === 1 ? 'pedido' : `${pvIds.length} pedidos`;
    if (nums.length <= 4) return nums.join(', ');
    return `${nums.slice(0, 4).join(', ')} +${nums.length - 4}`;
  }, [pvNumbers, pvIds.length]);

  const handleGenerate = async () => {
    if (conversionWarnings.length > 0) {
      toast.error('Corrija os cadastros de conversão indicados antes de gerar as OCs.');
      return;
    }
    if (needWarnings.length > 0 && !overrideNeedWarnings) {
      toast.error('Há materiais que não entram na compra — resolva o cadastro ou confirme o override.');
      return;
    }
    try {
      const res = await generate.mutateAsync({ pvIds, pvNumbers, drafts });
      onGenerated?.(res.createdIds);
      onOpenChange(false);
    } catch {
      /* erro já exibido via toast no hook */
    }
  };

  const handlePrintPdf = () => {
    const ok = printPerPvMaterials({ scopeLabel: titleScope, pvNumbers: pvNumbers || [], drafts, netOfStock, summary });
    if (!ok) toast.error('Não foi possível abrir a janela de impressão. Permita pop-ups para este site.');
  };

  // Imprimir OC: baixa 1 PDF por fornecedor (7 fornecedores → 7 arquivos), pra
  // enviar a ordem individual a cada um. Inclui o grupo "Sem Fornecedor".
  const handlePrintOcs = () => {
    const n = printPerPvOcPdf({ drafts, pvNumbers: pvNumbers || [] });
    if (n > 0) {
      toast.success(`Baixando ${n} PDF${n === 1 ? '' : 's'} de OC — 1 por fornecedor.`);
      toast.info('Se o navegador pedir, permita "baixar vários arquivos".', { duration: 6000 });
    } else {
      toast.error('Nada pra imprimir.');
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            Materiais necessários para {titleScope}
          </DialogTitle>
          <DialogDescription>
            Gera uma Ordem de Compra por fornecedor (+ uma agrupada "Sem Fornecedor").
            Estas OCs ficam no canal <strong>Compras por Pedido</strong> — separadas do MRP/ondas.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Calculando materiais...
          </div>
        )}

        {isError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Falha ao calcular materiais: {(error as Error)?.message || 'erro desconhecido'}.
            {' '}Verifique se a migration <code>compute_materials_per_pv</code> já foi aplicada no banco.
          </div>
        )}

        {conversionWarnings.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <strong>OC bloqueada por conversão inválida.</strong>
              <ul className="mt-1 list-disc pl-4">
                {conversionWarnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          </div>
        )}

        {/* Avisos do MOTOR (banco). Tira artesanal marcada como "corto aqui" sem
            napa na família+cor, receita ausente/zerada, largura faltando na ficha
            de componente — em todos a parcela afetada fica FORA da compra. Sem
            este bloco a linha simplesmente sumia da tela. */}
        {!isLoading && !isError && needWarnings.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <strong>
                  {blockedWarnings.length > 0
                    ? `${blockedWarnings.length} material(is) fora desta compra${needWarnings.length > blockedWarnings.length ? ` (+${needWarnings.length - blockedWarnings.length} comprado(s) a menos)` : ''}.`
                    : `${needWarnings.length} material(is) sendo comprado(s) a menos.`}
                </strong>{' '}
                O cálculo do pedido deixou parte da necessidade de fora por falta de
                cadastro. Enquanto não resolver, a compra <strong>não cobre</strong> o que a
                produção vai reservar.
                <ul className="mt-1.5 space-y-1.5">
                  {needWarnings.map((w) => (
                    <li key={`${w.material_id}-${w.color ?? ''}-${w.message}`} className="text-xs leading-snug">
                      <span className="font-mono">
                        {w.product_name} · <strong>{w.color || '—'}</strong>
                        {' · '}
                        {w.needed_qty > 0
                          ? `${formatBaseQty(w.needed_qty)} ${w.unit} na OC`
                          : 'nada na OC'}
                      </span>
                      <div className="mt-0.5">{w.message}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium">
              <Checkbox checked={overrideNeedWarnings} onCheckedChange={(v) => setOverrideNeedWarnings(!!v)} />
              Gerar mesmo assim (entendo que estes materiais ficarão de fora da compra)
            </label>
          </div>
        )}

        {!isLoading && !isError && drafts.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Package className="h-8 w-8" />
            <p className="text-sm">
              {needWarnings.length > 0
                ? 'Nada a comprar: o que este pedido precisa está bloqueado pelos avisos acima.'
                : netOfStock
                  ? 'Nenhum material em falta — o estoque cobre este(s) pedido(s).'
                  : 'Nenhum material necessário encontrado para este(s) pedido(s).'}
            </p>
          </div>
        )}

        {!isLoading && !isError && drafts.length > 0 && (
          <div className="space-y-4">
            {/* Resumo (KPIs) — total, OCs, itens e o que precisa de atenção */}
            <div className={`grid grid-cols-2 gap-px rounded-lg border border-border bg-border overflow-hidden ${baseTotal ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
              <div className="bg-card p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total estimado</p>
                <p className="text-xl font-bold tabular-nums leading-tight text-primary">{formatMoney(summary.total)}</p>
              </div>
              <div className="bg-card p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Ordens de compra</p>
                <p className="text-xl font-bold tabular-nums leading-tight">{summary.orderCount}</p>
              </div>
              <div className="bg-card p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Itens</p>
                <p className="text-xl font-bold tabular-nums leading-tight">{summary.itemCount}</p>
              </div>
              {/* Napa do pedido inteiro — mesmo número da faixa de Material base do Consumo */}
              {baseTotal && (
                <div className="bg-card p-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Material base</p>
                  <p className="text-xl font-bold tabular-nums leading-tight text-primary">
                    {formatBaseQty(baseTotal.total)} m
                  </p>
                  <p className="text-[10px] text-muted-foreground font-mono truncate" title={baseTotal.parts.map(p => `${formatBaseQty(p.qty)} m ${p.name}`).join(' · ')}>
                    {netOfStock ? 'a comprar · ' : ''}{baseTotal.parts.map(p => p.name).join(' · ')}
                  </p>
                </div>
              )}
              <div className="bg-card p-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Precisam atenção</p>
                <p className={`text-xl font-bold tabular-nums leading-tight ${(summary.noSupplierItemCount + summary.colorMismatchCount + needWarnings.length) > 0 ? 'text-amber-600 dark:text-amber-500' : ''}`}>
                  {summary.noSupplierItemCount + summary.colorMismatchCount + needWarnings.length}
                </p>
              </div>
            </div>

            {/* Opção de netar estoque */}
            <div className="flex items-center gap-2">
              <Checkbox id="net-of-stock" checked={netOfStock} onCheckedChange={(v) => setNetOfStock(!!v)} />
              <Label htmlFor="net-of-stock" className="text-sm font-normal cursor-pointer">
                Descontar estoque disponível (comprar só a falta líquida)
              </Label>
            </div>

            {/* Legenda do excedente por múltiplo de compra (só quando há) */}
            {drafts.some((d) => d.items.some((it) => (it.rounding_surplus ?? 0) > 0)) && (
              <p className="text-xs text-muted-foreground">
                Na coluna <strong>A comprar</strong>, o valor em{' '}
                <span className="text-blue-600 dark:text-blue-400 font-medium">azul</span> é o
                excedente comprado a mais pra fechar o múltiplo de compra (embalagem) ou a
                unidade inteira (ex.: placa/caixa).
              </p>
            )}

            {/* Aviso "Sem Fornecedor" */}
            {summary.hasNoSupplier && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  {summary.noSupplierItemCount} item(ns) sem fornecedor cadastrado serão agrupados
                  numa única OC <strong>"{NO_SUPPLIER_LABEL}"</strong>. Cadastre o fornecedor do
                  produto pra direcionar automaticamente nas próximas vezes.
                </span>
              </div>
            )}

            {/* Tira que deveria ter virado napa — flag `is_artisanal` faltando
                no produto faz a OC comprar tira PRONTA, calada. Avisa, não
                corrige sozinho: virar a flag muda o que se compra. */}
            {unrolledSuspects.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <strong>{unrolledSuspects.length} item(ns) sendo comprado(s) como tira pronta.</strong>{' '}
                  Os outros produtos do mesmo grupo são cortados do rolo, mas estes estão sem a marca
                  de <strong>material artesanal</strong> no cadastro — então não viraram napa aqui.
                  <ul className="mt-1.5 space-y-1">
                    {unrolledSuspects.map((i) => (
                      <li key={`${i.material_id}-${i.color ?? ''}`} className="text-xs font-mono">
                        {i.product_name} · <strong>{i.color || '—'}</strong> · {formatBaseQty(Number(i.needed_qty) || 0)} {i.unit}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs">
                    Pra converter em napa, marque o produto como artesanal em <strong>Estoque → Materiais</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* GUARD — cor não cadastrada (fallback silencioso de cor) bloqueia gerar */}
            {summary.colorMismatchCount > 0 && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <strong>{summary.colorMismatchCount} item(ns) com cor não cadastrada.</strong>{' '}
                    A cor pedida não tem produto nesse material — o consumo caiu numa cor <strong>diferente</strong>,
                    então a compra/débito sairiam errados. Cadastre a cor no material antes de gerar
                    (ou marque o override abaixo se for um material sem cor, ex.: base).
                    <ul className="mt-1.5 space-y-1">
                      {drafts.flatMap((d) => d.items.filter((i) => i.color_mismatch).map((i) => {
                        const grp = resolveGroupForMaterial(i.material_id);
                        return (
                          <li key={`${i.material_id}-${i.color ?? ''}`} className="flex items-center gap-2 text-xs">
                            <span className="leading-none">{i.product_name} · <strong>{i.color || '—'}</strong></span>
                            {grp && (i.color || '').trim() && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-[11px] gap-1 border-destructive/40"
                                onClick={() => setCreateTarget({ groupId: grp.groupId, groupName: grp.groupName, color: (i.color || '').trim() })}
                              >
                                <Package className="h-3 w-3" /> Cadastrar
                              </Button>
                            )}
                          </li>
                        );
                      }))}
                    </ul>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                  <Checkbox checked={overrideColorMismatch} onCheckedChange={(v) => setOverrideColorMismatch(!!v)} />
                  Gerar mesmo assim (entendo que a cor cairá num produto de outra cor)
                </label>
              </div>
            )}

            {/* Grupos por fornecedor */}
            {drafts.map((d) => (
              <Collapsible key={d.supplier_id ?? '__none__'} defaultOpen className="rounded-lg border">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 hover:bg-muted/40 [&[data-state=open]>svg]:rotate-180">
                  <div className="flex items-center gap-2 min-w-0">
                    <span aria-hidden="true" className={`inline-block h-3.5 w-[3px] shrink-0 rounded-sm ${d.supplier_id === null ? 'bg-amber-500' : 'bg-primary'}`} />
                    <span className={`font-semibold truncate ${d.supplier_id === null ? 'text-amber-700' : ''}`}>
                      {d.supplier_name}
                    </span>
                    <Badge variant="outline" className="shrink-0">{d.items.length} item(ns)</Badge>
                    {(() => {
                      const b = computePurchaseBaseTotal(baseInputsFor(d.items));
                      if (!b) return null;
                      return (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-primary/40 bg-primary/10 text-primary font-mono tabular-nums"
                          title={b.parts.map(p => `${formatBaseQty(p.qty)} m ${p.name}`).join(' · ')}
                        >
                          base {formatBaseQty(b.total)} m
                        </Badge>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-medium tabular-nums">{formatMoney(d.total)}</span>
                    <ChevronDown className="h-4 w-4 transition-transform text-muted-foreground" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Table className="[&_td]:py-1.5 [&_th]:py-1.5">
                    <TableHeader>
                      <TableRow className="[&_th]:text-xs [&_th]:text-muted-foreground">
                        <TableHead>Código</TableHead>
                        <TableHead>Material</TableHead>
                        <TableHead>Cor</TableHead>
                        <TableHead className="text-right">Necessário</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                        <TableHead className="text-right">A comprar</TableHead>
                        <TableHead>Unid.</TableHead>
                        <TableHead className="text-right">Preço est.</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.items.map((it) => {
                        const gradeSizes = it.grade ? Object.keys(it.grade).filter((k) => (it.grade![k] ?? 0) > 0) : [];
                        return (
                        <Fragment key={`${it.material_id}::${it.color ?? ''}`}>
                        <TableRow className={gradeSizes.length > 0 ? '[&>td]:border-b-0' : ''}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{it.sku || '—'}</TableCell>
                          <TableCell className={`font-medium ${it.color_mismatch ? 'text-destructive' : ''}`}>
                            {it.product_name}
                            {it.color_mismatch && <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide">⚠ cor não cadastrada</span>}
                            {/* Descrição técnica só quando acrescenta — em vários
                                cadastros ela repete o nome ou o próprio código. */}
                            {it.technical_name
                              && it.technical_name.toLowerCase() !== it.product_name.trim().toLowerCase()
                              && it.technical_name.toLowerCase() !== (it.sku || '').trim().toLowerCase() && (
                              <div className="mt-0.5 text-[11px] font-normal leading-snug text-muted-foreground">{it.technical_name}</div>
                            )}
                            {/* Linha que ENTROU na OC mas com parte da necessidade
                                de fora — comprar isto sem ler o aviso é comprar a menos. */}
                            {it.conversion_warning && (
                              <div className="mt-0.5 flex items-start gap-1 text-[11px] font-normal leading-snug text-amber-600 dark:text-amber-500">
                                <AlertTriangle className="h-3 w-3 mt-[2px] shrink-0" />
                                <span>{it.conversion_warning}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className={it.color_mismatch ? 'text-destructive font-semibold' : 'text-muted-foreground'}>{it.color || '—'}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {it.needed_qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {it.stock_qty.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {it.quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                            {(it.rounding_surplus ?? 0) > 0 && (
                              <span
                                className="ml-1 text-blue-600 dark:text-blue-400 font-medium"
                                title={`+${(it.rounding_surplus ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} comprado a mais pra fechar o múltiplo de compra (embalagem) ou a unidade inteira`}
                              >
                                +{(it.rounding_surplus ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{it.unit}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(it.unit_price)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(it.quantity * it.unit_price)}</TableCell>
                        </TableRow>
                        {gradeSizes.length > 0 && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={9} className="pt-0">
                              <div className="flex flex-wrap items-center gap-1 pl-1">
                                <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Grade · numeração</span>
                                {gradeSizes.sort((a, b) => parseFloat(a) - parseFloat(b)).map((sz) => (
                                  <span key={sz} className="inline-flex items-baseline gap-1 rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[11px]">
                                    <span className="font-mono text-muted-foreground">{sz}</span>
                                    <span className="font-semibold tabular-nums">{(it.grade![sz] ?? 0).toLocaleString('pt-BR')}</span>
                                  </span>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="text-sm text-muted-foreground">
            {drafts.length > 0 && (
              <>
                <strong>{summary.orderCount}</strong> OC(s) · {summary.itemCount} item(ns) ·{' '}
                total estimado <strong>{formatMoney(summary.total)}</strong>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {drafts.length > 0 && (
              <Button variant="outline" onClick={handlePrintPdf} disabled={generate.isPending} className="gap-2">
                <FileText className="h-4 w-4" /> Gerar PDF
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generate.isPending}>
              Cancelar
            </Button>
            {drafts.length > 0 && (
              <Button variant="outline" onClick={handlePrintOcs} disabled={generate.isPending} className="gap-2"
                title="Baixa 1 PDF por fornecedor pra enviar a ordem individual a cada um">
                <Files className="h-4 w-4" /> Imprimir OC
              </Button>
            )}
            <Button
              onClick={handleGenerate}
              disabled={generate.isPending || drafts.length === 0 || conversionWarnings.length > 0 || (summary.colorMismatchCount > 0 && !overrideColorMismatch) || (needWarnings.length > 0 && !overrideNeedWarnings)}
              title={conversionWarnings.length > 0 ? 'Há materiais com conversão inválida' : summary.colorMismatchCount > 0 && !overrideColorMismatch ? 'Há itens com cor não cadastrada — cadastre a cor ou marque o override' : needWarnings.length > 0 && !overrideNeedWarnings ? 'Há materiais fora da compra por falta de cadastro — resolva ou marque o override' : undefined}
              className="gap-2"
            >
              {generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              Confirmar e Gerar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {createTarget && (
      <CreateStrapProductDialog
        open
        onOpenChange={(o) => { if (!o) setCreateTarget(null); }}
        groupId={createTarget.groupId}
        groupName={createTarget.groupName}
        color={createTarget.color}
        onCreated={() => {
          setCreateTarget(null);
          setOverrideColorMismatch(false);
          qc.invalidateQueries({ queryKey: ['materials_per_pv'] });
          qc.invalidateQueries({ queryKey: ['products'] });
        }}
      />
    )}
    </>
  );
}
