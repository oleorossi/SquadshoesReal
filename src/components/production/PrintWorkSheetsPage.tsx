import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Layers } from 'lucide-react';
import OperatorWorkSheet from '@/components/production/OperatorWorkSheet';
import { PalmilhaWorkSheet, type PalmilhaGroup } from '@/components/production/PalmilhaWorkSheet';
import { SilkMontageWorkSheet, type SoleSilkGroup, type SilkColorGroup } from '@/components/production/SilkMontageWorkSheet';
import { SolagemWorkSheet, type SoleColorBand } from '@/components/production/SolagemWorkSheet';

const printStyles = `
  @page { size: A4 portrait; margin: 0; }
  @media print {
    body * { visibility: hidden; }
    .print-area, .print-area * { visibility: visible; }
    .print-area { position: absolute; left: 0; top: 0; width: 100%; }
    .no-print { display: none !important; }
    .page-break { page-break-after: always; break-after: page; }
    .store-divider { page-break-before: always; break-before: page; }
  }
`;

interface PrintWorkSheetsPageProps {
  orders: any[];
  onBack: () => void;
}

const SECTORS = ['Corte Palmilha', 'Corte Forração', 'Mesa', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'] as const;

// ── Group orders by reference_id + color ────────────────────────────────────
function groupOrdersByRefColor(orders: any[]): Array<{
  representative: any;
  combinedGrid: Record<string, number>;
  totalPairs: number;
  latestDueDate: string;
  opNumbers: string[];
}> {
  const map = new Map<string, ReturnType<typeof groupOrdersByRefColor>[number]>();

  for (const order of orders) {
    const key = `${order.reference_id ?? ''}::${(order.color ?? '').toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        representative: order,
        combinedGrid: {},
        totalPairs: 0,
        latestDueDate: order.due_date ?? '',
        opNumbers: [],
      });
    }
    const g = map.get(key)!;
    g.opNumbers.push(order.op_number);
    g.totalPairs += order.total_pairs ?? 0;
    if (order.due_date && order.due_date > g.latestDueDate) g.latestDueDate = order.due_date;
    const grid: Record<string, number> = order.grid ?? {};
    for (const [size, qty] of Object.entries(grid)) {
      const n = Number(qty) || 0;
      if (n > 0) g.combinedGrid[size] = (g.combinedGrid[size] ?? 0) + n;
    }
  }

  return Array.from(map.values());
}

// ── Group orders by store/client (Acabamento & Expedição) ───────────────────
function groupOrdersByStore(orders: any[], saleOrders: any[]): Array<{
  storeId: string;
  clientName: string;
  orderNumber: string;
  orders: any[];
}> {
  const map = new Map<string, { clientName: string; orderNumber: string; orders: any[] }>();

  for (const order of orders) {
    const soId = order.sale_order_id ?? '__avulso__';
    if (!map.has(soId)) {
      const so = saleOrders.find((s: any) => s.id === soId);
      map.set(soId, {
        clientName: so?.client_name ?? (soId === '__avulso__' ? 'Sem pedido' : 'Cliente'),
        orderNumber: so?.order_number ?? '',
        orders: [],
      });
    }
    map.get(soId)!.orders.push(order);
  }

  return Array.from(map.entries())
    .map(([storeId, v]) => ({ storeId, ...v }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR'));
}

const PrintWorkSheetsPage = ({ orders, onBack }: PrintWorkSheetsPageProps) => {
  const [selectedSector, setSelectedSector] = useState<typeof SECTORS[number]>('Corte Palmilha');

  const referenceIds = useMemo(() => [...new Set(orders.map(o => o.reference_id).filter(Boolean))], [orders]);

  const { data: silkRegistrations = [] } = useQuery({
    queryKey: ['sole_silk_registrations'],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from('sole_silk_registrations').select('*');
      if (error) throw error;
      return data;
    },
  });

  const { data: saleOrders = [] } = useQuery({
    queryKey: ['sale_orders_for_worksheets_v2'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sale_orders')
        .select('id, client_id, economic_group_id, client_name, order_number');
      if (error) throw error;
      return data;
    },
  });

  const { data: soleMappings = [] } = useQuery({
    queryKey: ['sole_ref_mappings', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name, color)')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data;
    },
  });

  const { data: palmilhaMappings = [] } = useQuery({
    queryKey: ['palmilha_ref_mappings', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_palmilha_colors')
        .select('sheet_id, cabedal_color, palmilha_color')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: sheetLiningFlags = [] } = useQuery({
    queryKey: ['sheet_insole_lining', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technical_sheets')
        .select('id, insole_has_lining, insole_ready_made, has_straps, mesa_daily_capacity, cutting_capacity_per_day, sewing_capacity_per_day, assembly_capacity_per_day, finishing_capacity_per_day, silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day')
        .in('id', referenceIds);
      if (error) throw error;
      return data || [];
    },
  });

  // ── Lookup maps ──────────────────────────────────────────────────────────────
  const soleColorLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const mapping of soleMappings) {
      const key = `${mapping.sheet_id}::${(mapping.product_color || '').toLowerCase()}`;
      m.set(key, (mapping as any).products?.color || null);
    }
    return m;
  }, [soleMappings]);

  const palmilhaLookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const mapping of palmilhaMappings) {
      const key = `${mapping.sheet_id}::${(mapping.cabedal_color || '').toLowerCase()}`;
      m.set(key, mapping.palmilha_color);
    }
    return m;
  }, [palmilhaMappings]);

  const liningFlagLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, (s as any).insole_has_lining !== false);
    }
    return m;
  }, [sheetLiningFlags]);

  const readyMadeLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, (s as any).insole_ready_made === true);
    }
    return m;
  }, [sheetLiningFlags]);

  const hasStrapsLookup = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, (s as any).has_straps === true);
    }
    return m;
  }, [sheetLiningFlags]);

  const mesaCapacityLookup = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sheetLiningFlags) {
      m.set((s as any).id, Number((s as any).mesa_daily_capacity) || 0);
    }
    return m;
  }, [sheetLiningFlags]);

  // Returns the capacity (pares/dia) for the given sector and sheet
  const getSheetSectorCapacity = (sheetId: string, sector: string): number => {
    const s = sheetLiningFlags.find((x: any) => x.id === sheetId) as any;
    if (!s) return 0;
    const map: Record<string, string> = {
      'Corte Forração': 'cutting_capacity_per_day',
      'Corte Palmilha': 'sewing_capacity_per_day',
      'Montagem':       'assembly_capacity_per_day',
      'Acabamento':     'finishing_capacity_per_day',
      'Mesa':           'mesa_daily_capacity',
      'Silk':           'silk_capacity_per_day',
      'Colagem':        'gluing_capacity_per_day',
      'Solagem':        'soling_capacity_per_day',
    };
    const col = map[sector];
    return col ? (Number(s[col]) || 0) : 0;
  };

  const getBaseName = (name: string) =>
    name.replace(/\s*-\s*(Preto|Caramelo|Branco|Nude|Vermelho|Azul|Rosa|Verde|Cinza|Ouro|Prata)$/i, '').trim();

  const resolveInsoleColor = (sheetId: string, cabedelColorLower: string, cabedelColorName: string, isReadyMade: boolean) => {
    if (isReadyMade) {
      return cabedelColorName?.toLowerCase().includes('preto') ? 'Preto' : 'Caramelo';
    }
    const palmilhaKey = `${sheetId}::${cabedelColorLower}`;
    return palmilhaLookup.get(palmilhaKey) || palmilhaLookup.get(`${sheetId}::__default__`) || cabedelColorName;
  };

  // ── Silk lookup ───────────────────────────────────────────────────────────────
  const getOrderSilk = (order: any) => {
    const soleMapping = soleMappings.find((m: any) => m.sheet_id === order.reference_id && m.product_color === order.color);
    const soleProductId = soleMapping?.sole_product_id;
    const soleProductName = (soleMapping as any)?.products?.name;
    if (!soleProductId && !soleProductName) return undefined;
    const saleOrder = saleOrders.find((so: any) => so.id === order.sale_order_id);
    const clientId = saleOrder?.client_id;
    const economicGroupId = saleOrder?.economic_group_id;
    const baseSoleName = soleProductName ? getBaseName(soleProductName) : null;
    const findSilk = (cId?: string | null, gId?: string | null) =>
      silkRegistrations.find((s: any) => {
        const matchesCtx = cId ? s.client_id === cId : (gId ? s.economic_group_id === gId : !s.client_id && !s.economic_group_id);
        const matchesProd = (soleProductId && s.sole_product_id === soleProductId) || (baseSoleName && s.sole_type && getBaseName(s.sole_type) === baseSoleName);
        return matchesProd && matchesCtx;
      });
    let silk = findSilk(clientId);
    if (!silk && economicGroupId) silk = findSilk(null, economicGroupId);
    if (!silk) silk = findSilk(null, null);
    return silk ? { silk_name: silk.silk_name, silk_url: silk.silk_url } : undefined;
  };

  const getOrderColors = (order: any) => {
    const sheetId = order.reference_id;
    const cabedelColor = (order.color || '').toLowerCase();
    const soleKey = `${sheetId}::${cabedelColor}`;
    const soleColor = soleColorLookup.get(soleKey) || null;
    const insoleHasLining = liningFlagLookup.get(sheetId) !== false;
    const insoleReadyMade = readyMadeLookup.get(sheetId) === true;
    const hasStraps = hasStrapsLookup.get(sheetId) === true;
    const mesaCapacity = mesaCapacityLookup.get(sheetId) ?? 0;
    let insoleColor: string | null = null;
    if (!insoleHasLining) {
      const palmilhaKey = `${sheetId}::${cabedelColor}`;
      insoleColor = palmilhaLookup.get(palmilhaKey) || palmilhaLookup.get(`${sheetId}::__default__`) || null;
    }
    return { soleColor, insoleColor, insoleHasLining, insoleReadyMade, hasStraps, mesaCapacity };
  };

  // ── Palmilha groups (Corte Palmilha — consolidated by sole+insole) ───────────
  const { palmilhaGroups, allSizes: palmilhaAllSizes } = useMemo(() => {
    const groupMap = new Map<string, PalmilhaGroup & { readyMade: boolean }>();
    const sizeSet = new Set<string>();
    for (const order of orders) {
      const sheetId = order.reference_id;
      if (!sheetId) continue;
      const isReadyMade = readyMadeLookup.get(sheetId) === true;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const cabedelColorName = order.variant?.color_name || order.color || '';
      const insoleColor = resolveInsoleColor(sheetId, cabedelColorLower, cabedelColorName, isReadyMade);
      const soleMapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const rawSoleName = (soleMapping as any)?.products?.name || '';
      const soleName = rawSoleName ? getBaseName(rawSoleName) : 'Sem Solado';
      const key = `${soleName}::${insoleColor}::${isReadyMade ? 'pronta' : 'cortar'}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, { soleName, insoleColor, totalPairs: 0, grade: {}, readyMade: isReadyMade });
      }
      const group = groupMap.get(key)!;
      const grid = order.grid || {};
      for (const [size, qty] of Object.entries(grid)) {
        const n = Number(qty) || 0;
        if (n > 0) { group.grade[size] = (group.grade[size] || 0) + n; sizeSet.add(size); }
      }
      group.totalPairs = Object.values(group.grade).reduce((s, v) => s + v, 0);
    }
    const sortedSizes = Array.from(sizeSet).sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
    const groups = Array.from(groupMap.values()).sort((a, b) => {
      const cmp = a.soleName.localeCompare(b.soleName);
      return cmp !== 0 ? cmp : a.insoleColor.localeCompare(b.insoleColor);
    });
    return { palmilhaGroups: groups, allSizes: sortedSizes };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, readyMadeLookup, palmilhaLookup, soleMappings]);

  // ── Silk / Montagem: grouped by sole → color ─────────────────────────────────
  const silkMontageGroups = useMemo<SoleSilkGroup[] | null>(() => {
    if (selectedSector !== 'Silk' && selectedSector !== 'Montagem') return null;
    const soleMap = new Map<string, Map<string, SilkColorGroup>>();

    for (const order of orders) {
      const sheetId = order.reference_id;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const colorName = order.variant?.color_name || order.color || '';
      const colorHex = order.variant?.color_hex;

      const soleMapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const rawSoleName = (soleMapping as any)?.products?.name || '';
      const soleName = rawSoleName ? getBaseName(rawSoleName) : 'Sem Solado';

      if (!soleMap.has(soleName)) soleMap.set(soleName, new Map());
      const colorMap = soleMap.get(soleName)!;

      if (!colorMap.has(colorName)) {
        const silk = selectedSector === 'Silk' ? getOrderSilk(order) : undefined;
        colorMap.set(colorName, {
          color: colorName,
          colorHex,
          combinedGrid: {},
          totalPairs: 0,
          opNumbers: [],
          silk,
        });
      }

      const cg = colorMap.get(colorName)!;
      cg.opNumbers.push(order.op_number);
      const grid = order.grid || {};
      for (const [size, qty] of Object.entries(grid)) {
        const n = Number(qty) || 0;
        if (n > 0) cg.combinedGrid[size] = (cg.combinedGrid[size] ?? 0) + n;
      }
      cg.totalPairs = Object.values(cg.combinedGrid).reduce((s, v) => s + v, 0);
    }

    return Array.from(soleMap.entries())
      .map(([soleName, colorMap]) => {
        const colorGroups = Array.from(colorMap.values()).sort((a, b) => a.color.localeCompare(b.color, 'pt-BR'));
        const totalPairs = colorGroups.reduce((s, g) => s + g.totalPairs, 0);
        return { soleName, colorGroups, totalPairs };
      })
      .sort((a, b) => a.soleName.localeCompare(b.soleName, 'pt-BR'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, selectedSector, soleMappings, silkRegistrations, saleOrders]);

  // ── Solagem: consolidated by sole color ──────────────────────────────────────
  const solagemData = useMemo<{ bands: SoleColorBand[]; allSizes: string[]; grandTotal: number } | null>(() => {
    if (selectedSector !== 'Solagem') return null;
    const soleColorMap = new Map<string, { grade: Record<string, number>; totalPairs: number }>();
    const sizeSet = new Set<string>();

    for (const order of orders) {
      const sheetId = order.reference_id;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const soleColor = soleColorLookup.get(`${sheetId}::${cabedelColorLower}`) || 'Sem Cor';

      if (!soleColorMap.has(soleColor)) {
        soleColorMap.set(soleColor, { grade: {}, totalPairs: 0 });
      }
      const band = soleColorMap.get(soleColor)!;
      const grid = order.grid || {};
      for (const [size, qty] of Object.entries(grid)) {
        const n = Number(qty) || 0;
        if (n > 0) {
          band.grade[size] = (band.grade[size] ?? 0) + n;
          sizeSet.add(size);
        }
      }
      band.totalPairs = Object.values(band.grade).reduce((s, v) => s + v, 0);
    }

    const allSizes = Array.from(sizeSet).sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb;
    });
    const bands: SoleColorBand[] = Array.from(soleColorMap.entries())
      .map(([soleColor, v]) => ({ soleColor, ...v }))
      .sort((a, b) => a.soleColor.localeCompare(b.soleColor, 'pt-BR'));
    const grandTotal = bands.reduce((s, b) => s + b.totalPairs, 0);

    return { bands, allSizes, grandTotal };
  }, [orders, selectedSector, soleColorLookup]);

  // ── Acabamento / Expedição: one group per store/client ───────────────────────
  const storeGroups = useMemo(() => {
    if (selectedSector !== 'Acabamento' && selectedSector !== 'Expedição') return null;
    return groupOrdersByStore(orders, saleOrders);
  }, [orders, saleOrders, selectedSector]);

  // ── Corte Forração / Mesa / Colagem: grouped by Ref + Cor ───────────────────
  const groupedWorksheets = useMemo(() => {
    const excluded = new Set(['Corte Palmilha', 'Silk', 'Montagem', 'Solagem', 'Acabamento', 'Expedição']);
    if (excluded.has(selectedSector)) return null;
    return groupOrdersByRefColor(orders);
  }, [orders, selectedSector]);

  // ── Sheet count for print button label ───────────────────────────────────────
  const sheetCount =
    selectedSector === 'Corte Palmilha'
      ? 1
      : selectedSector === 'Solagem'
        ? 1
        : selectedSector === 'Silk' || selectedSector === 'Montagem'
          ? (silkMontageGroups?.length ?? 0)
          : selectedSector === 'Acabamento' || selectedSector === 'Expedição'
            ? (storeGroups?.reduce((s, g) => s + g.orders.length, 0) ?? orders.length)
            : (groupedWorksheets?.length ?? orders.length);

  const badgeLabel =
    selectedSector === 'Corte Palmilha' ? 'Consolidado por solado' :
    selectedSector === 'Solagem'        ? 'Consolidado por cor de solado' :
    selectedSector === 'Silk' || selectedSector === 'Montagem' ? 'Agrupado por solado + cor' :
    selectedSector === 'Acabamento' || selectedSector === 'Expedição' ? 'Separado por loja/cliente' :
    'Agrupado por Ref + Cor';

  const today = new Date().toLocaleDateString('pt-BR');

  return (
    <div className="p-6 space-y-6">
      <style>{printStyles}</style>

      {/* ── Toolbar (no-print) ── */}
      <div className="no-print flex items-center justify-between bg-muted/40 p-4 rounded-lg border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
          <div className="h-8 w-[1px] bg-border" />
          <h2 className="font-bold text-lg">Fichas de Operador</h2>
          <span className="text-sm text-muted-foreground">
            {orders.length} OP(s) →{' '}
            {selectedSector === 'Corte Palmilha' || selectedSector === 'Solagem' ? (
              <>1 ficha consolidada</>
            ) : selectedSector === 'Silk' || selectedSector === 'Montagem' ? (
              <>{sheetCount} ficha(s) por solado</>
            ) : selectedSector === 'Acabamento' || selectedSector === 'Expedição' ? (
              <>{storeGroups?.length ?? 0} lojas · {sheetCount} fichas</>
            ) : (
              <>{sheetCount} fichas agrupadas ({orders.length} OPs)</>
            )}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground bg-muted rounded-md px-2 py-1 flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" />
            {badgeLabel}
          </span>
          <select
            className="p-2 rounded border bg-background text-sm font-medium"
            value={selectedSector}
            onChange={e => setSelectedSector(e.target.value as any)}
          >
            {SECTORS.map(s => <option key={s} value={s}>Setor: {s}</option>)}
          </select>
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" /> Imprimir {sheetCount} Ficha(s)
          </Button>
        </div>
      </div>

      {/* ── Print area ── */}
      <div className="print-area space-y-0">

        {/* ── Corte Palmilha: consolidated insole-cutting sheet ── */}
        {selectedSector === 'Corte Palmilha' && (
          <PalmilhaWorkSheet
            groups={palmilhaGroups}
            allSizes={palmilhaAllSizes}
            date={today}
          />
        )}

        {/* ── Silk / Montagem: one sheet per sole, per-color tables ── */}
        {(selectedSector === 'Silk' || selectedSector === 'Montagem') && silkMontageGroups && silkMontageGroups.map((group, idx) => (
          <div key={group.soleName} className={idx < silkMontageGroups.length - 1 ? 'page-break' : ''}>
            <SilkMontageWorkSheet
              group={group}
              sector={selectedSector as 'Silk' | 'Montagem'}
              date={today}
            />
          </div>
        ))}

        {/* ── Solagem: one consolidated sheet by sole color ── */}
        {selectedSector === 'Solagem' && solagemData && (
          <SolagemWorkSheet
            bands={solagemData.bands}
            allSizes={solagemData.allSizes}
            date={today}
            grandTotal={solagemData.grandTotal}
          />
        )}

        {/* ── Acabamento / Expedição: grouped by store, each OP its own page ── */}
        {(selectedSector === 'Acabamento' || selectedSector === 'Expedição') && storeGroups && storeGroups.map((storeGroup, gi) => (
          <div key={storeGroup.storeId}>
            <div className={`${gi > 0 ? 'store-divider' : ''} no-print mb-4 p-3 bg-emerald-50 border-2 border-emerald-400 rounded-lg flex items-center gap-3`}>
              <div className="w-2 h-10 bg-emerald-600 rounded-full" />
              <div>
                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Loja / Cliente</p>
                <p className="text-lg font-black text-emerald-900">{storeGroup.clientName}</p>
                {storeGroup.orderNumber && <p className="text-xs text-emerald-600 font-mono">Pedido {storeGroup.orderNumber}</p>}
              </div>
              <span className="ml-auto text-sm text-emerald-700 font-semibold">
                {storeGroup.orders.length} OP(s) · {storeGroup.orders.reduce((s: number, o: any) => s + (o.total_pairs ?? 0), 0)} pares
              </span>
            </div>

            {storeGroup.orders.map((order: any, oi: number) => {
              const silk = getOrderSilk(order);
              const { soleColor, insoleColor, insoleHasLining, insoleReadyMade, hasStraps, mesaCapacity } = getOrderColors(order);
              const isLast = gi === storeGroups.length - 1 && oi === storeGroup.orders.length - 1;
              return (
                <div key={order.id} className={!isLast ? 'page-break' : ''}>
                  <OperatorWorkSheet
                    order={order}
                    sector={selectedSector}
                    silk={silk}
                    soleColor={soleColor}
                    insoleColor={insoleColor}
                    insoleHasLining={insoleHasLining}
                    insoleReadyMade={insoleReadyMade}
                    hasStraps={hasStraps}
                    mesaCapacity={mesaCapacity}
                    sectorCapacityPerDay={getSheetSectorCapacity(order.reference_id, selectedSector)}
                    clientInfo={{ name: storeGroup.clientName, orderNumber: storeGroup.orderNumber }}
                  />
                </div>
              );
            })}
          </div>
        ))}

        {/* ── Corte Forração / Mesa / Colagem: grouped by Ref + Cor ── */}
        {groupedWorksheets && groupedWorksheets.map((group, idx) => {
          const { representative } = group;
          const syntheticOrder = {
            ...representative,
            grid: group.combinedGrid,
            total_pairs: group.totalPairs,
            due_date: group.latestDueDate || representative.due_date,
            op_number: group.opNumbers[0],
          };
          const silk = getOrderSilk(representative);
          const { soleColor, insoleColor, insoleHasLining, insoleReadyMade, hasStraps, mesaCapacity } = getOrderColors(representative);
          const isLast = idx === groupedWorksheets.length - 1;
          return (
            <div key={`${representative.reference_id}::${representative.color}`} className={!isLast ? 'page-break' : ''}>
              <OperatorWorkSheet
                order={syntheticOrder}
                sector={selectedSector}
                silk={silk}
                soleColor={soleColor}
                insoleColor={insoleColor}
                insoleHasLining={insoleHasLining}
                insoleReadyMade={insoleReadyMade}
                hasStraps={hasStraps}
                mesaCapacity={mesaCapacity}
                sectorCapacityPerDay={getSheetSectorCapacity(representative.reference_id, selectedSector)}
                opNumbers={group.opNumbers}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PrintWorkSheetsPage;
