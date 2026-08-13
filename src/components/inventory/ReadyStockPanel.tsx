import { useState, useMemo } from 'react';
import { escapeHtml, safeUrlAttr } from '@/lib/htmlUtils';
import { Plus, Trash as Trash2, CircleNotch as Loader2, MagnifyingGlass, Package, ShoppingBag, PencilSimple as Pencil, MapPin, Note as StickyNote, FileArrowDown as FileDown, Tag, Package as BoxIcon, Printer, ImageSquare as ImagePlus } from '@phosphor-icons/react';
import { buildStockBoxLabelsHtml, buildThermalLabelsHtml } from '@/lib/printLabels';
import { resolveMaterialLabels, materialLabelKey } from '@/lib/labelUtils';
import { DEFAULT_MANUFACTURER_CNPJ } from '@/lib/companySender';
import { printHtml, writeRawPrintWindow, openPrintWindow } from '@/lib/printOrder';
import { openPrintTab, printHtmlAsPdf } from '@/lib/printPdf';
import { createPrintJob, setPrintJobStatus } from '@/lib/printJobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NumberInput } from '@/components/ui/number-input';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useProducts } from '@/hooks/useProducts';
import {
  useReadyStock, useUpsertReadyStock, useBatchUpsertReadyStock,
  useUpdateReadyStock, useDeleteReadyStock,
} from '@/hooks/useReadyStock';
import { cn } from '@/lib/utils';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { toast } from 'sonner';

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function parseSizes(sizesStr: string | null): string[] {
  if (!sizesStr) return [];
  const match = sizesStr.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (match) {
    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const sizes: string[] = [];
    for (let i = start; i <= end; i++) sizes.push(String(i));
    return sizes;
  }
  return sizesStr.split(',').map(s => s.trim()).filter(Boolean);
}

function parseColors(colorsStr: string | null): string[] {
  if (!colorsStr) return [];
  return colorsStr.split(',').map(s => s.trim()).filter(Boolean);
}

