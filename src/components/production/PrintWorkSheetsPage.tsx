import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Printer, ArrowLeft, Layers } from 'lucide-react';
import OperatorWorkSheet from '@/components/production/OperatorWorkSheet';
import { PalmilhaWorkSheet, type PalmilhaGroup } from '@/components/production/PalmilhaWorkSheet';
import { SilkMontageWorkSheet, type SoleSilkGroup, type SilkColorGroup, type GroupedSector } from '@/components/production/SilkMontageWorkSheet';
import { SolagemWorkSheet, type SoleColorBand } from '@/components/production/SolagemWorkSheet';
import { ExpedicaoWorkSheet, type ExpedicaoCustomerGroup, type ExpedicaoOrder } from '@/components/production/ExpedicaoWorkSheet';

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

const SECTORS = ['Corte Palmilha', 'Corte Forração', 'Costura', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição'] as const;

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
    queryKey: ['sale_orders_for_worksheets_v3'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('sale_orders')
        .select('id, client_id, economic_group_id, client_name, client_cnpj, order_number');
      if (error) throw error;
      return data;
    },
  });

  const { data: clientsInfo = [] } = useQuery({
    queryKey: ['clients_for_expedicao'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('clients')
        .select('id, name, cnpj, city');
      if (error) throw error;
      return data || [];
    },
  });

  const { data: soleMappings = [] } = useQuery({
    queryKey: ['sole_ref_mappings_v2', referenceIds],
    enabled: referenceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheet_sole_colors')
        .select('sheet_id, product_color, sole_product_id, products:sole_product_id(name, color, group_id)')
        .in('sheet_id', referenceIds);
      if (error) throw error;
      return data;
    },
  });

  // Pacote de embalagem por grupo de solado (pra Expedição)
  const soleGroupIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of soleMappings as any[]) {
      const gid = (m as any)?.products?.group_id;
      if (gid) ids.add(gid);
    }
    return Array.from(ids);
  }, [soleMappings]);

  const { data: soleGroupPackaging = [] } = useQuery({
    queryKey: ['sole_group_packaging', soleGroupIds],
    enabled: soleGroupIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('product_groups')
        .select('id, pairs_per_box_individual')
        .in('id', soleGroupIds);
      if (error) throw error;
      return data || [];
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
      'Costura':        'costura_capacity_per_day',
      'Montagem':       'assembly_capacity_per_day',
      'Acabamento':     'finishing_capacity_per_day',
      'Aviamento':      'mesa_daily_capacity',  // DB column ainda chama mesa_daily_capacity
      'Mesa':           'mesa_daily_capacity',  // alias legacy
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

  // ── Setores que agrupam por SOLADO + COR ───────────────────────────────────
  // Silk, Montagem, Corte Forração, Costura, Aviamento, Acabamento.
  // (Corte Palmilha = só por solado; Solagem = por cor de solado;
  //  Expedição = por cliente; Colagem ainda usa Ref+Cor.)
  const SOLE_COLOR_GROUPED_SECTORS: ReadonlyArray<GroupedSector> = [
    'Silk', 'Montagem', 'Corte Forração', 'Costura', 'Aviamento', 'Acabamento',
  ];

  // ── Silk / Montagem / Corte Forração / Costura / Aviamento / Acabamento ────
  const silkMontageGroups = useMemo<SoleSilkGroup[] | null>(() => {
    if (!SOLE_COLOR_GROUPED_SECTORS.includes(selectedSector as GroupedSector)) return null;
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

  // ── Expedição: por cliente (LOJA-A-LOJA), com info de embalagem ──────────
  // Acabamento agora segue mesma lógica de Aviamento (sole+color), per user.
  const expedicaoGroups = useMemo<ExpedicaoCustomerGroup[] | null>(() => {
    if (selectedSector !== 'Expedição') return null;

    const clientById = new Map<string, any>();
    for (const c of clientsInfo as any[]) clientById.set((c as any).id, c);

    const groupPackagingById = new Map<string, number | null>();
    for (const g of soleGroupPackaging as any[]) {
      groupPackagingById.set((g as any).id, (g as any).pairs_per_box_individual);
    }

    // Resolve sole info por order (nome + pairs_per_box)
    const resolveSoleInfo = (order: any): { soleName: string | null; pairsPerBox: number | null } => {
      const sheetId = order.reference_id;
      const cabedelColorLower = (order.color || '').toLowerCase();
      const mapping = (soleMappings as any[]).find(
        m => m.sheet_id === sheetId && (m.product_color || '').toLowerCase() === cabedelColorLower,
      );
      const soleName = (mapping as any)?.products?.name ? getBaseName((mapping as any).products.name) : null;
      const groupId = (mapping as any)?.products?.group_id;
      const pairsPerBox = groupId ? (groupPackagingById.get(groupId) ?? null) : null;
      return { soleName, pairsPerBox };
    };

    // Agrupa por client_id (fallback: sale_order_id pra avulsos)
    const map = new Map<string, ExpedicaoCustomerGroup>();
    for (const order of orders) {
      const so = (saleOrders as any[]).find((s: any) => s.id === order.sale_order_id);
      const clientId = so?.client_id || `__order_${order.sale_order_id ?? order.id}`;
      const client = so?.client_id ? clientById.get(so.client_id) : null;

      const { soleName, pairsPerBox } = resolveSoleInfo(order);

      if (!map.has(clientId)) {
        map.set(clientId, {
          client_id: clientId,
          client_name: client?.name || so?.client_name || 'Sem cliente',
          client_cnpj: client?.cnpj || so?.client_cnpj || null,
          client_city: client?.city || null,
          sale_order_number: so?.order_number || null,
          orders: [],
        });
      }
      const cust = map.get(clientId)!;
      cust.orders.push({
        id: order.id,
        op_number: order.op_number,
        reference_id: order.reference_id,
        reference_code: order.reference_code,
        reference_name: order.reference_name,
        color: order.color,
        total_pairs: order.total_pairs ?? 0,
        grid: order.grid,
        sole_name: soleName,
        pairs_per_box: pairsPerBox,
      });
    }

    return Array.from(map.values()).sort((a, b) => a.client_name.localeCompare(b.client_name, 'pt-BR'));
  }, [orders, saleOrders, clientsInfo, soleMappings, soleGroupPackaging, selectedSector]);

  // ── Colagem: agrupa por Ref + Cor (não tem solado-específico) ──────────────
  const groupedWorksheets = useMemo(() => {
    if (selectedSector !== 'Colagem') return null;
    return groupOrdersByRefColor(orders);
  }, [orders, selectedSector]);

  // ── Sheet count for print button label ───────────────────────────────────────
  const sheetCount =
    selectedSector === 'Corte Palmilha'
      ? 1
      : selectedSector === 'Solagem'
        ? 1
        : SOLE_COLOR_GROUPED_SECTORS.includes(selectedSector as GroupedSector)
          ? (silkMontageGroups?.length ?? 0)
          : selectedSector === 'Expedição'
            ? (expedicaoGroups?.length ?? 0)
            : (groupedWorksheets?.length ?? orders.length);

  const badgeLabel =
    selectedSector === 'Corte Palmilha' ? 'Consolidado por solado' :
    selectedSector === 'Solagem'        ? 'Consolidado por cor de solado' :
    SOLE_COLOR_GROUPED_SECTORS.includes(selectedSector as GroupedSector) ? 'Agrupado por solado + cor' :
    selectedSector === 'Expedição' ? 'Separado por loja/cliente' :
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
            ) : SOLE_COLOR_GROUPED_SECTORS.includes(selectedSector as GroupedSector) ? (
              <>{sheetCount} ficha(s) por solado</>
            ) : selectedSector === 'Expedição' ? (
              <>{expedicaoGroups?.length ?? 0} loja(s) · {sheetCount} ficha(s)</>
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

        {/* ── Sole+Color sectors (Silk, Montagem, Corte Forração, Costura, Aviamento, Acabamento) ── */}
        {silkMontageGroups && silkMontageGroups.map((group, idx) => (
          <div key={group.soleName} className={idx < silkMontageGroups.length - 1 ? 'page-break' : ''}>
            <SilkMontageWorkSheet
              group={group}
              sector={selectedSector as GroupedSector}
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

        {/* ── Expedição: 1 ficha por cliente/CNPJ, com info de embalagem ── */}
        {selectedSector === 'Expedição' && expedicaoGroups && expedicaoGroups.map((group, idx) => (
          <div key={group.client_id} className={idx < expedicaoGroups.length - 1 ? 'page-break' : ''}>
            <ExpedicaoWorkSheet group={group} date={today} />
          </div>
        ))}

        {/* ── Colagem: agrupado por Ref + Cor (não tem solado-específico) ── */}
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
