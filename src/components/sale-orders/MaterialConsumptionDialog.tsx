import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CircleNotch as Loader2, Package, FileText, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown, Warning as WarningIcon, Scissors, CheckCircle, ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useContractors } from '@/hooks/useContractors';
import { generateServiceOrderNumber } from '@/lib/serviceOrderStock';
import { escapeHtml } from '@/lib/htmlUtils';
import { soleMatrixHtml, buildColAvailability, sizeSortKey } from '@/lib/soleMatrixHtml';
import {
  fetchConsumptionContext,
  computeConsumptionForItems,
  TECHNICAL_SHEET_CONSUMPTION_COLUMNS,
  type ConsumptionItem,
  type MaterialConsumptionRow,
} from '@/lib/orderConsumption';
import {
  aggregateArtisanalStrapCut,
  isArtisanalStrap,
  normalizeWidthToMm,
  rollFillLabel,
  strapRollBarHtml,
  type ArtisanalStrapAggInput,
  type ArtisanalStrapCutRow,
} from '@/lib/strapRollCut';
import ArtisanalStrapRollCutBlock from '@/components/sale-orders/ArtisanalStrapRollCutBlock';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  saleOrderId: string | null;
  orderNumber: string;
};

/** Linha do modal = consumo canônico (motor em @/lib/orderConsumption) +
 *  disponibilidade em estoque anotada localmente (verde/vermelho). */
type ConsumptionRow = MaterialConsumptionRow & {
  /** Disponibilidade em estoque no momento da consulta (não-solado): soma do
   *  estoque dos produtos do grupo que casam na cor. Verde se cobre o consumo. */
  available?: number;
  /** Solado: estoque por numeração (stock_grade do produto-solado resolvido).
   *  Permite marcar verde/vermelho número a número. */
  soleSizeStock?: Record<string, number>;
  /** Equivalente em material-base SE produzido artesanalmente (Materiais
   *  Artesanais → artisanal_recipes). Ex.: tira overlock que rende 88 m por 1 m
   *  de NAPA SOFT → base = metros_de_tira / yield_per_meter, na mesma cor. */
  artisanal?: { baseName: string; baseQty: number; yieldPerMeter: number };
};

const COMPONENT_ORDER = ['Cabedal', 'Forração', 'Fachete', 'Palmilha', 'Forração Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'] as const;

// Normalização de texto (lowercase + sem acento) — usada no match de cor do
// estoque e no match de OS já gerada de corte de cabedal.
const normTxt = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/* ── Terceirização do Corte de Cabedal ─────────────────────────────────────
 * Itens do PV cuja ficha técnica NÃO tem tiras (has_straps !== true) passam
 * pela sub-etapa "Corte Cabedal" — mesma regra `requiresUpperCut` da ficha de
 * operador (PrintWorkSheetsPage). A seção abaixo permite gerar a OS de
 * terceirização direto do modal, espelhando o payload do
 * ServiceOrderFormDialog (criação manual canônica do menu Terceirizados). */
type UpperCutGroup = {
  /** chave estável referência+cor */
  key: string;
  refId: string;
  refCode: string | null;
  refName: string;
  color: string;
  pairs: number;
};

/** Valor de domínio pro setor de corte de cabedal — existe no enum SQL
 *  `production_stage_enum` ('corte_cabedal') e segue o padrão lowercase dos
 *  demais target_sector ('costura', 'corte_palmilha', ...). */
const UPPER_CUT_SECTOR = 'corte_cabedal';

/** Status que encerram uma OS — mesma lista usada no fluxo de gargalos
 *  (useSectorBottlenecks) e nos guards do Contractors.tsx. OS nesses status
 *  NÃO bloqueia gerar outra (anti-duplicação só considera OS ativa). */
const FINALIZED_OS_STATUSES = ['received', 'Concluído', 'concluido', 'finalizado', 'Finalizado', 'Cancelado', 'cancelled', 'cancelado'];

/**
 * Solado em matriz numeração × cor (igual à visão da OC), com cada célula colorida
 * por disponibilidade: verde = estoque do nº cobre o necessário, vermelho = falta.
 * `sizeSortKey`/`buildColAvailability` (e a versão HTML `soleMatrixHtml`) moram em
 * `@/lib/soleMatrixHtml` — FONTE ÚNICA reusada por este React e pelos PDFs.
 */