export default function ReadyStockPanel() {
  const { data: stock = [], isLoading } = useReadyStock();
  const { data: references = [] } = useTechnicalSheets();
  const { data: products = [] } = useProducts();
  const upsert = useUpsertReadyStock();
  const batchUpsert = useBatchUpsertReadyStock();
  const updateStock = useUpdateReadyStock();
  const deleteStock = useDeleteReadyStock();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  // Form state
  const [selRef, setSelRef] = useState('');
  const [selColor, setSelColor] = useState('');
  const [gradeQty, setGradeQty] = useState<Record<string, number>>({});
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  const activeRefs = useMemo(() => references.filter(r => r.status === 'Ativo'), [references]);

  const selectedRef = useMemo(() => activeRefs.find(r => r.id === selRef), [activeRefs, selRef]);
  const availableSizes = useMemo(() => parseSizes(selectedRef?.sizes || null), [selectedRef]);
  const availableColors = useMemo(() => {
    const fromText = parseColors(selectedRef?.colors || null);
    if (fromText.length > 0) return fromText;
    const ref = selectedRef as any;
    if (ref?.cor_predominante_id) {
      const groupProducts = products.filter(p => p.active && p.group_id === ref.cor_predominante_id);
      const colors = new Set<string>();
      groupProducts.forEach(p => {
        if (p.color?.trim()) {
          p.color.split(',').forEach(c => {
            const t = c.trim();
            if (t) colors.add(t);
          });
        }
      });
      return Array.from(colors).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    }
    return [];
  }, [selectedRef, products]);

  const filtered = useMemo(() => {
    return stock.filter(s => {
      const ref = s.technical_sheets;
      return searchMatchesAllTerms(search, ref?.name, ref?.code, s.color, s.size, ref?.shoe_category, ref?.brand);
    });
  }, [stock, search]);

  // Group by reference + color
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    filtered.forEach(item => {
      const key = `${item.reference_id}|${item.color}`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      referenceId: items[0].reference_id,
      refName: items[0].technical_sheets?.name || '—',
      refCode: items[0].technical_sheets?.code || '',
      category: items[0].technical_sheets?.shoe_category || '',
      color: items[0].color,
      items: items.sort((a, b) => parseInt(a.size) - parseInt(b.size)),
      totalQty: items.reduce((s, i) => s + i.quantity, 0),
      price: items[0].technical_sheets?.sale_price || 0,
      costPrice: items[0].technical_sheets?.cost_price || 0,
      imageUrl: (() => {
        const ts = items[0].technical_sheets;
        if (!ts) return '';
        if (Array.isArray(ts.color_images)) {
          const ci = ts.color_images.find((c: any) => c.color === items[0].color);
          if (ci?.url) return ci.url;
        }
        return ts.image_url || '';
      })(),
      sizes: items[0].technical_sheets?.sizes || '',
      brand: items[0].technical_sheets?.brand || '',
    }));
  }, [filtered]);

  // Collect all sizes across all groups for consistent columns
  const allSizes = useMemo(() => {
    const sizeSet = new Set<string>();
    grouped.forEach(g => g.items.forEach(i => sizeSet.add(i.size)));
    return Array.from(sizeSet).sort((a, b) => parseInt(a) - parseInt(b));
  }, [grouped]);

  const totalPairs = filtered.reduce((s, i) => s + i.quantity, 0);
  const totalValue = grouped.reduce((s, g) => s + g.totalQty * g.price, 0);
  const totalCost = grouped.reduce((s, g) => s + g.totalQty * g.costPrice, 0);

  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  const fmtNum = (v: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

  const toLabelData = (g: typeof grouped[number], material = '') => ({
    refName: g.refName,
    refCode: g.refCode,
    color: g.color,
    category: g.category,
    sizes: g.items.map(i => ({ size: i.size, qty: i.quantity })),
    totalQty: g.totalQty,
    costPrice: g.costPrice,
    salePrice: g.price,
    imageUrl: g.imageUrl,
    material,
  });

  // MATERIAL das etiquetas da Pronta Entrega — estoque não tem PV/variação,
  // então a cascata resolve por ficha+cor (cabedal > tiras/forração pick-one).
  const resolveGroupMaterials = async () => {
    const map = await resolveMaterialLabels(
      grouped.map(g => ({ referenceId: g.referenceId, color: g.color })),
    ).catch(() => new Map<string, string>());
    return (g: typeof grouped[number]) =>
      map.get(materialLabelKey({ referenceId: g.referenceId, color: g.color })) || '';
  };

  const resetForm = () => {
    setSelRef('');
    setSelColor('');
    setGradeQty({});
    setLocation('');
    setNotes('');
    setEditItem(null);
  };

  const openAdd = () => { resetForm(); setDialogOpen(true); };

  const handleExportPdf = () => {
    const sizeCols = allSizes;
    const sizeHeaders = sizeCols.map(s => `<th style="text-align:center;padding:4px 3px;border:1px solid #999;font-size:9px;background:#e8e8d0;min-width:28px;">${s}</th>`).join('');

    let rowsHtml = '';
    let grandTotalPairs = 0;
    let grandTotalValue = 0;
    let grandTotalCost = 0;
    const grandGrade: Record<string, number> = {};
    sizeCols.forEach(s => { grandGrade[s] = 0; });

    grouped.forEach((g, idx) => {
      const imgTag = g.imageUrl
        ? `<img src="${safeUrlAttr(g.imageUrl)}" style="width:50px;height:50px;object-fit:cover;border-radius:4px;" />`
        : '';

      const gradeCells = sizeCols.map(s => {
        const item = g.items.find(i => i.size === s);
        const qty = item?.quantity || 0;
        grandGrade[s] += qty;
        return `<td style="text-align:center;padding:4px 3px;border:1px solid #999;font-family:monospace;font-size:10px;font-weight:600;">${qty || ''}</td>`;
      }).join('');

      const totalVal = g.totalQty * g.price;
      const totalCostVal = g.totalQty * g.costPrice;
      grandTotalPairs += g.totalQty;
      grandTotalValue += totalVal;
      grandTotalCost += totalCostVal;

      rowsHtml += `
        <tr style="border-top:2px solid #666;">
          <td style="text-align:center;padding:4px 6px;border:1px solid #999;font-size:10px;font-weight:600;">${idx + 1}</td>
          <td style="padding:4px 6px;border:1px solid #999;text-align:center;">${imgTag}</td>
          <td style="padding:4px 6px;border:1px solid #999;font-size:9px;font-weight:600;">${escapeHtml(g.refCode)}</td>
          <td style="padding:4px 6px;border:1px solid #999;font-size:9px;">${escapeHtml(g.refName)}</td>
          <td style="padding:4px 6px;border:1px solid #999;font-size:9px;">${escapeHtml(g.category) || '—'}</td>
          <td style="padding:4px 6px;border:1px solid #999;font-size:9px;text-align:center;">${escapeHtml(g.color)}</td>
          ${gradeCells}
          <td style="text-align:center;padding:4px 6px;border:1px solid #999;font-family:monospace;font-size:10px;font-weight:700;background:#f5f5f0;">${g.totalQty}</td>
          <td style="text-align:right;padding:4px 6px;border:1px solid #999;font-family:monospace;font-size:10px;">${fmtNum(g.costPrice)}</td>
          <td style="text-align:right;padding:4px 6px;border:1px solid #999;font-family:monospace;font-size:10px;">${fmtNum(g.price)}</td>
          <td style="text-align:right;padding:4px 6px;border:1px solid #999;font-family:monospace;font-size:10px;font-weight:700;background:#f5f5f0;">${fmtNum(totalVal)}</td>
        </tr>`;
    });

    // Grand total row
    const grandGradeCells = sizeCols.map(s =>
      `<td style="text-align:center;padding:4px 3px;border:1px solid #999;font-family:monospace;font-size:10px;font-weight:700;background:#e8e8d0;">${grandGrade[s] || ''}</td>`
    ).join('');

    const html = `
      <h1 style="font-size:16px;margin-bottom:2px;">📦 Estoque Pronta Entrega</h1>
      <p style="font-size:10px;color:#666;margin-bottom:12px;">Gerado em ${new Date().toLocaleString('pt-BR')}</p>

      <div style="display:flex;gap:20px;margin-bottom:14px;">
        <div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;">
          <p style="font-size:18px;font-weight:700;">${grouped.length}</p>
          <p style="font-size:9px;color:#666;">Modelos/Cores</p>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;">
          <p style="font-size:18px;font-weight:700;">${grandTotalPairs}</p>
          <p style="font-size:9px;color:#666;">Total Pares</p>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;">
          <p style="font-size:18px;font-weight:700;">${fmt(grandTotalCost)}</p>
          <p style="font-size:9px;color:#666;">Custo Total</p>
        </div>
        <div style="text-align:center;padding:8px 16px;background:#f5f5f0;border:1px solid #ddd;border-radius:6px;">
          <p style="font-size:18px;font-weight:700;">${fmt(grandTotalValue)}</p>
          <p style="font-size:9px;color:#666;">Valor Venda Total</p>
        </div>
      </div>

      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr>
            <th style="text-align:center;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;width:30px;">Seq.</th>
            <th style="text-align:center;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;width:55px;">Foto</th>
            <th style="text-align:left;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;">Refer.</th>
            <th style="text-align:left;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;">Descrição</th>
            <th style="text-align:left;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;">Categoria</th>
            <th style="text-align:center;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;">Cor</th>
            ${sizeHeaders}
            <th style="text-align:center;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e0e0c8;font-weight:700;">Quant.</th>
            <th style="text-align:right;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;">Preço Custo</th>
            <th style="text-align:right;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e8e8d0;">Preço Venda</th>
            <th style="text-align:right;padding:4px 6px;border:1px solid #999;font-size:9px;background:#e0e0c8;font-weight:700;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
          <tr style="border-top:3px solid #333;">
            <td colspan="6" style="padding:4px 6px;border:1px solid #999;font-size:10px;font-weight:700;background:#e8e8d0;text-align:right;">TOTAL GERAL</td>
            ${grandGradeCells}
            <td style="text-align:center;padding:4px 6px;border:1px solid #999;font-family:monospace;font-size:10px;font-weight:700;background:#e0e0c8;">${grandTotalPairs}</td>
            <td style="border:1px solid #999;background:#e8e8d0;"></td>
            <td style="border:1px solid #999;background:#e8e8d0;"></td>
            <td style="text-align:right;padding:4px 6px;border:1px solid #999;font-family:monospace;font-size:10px;font-weight:700;background:#e0e0c8;">${fmtNum(grandTotalValue)}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top:14px;display:flex;gap:24px;font-size:10px;">
        <div><strong>Total de Pares:</strong> ${grandTotalPairs}</div>
        <div><strong>Valor Total Custo:</strong> ${fmt(grandTotalCost)}</div>
        <div><strong>Valor Total Venda:</strong> ${fmt(grandTotalValue)}</div>
      </div>
    `;

    printHtml('Estoque Pronta Entrega', html);
  };

  const handleExportPhotoPdf = () => {
    const dateStr = new Date().toLocaleDateString('pt-BR');

    // Sort: by refCode → color
    const sortedGrouped = [...grouped].sort((a, b) => {
      const c = a.refCode.localeCompare(b.refCode);
      return c !== 0 ? c : a.color.localeCompare(b.color, 'pt-BR');
    });

    // Assign sequential color index per product
    const colorCounter: Record<string, number> = {};
    const pdfItems = sortedGrouped.map(g => {
      const idx = (colorCounter[g.refCode] || 0) + 1;
      colorCounter[g.refCode] = idx;

      const gradeMap: Record<string, number> = {};
      g.items.forEach(i => { gradeMap[i.size] = i.quantity; });

      const nonZero = Object.values(gradeMap).filter(v => v > 0);
      const cxs = nonZero.length > 0 ? nonZero.reduce(gcd, nonZero[0]) : 1;

      const perBoxGrade: Record<string, number> = {};
      Object.entries(gradeMap).forEach(([s, q]) => { perBoxGrade[s] = Math.round(q / cxs); });
      const perBoxTotal = Object.values(perBoxGrade).reduce((s, v) => s + v, 0);

      const itemSizes = g.items.map(i => i.size).sort((a, b) => parseInt(a) - parseInt(b));
      return { ...g, colorIndex: idx, cxs, perBoxGrade, perBoxTotal, gradeMap, itemSizes };
    });

    const fmtPrice = (v: number) =>
      new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

    const cardsHtml = pdfItems.map(g => {
      const idxStr = String(g.colorIndex).padStart(2, '0');
      const brandTxt = g.brand ? `MARCA: ${g.brand}` : '';

      const photoHtml = g.imageUrl
        ? `<img src="${safeUrlAttr(g.imageUrl)}" crossorigin="anonymous" style="max-width:100%;max-height:220px;object-fit:contain;display:block;margin:0 auto;" />`
        : `<div style="width:100%;height:120px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#aaa;border:1px dashed #ccc;border-radius:4px;">Sem foto</div>`;

      const sizeTdStyle = 'border:1px solid #444;padding:2px 5px;text-align:center;font-size:9px;min-width:22px;';
      const hdrTdStyle = `${sizeTdStyle}font-weight:700;`;
      const totalColStyle = 'border:1px solid #444;padding:2px 6px;text-align:center;font-weight:700;font-size:9px;min-width:32px;';

      const sizeHeaders = g.itemSizes.map(s => `<td style="${hdrTdStyle}">${s}</td>`).join('');
      const qtyRow = g.itemSizes.map(s => {
        const q = g.perBoxGrade[s] || 0;
        return `<td style="${sizeTdStyle}">${q > 0 ? String(q).padStart(2, '0') : ''}</td>`;
      }).join('');

      return `
<div style="border:1.5px solid #000;margin-bottom:8px;page-break-inside:avoid;background:#fff;">
  <div style="padding:4px 6px;border-bottom:1px solid #000;">
    <div style="font-size:10px;font-weight:700;font-family:monospace;letter-spacing:0.2px;">PRODUTO:${g.refCode} &ndash; ${g.refName}</div>
    <div style="font-size:9px;font-family:monospace;">PADRONIZA&Ccedil;&Atilde;O &nbsp;${idxStr} &ndash; ${g.color}</div>
  </div>
  <div style="padding:8px 12px;min-height:80px;display:flex;align-items:center;justify-content:center;">${photoHtml}</div>
  <table style="width:100%;border-collapse:collapse;border-top:1px solid #000;">
    <tr>
      ${sizeHeaders}
      <td rowspan="2" style="border:1px solid #444;padding:2px 6px;text-align:center;font-weight:700;font-size:8px;vertical-align:middle;">${brandTxt}</td>
      <td style="${hdrTdStyle}">TOT</td>
      <td style="${hdrTdStyle}">CXS DISP</td>
      <td style="${hdrTdStyle}">PRE&Ccedil;O</td>
    </tr>
    <tr>
      ${qtyRow}
      <td style="${totalColStyle}">${g.perBoxTotal}</td>
      <td style="${totalColStyle}">${g.cxs}</td>
      <td style="${totalColStyle}">${fmtPrice(g.price)}</td>
    </tr>
  </table>
</div>`;
    }).join('');

    const htmlDoc = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Pronta Entrega &ndash; Foto</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  html,body{font-family:Arial,Helvetica,sans-serif;font-size:10px;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  .page-hdr{display:flex;justify-content:space-between;align-items:center;padding:3px 6px;border-bottom:2px solid #000;font-size:10px;font-weight:700;font-family:monospace;letter-spacing:0.3px;margin-bottom:8px;}
  @media screen{body{max-width:210mm;margin:0 auto;padding:8mm;background:#f3f3f3;} .page-hdr{background:#fff;border:1px solid #000;margin-bottom:10px;}}
  @media print{
    @page{size:A4 portrait;margin:8mm;}
    .page-hdr{position:fixed;top:0;left:0;right:0;border-bottom:2px solid #000;background:#fff;padding:2px 6px;height:18px;}
    body{padding-top:22px;}
  }
</style>
</head><body>
<div class="page-hdr"><span>PRONTO ENTREGA - FOTO</span><span>${dateStr}</span></div>
${cardsHtml}
</body></html>`;

    writeRawPrintWindow(openPrintWindow('Pronta Entrega'), htmlDoc);
  };

  const handleSubmit = async () => {
    if (!selRef || !selColor) return;
    const items = Object.entries(gradeQty)
      .filter(([_, qty]) => qty > 0)
      .map(([size, quantity]) => ({
        reference_id: selRef,
        color: selColor,
        size,
        quantity,
        location,
        notes,
      }));
    if (items.length === 0) return;
    try {
      await batchUpsert.mutateAsync(items);
      // Só fecha/reseta no sucesso — falha mantém a grade digitada na tela
      setDialogOpen(false);
      resetForm();
    } catch {
      // erro já toasteado pelo hook (onError)
    }
  };

  // M18: confirmação estruturada (AlertDialog) no lugar do confirm() nativo
  const [confirmRemove, setConfirmRemove] = useState<{ type: 'item'; id: string } | { type: 'group'; items: { id: string }[] } | null>(null);

  const handleDelete = (id: string) => {
    setConfirmRemove({ type: 'item', id });
  };

  const executeConfirmedRemove = async () => {
    if (!confirmRemove) return;
    if (confirmRemove.type === 'item') {
      deleteStock.mutate(confirmRemove.id);
    } else {
      await Promise.allSettled(confirmRemove.items.map(i => deleteStock.mutateAsync(i.id)));
    }
    setConfirmRemove(null);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <StatGrid>
        <StatCard
          label="Pares Disponíveis"
          value={totalPairs.toLocaleString('pt-BR')}
          hint="em estoque"
          icon={ShoppingBag}
          tone="primary"
        />
        <StatCard
          label="Modelos/Cores"
          value={grouped.length}
          hint="variantes ativas"
          icon={Package}
          tone="success"
        />
        <StatCard
          label="Custo Total"
          value={fmt(totalCost)}
          hint="estoque a custo"
          icon={Package}
          tone="warning"
        />
        <StatCard
          label="Valor Venda Total"
          value={fmt(totalValue)}
          hint="estoque a preço de venda"
          icon={Package}
        />
      </StatGrid>

      {/* Search + Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="flex-1 max-w-sm"
          placeholder="Buscar por modelo, código, cor ou categoria…"
          value={search}
          onChange={setSearch}
          resultCount={filtered.length}
          totalCount={stock.length}
        />
        <Button onClick={openAdd} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Lançar Estoque</span>
        </Button>
        {grouped.length > 0 && (
          <>
            <Button onClick={handleExportPhotoPdf} className="gap-2">
              <ImagePlus className="h-4 w-4" />
              <span className="hidden sm:inline">Catálogo Foto</span>
            </Button>
            <Button variant="outline" onClick={handleExportPdf} className="gap-2">
              <Printer className="h-4 w-4" />
              <span className="hidden sm:inline">PDF Lista</span>
            </Button>
            <Button variant="outline" onClick={async () => {
              if (grouped.length > 5000) {
                toast.error(`A seleção geraria ${grouped.length.toLocaleString('pt-BR')} rótulos. Reduza o lote para no máximo 5.000.`);
                return;
              }
              const target = openPrintTab();
              try {
                const materialFor = await resolveGroupMaterials();
                const html = buildStockBoxLabelsHtml(
                  grouped.map(g => toLabelData(g, materialFor(g))),
                  DEFAULT_MANUFACTURER_CNPJ,
                );
                const jobId = await createPrintJob({
                  batchName: `Rótulos pronta-entrega - ${new Date().toLocaleString('pt-BR')}`,
                  totalLabels: grouped.length,
                });
                const submitted = await printHtmlAsPdf(html, {
                  filename: `rotulos-pronta-entrega-${new Date().toISOString().slice(0, 10)}`,
                  target,
                  jobId,
                });
                if (!submitted) await setPrintJobStatus(jobId, 'failed');
              } catch (error) {
                target?.close();
                toast.error(error instanceof Error ? error.message : 'Falha ao gerar os rótulos.');
              }
            }} className="gap-2">
              <BoxIcon className="h-4 w-4" />
              <span className="hidden sm:inline">Rótulo Caixa</span>
            </Button>
            <Button variant="outline" onClick={async () => {
              // Etiqueta individual sai na impressora TÉRMICA (100×30mm, 1 por
              // página) — A4 fica pros rótulos de caixa e listas.
              const requested = grouped.reduce((sum, group) =>
                sum + group.items.reduce((itemSum, item) => itemSum + Math.max(0, Number(item.quantity) || 0), 0), 0);
              if (requested > 5000) {
                toast.error(`A seleção geraria ${requested.toLocaleString('pt-BR')} etiquetas. Reduza o lote para no máximo 5.000.`);
                return;
              }
              const target = openPrintTab();
              try {
                const materialFor = await resolveGroupMaterials();
                const thermal = grouped.flatMap(g =>
                  g.items.filter(i => i.quantity > 0).flatMap(i =>
                    Array.from({ length: i.quantity }, () => ({
                      refCode: g.refCode,
                      refName: g.refName,
                      mainMaterial: materialFor(g),
                      color: g.color,
                      size: i.size,
                      barcode: g.refCode || g.refName,
                      imageUrl: g.imageUrl,
                      shoeCategory: g.category,
                    }))
                  )
                );
                const html = buildThermalLabelsHtml(thermal, '', { width: 100, height: 30 }, undefined, DEFAULT_MANUFACTURER_CNPJ);
                const jobId = await createPrintJob({
                  batchName: `Térmicas pronta-entrega - ${new Date().toLocaleString('pt-BR')}`,
                  totalLabels: thermal.length,
                });
                const submitted = await printHtmlAsPdf(html, {
                  filename: `etiquetas-pronta-entrega-${new Date().toISOString().slice(0, 10)}`,
                  target,
                  jobId,
                });
                if (!submitted) await setPrintJobStatus(jobId, 'failed');
              } catch (error) {
                target?.close();
                toast.error(error instanceof Error ? error.message : 'Falha ao gerar as etiquetas.');
              }
            }} className="gap-2">
              <Tag className="h-4 w-4" />
              <span className="hidden sm:inline">Etiquetas</span>
            </Button>
          </>
        )}
      </div>

      {/* Industrial table */}
      {grouped.length === 0 ? (
        <Card>
          {search.trim() ? (
            <EmptyState
              size="sm"
              icon={MagnifyingGlass}
              title={`Nenhum resultado para "${search}"`}
              action={
                <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <CardContent className="py-12 text-center text-muted-foreground">
              <ShoppingBag className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhum produto em pronta entrega</p>
              <p className="text-xs mt-1">Clique em "Lançar Estoque" para adicionar</p>
            </CardContent>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/60 hover:bg-muted/60">
                  <TableHead className="text-center text-xs font-bold w-10">Seq.</TableHead>
                  <TableHead className="text-center text-xs font-bold w-14">Foto</TableHead>
                  <TableHead className="text-xs font-bold">Refer.</TableHead>
                  <TableHead className="text-xs font-bold">Descrição</TableHead>
                  <TableHead className="text-xs font-bold">Categoria</TableHead>
                  <TableHead className="text-center text-xs font-bold">Cor</TableHead>
                  {allSizes.map(s => (
                    <TableHead key={s} className="text-center text-xs font-bold w-10 px-1">{s}</TableHead>
                  ))}
                  <TableHead className="text-center text-xs font-bold bg-muted w-12">Quant.</TableHead>
                  <TableHead className="text-right text-xs font-bold">Custo</TableHead>
                  <TableHead className="text-right text-xs font-bold">Venda</TableHead>
                  <TableHead className="text-right text-xs font-bold bg-muted w-20">Total</TableHead>
                  <TableHead className="text-center text-xs w-10">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grouped.map((g, idx) => (
                  <TableRow key={g.key} className="border-t-2 border-border/60">
                    <TableCell className="text-center text-xs font-semibold">{idx + 1}</TableCell>
                    <TableCell className="text-center p-1">
                      {g.imageUrl ? (
                        <img src={g.imageUrl} alt={g.refName} className="w-10 h-10 object-cover rounded mx-auto" />
                      ) : (
                        <div className="w-10 h-10 bg-muted rounded flex items-center justify-center mx-auto">
                          <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono font-semibold">{g.refCode}</TableCell>
                    <TableCell className="text-xs">{g.refName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{g.category || '—'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="text-xs">{g.color}</Badge>
                    </TableCell>
                    {allSizes.map(s => {
                      const item = g.items.find(i => i.size === s);
                      const qty = item?.quantity || 0;
                      return (
                        <TableCell key={s} className={cn(
                          "text-center text-xs font-mono font-semibold px-1",
                          qty > 0 ? "text-foreground" : "text-muted-foreground/30"
                        )}>
                          {qty || ''}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center text-xs font-mono font-bold bg-muted/50">{g.totalQty}</TableCell>
                    <TableCell className="text-right text-xs font-mono">{fmtNum(g.costPrice)}</TableCell>
                    <TableCell className="text-right text-xs font-mono">{fmtNum(g.price)}</TableCell>
                    <TableCell className="text-right text-xs font-mono font-bold bg-muted/50">{fmtNum(g.totalQty * g.price)}</TableCell>
                    <TableCell className="text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => group_items_delete(g)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remover linha</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Grand total row */}
                <TableRow className="border-t-[3px] border-foreground/30 bg-muted/60 hover:bg-muted/60 font-bold">
                  <TableCell colSpan={6} className="text-right text-xs font-bold pr-4">TOTAL GERAL</TableCell>
                  {allSizes.map(s => {
                    const total = grouped.reduce((sum, g) => {
                      const item = g.items.find(i => i.size === s);
                      return sum + (item?.quantity || 0);
                    }, 0);
                    return (
                      <TableCell key={s} className="text-center text-xs font-mono font-bold px-1 bg-muted">{total || ''}</TableCell>
                    );
                  })}
                  <TableCell className="text-center text-xs font-mono font-bold bg-muted">{totalPairs}</TableCell>
                  <TableCell className="text-right text-xs font-mono bg-muted"></TableCell>
                  <TableCell className="text-right text-xs font-mono bg-muted"></TableCell>
                  <TableCell className="text-right text-xs font-mono font-bold bg-muted">{fmtNum(totalValue)}</TableCell>
                  <TableCell className="bg-muted"></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {/* Summary footer */}
          <div className="flex flex-wrap gap-6 px-4 py-3 border-t text-xs">
            <div><span className="text-muted-foreground">Total de Pares:</span> <strong>{totalPairs}</strong></div>
            <div><span className="text-muted-foreground">Valor Total Custo:</span> <strong>{fmt(totalCost)}</strong></div>
            <div><span className="text-muted-foreground">Valor Total Venda:</span> <strong>{fmt(totalValue)}</strong></div>
          </div>
        </Card>
      )}

      {/* Add dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary" />
              Lançar Pronta Entrega
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Reference */}
            <div>
              <Label className="text-xs">Referência / Modelo</Label>
              <Select value={selRef} onValueChange={v => { setSelRef(v); setSelColor(''); setGradeQty({}); }}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {activeRefs.map(r => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.code ? `${r.code} — ` : ''}{r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Color */}
            {selectedRef && (
              <div>
                <Label className="text-xs">Cor</Label>
                {availableColors.length > 0 ? (
                  <Select value={selColor} onValueChange={setSelColor}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione a cor..." /></SelectTrigger>
                    <SelectContent>
                      {availableColors.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={selColor}
                    onChange={e => setSelColor(e.target.value)}
                    placeholder="Digite a cor..."
                    className="mt-1"
                  />
                )}
              </div>
            )}

            {/* Image Preview */}
            {selectedRef && selColor && (
              <div className="flex justify-center py-2">
                {(() => {
                  const ts = selectedRef as any;
                  const colorImages = ts.color_images;
                  let url = ts.image_url;
                  if (Array.isArray(colorImages)) {
                    const ci = colorImages.find((c: any) => c.color === selColor);
                    if (ci?.url) url = ci.url;
                  }
                  if (!url) return (
                    <div className="h-32 w-32 rounded-lg bg-muted flex items-center justify-center border-2 border-dashed border-border shadow-sm">
                      <ImagePlus className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  );
                  return (
                    <div className="relative group">
                      <img src={url} alt={selColor} className="h-32 w-32 rounded-lg object-cover border-2 border-border shadow-md" />
                      <div className="absolute inset-0 rounded-lg bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge className="bg-primary/90 text-white border-none text-xs">{selColor}</Badge>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Grade */}
            {selectedRef && selColor && (
              <div>
                <Label className="text-xs mb-2 block">Grade de Numeração</Label>
                <div className="grid grid-cols-5 gap-2">
                  {availableSizes.map(size => (
                    <div key={size} className="text-center">
                      <p className="text-xs font-semibold text-muted-foreground mb-1">Nº {size}</p>
                      <NumberInput
                        min={0}
                        decimals={0}
                        value={gradeQty[size]}
                        onChange={n => setGradeQty(prev => ({ ...prev, [size]: n }))}
                        className="text-center h-9 text-sm font-mono"
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Total: <strong>{Object.values(gradeQty).reduce((s, v) => s + v, 0)}</strong> pares
                </p>
              </div>
            )}

            {/* Location / Notes */}
            {selectedRef && selColor && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Localização</Label>
                  <Input value={location} onChange={e => setLocation(e.target.value)} placeholder="Ex: Prateleira A3" className="mt-1" />
                </div>
                <div>
                  <Label className="text-xs">Observação</Label>
                  <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional" className="mt-1" />
                </div>
              </div>
            )}

            <Button
              onClick={handleSubmit}
              disabled={batchUpsert.isPending || !selRef || !selColor || Object.values(gradeQty).every(v => !v)}
              className="w-full"
            >
              {batchUpsert.isPending ? 'Lançando...' : 'Lançar no Estoque'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

  async function group_items_delete(g: typeof grouped[number]) {
    if (!confirm('Remover todos os itens desta referência/cor do estoque?')) return;
    await Promise.allSettled(g.items.map(i => deleteStock.mutateAsync(i.id)));
  }
}
