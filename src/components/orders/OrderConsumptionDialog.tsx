import { useState, useEffect, useMemo, useCallback } from 'react';
import { escapeHtml } from '@/lib/htmlUtils';
import {
  AdaptiveDialog,
  AdaptiveDialogContent,
  AdaptiveDialogHeader,
  AdaptiveDialogTitle,
} from '@/components/ui/adaptive-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CircleNotch as Loader2, Package, FileText, ArrowsDownUp as ArrowUpDown, ArrowUp, ArrowDown } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchConsumptionContext,
  fetchTechnicalSheetsForConsumption,
  computeConsumptionForItems,
  type ConsumptionItem,
} from '@/lib/orderConsumption';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderIds: string[];
  title: string;
};

type ConsumptionRow = {
  componentType: string;
  groupName: string;
  materialName: string;
  productUnit: string;
  color: string;
  totalQuantity: number;
  /** Material de área (dm²) sem largura na ficha de componente → não dá pra
   *  converter pra unidade física; valor fica ~100× inflado e a linha vira neutra. */
  widthMissing?: boolean;
};

const COMPONENT_ORDER = ['Cabedal', 'Forração', 'Palmilha', 'Solado', 'Tiras', 'Químicos', 'Embalagem', 'Outros'] as const;

export default function OrderConsumptionDialog({ open, onOpenChange, orderIds, title }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ConsumptionRow[]>([]);

  useEffect(() => {
    if (!open || orderIds.length === 0) return;
    loadConsumption();
  }, [open, orderIds]);

  const loadConsumption = async () => {
    if (orderIds.length === 0) return;
    setLoading(true);

    try {
      // OPs de produção. sale_order_id puxa o packaging_mode do PV.
      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('id, reference_id, color, quantity, grade, sale_order_item_id, sale_order_id')
        .in('id', orderIds);

      if (ordersError) throw ordersError;
      if (!ordersData || ordersData.length === 0) { setRows([]); return; }

      const refIds = [...new Set(ordersData.map(o => o.reference_id).filter(Boolean))] as string[];
      const saleOrderItemIds = [...new Set(ordersData.map(o => o.sale_order_item_id).filter(Boolean))] as string[];
      const saleOrderIds = [...new Set(ordersData.map(o => (o as any).sale_order_id).filter(Boolean))] as string[];

      // Motor CANÔNICO (@/lib/orderConsumption — o MESMO do modal por PV e da ficha
      // do operador). Substitui a lógica duplicada que esta tela reimplementava e que
      // NÃO filtrava a caixa por packaging_mode (caixa dupla/fantasma no consumo de OP).
      const [ctx, sheetMap, strapRes, pkgRes] = await Promise.all([
        fetchConsumptionContext(refIds),
        fetchTechnicalSheetsForConsumption(refIds),
        saleOrderItemIds.length > 0
          ? supabase.from('sale_order_items').select('id, strap_colors, material_variant_id').in('id', saleOrderItemIds)
          : Promise.resolve({ data: [] as any[] }),
        saleOrderIds.length > 0
          ? supabase.from('sale_orders').select('id, packaging_mode').in('id', saleOrderIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const strapByItem = new Map<string, any>(((strapRes as any).data || []).map((si: any) => [si.id, si.strap_colors]));
      const variantByItem = new Map<string, string | null>(((strapRes as any).data || []).map((si: any) => [si.id, si.material_variant_id ?? null]));
      const pkgByOrder = new Map<string, string | null>(((pkgRes as any).data || []).map((s: any) => [s.id, s.packaging_mode ?? null]));

      const items: ConsumptionItem[] = ordersData
        .filter((o) => o.reference_id && sheetMap.get(o.reference_id))
        .map((o) => ({
          reference_id: o.reference_id as string,
          color: o.color || '—',
          quantity: Number(o.quantity) || 0,
          grade: (o.grade as Record<string, number> | null) ?? null,
          // `fichas: null` deixa o fallback EXATO (quantity ÷ gradeTotal) dos
          // motores agir — escala-invariante: grade REAL (Σ = quantity ⇒ 1×) e
          // grade BASE legada (Σ = 1 ficha ⇒ quantity/base) saem certas. Com 1
          // fixo, OP legada com grade base subcontava per-size/tiras até ~50×
          // (auditoria 2026-07-19, TS-1 — mesmo fix do bomConsumption).
          fichas: null,
          strap_colors: o.sale_order_item_id ? (strapByItem.get(o.sale_order_item_id) ?? null) : null,
          // Variante de material do item do PV — resolve os materiais da OP
          // (cabedal/forro/palmilha/solado/BOM) pela variante escolhida.
          material_variant_id: o.sale_order_item_id ? (variantByItem.get(o.sale_order_item_id) ?? null) : null,
          technical_sheets: sheetMap.get(o.reference_id),
          packagingMode: (o as any).sale_order_id ? (pkgByOrder.get((o as any).sale_order_id) ?? null) : null,
        }));

      // Linhas SÓ de aviso (ex.: fachete sem specs, qtd 0) são exibidas no modal
      // de Consumo do PV (planejamento); aqui, na visão por OP, ficam de fora pra
      // não imprimir "0,00" sem quantidade real. Linha com consumo real E aviso
      // (fallback_average de tamanho sem spec — F2-02) CONTINUA: a qtd é válida.
      const computed = (computeConsumptionForItems(items, ctx) as ConsumptionRow[])
        .filter(r => !((r as any).warning && !(r.totalQuantity > 0)));

      const sortedRows = [...computed].sort((a, b) => {
        const typeDiff = COMPONENT_ORDER.indexOf(a.componentType as any) - COMPONENT_ORDER.indexOf(b.componentType as any);
        if (typeDiff !== 0) return typeDiff;
        return a.groupName.localeCompare(b.groupName, 'pt-BR') || a.materialName.localeCompare(b.materialName, 'pt-BR') || a.color.localeCompare(b.color, 'pt-BR');
      });

      setRows(sortedRows);
    } catch (err) {
      console.error('[OrderConsumptionDialog] Failed to load consumption:', err);
      setRows([]);
    } finally {
      setLoading(false);
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
    if (sortKey && sortKey !== 'componentType') {
      return new Map([['Todos', sortedRows]]);
    }
    const map = new Map<string, ConsumptionRow[]>();
    for (const row of sortedRows) {
      if (!map.has(row.componentType)) map.set(row.componentType, []);
      map.get(row.componentType)!.push(row);
    }
    return map;
  }, [sortedRows, sortKey]);

  const totalsByUnit = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.productUnit, (map.get(row.productUnit) || 0) + row.totalQuantity);
    }
    return map;
  }, [rows]);

  const formatUnit = (unit: string) => {
    const labels: Record<string, string> = {
      metro: 'm', m: 'm', dm2: 'dm²', par: 'par', un: 'un', kg: 'kg', litro: 'L', placa: 'placas',
    };
    return labels[unit] || unit || 'un';
  };

  const handlePrintPdf = useCallback(() => {
    const printRows = sortedRows;
    const tableRows = printRows.map(row =>
      `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-weight:500">${escapeHtml(row.groupName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.materialName)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">${escapeHtml(row.color)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:monospace;font-weight:700">${row.totalQuantity.toFixed(2)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;text-align:center">${formatUnit(row.productUnit)}</td>
      </tr>`
    ).join('');

    const totalsHtml = Array.from(totalsByUnit.entries()).map(([unit, total]) =>
      `<span style="display:inline-block;background:#f3f4f6;padding:4px 12px;border-radius:6px;margin-right:8px;font-size:13px;font-weight:600">${total.toFixed(2)} ${formatUnit(unit)}</span>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Consumo — ${title}</title>
      <style>@page{size:A4;margin:5mm 6mm}body{font-family:system-ui,-apple-system,sans-serif;color:#111;margin:0;padding:5mm 6mm}
      table{width:100%;border-collapse:collapse;font-size:13px}th{background:#f9fafb;padding:8px 10px;text-align:left;border-bottom:2px solid #d1d5db;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
      h1{font-size:18px;margin:0 0 4px}p.sub{color:#6b7280;font-size:13px;margin:0 0 16px}</style></head>
      <body>
        <h1>Consumo de Materiais — ${title}</h1>
        <p class="sub">${rows.length} ${rows.length === 1 ? 'item' : 'itens'} · ${orderIds.length} ${orderIds.length === 1 ? 'OP' : 'OPs'} · Gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div style="margin-bottom:16px">${totalsHtml}</div>
        <table><thead><tr>
          <th>Grupo de Material</th><th>Aplicação</th><th>Cor</th>
          <th style="text-align:right">Consumo Total</th><th style="text-align:center">Unidade</th>
        </tr></thead><tbody>${tableRows}</tbody></table>
      </body></html>`;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => printWindow.print(), 400);
    }
  }, [sortedRows, totalsByUnit, title, orderIds.length, rows.length]);

  return (
    <AdaptiveDialog open={open} onOpenChange={onOpenChange}>
      <AdaptiveDialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto">
        <AdaptiveDialogHeader>
          <AdaptiveDialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Consumo — {title}
          </AdaptiveDialogTitle>
        </AdaptiveDialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">Nenhum consumo de material encontrado.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {Array.from(totalsByUnit.entries()).map(([unit, total]) => (
                  <Badge key={unit} variant="secondary" className="text-sm px-3 py-1">
                    {total.toFixed(2)} {formatUnit(unit)}
                  </Badge>
                ))}
                <Badge variant="outline" className="text-sm px-3 py-1">
                  {rows.length} {rows.length === 1 ? 'item' : 'itens'}
                </Badge>
                {orderIds.length > 1 && (
                  <Badge variant="outline" className="text-sm px-3 py-1">
                    {orderIds.length} OPs
                  </Badge>
                )}
              </div>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrintPdf}>
                <FileText className="h-4 w-4" /> Gerar PDF
              </Button>
            </div>

            {Array.from(grouped.entries()).map(([componentType, componentRows]) => (
              <div key={componentType} className="space-y-1">
                {componentType !== 'Todos' && (
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{componentType}</h3>
                )}
                 <div className="rounded-lg border overflow-hidden overflow-x-auto">
                   <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead aria-sort={sortKey === 'groupName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('groupName')}>Grupo de material <SortIcon col="groupName" /></button>
                        </TableHead>
                        <TableHead aria-sort={sortKey === 'materialName' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('materialName')}>Aplicação <SortIcon col="materialName" /></button>
                        </TableHead>
                        <TableHead aria-sort={sortKey === 'color' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="flex w-full items-center select-none hover:text-foreground" onClick={() => handleSort('color')}>Cor <SortIcon col="color" /></button>
                        </TableHead>
                        <TableHead className="text-right" aria-sort={sortKey === 'totalQuantity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="flex w-full items-center justify-end select-none hover:text-foreground" onClick={() => handleSort('totalQuantity')}>Consumo Total <SortIcon col="totalQuantity" /></button>
                        </TableHead>
                        <TableHead className="text-center w-24" aria-sort={sortKey === 'productUnit' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                          <button type="button" className="flex w-full items-center justify-center select-none hover:text-foreground" onClick={() => handleSort('productUnit')}>Unidade <SortIcon col="productUnit" /></button>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {componentRows.map((row, index) => (
                        <TableRow key={`${row.componentType}-${row.groupName}-${row.color}-${index}`}>
                          <TableCell className="font-medium">{row.groupName}</TableCell>
                          <TableCell>{row.materialName}</TableCell>
                          <TableCell>{row.color}</TableCell>
                          <TableCell className={`text-right font-mono font-bold ${row.widthMissing ? 'text-amber-600' : ''}`}>
                            {row.totalQuantity.toFixed(2)}
                            {row.widthMissing && (
                              <span
                                className="ml-1 cursor-help"
                                title="Material de área sem largura na ficha de componente — valor em dm² (não convertido). Cadastre a largura em Materiais → Ficha de Componente → Dimensões."
                              >⚠</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-muted-foreground">{formatUnit(row.productUnit)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        )}
      </AdaptiveDialogContent>
    </AdaptiveDialog>
  );
}