function SoleMatrix({ rows }: { rows: ConsumptionRow[] }) {
  const sizes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const s of Object.keys(r.sizeBreakdown || {})) set.add(s);
    return Array.from(set).sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
  }, [rows]);
  const totalsBySize = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) for (const [s, q] of Object.entries(r.sizeBreakdown || {})) m[s] = (m[s] || 0) + (Number(q) || 0);
    return m;
  }, [rows]);

  // Fallback: solado sem breakdown por numeração — tabela simples por cor,
  // colorida pelo total (soma do stock_grade ≥ total necessário).
  if (sizes.length === 0) {
    return (
      <div className="rounded-lg border overflow-hidden overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead>Solado</TableHead><TableHead>Cor</TableHead>
              <TableHead className="text-right">Consumo Total</TableHead>
              <TableHead className="text-right w-28">Em estoque</TableHead>
              <TableHead className="text-center w-24">Unidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const have = Object.values(r.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0);
              const ok = have >= r.totalQuantity;
              return (
                <TableRow key={i} className={ok ? 'bg-green-500/10' : 'bg-red-500/10'}>
                  <TableCell className="font-medium">{r.groupName}</TableCell>
                  <TableCell>{r.color}</TableCell>
                  <TableCell className="text-right font-mono font-bold">{r.totalQuantity.toFixed(2)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{have.toFixed(0)}</TableCell>
                  <TableCell className="text-center"><Badge variant="outline" className="text-xs">par</Badge></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden overflow-x-auto keep-together">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead>Cor</TableHead>
            {sizes.map((s) => <TableHead key={s} className="text-center px-2 whitespace-nowrap">{s}</TableHead>)}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => {
            const total = Object.values(r.sizeBreakdown || {}).reduce((s, v) => s + (Number(v) || 0), 0) || r.totalQuantity;
            return (
              <TableRow key={i}>
                <TableCell><Badge variant="outline" className="text-xs">{r.color}</Badge></TableCell>
                {(() => {
                  const avail = buildColAvailability(r.soleSizeStock, sizes, r.sizeBreakdown || {});
                  return sizes.map((s) => {
                  const need = r.sizeBreakdown?.[s] || 0;
                  const have = avail[s] || 0;
                  if (need <= 0) return <TableCell key={s} className="text-center text-muted-foreground">·</TableCell>;
                  const ok = have >= need;
                  return (
                    <TableCell
                      key={s}
                      title={`Necessário ${need} · Em estoque ${Math.round(have * 10) / 10}`}
                      className={`text-center font-mono font-semibold tabular-nums ${ok ? 'bg-green-500/15 text-green-700 dark:text-green-400' : 'bg-red-500/15 text-red-700 dark:text-red-400'}`}
                    >
                      {need}
                    </TableCell>
                  );
                  });
                })()}
                <TableCell className="text-right font-mono font-bold whitespace-nowrap">{total} <span className="text-[10px] text-muted-foreground">par</span></TableCell>
              </TableRow>
            );
          })}
          <TableRow className="bg-muted/40 font-semibold">
            <TableCell>Total por numeração</TableCell>
            {sizes.map((s) => <TableCell key={s} className="text-center font-mono tabular-nums">{totalsBySize[s] || 0}</TableCell>)}
            <TableCell className="text-right font-mono">{Object.values(totalsBySize).reduce((s, v) => s + v, 0)} <span className="text-[10px] text-muted-foreground">par</span></TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Seção Solado: uma MATRIZ POR TIPO DE SOLADO (separadas). Ex.: solado 01 e 238 no
 * mesmo PV/OC aparecem em tabelas distintas, cada uma com sua própria numeração
 * (conjugada ou individual) × cor. Pedido user 2026-05-30.
 */
function SoleSection({ rows }: { rows: ConsumptionRow[] }) {
  const bySole = useMemo(() => {
    const m = new Map<string, ConsumptionRow[]>();
    for (const r of rows) { const k = r.groupName || '—'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [rows]);
  return (
    <div className="space-y-3">
      {bySole.map(([sole, soleRows]) => (
        <div key={sole} className="space-y-1 keep-together">
          <div className="text-xs font-semibold flex items-center gap-2">
            <span className="inline-block rounded bg-muted px-2 py-0.5 text-foreground">{sole}</span>
            <span className="text-muted-foreground font-normal">{soleRows.length} cor(es)</span>
          </div>
          <SoleMatrix rows={soleRows} />
        </div>
      ))}
    </div>
  );
}

export default function MaterialConsumptionDialog({ open, onOpenChange, saleOrderId, orderNumber }: Props) {
  const qc = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);
  // Bloco SEPARADO (vermelho) das tiras artesanais cortadas do rolo. Derivado
  // das linhas 'Tiras' já agregadas (grupo+cor, em metros) — mesma detecção e
  // mesma matemática (strapRollCut) usadas no Resumo Consolidado e na Lista de
  // Separação. Sem isto, o modal por-PV mostrava as tiras só no preto.
  const [artisanalStrapRows, setArtisanalStrapRows] = useState<ArtisanalStrapCutRow[]>([]);

  // ── Corte de Cabedal — terceirização ────────────────────────────────────
  const { data: contractors = [] } = useContractors();
  const activeContractors = useMemo(
    () => contractors.filter((c) => c.active), // hook já ordena por nome
    [contractors],
  );
  const [upperCutGroups, setUpperCutGroups] = useState<UpperCutGroup[]>([]);
  /** key do grupo → order_number da OS ativa já existente (anti-duplicação) */
  const [existingOsByKey, setExistingOsByKey] = useState<Record<string, string>>({});
  /** key do grupo → contractor_id selecionado no Select */
  const [contractorByKey, setContractorByKey] = useState<Record<string, string>>({});
  const [creatingKey, setCreatingKey] = useState<string | null>(null);

  // Gatilho de recálculo automático: invalidado pelo save do PV
  // (useUpdateSaleOrder → invalidateQueries(['consumption-source'])). Ao salvar
  // o pedido, esta query refetcha; o `dataUpdatedAt` muda e o efeito abaixo
  // recarrega o consumo SOZINHO — sem fechar/reabrir nem clicar Recalcular.
  const { dataUpdatedAt: pvTouchedAt } = useQuery({
    queryKey: ['consumption-source', saleOrderId],
    queryFn: async () => {
      const { data } = await supabase
        .from('sale_orders')
        .select('updated_at')
        .eq('id', saleOrderId as string)
        .maybeSingle();
      return (data as any)?.updated_at ?? null;
    },
    enabled: open && !!saleOrderId,
    staleTime: 0,
  });

  useEffect(() => {
    if (!open || !saleOrderId) return;
    let cancelled = false;
    loadConsumption(() => cancelled);
    return () => { cancelled = true; };
  }, [open, saleOrderId, pvTouchedAt]);

  const loadConsumption = async (isCancelled: () => boolean = () => false) => {
    if (!saleOrderId) return;
    setLoading(true);

    try {
      // O sub-select de technical_sheets reusa TECHNICAL_SHEET_CONSUMPTION_COLUMNS
      // (fonte ÚNICA das colunas que o motor canônico lê) + os campos exclusivos
      // do modal (code/name p/ a seção de Corte de Cabedal, has_straps p/ decidir
      // quem entra nela). Antes a lista era duplicada inline e DRIFTOU do motor:
      // faltavam lining_consumption_per_size (→ modal usava o escalar e divergia
      // do per-size que a ficha usa) e os *_material_product_id (→ pino de SKU não
      // aparecia no modal). Compor da constante elimina a divergência por
      // construção. (Auditoria do motor 2026-06-29.)
      const { data: items, error: itemsError } = await supabase
        .from('sale_order_items')
        .select(`
          reference_id,
          color,
          quantity,
          grade,
          fichas,
          strap_colors,
          technical_sheets(
            code,
            name,
            has_straps,
            ${TECHNICAL_SHEET_CONSUMPTION_COLUMNS}
          )
        `)
        .eq('sale_order_id', saleOrderId);

      if (itemsError) throw itemsError;
      if (!items || items.length === 0) {
        setRows([]);
        setArtisanalStrapRows([]);
        setUpperCutGroups([]);
        setExistingOsByKey({});
        setContractorByKey({});
        return;
      }

      // ── Itens com Corte de Cabedal (has_straps !== true), agrupados por
      //    referência + cor — alimenta a seção de terceirização. ────────────
      const groupsMap = new Map<string, UpperCutGroup>();
      for (const item of items as any[]) {
        const sheet = item.technical_sheets;
        if (!item.reference_id || !sheet || sheet.has_straps === true) continue;
        const color = (item.color || '').trim() || '—';
        const key = `${item.reference_id}|${normTxt(color)}`;
        const g = groupsMap.get(key) || {
          key,
          refId: item.reference_id,
          refCode: sheet.code || null,
          refName: sheet.name || '',
          color,
          pairs: 0,
        };
        g.pairs += Number(item.quantity) || 0;
        groupsMap.set(key, g);
      }
      const upperGroups = Array.from(groupsMap.values())
        .filter((g) => g.pairs > 0)
        .sort((a, b) => (a.refCode || a.refName).localeCompare(b.refCode || b.refName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR'));

      // OS ativas de corte de cabedal já vinculadas a ESTE PV (anti-duplicação):
      // casa pela referência (code, senão nome) + cor presentes na description.
      const osByKey: Record<string, string> = {};
      if (upperGroups.length > 0) {
        // Inclui OSs vinculadas via linked_sale_order_ids (ex.: excedente do
        // Planejamento cobrindo este PV) — não só as criadas por este modal.
        const { data: existingOs } = await (supabase as any)
          .from('service_orders')
          .select('order_number, description, status')
          .or(`sale_order_id.eq.${saleOrderId},linked_sale_order_ids.cs.{${saleOrderId}}`)
          .eq('target_sector', UPPER_CUT_SECTOR);
        const activeOs = ((existingOs || []) as Array<{ order_number: string; description: string | null; status: string }>)
          .filter((o) => !FINALIZED_OS_STATUSES.includes(o.status));
        for (const g of upperGroups) {
          const refToken = normTxt(g.refCode || g.refName);
          if (!refToken) continue;
          const hit = activeOs.find((o) => {
            const desc = normTxt(o.description || '');
            if (!desc.includes(refToken)) return false;
            // se o grupo tem cor definida, exige a cor na description também
            if (g.color !== '—' && !desc.includes(normTxt(g.color))) return false;
            return true;
          });
          if (hit) osByKey[g.key] = hit.order_number;
        }
      }

      if (!isCancelled()) {
        setUpperCutGroups(upperGroups);
        setExistingOsByKey(osByKey);
        setContractorByKey({});
      }

      const refIds = [...new Set(items.map((item) => item.reference_id).filter(Boolean))];

      const ctx = await fetchConsumptionContext(refIds);

      // Receitas artesanais (Materiais Artesanais): cada uma liga um produto
      // artesanal (ex.: tira) a um material-base (napa) com yield_per_meter
      // (metros de saída por 1 m de base). Usado pra (a) mostrar, ao lado do
      // consumo da tira, quanto de napa-base sairia se feita artesanalmente; e
      // (b) DETECTAR que a tira é artesanal cortada do rolo (grupo de RESULTADO
      // `artisanal_product_name`) + largura de corte (`cut_width_mm`, mm).
      // Query DEFENSIVA em cut_width_mm: se a coluna ainda não foi migrada, o
      // PostgREST erra e refazemos sem ela (não quebra o modal).
      let recipesData: any[] | null = null;
      {
        const withWidth = await supabase
          .from('artisanal_recipes')
          .select('artisanal_product_name, base_product_name, yield_per_meter, cut_width_mm' as any)
          .eq('active', true);
        if (!withWidth.error) {
          recipesData = withWidth.data as any[];
        } else {
          const fallback = await supabase
            .from('artisanal_recipes')
            .select('artisanal_product_name, base_product_name, yield_per_meter')
            .eq('active', true);
          recipesData = (fallback.data as any[]) || null;
        }
      }

      // Modo de embalagem do PEDIDO — quando a ficha tem várias caixas no BOM
      // (colmeia + individual), o motor mostra só a caixa do modo escolhido.
      const { data: soPkg } = await supabase
        .from('sale_orders')
        .select('packaging_mode')
        .eq('id', saleOrderId)
        .single();
      const packagingMode = (soPkg as any)?.packaging_mode ?? null;
      const itemsWithMode = (items as any[]).map((it) => ({ ...it, packagingMode }));

      // Motor CANÔNICO (mesmo de @/lib/orderConsumption usado pela ficha do
      // operador, por OP). Aqui calculamos por PEDIDO: agrega todos os itens do
      // PV. Só o consumo previsto — a disponibilidade é anotada logo abaixo.
      const rows = computeConsumptionForItems(
        itemsWithMode as unknown as ConsumptionItem[],
        ctx,
      ) as ConsumptionRow[];

      // ── Disponibilidade em estoque (no momento da consulta) ──────────────
      // Não-solado: soma o estoque dos produtos do grupo que casam na cor.
      // Solado: pega o stock_grade do produto-solado (número a número).
      const colorMatchesProduct = (p: any, color: string): boolean => {
        if (!color || color === '—') return true;
        const c = normTxt(color);
        const pName = normTxt(p.name); const pColor = normTxt(p.color);
        if (pColor === c || pName === c) return true;
        const after = pName.includes(':') ? normTxt(pName.split(':').pop() || '') : pName.includes('-') ? normTxt(pName.split('-').pop() || '') : '';
        if (after && after === c) return true;
        if (pColor.length > 3 && c.length > 3 && (c.includes(pColor) || pColor.includes(c))) return true;
        return false;
      };
      const groupAvailable = (groupName: string, color: string): number => {
        const group = (ctx.productGroups || []).find((g: any) => normTxt(g.name) === normTxt(groupName));
        return (ctx.allProducts || []).filter((p: any) => {
          // membro do grupo; só cai no match por nome quando o grupo não existe
          // (evita puxar produto de OUTRO grupo que só compartilha o nome)
          const ok = group ? p.group_id === group.id : normTxt(p.name) === normTxt(groupName);
          if (!ok) return false;
          return colorMatchesProduct(p, color);
        }).reduce((s: number, p: any) => {
          // disponível = quantidade − reservado (consistente com o resto do app)
          const avail = (Number(p.quantity) || 0) - (Number(p.reserved_stock) || 0);
          return s + Math.max(0, avail);
        }, 0);
      };
      const extractStockGrade = (prod: any): Record<string, number> => {
        const out: Record<string, number> = {};
        const g = prod?.stock_grade;
        if (g && typeof g === 'object') {
          for (const [k, v] of Object.entries(g)) {
            if (k.startsWith('_')) continue; // pula meta (_size_to, _size_from)
            const n = Number(v);
            if (Number.isFinite(n)) out[k] = n;
          }
        }
        return out;
      };
      // Estoque por numeração do solado. Como agora agrupamos o solado pelo MODELO
      // (nome do grupo, que difere do nome do produto), o id resolvido pelo motor
      // (`soleProductId`) é a forma confiável de achar a variante de cor certa.
      // Fallback pro casamento por nome quando o motor não resolveu o produto
      // (solado só via texto sheet.sole_material).
      const soleStockById = (productId: string): Record<string, number> => {
        const prod = (ctx.allProducts || []).find((p: any) => p.id === productId);
        return extractStockGrade(prod);
      };
      const soleStockGrade = (groupName: string, color: string): Record<string, number> => {
        const prod = (ctx.allProducts || []).find((p: any) => normTxt(p.name) === normTxt(groupName) && colorMatchesProduct(p, color))
          || (ctx.allProducts || []).find((p: any) => normTxt(p.name) === normTxt(groupName));
        return extractStockGrade(prod);
      };
      // Mapa nome-do-produto-artesanal (normalizado) → { base, yield }. O nome
      // da receita usa grafia variada (ex.: "Tira Overlock 5mm") e o grupo da
      // tira vem em CAIXA ALTA ("TIRA OVERLOCK 5MM") — normTxt resolve isso.
      const recipeMap = new Map<string, { base: string; yieldPerMeter: number }>();
      for (const r of (recipesData || []) as any[]) {
        const y = Number(r.yield_per_meter) || 0;
        if (y > 0 && r.artisanal_product_name) {
          recipeMap.set(normTxt(r.artisanal_product_name), { base: r.base_product_name, yieldPerMeter: y });
        }
      }
      const LINEAR = new Set(['m', 'metro', 'metros', 'mt']);

      // ── Tiras artesanais (corte do rolo): detecção + largura de corte ───────
      // Detecção AUTORITATIVA = grupo da tira é o RESULTADO de uma receita ativa
      // (`artisanal_product_name`). Inclui receitas com yield 0 (recipeMap acima
      // exige yield > 0; aqui basta o nome). Largura prioriza `cut_width_mm` da
      // receita → largura do grupo (`product_groups.dimensions_width`).
      const recipeOutputNorms = new Set<string>();
      const recipeWidth = new Map<string, number>();
      // Base do rolo por norm — INDEPENDENTE de yield (o `recipeMap` acima exige
      // yield > 0; o agrupamento por base+cor do otimizador precisa valer também
      // pra receitas yield-0, igual aos outros 2 painéis). Não ler do recipeMap.
      const recipeBaseByNorm = new Map<string, string>();
      for (const r of (recipesData || []) as any[]) {
        const norm = normTxt(r.artisanal_product_name || '');
        if (!norm) continue;
        recipeOutputNorms.add(norm);
        const w = Number(r.cut_width_mm) || 0;
        if (w > (recipeWidth.get(norm) || 0)) recipeWidth.set(norm, w);
        const base = (r.base_product_name || '').toString().trim();
        if (base && !recipeBaseByNorm.has(norm)) recipeBaseByNorm.set(norm, base);
      }
      const groupWidthByNorm = new Map<string, number>();
      const groupNameByNorm = new Map<string, string>();
      // norm do nome → group_id, pra agregar por (group_id+cor) igual aos outros painéis.
      const groupIdByNorm = new Map<string, string>();
      for (const g of (ctx.productGroups || []) as any[]) {
        const norm = normTxt(g.name);
        if (!norm) continue;
        if (!groupNameByNorm.has(norm)) groupNameByNorm.set(norm, g.name);
        if (g.id && !groupIdByNorm.has(norm)) groupIdByNorm.set(norm, String(g.id));
        const w = normalizeWidthToMm(g.dimensions_width, g.dimensions_unit);
        if (w > (groupWidthByNorm.get(norm) || 0)) groupWidthByNorm.set(norm, w);
      }
      // Flag `is_artisanal_strap` no grupo — sinal secundário (recipe vence).
      // Query DEFENSIVA: coluna pode não estar migrada → seguimos sem ela.
      const groupArtisanalFlag = new Map<string, boolean>();
      {
        const { data: flagged, error: flagErr } = await supabase
          .from('product_groups')
          .select('name, is_artisanal_strap' as any);
        if (!flagErr && Array.isArray(flagged)) {
          for (const g of flagged as any[]) {
            if ((g as any)?.is_artisanal_strap) groupArtisanalFlag.set(normTxt(g.name), true);
          }
        }
      }
      const strapWidthForNorm = (norm: string) =>
        recipeWidth.get(norm) || groupWidthByNorm.get(norm) || 0;

      for (const row of rows) {
        if (row.componentType === 'Solado') {
          row.soleSizeStock = row.soleProductId
            ? soleStockById(row.soleProductId)
            : soleStockGrade(row.groupName, row.color);
        } else {
          row.available = groupAvailable(row.groupName, row.color);
        }
        // Equivalente em material-base se feita artesanalmente. Só faz sentido
        // pra linhas lineares (metros) — yield_per_meter é m-saída por m-base.
        const recipe = recipeMap.get(normTxt(row.groupName)) || recipeMap.get(normTxt(row.materialName));
        if (recipe && LINEAR.has((row.productUnit || '').toLowerCase()) && row.totalQuantity > 0) {
          row.artisanal = {
            baseName: recipe.base,
            baseQty: row.totalQuantity / recipe.yieldPerMeter,
            yieldPerMeter: recipe.yieldPerMeter,
          };
        }
      }

      const sortedRows = [...rows].sort((a, b) => {
        const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number]) - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
        if (typeDiff !== 0) return typeDiff;
        const groupDiff = a.groupName.localeCompare(b.groupName, 'pt-BR');
        if (groupDiff !== 0) return groupDiff;
        const materialDiff = a.materialName.localeCompare(b.materialName, 'pt-BR');
        if (materialDiff !== 0) return materialDiff;
        return a.color.localeCompare(b.color, 'pt-BR');
      });

      // Linhas do bloco vermelho: uma por (grupo+cor) de tira artesanal. As
      // linhas 'Tiras' já vêm agregadas por grupo+cor em METROS (motor canônico),
      // então `totalQuantity` é exatamente os metros_necessarios do corte do rolo
      // — o mesmo total que a seção "Tiras" exibe acima (por isso o bloco vermelho
      // não repete a coluna de metros: só mostra o cm a cortar do rolo).
      const artisanalInputs: ArtisanalStrapAggInput[] = [];
      for (const row of sortedRows) {
        if (row.componentType !== 'Tiras' || !(row.totalQuantity > 0)) continue;
        const norm = normTxt(row.groupName);
        const detected = isArtisanalStrap({
          recipeFlag: recipeOutputNorms.has(norm),
          groupFlag: groupArtisanalFlag.get(norm),
          name: `${row.groupName} ${row.materialName || ''}`,
        });
        if (!detected) continue;
        artisanalInputs.push({
          // group_id resolvido pelo nome do grupo (as linhas canônicas já vêm
          // somadas por grupo+cor); agrupar por (group_id+cor) mantém paridade
          // com os outros painéis e soma os metros antes do corte do rolo.
          groupKey: groupIdByNorm.get(norm) || norm,
          groupName: groupNameByNorm.get(norm) || row.groupName,
          color: (row.color || '—').toString().trim() || '—',
          metros: row.totalQuantity,
          largura_mm: strapWidthForNorm(norm),
          baseName: recipeBaseByNorm.get(norm) || undefined,
        });
      }
      const artisanalCut: ArtisanalStrapCutRow[] = aggregateArtisanalStrapCut(artisanalInputs);

      if (isCancelled()) return;
      setRows(sortedRows);
      setArtisanalStrapRows(artisanalCut);
    } catch (err) {
      if (isCancelled()) return;
      console.error('Erro ao carregar consumo:', err);
      setRows([]);
      setArtisanalStrapRows([]);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  };

  /** Cria a OS de corte de cabedal pro grupo (ref+cor) — espelha o payload do
   *  ServiceOrderFormDialog (criação manual canônica): order_number via
   *  generateServiceOrderNumber(), status 'Pendente', service_date hoje. */
  const handleCreateUpperCutOS = async (g: UpperCutGroup) => {
    const contractorId = contractorByKey[g.key];
    if (!saleOrderId || !contractorId || creatingKey) return;
    setCreatingKey(g.key);
    try {
      const order_number = await generateServiceOrderNumber();
      // Tarifa vigente serviço×prestadora (Fase 1 facção) — evita OS sem preço
      // (65% das OSs históricas) e alimenta a conta a pagar por pares bons.
      let unitPrice = 0;
      try {
        const { data: rate } = await (supabase as any).rpc('get_contractor_rate', {
          p_contractor_id: contractorId,
          p_sector: UPPER_CUT_SECTOR,
          p_date: new Date().toISOString().slice(0, 10),
        });
        unitPrice = rate != null ? Number(rate) : 0;
      } catch { /* sem tarifa — OS nasce com preço 0, definir depois */ }
      const refLabel = [g.refCode, g.refName].filter(Boolean).join(' ');
      const colorPart = g.color !== '—' ? ` · cor ${g.color}` : '';
      const payload = {
        contractor_id: contractorId,
        order_number,
        description: `Corte de cabedal — REF ${refLabel}${colorPart} · ${g.pairs} pares (PV ${orderNumber})`,
        service_date: new Date().toISOString().slice(0, 10),
        target_sector: UPPER_CUT_SECTOR,
        sale_order_id: saleOrderId,
        linked_sale_order_ids: [saleOrderId],
        quantity: g.pairs,
        unit_price: unitPrice,
        total_value: unitPrice > 0 ? unitPrice * g.pairs : 0,
        status: 'Pendente',
      };
      const { data: inserted, error } = await (supabase as any)
        .from('service_orders')
        .insert(payload)
        .select('id, order_number')
        .single();
      if (error) throw new Error(error.message);

      setExistingOsByKey((prev) => ({ ...prev, [g.key]: inserted.order_number as string }));
      // Re-valida os caches das listas de Terceirizados — a OS aparece sem refresh.
      qc.invalidateQueries({ queryKey: ['service_orders'] });
      qc.invalidateQueries({ queryKey: ['contractors'] });
      qc.invalidateQueries({ queryKey: ['v_outsourced_in_field'] });
      qc.invalidateQueries({ queryKey: ['v_contractor_metrics'] });
      if (unitPrice > 0) {
        toast.success(`OS ${inserted.order_number} criada (R$ ${unitPrice.toFixed(2)}/par pela tabela) — visível no menu Terceirizados.`);
      } else {
        toast.warning(`OS ${inserted.order_number} criada SEM preço — cadastre a tarifa da prestadora ou defina o valor na OS.`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao criar a OS de corte de cabedal.');
    } finally {
      setCreatingKey(null);
    }
  };

  type SortKey = 'componentType' | 'groupName' | 'materialName' | 'color' | 'totalQuantity' | 'productUnit';
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey(null); setSortDir('asc'); }
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    return [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'totalQuantity') return (a.totalQuantity - b.totalQuantity) * dir;
      const aVal = (a[sortKey] || '').toLowerCase();
      const bVal = (b[sortKey] || '').toLowerCase();
      return aVal.localeCompare(bVal, 'pt-BR') * dir;
    });
  }, [rows, sortKey, sortDir]);

  const grouped = useMemo(() => {
    // Visão SEGMENTADA: ao ordenar por qualquer coluna de TEXTO (Grupo, Aplicação,
    // Cor, Unidade), monta seções por valor daquela coluna — o valor vazio/sem
    // ("Sem cor", "Sem grupo"…) sempre no topo e, depois, cada valor com TODOS os
    // seus materiais (tira, forração, cabedal, solado…) em sequência. A ordem dos
    // valores respeita asc/desc; dentro de cada seção ordena por tipo de
    // componente → grupo → aplicação → cor. (Pedido user.)
    const SEGMENT_KEYS: SortKey[] = ['groupName', 'materialName', 'color', 'productUnit'];
    if (sortKey && SEGMENT_KEYS.includes(sortKey)) {
      const key = sortKey as 'groupName' | 'materialName' | 'color' | 'productUnit';
      const emptyLabel = key === 'color' ? 'Sem cor'
        : key === 'groupName' ? 'Sem grupo'
        : key === 'materialName' ? 'Sem aplicação'
        : 'Sem unidade';
      const sortWithin = (arr: ConsumptionRow[]) => [...arr].sort((a, b) => {
        const t = COMPONENT_ORDER.indexOf(a.componentType as (typeof COMPONENT_ORDER)[number])
          - COMPONENT_ORDER.indexOf(b.componentType as (typeof COMPONENT_ORDER)[number]);
        if (t !== 0) return t;
        return a.groupName.localeCompare(b.groupName, 'pt-BR')
          || a.materialName.localeCompare(b.materialName, 'pt-BR')
          || a.color.localeCompare(b.color, 'pt-BR');
      });
      const empties: ConsumptionRow[] = [];
      const byVal = new Map<string, ConsumptionRow[]>();
      for (const row of rows) {
        const v = (row[key] || '').trim();
        if (!v || v === '—') { empties.push(row); continue; }
        if (!byVal.has(v)) byVal.set(v, []);
        byVal.get(v)!.push(row);
      }
      const dir = sortDir === 'asc' ? 1 : -1;
      const keys = Array.from(byVal.keys()).sort((a, b) => a.localeCompare(b, 'pt-BR') * dir);
      const out = new Map<string, ConsumptionRow[]>();
      if (empties.length) out.set(emptyLabel, sortWithin(empties)); // sempre no topo
      for (const k of keys) out.set(k, sortWithin(byVal.get(k)!));
      return out;
    }
    if (sortKey === 'totalQuantity') {
      return new Map([['Todos', sortedRows]]);
    }
    const map = new Map<string, ConsumptionRow[]>();
    for (const row of sortedRows) {
      if (!map.has(row.componentType)) map.set(row.componentType, []);
      map.get(row.componentType)!.push(row);
    }
    return map;
  }, [rows, sortedRows, sortKey, sortDir]);

  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    }
    return map;
  }, [rows]);

  const formatUnit = (unit: string) => {
    const labels: Record<string, string> = {
      metro: 'm',
      m: 'm',
      'm²': 'm²',
      dm2: 'dm²',
      par: 'par',
      un: 'un',
      kg: 'kg',
      litro: 'L',
      placa: 'placa(s)',
    };
    return labels[unit] || unit || 'un';
  };

  const handlePrintPdf = useCallback(() => {
    // Cores de cabeçalho por componentType (visual hierarchy)
    const componentColors: Record<string, { bg: string; border: string; text: string }> = {
      'Cabedal':    { bg: '#fef3c7', border: '#f59e0b', text: '#78350f' },
      'Forração':      { bg: '#cffafe', border: '#06b6d4', text: '#155e75' },
      'Fachete':    { bg: '#cffafe', border: '#0891b2', text: '#155e75' },
      'Palmilha':   { bg: '#dbeafe', border: '#3b82f6', text: '#1e3a8a' },
      'Forração Palmilha': { bg: '#cffafe', border: '#06b6d4', text: '#155e75' },
      'Solado':     { bg: '#dcfce7', border: '#22c55e', text: '#14532d' },
      'Tiras':      { bg: '#fce7f3', border: '#ec4899', text: '#831843' },
      'Químicos':   { bg: '#ede9fe', border: '#8b5cf6', text: '#4c1d95' },
      'Embalagem':  { bg: '#e0e7ff', border: '#6366f1', text: '#312e81' },
      'Outros':     { bg: '#f3f4f6', border: '#9ca3af', text: '#374151' },
    };

    // Agrupa por componentType pra cards
    const cards: string[] = [];
    for (const [componentType, componentRows] of grouped.entries()) {
      if (componentType === 'Todos') continue;
      const colors = componentColors[componentType] || componentColors['Outros'];
      // Calcula total do componente (agrupa por unidade)
      const totalsThisComp = new Map<string, number>();
      for (const r of componentRows) {
        totalsThisComp.set(r.productUnit, (totalsThisComp.get(r.productUnit) || 0) + r.totalQuantity);
      }
      const totalSummary = Array.from(totalsThisComp.entries())
        .map(([u, v]) => `${v.toFixed(1)} ${formatUnit(u)}`)
        .join(' · ');

      // Solado: MATRIZ numeração × cor por modelo (igual à tela), full-width pra
      // caber a grade de numeração. Substitui o texto inline "Nº 34: 184 · …".
      if (componentType === 'Solado') {
        cards.push(`
        <div class="card" style="grid-column:1 / -1;border:2px solid ${colors.border};border-radius:6px;overflow:hidden;break-inside:avoid;margin-bottom:6px">
          <div style="background:${colors.bg};color:${colors.text};padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center">
            <span>▌${escapeHtml(componentType)}</span>
            <span style="font-size:8.5pt;font-weight:600;opacity:.8">${totalSummary}</span>
          </div>
          <div style="background:white;padding:0 6px 6px">${soleMatrixHtml(componentRows)}</div>
        </div>
      `);
        continue;
      }

      const rowsHtml = componentRows.map(row => {
        const aplicacao = row.sizeBreakdown && Object.keys(row.sizeBreakdown).length > 0
          ? Object.entries(row.sizeBreakdown)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([s, qty]) => `Nº ${s}: ${qty}`)
              .join(' · ')
          : row.materialName;
        return `
        <tr>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb">
            <div style="font-weight:600;font-size:10pt">${escapeHtml(aplicacao)}</div>
            <div style="color:#6b7280;font-size:8.5pt">${escapeHtml(row.groupName)}${row.color && row.color !== '—' ? ` · ${escapeHtml(row.color)}` : ''}</div>
          </td>
          <td style="padding:3px 6px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700;font-size:10pt">
            ${row.totalQuantity.toFixed(2)} <span style="color:#6b7280;font-weight:400;font-size:8.5pt">${formatUnit(row.productUnit)}</span>
            ${row.artisanal ? `<div style="color:#6b7280;font-weight:400;font-size:7.5pt;white-space:nowrap">≈ ${row.artisanal.baseQty.toFixed(2)} m ${escapeHtml(row.artisanal.baseName)} · artesanal (1 m → ${row.artisanal.yieldPerMeter} m)</div>` : ''}
          </td>
        </tr>
      `;
      }).join('');

      cards.push(`
        <div class="card" style="border:2px solid ${colors.border};border-radius:6px;overflow:hidden;break-inside:avoid;margin-bottom:6px">
          <div style="background:${colors.bg};color:${colors.text};padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;display:flex;justify-content:space-between;align-items:center">
            <span>▌${escapeHtml(componentType)}</span>
            <span style="font-size:8.5pt;font-weight:600;opacity:.8">${totalSummary}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;background:white">
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `);
    }

    const totalsHtml = Array.from(totalsByUnit.entries()).map(([unit, total]) =>
      `<span style="display:inline-block;background:#1f2937;color:white;padding:3px 10px;border-radius:4px;margin-right:6px;font-size:9.5pt;font-weight:600">
        ${total.toFixed(1)} ${formatUnit(unit)}
      </span>`
    ).join('');

    // Bloco vermelho: tiras artesanais — corte do rolo (mesmo conteúdo da tela).
    const strapCutHtml = artisanalStrapRows.length === 0 ? '' : `
        <div style="break-inside:avoid;margin-top:10px">
          <div style="background:#fef2f2;color:#dc2626;padding:4px 8px;font-weight:700;font-size:10pt;text-transform:uppercase;letter-spacing:.5px;border-radius:4px">✂️ Tiras artesanais — corte do rolo (40m × 1370mm)</div>
          <p style="font-size:8.5pt;color:#dc2626;margin:4px 0">Cortar do rolo — não é consumo direto de estoque.</p>
          <table style="width:100%;border-collapse:collapse;font-size:9.5pt;border:1px solid #fca5a5">
            <thead><tr style="color:#dc2626;background:#fef2f2">
              <th style="padding:4px 6px;text-align:left;font-size:8.5pt;text-transform:uppercase">Tira (cor · largura)</th>
              <th style="padding:4px 6px;text-align:right;font-size:8.5pt;text-transform:uppercase">Cortar do rolo (cm)</th>
            </tr></thead>
            <tbody>${artisanalStrapRows.map((r) => {
              const { cut } = r;
              const cortar = cut.valid
                ? `<span style="font-weight:700;font-size:11pt">${cut.cm_a_cortar.toFixed(1)} cm</span>`
                : `<span style="font-size:8.5pt">⚠ ${cut.warning || 'sem largura'}</span>`;
              const fill = rollFillLabel(cut);
              const breakdownHtml = fill ? `<div style="font-size:7.5pt;opacity:.85">${fill}</div>` : '';
              const larguraTxt = cut.widthMissing ? '' : ` · ${r.largura_mm.toFixed(0)} mm`;
              return `<tr style="color:#dc2626">
                <td style="padding:3px 6px;border-bottom:1px solid #fecaca;font-weight:600">${escapeHtml(r.groupName)}${r.color && r.color !== '—' ? ` · ${escapeHtml(r.color)}` : ''}${larguraTxt}</td>
                <td style="padding:3px 6px;border-bottom:1px solid #fecaca;text-align:right;font-family:monospace">${cortar}${strapRollBarHtml(cut)}${breakdownHtml}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consumo de Materiais — ${escapeHtml(orderNumber)}</title>
      <style>
        /* Margem 8mm (não 6mm) + box-sizing global p/ as bordas não serem
           cortadas: com 6mm o conteúdo encostava na zona não-imprimível da
           impressora e a borda direita dos cards saía cortada. Mesma correção
           já aplicada em printLabels.ts/PrintWorkSheetsPage. */
        @page { size: A4 portrait; margin: 8mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body { font-family: system-ui, -apple-system, sans-serif; color: #111; font-size: 10pt; line-height: 1.3; max-width: 100%; overflow-x: hidden; }
        h1 { font-size: 14pt; margin: 0 0 2px; }
        .sub { color: #6b7280; font-size: 9pt; margin: 0 0 8px; }
        .totals-strip { margin-bottom: 10px; padding: 6px 0; border-top: 2px solid #1f2937; border-bottom: 2px solid #1f2937; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; }
        .card { max-width: 100%; }
        table { max-width: 100%; }
        @media print {
          .card { break-inside: avoid; }
        }
      </style></head>
      <body>
        <h1>Consumo de Materiais — ${escapeHtml(orderNumber)}</h1>
        <p class="sub">${rows.length} item${rows.length !== 1 ? 'ns' : ''} · ${grouped.size} componente${grouped.size !== 1 ? 's' : ''} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div class="totals-strip">${totalsHtml}</div>
        <div class="grid">${cards.join('')}</div>
        ${strapCutHtml}
      </body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  }, [grouped, totalsByUnit, orderNumber, rows.length, artisanalStrapRows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-7xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Consumo de Materiais — {orderNumber}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum consumo de material encontrado para este pedido.</p>
        ) : (
          <div className="space-y-4">
            {rows.some(r => r.widthMissing) && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2">
                <WarningIcon weight="fill" className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-amber-900 dark:text-amber-300">Atenção — consumo pode estar inflado</p>
                  <p className="text-amber-900/80 dark:text-amber-200/80 mt-0.5">
                    Materiais marcados com <WarningIcon weight="fill" className="h-3 w-3 inline text-amber-600" /> não têm <strong>largura cadastrada</strong> na Ficha de Componente.
                    Sem isso, o sistema trata dm² como metro, fazendo o consumo aparecer ~100× maior que o real.
                    Cadastre em <strong>Materiais → produto → Ficha de Componente → Dimensões</strong> pra corrigir.
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
                  <Badge key={unit} variant="secondary" className="text-sm px-3 py-1">
                    {total.toFixed(2)} {formatUnit(unit)}
                  </Badge>
                ))}
                <Badge variant="outline" className="text-sm px-3 py-1">
                  {rows.length} item(ns)
                </Badge>
                <span className="flex items-center gap-2 text-xs text-muted-foreground ml-1">
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-green-500/40 border border-green-500/60" /> em estoque</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-red-500/40 border border-red-500/60" /> em falta</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => loadConsumption()} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Recalcular
                </Button>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintPdf}>
                  <FileText className="h-4 w-4" /> Gerar PDF
                </Button>
              </div>
            </div>

            {Array.from(grouped.entries()).map(([componentType, componentRows]) => (
              <div key={componentType} className="space-y-1">
                {componentType !== 'Todos' && (
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{componentType}</h3>
                )}
                {componentType === 'Solado'
                  ? <SoleSection rows={componentRows} />
                  : (
                 <div className="rounded-lg border overflow-hidden overflow-x-auto">
                   <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('groupName')}>
                          <span className="flex items-center">Grupo de material <SortIcon col="groupName" /></span>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('materialName')}>
                          <span className="flex items-center">Aplicação <SortIcon col="materialName" /></span>
                        </TableHead>
                        <TableHead className="cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('color')}>
                          <span className="flex items-center">Cor <SortIcon col="color" /></span>
                        </TableHead>
                        <TableHead className="text-right cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('totalQuantity')}>
                          <span className="flex items-center justify-end">Consumo Total <SortIcon col="totalQuantity" /></span>
                        </TableHead>
                        <TableHead className="text-right w-28">Em estoque</TableHead>
                        <TableHead className="text-center w-24 cursor-pointer select-none hover:text-foreground" onClick={() => handleSort('productUnit')}>
                          <span className="flex items-center justify-center">Unidade <SortIcon col="productUnit" /></span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentRows.map((row, index) => {
                        // widthMissing infla o consumo ~100× — comparar com estoque seria
                        // enganoso, então a linha fica neutra (o aviso âmbar permanece).
                        const known = !row.widthMissing;
                        // Na visão por COR o solado também cai nesta tabela genérica
                        // (a seção é uma cor, não "Solado"); usa o total do stock_grade
                        // como disponível em vez de `available` (que é undefined p/ solado).
                        const avail = row.componentType === 'Solado'
                          ? Object.values(row.soleSizeStock || {}).reduce((s, v) => s + (Number(v) || 0), 0)
                          : (row.available ?? 0);
                        const ok = avail >= row.totalQuantity;
                        const rowBg = !known ? '' : ok ? 'bg-green-500/10' : 'bg-red-500/10';
                        return (
                        <TableRow key={`${row.componentType}-${row.groupName}-${row.materialName}-${row.color}-${index}`} className={rowBg}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-1.5">
                              {row.widthMissing && (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <WarningIcon weight="fill" className="h-4 w-4 text-amber-600 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="max-w-xs">
                                      <p className="text-xs">
                                        Largura do material não cadastrada em <strong>Materiais → Ficha de Componente</strong>.
                                        Consumo pode estar até <strong>100× inflado</strong>. Cadastre <code>dimensions_width</code> pra corrigir.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {row.groupName}
                            </div>
                          </TableCell>
                          <TableCell>{row.materialName}</TableCell>
                          <TableCell>{row.color}</TableCell>
                          <TableCell className="text-right font-mono font-bold">
                            {row.totalQuantity.toFixed(2)}
                            {row.artisanal && (
                              <div className="text-[10px] font-normal text-muted-foreground mt-0.5 whitespace-nowrap">
                                ≈ {row.artisanal.baseQty.toFixed(2)} m {row.artisanal.baseName}
                                <span className="opacity-70"> · artesanal (1 m → {row.artisanal.yieldPerMeter} m)</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className={`text-right font-mono font-semibold ${!known ? 'text-muted-foreground' : ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                            {!known ? '—' : avail.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="text-xs">{formatUnit(row.productUnit)}</Badge>
                          </TableCell>
                        </TableRow>
                      ); })}
                    </TableBody>
                  </Table>
                </div>
                )}
              </div>
            ))}

            {/* Bloco separado: tiras artesanais cortadas do rolo (vermelho) */}
            <ArtisanalStrapRollCutBlock rows={artisanalStrapRows} />
          </div>
        )}

        {/* ── Corte de Cabedal — Terceirização ──────────────────────────────
            Visível quando ≥1 item do PV tem referência SEM tiras (modelo com
            cabedal completo a cortar). Atalho pro fluxo manual do menu
            Terceirizados: seleciona a terceirizada e gera a OS daqui. */}
        {!loading && upperCutGroups.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <Scissors className="h-4 w-4" />
              Corte de Cabedal — Terceirização
            </h3>
            <p className="text-xs text-muted-foreground">
              Referências deste pedido com corte de cabedal (modelo sem tiras). Selecione a terceirizada e
              gere a Ordem de Serviço direto daqui — ela entra como <strong>Pendente</strong> nas listas do
              menu Terceirizados.
            </p>
            <div className="rounded-lg border overflow-hidden overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Referência</TableHead>
                    <TableHead>Cor</TableHead>
                    <TableHead className="text-right w-20">Pares</TableHead>
                    <TableHead className="w-64">Terceirizada</TableHead>
                    <TableHead className="text-right w-44">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upperCutGroups.map((g) => {
                    const existingOs = existingOsByKey[g.key];
                    const selected = contractorByKey[g.key] || '';
                    const isCreating = creatingKey === g.key;
                    return (
                      <TableRow key={g.key}>
                        <TableCell className="font-medium">
                          {g.refCode && <span className="font-mono text-xs mr-1.5 text-muted-foreground">{g.refCode}</span>}
                          {g.refName}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{g.color}</Badge></TableCell>
                        <TableCell className="text-right font-mono font-semibold">{g.pairs}</TableCell>
                        <TableCell>
                          {existingOs ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <Select value={selected} onValueChange={(v) => setContractorByKey((prev) => ({ ...prev, [g.key]: v }))}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecionar terceirizada..." />
                              </SelectTrigger>
                              <SelectContent>
                                {activeContractors.length === 0 && (
                                  <div className="px-3 py-2 text-xs text-muted-foreground">
                                    Nenhuma terceirizada ativa. Cadastre em Terceirizados.
                                  </div>
                                )}
                                {activeContractors.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.trade_name || c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {existingOs ? (
                            <Badge variant="outline" className="text-xs gap-1 bg-green-500/10 text-green-700 border-green-500/40 dark:text-green-400">
                              <CheckCircle className="h-3 w-3" />
                              OS já gerada: {existingOs}
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              className="h-8 text-xs gap-1.5"
                              disabled={!selected || isCreating}
                              onClick={() => handleCreateUpperCutOS(g)}
                            >
                              {isCreating
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <Scissors className="h-3.5 w-3.5" />}
                              {isCreating ? 'Gerando...' : 'Gerar OS'}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
