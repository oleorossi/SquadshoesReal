import { printHtml } from './printOrder';
import { scaleGradeWithLargestRemainder } from './scaleGrade';
import { getOrderSilkInfo } from './getClientLogo';
import { supabase } from '@/integrations/supabase/client';
import { escapeHtml } from './htmlUtils';
import type { WorkSheetLayoutSettings } from '@/components/production/WorkSheetSettingsDialog';
import { loadWorkSheetSettings } from '@/components/production/WorkSheetSettingsDialog';

const SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

type OrderData = {
  id: string;
  order_number: string;
  reference_id: string;
  color: string;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
  sale_order_id?: string | null;
  item_observation?: string | null;
};

type ReferenceData = {
  id: string;
  code: string;
  name: string;
  shoe_category?: string;
  image_url?: string;
  images?: any[];
  has_straps?: boolean | null;
};

type SaleOrderData = {
  id: string;
  order_number?: string;
  client_name?: string;
  client_order_number?: string;
  delivery_deadline?: string;
  client_number?: string;
  economic_group_id?: string | null;
};

interface WorkSheetOptions {
  sectorName: string;
  sectorEmoji: string;
  orders: OrderData[];
  references: ReferenceData[];
  saleOrders?: SaleOrderData[];
  getStrapsLabel?: (order: any) => string;
  getSoleColor?: (orderColor: string | null | undefined) => string;
  getSoleReference?: (order: OrderData) => string | undefined;
  layoutSettings?: WorkSheetLayoutSettings;
}

type GroupedWorkSheetData = {
  orderNumbers: string[];
  clientNames: string[];
  saleOrderNumbers: string[];
  clientOrderNumbers: string[];
  deliveryDates: string[];
  totalBySize: Record<string, number>;
  totalPairs: number;
  activeSizes: string[];
  strapsLabel?: string;
  soleColor?: string;
  soleReferenceName?: string;
  observations: string[];
};

type WorkSheetCardItem = {
  order: OrderData;
  ref?: ReferenceData;
  strapsLabel?: string;
  soleColor?: string;
  soleReferenceName?: string;
  groupData?: GroupedWorkSheetData;
};

function normalizeGroupPart(value: string): string {
  return (value || '').trim().normalize('NFC').toUpperCase();
}

function deriveSoleType(color: string | null | undefined, reference?: ReferenceData): string {
  // Se a referência tem uma cor de solado explícita na ficha técnica, usa ela como prioridade
  const refSoleColor = (reference as any)?.sole_color;
  if (refSoleColor && typeof refSoleColor === 'string' && refSoleColor.trim()) {
    return `Solado ${refSoleColor.trim()}`;
  }

  const c = (color || '').toLowerCase().normalize('NFC').trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Solado Preto';
  return 'Solado Caramelo';
}

function getScaledGrade(order: OrderData): { baseGrade: Record<string, number>; scaledGrade: Record<string, number>; totalPairs: number; activeSizes: string[]; gradeSum: number } {
  const grade = order.grade;
  if (!grade || typeof grade !== 'object') {
    return { baseGrade: {}, scaledGrade: {}, totalPairs: order.quantity || 0, activeSizes: [], gradeSum: 0 };
  }
  const gradeSum = Object.values(grade).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalPairs = order.quantity || gradeSum || 0;
  const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;

  const baseGrade: Record<string, number> = {};
  for (const s of SIZES) {
    const baseQty = Number(grade[s]) || 0;
    if (baseQty > 0) baseGrade[s] = baseQty;
  }
  const scaledGrade = scaleGradeWithLargestRemainder(baseGrade, multiplier, totalPairs);
  const activeSizes = SIZES.filter(s => (scaledGrade[s] || 0) > 0 || (baseGrade[s] || 0) > 0);
  return { baseGrade, scaledGrade, totalPairs, activeSizes, gradeSum };
}

function buildDualGradeTable(baseGrade: Record<string, number>, scaledGrade: Record<string, number>, activeSizes: string[], gradeSum: number, totalPairs: number): string {
  if (activeSizes.length === 0) return '';

  const fichas = gradeSum > 0 ? Math.ceil(totalPairs / gradeSum) : 0;
  const perFichaGrade: Record<string, number> = {};
  let perFichaSum = 0;
  for (const s of activeSizes) {
    const val = fichas > 0 ? Math.round((scaledGrade[s] || 0) / fichas) : (baseGrade[s] || 0);
    perFichaGrade[s] = val;
    perFichaSum += val;
  }
  const denseLayout = activeSizes.length >= 12;
  const firstColumnWidth = denseLayout ? 46 : 54;
  const totalColumnWidth = denseLayout ? 38 : 42;
  const headerFontSize = denseLayout ? 8 : 9;
  const sizeHeaderFontSize = denseLayout ? 9 : 10;
  const baseValueFontSize = denseLayout ? 12 : 13;
  const totalValueFontSize = denseLayout ? 13 : 15;

  return `
    <table style="width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed;">
      <colgroup>
        <col style="width:${firstColumnWidth}px;" />
        ${activeSizes.map(() => '<col />').join('')}
        <col style="width:${totalColumnWidth}px;" />
      </colgroup>
      <tr style="background:#1a1a1a;color:#fff;">
        <th style="border:1px solid #555;padding:3px 2px;text-align:center;font-size:${headerFontSize}px;line-height:1.1;white-space:nowrap;">Nº</th>
        ${activeSizes.map(s => `<th style="border:1px solid #555;padding:3px 1px;text-align:center;font-size:${sizeHeaderFontSize}px;line-height:1;white-space:nowrap;">${s}</th>`).join('')}
        <th style="border:1px solid #555;padding:3px 2px;text-align:center;font-size:${headerFontSize}px;background:#333;line-height:1.1;white-space:nowrap;">TOTAL</th>
      </tr>
      <tr style="background:#f9f9f0;">
        <td style="border:1px solid #999;padding:4px 2px;text-align:center;font-size:8px;font-weight:700;color:#666;line-height:1.15;">Por Ficha<br/>(${perFichaSum}p)</td>
        ${activeSizes.map(s => `<td style="border:1px solid #999;padding:4px 1px;text-align:center;font-family:'Courier New',monospace;font-size:${baseValueFontSize}px;font-weight:700;white-space:nowrap;">${perFichaGrade[s] || 0}</td>`).join('')}
        <td style="border:1px solid #999;padding:4px 1px;text-align:center;font-family:'Courier New',monospace;font-size:${baseValueFontSize}px;font-weight:700;background:#f0f0e8;white-space:nowrap;">${perFichaSum}</td>
      </tr>
      <tr>
        <td style="border:1px solid #999;padding:4px 2px;text-align:center;font-size:8px;font-weight:700;color:#333;background:#e8e8d8;line-height:1.15;">Total${fichas > 1 ? `<br/>(${fichas}x)` : ''}<br/>(${totalPairs}p)</td>
        ${activeSizes.map(s => `<td style="border:1px solid #999;padding:4px 1px;text-align:center;font-family:'Courier New',monospace;font-size:${totalValueFontSize}px;font-weight:900;white-space:nowrap;">${scaledGrade[s] || 0}</td>`).join('')}
        <td style="border:1px solid #999;padding:4px 1px;text-align:center;font-family:'Courier New',monospace;font-size:${totalValueFontSize}px;font-weight:900;background:#f0f0e8;white-space:nowrap;">${totalPairs}</td>
      </tr>
    </table>`;
}

function buildGroupedGradeTable(totalBySize: Record<string, number>, activeSizes: string[], totalPairs: number): string {
  if (activeSizes.length === 0) return '';

  const denseLayout = activeSizes.length >= 12;
  const firstColumnWidth = denseLayout ? 58 : 68;
  const totalColumnWidth = denseLayout ? 38 : 42;
  const headerFontSize = denseLayout ? 8 : 9;
  const sizeHeaderFontSize = denseLayout ? 9 : 10;
  const totalValueFontSize = denseLayout ? 13 : 15;

  return `
    <table style="width:100%;border-collapse:collapse;margin-top:6px;table-layout:fixed;">
      <colgroup>
        <col style="width:${firstColumnWidth}px;" />
        ${activeSizes.map(() => '<col />').join('')}
        <col style="width:${totalColumnWidth}px;" />
      </colgroup>
      <tr style="background:#1a1a1a;color:#fff;">
        <th style="border:1px solid #555;padding:3px 2px;text-align:center;font-size:${headerFontSize}px;line-height:1.1;white-space:nowrap;">Nº</th>
        ${activeSizes.map(s => `<th style="border:1px solid #555;padding:3px 1px;text-align:center;font-size:${sizeHeaderFontSize}px;line-height:1;white-space:nowrap;">${s}</th>`).join('')}
        <th style="border:1px solid #555;padding:3px 2px;text-align:center;font-size:${headerFontSize}px;background:#333;line-height:1.1;white-space:nowrap;">TOTAL</th>
      </tr>
      <tr>
        <td style="border:1px solid #999;padding:4px 2px;text-align:center;font-size:8px;font-weight:700;color:#333;background:#e8e8d8;line-height:1.15;">Total<br/>Agrupado<br/>(${totalPairs}p)</td>
        ${activeSizes.map(s => `<td style="border:1px solid #999;padding:4px 1px;text-align:center;font-family:'Courier New',monospace;font-size:${totalValueFontSize}px;font-weight:900;white-space:nowrap;">${totalBySize[s] || 0}</td>`).join('')}
        <td style="border:1px solid #999;padding:4px 1px;text-align:center;font-family:'Courier New',monospace;font-size:${totalValueFontSize}px;font-weight:900;background:#f0f0e8;white-space:nowrap;">${totalPairs}</td>
      </tr>
    </table>`;
}

function buildWorkSheetCardItems(
  sectorName: string,
  orders: OrderData[],
  references: ReferenceData[],
  saleOrders?: SaleOrderData[],
  getStrapsLabel?: (order: any) => string,
  getSoleColor?: (orderColor: string | null | undefined) => string,
  getSoleReference?: (order: OrderData) => string | undefined,
): WorkSheetCardItem[] {
  const referenceMap = new Map(references.map(reference => [reference.id, reference]));
  const saleOrderMap = new Map((saleOrders || []).map(saleOrder => [saleOrder.id, saleOrder]));


  type MutableGroup = {
    representativeOrder: OrderData;
    ref?: ReferenceData;
    color: string;
    strapsLabel?: string;
    soleColor?: string;
    soleReferenceName?: string;
    totalBySize: Record<string, number>;
    totalPairs: number;
    orderNumbers: string[];
    clientNames: Set<string>;
    saleOrderNumbers: Set<string>;
    clientOrderNumbers: Set<string>;
    deliveryDates: Set<string>;
    observations: Set<string>;
  };

  const groupMap = new Map<string, MutableGroup>();

  for (const order of orders) {
    let strapsLabel = '';
    if (getStrapsLabel) {
      try {
        strapsLabel = getStrapsLabel(order) || '';
      } catch {
        strapsLabel = '';
      }
    }

    const ref = referenceMap.get(order.reference_id);
    const soleColor = getSoleColor ? (getSoleColor(order.color) || deriveSoleType(order.color, ref)) : deriveSoleType(order.color, ref);
    const soleReferenceName = getSoleReference ? getSoleReference(order) : undefined;
    const saleOrder = order.sale_order_id ? saleOrderMap.get(order.sale_order_id) : undefined;
    const { scaledGrade, totalPairs } = getScaledGrade(order);

    const economicGroupKey = saleOrder?.economic_group_id || '__NO_GROUP__';
    const key = [
      normalizeGroupPart(soleColor || deriveSoleType(order.color)),
      order.reference_id,
      normalizeGroupPart(order.color || '—'),
      normalizeGroupPart(strapsLabel || '__NO_STRAPS__'),
      normalizeGroupPart(economicGroupKey),
    ].join('|');

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        representativeOrder: order,
        ref,
        color: order.color || '—',
        strapsLabel: strapsLabel || undefined,
        soleColor,
        soleReferenceName,
        totalBySize: {},
        totalPairs: 0,
        orderNumbers: [],
        clientNames: new Set<string>(),
        saleOrderNumbers: new Set<string>(),
        clientOrderNumbers: new Set<string>(),
        deliveryDates: new Set<string>(),
        observations: new Set<string>(),
      });
    }

    const group = groupMap.get(key)!;
    group.totalPairs += totalPairs;
    group.orderNumbers.push(order.order_number);

    if (!group.strapsLabel && strapsLabel) group.strapsLabel = strapsLabel;
    if (!group.soleReferenceName && soleReferenceName) group.soleReferenceName = soleReferenceName;

    for (const size of SIZES) {
      const qty = scaledGrade[size] || 0;
      if (qty > 0) {
        group.totalBySize[size] = (group.totalBySize[size] || 0) + qty;
      }
    }

    if (saleOrder?.client_name) group.clientNames.add(saleOrder.client_name);
    if (saleOrder?.order_number) group.saleOrderNumbers.add(saleOrder.order_number);
    if (saleOrder?.client_order_number) group.clientOrderNumbers.add(saleOrder.client_order_number);
    if (saleOrder?.delivery_deadline) {
      group.deliveryDates.add(new Date(saleOrder.delivery_deadline).toLocaleDateString('pt-BR'));
    }
    if (order.item_observation?.trim()) group.observations.add(order.item_observation.trim());
  }

  return Array.from(groupMap.values())
    .sort((a, b) => {
      const bySole = (a.soleColor || '').localeCompare(b.soleColor || '', 'pt-BR');
      if (bySole !== 0) return bySole;

      const byRef = `${a.ref?.code || ''} ${a.ref?.name || ''}`.localeCompare(`${b.ref?.code || ''} ${b.ref?.name || ''}`, 'pt-BR');
      if (byRef !== 0) return byRef;

      const byColor = a.color.localeCompare(b.color, 'pt-BR');
      if (byColor !== 0) return byColor;

      return (a.strapsLabel || '').localeCompare(b.strapsLabel || '', 'pt-BR');
    })
    .map(group => {
      const baseCard: WorkSheetCardItem = {
        order: group.representativeOrder,
        ref: group.ref,
        strapsLabel: group.strapsLabel,
        soleColor: group.soleColor,
        soleReferenceName: group.soleReferenceName,
      };

      if (group.orderNumbers.length <= 1) return baseCard;

      return {
        ...baseCard,
        groupData: {
          orderNumbers: group.orderNumbers,
          clientNames: Array.from(group.clientNames).sort((a, b) => a.localeCompare(b, 'pt-BR')),
          saleOrderNumbers: Array.from(group.saleOrderNumbers).sort((a, b) => a.localeCompare(b, 'pt-BR')),
          clientOrderNumbers: Array.from(group.clientOrderNumbers).sort((a, b) => a.localeCompare(b, 'pt-BR')),
          deliveryDates: Array.from(group.deliveryDates).sort((a, b) => a.localeCompare(b, 'pt-BR')),
          totalBySize: group.totalBySize,
          totalPairs: group.totalPairs,
          activeSizes: SIZES.filter(size => (group.totalBySize[size] || 0) > 0),
          strapsLabel: group.strapsLabel,
          soleColor: group.soleColor,
          soleReferenceName: group.soleReferenceName,
          observations: Array.from(group.observations),
        },
      };
    });
}

// Cache em memória por execução para evitar refetch dos mesmos recursos
type RenderCaches = {
  variantImages: Map<string, string>; // key: `${reference_id}|${color}` → image_url
  silkUrls: Map<string, string>; // key: `${sale_order_id}|${reference_id}` → silk url
  importantInfos: Map<string, string>; // key: `${sale_order_id}` → important info
};

 function buildMiniGradeRow(
   label: string,
   emoji: string,
   bgColor: string,
   borderColor: string,
   showColor: boolean,
   sizesArr: string[],
   totalsBySize: Record<string, number>,
   totalPairs: number,
   globalBadge?: boolean,
   color?: string,
 ): string {
   if (sizesArr.length === 0) return '';
   const cells = sizesArr.map(s => `<td style="border:1px solid #999;padding:2px 3px;text-align:center;font-family:'Courier New',monospace;font-size:11px;font-weight:800;">${totalsBySize[s] || 0}</td>`).join('');
   const colorBadge = showColor
     ? `<span style="font-size:9px;font-weight:700;background:#fff;border:1px solid #999;border-radius:3px;padding:1px 5px;margin-left:6px;">COR: ${color || '—'}</span>`
     : globalBadge
       ? `<span style="font-size:9px;font-weight:700;background:#fef3c7;border:1px solid #d4a017;border-radius:3px;padding:1px 5px;margin-left:6px;color:#7c2d12;">SOMA TOTAL</span>`
       : `<span style="font-size:9px;font-weight:700;background:#fff;border:1px solid #999;border-radius:3px;padding:1px 5px;margin-left:6px;color:#666;">Soma total</span>`;
   return `
     <div style="margin-top:6px;border:1px solid ${borderColor};border-radius:4px;background:${bgColor};padding:5px 6px;">
       <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
         <span style="font-size:11px;font-weight:800;color:#222;">${emoji} ${label}</span>
         <span style="display:flex;align-items:center;gap:4px;">
           ${colorBadge}
           <span style="font-size:10px;font-weight:700;background:#222;color:#fff;border-radius:3px;padding:1px 6px;">${totalPairs}p</span>
           <span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;background:#fff;" title="OK"></span>
         </span>
       </div>
       <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
         <tr style="background:#1a1a1a;color:#fff;">
           ${sizesArr.map(s => `<th style="border:1px solid #555;padding:2px 1px;text-align:center;font-size:9px;">${s}</th>`).join('')}
         </tr>
         <tr style="background:#fff;">${cells}</tr>
       </table>
     </div>`;
 }

 async function buildOrderCard(
   order: OrderData,
   ref: ReferenceData | undefined,
   sectorName: string,
   sectorEmoji: string,
   saleOrders?: SaleOrderData[],
   strapsLabel?: string,
   soleColor?: string,
   soleReferenceName?: string,
   layoutSettings?: WorkSheetLayoutSettings,
   groupData?: GroupedWorkSheetData,
   caches?: RenderCaches,
   _palmilhaGlobal?: { totalsBySize: Record<string, number>; totalPairs: number; activeSizes: string[] },
 ): Promise<string> {
   const settings = layoutSettings || loadWorkSheetSettings();
   const isGrouped = Boolean(groupData);
   const singleGradeData = isGrouped ? null : getScaledGrade(order);
 
   const totalPairs = isGrouped ? groupData!.totalPairs : singleGradeData!.totalPairs;
   const activeSizes = isGrouped ? groupData!.activeSizes : singleGradeData!.activeSizes;
   const effectiveStrapsLabel = groupData?.strapsLabel ?? strapsLabel;
   const effectiveSoleColor = groupData?.soleColor ?? soleColor;
   const effectiveSoleReferenceName = groupData?.soleReferenceName ?? soleReferenceName;
   const observationText = isGrouped ? groupData!.observations.join(' • ') : ((order as any).item_observation || '');
 
   const so = !isGrouped ? saleOrders?.find(s => s.id === order.sale_order_id) : undefined;
   const refCode = ref?.code || '—';
   const refName = ref?.name || '';
   const imageSizeMap = { small: '30mm', medium: '40mm', large: '55mm' };
   const imageSize = imageSizeMap[settings.imageSize] || '40mm';
   const fontScale = settings.fontSize === 'small' ? 0.85 : settings.fontSize === 'large' ? 1.15 : 1;

  let imageUrl = '';
  if (order.color && ref) {
    const cacheKey = `${order.reference_id}|${order.color}`;
    if (caches?.variantImages.has(cacheKey)) {
      imageUrl = caches.variantImages.get(cacheKey) || '';
    } else {
      try {
        const { data: variant } = await supabase
          .from('reference_color_variants')
          .select('image_url')
          .eq('reference_id', order.reference_id)
          .eq('color', order.color)
          .maybeSingle();
        if (variant?.image_url) imageUrl = variant.image_url;
        caches?.variantImages.set(cacheKey, imageUrl);
      } catch { /* ignore */ }
    }
  }
  if (!imageUrl && ref) {
    imageUrl = (ref.images as string[] | null)?.[0] || ref.image_url || '';
  }
  // Removido fallback extra (anyVariant query) — pré-carregamento em buildSectorWorkSheetsHtml já cobre o caso
  const imageHtml = settings.showImage
    ? (imageUrl
      ? `<img src="${imageUrl}" crossorigin="anonymous" style="width:${imageSize};height:${imageSize};object-fit:contain;border:1px solid #ccc;border-radius:4px;background:#fafafa;display:block;" />`
      : `<div style="width:${imageSize};height:${imageSize};background:#f5f5f5;border:1px solid #ccc;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:9px;">Sem foto</div>`)
    : '';

  const deliveryDate = isGrouped
    ? (groupData!.deliveryDates.length === 1 ? groupData!.deliveryDates[0] : groupData!.deliveryDates.length > 1 ? 'Múltiplas' : '—')
    : so?.delivery_deadline
      ? new Date(so.delivery_deadline).toLocaleDateString('pt-BR')
      : '—';

  let silkHtml = '';
  let importantInfoHtml = '';
   if (settings.showSilk) {
    if (isGrouped && groupData!.clientNames.length > 1) {
      silkHtml = `<div style="text-align:center;flex-shrink:0;">
        <p style="font-size:8px;color:#999;margin-bottom:2px;font-weight:700;">SILK</p>
        <div style="width:100px;height:100px;border:1px solid #ddd;border-radius:4px;display:flex;align-items:center;justify-content:center;text-align:center;color:#666;font-size:10px;font-weight:700;padding:6px;box-sizing:border-box;">
          Múltiplas lojas
        </div>
      </div>`;
    } else {
      try {
        const silkKey = `${order.sale_order_id || ''}|${order.reference_id || ''}`;
        const infoKey = order.sale_order_id || '';
        let silkUrl: string;
        let importantInfo: string;

        if (caches?.silkUrls.has(silkKey)) {
          silkUrl = caches.silkUrls.get(silkKey)!;
          importantInfo = caches.importantInfos.get(infoKey) || '';
        } else {
          const info = await getOrderSilkInfo(order);
          silkUrl = info.silkUrl;
          importantInfo = info.importantInfo;
          caches?.silkUrls.set(silkKey, silkUrl);
          caches?.importantInfos.set(infoKey, importantInfo);
        }

        silkHtml = `<div style="text-align:center;flex-shrink:0;">
          <p style="font-size:8px;color:#999;margin-bottom:2px;font-weight:700;">SILK</p>
          <img src="${silkUrl}" crossorigin="anonymous" style="width:100px;height:100px;object-fit:contain;border:1px solid #ddd;border-radius:4px;" />
        </div>`;

        if (importantInfo) {
          importantInfoHtml = `<div style="margin-top:6px;padding:6px 10px;background:#fff5f5;border:1px solid #feb2b2;border-radius:4px;font-size:11px;color:#c53030;">
            <span style="font-weight:900;text-transform:uppercase;font-size:9px;display:block;margin-bottom:2px;color:#9b2c2c;">⚠️ INFO GRUPO / LOJA:</span>
            ${escapeHtml(importantInfo).replace(/\n/g, '<br/>')}
          </div>`;
        }
      } catch { /* ignore */ }
    }
  }

  let sectorSpecific = '';
  if (sectorName === 'Solagem') {
    const soleInfo = [effectiveSoleColor ? `Cor: ${escapeHtml(effectiveSoleColor)}` : '', effectiveSoleReferenceName ? `Ref: ${escapeHtml(effectiveSoleReferenceName)}` : ''].filter(Boolean).join(' — ');
    if (soleInfo) {
      sectorSpecific = `<div style="margin-top:6px;padding:6px 10px;background:#f0f7f4;border:1px solid #c2d6ce;border-radius:4px;">
      <span style="font-size:11px;font-weight:700;">🦶 Solado: <span style="font-size:13px;color:#1F513B;">${soleInfo}</span></span>
    </div>`;
    }
  }
  if (settings.showChecklist) {
    if (sectorName === 'Montagem') {
      sectorSpecific = `<div style="margin-top:8px;border:1px solid #ccc;border-radius:4px;padding:8px;">
        <p style="font-size:9px;font-weight:700;color:#666;margin-bottom:4px;">CHECKLIST MONTAGEM</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Cabedal conformado</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Solado posicionado</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Colagem finalizada</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Inspeção OK</label>
        </div>
      </div>`;
    }
    if (sectorName === 'Corte') {
      // Modelos COM tiras: cabedal vem pré-montado, então NÃO renderiza bloco de Cabedal.
      // Forração: sempre presente, identificada por COR.
      // Palmilha: sempre presente, soma TOTAL (independe da cor).
      const showCabedal = !ref?.has_straps;
      const corteColor = order.color || '—';

      const currentGrade = isGrouped ? groupData!.totalBySize : (singleGradeData?.scaledGrade || {});
      const cabedalBlock = showCabedal
        ? buildMiniGradeRow('FICHA CABEDAL', '👟', '#fff8e1', '#d4a017', true, activeSizes, currentGrade, totalPairs, false, corteColor)
        : `<div style="margin-top:6px;border:1px dashed #bbb;border-radius:4px;padding:5px 8px;background:#f9f9f9;font-size:10px;color:#888;text-align:center;">
             ⚠️ Cabedal pré-montado (modelo com tiras) — não há corte de cabedal nesta OP
           </div>`;
      const forracaoBlock = buildMiniGradeRow('FICHA FORRAÇÃO', '🧵', '#e0f2fe', '#0369a1', true, activeSizes, currentGrade, totalPairs, false, corteColor);
      
      // Palmilha agora é renderizada apenas uma vez por solado no buildSectorWorkSheetsHtml
      const palmilhaBlock = '';

      sectorSpecific = `
        <div style="margin-top:8px;">
          <p style="font-size:10px;font-weight:800;color:#444;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px;">✂️ Subdivisão de Corte</p>
          ${cabedalBlock}
          ${forracaoBlock}
          ${palmilhaBlock}
        </div>`;
    }
    if (sectorName === 'Aviamento') {
      sectorSpecific = `<div style="margin-top:8px;border:1px solid #ccc;border-radius:4px;padding:8px;">
        <p style="font-size:9px;font-weight:700;color:#666;margin-bottom:4px;">CHECKLIST AVIAMENTO</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Ilhós / Rebites</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Costura</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Enfeites / Componentes</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Inspeção OK</label>
        </div>
      </div>`;
    }
    if (sectorName === 'Costura') {
      sectorSpecific = `<div style="margin-top:8px;border:1px solid #ccc;border-radius:4px;padding:8px;">
        <p style="font-size:9px;font-weight:700;color:#666;margin-bottom:4px;">CHECKLIST COSTURA</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Costuras superiores</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Costuras laterais</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Acabamento de borda</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Inspeção OK</label>
        </div>
      </div>`;
    }
    if (sectorName === 'Mesa') {
      // Fallback legacy: setor "Mesa" pre-PR1, hoje "Aviamento". Mantido pra OPs
      // antigas; conteúdo é o checklist de preparação de kit (separar materiais).
      sectorSpecific = `<div style="margin-top:8px;border:1px solid #ccc;border-radius:4px;padding:8px;">
        <p style="font-size:9px;font-weight:700;color:#666;margin-bottom:4px;">CHECKLIST AVIAMENTO (LEGACY: Mesa)</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Materiais separados</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Quantidades conferidas</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Kit montado por OP</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Inspeção OK</label>
        </div>
      </div>`;
    }
    if (sectorName === 'Acabamento') {
      sectorSpecific = `<div style="margin-top:8px;border:1px solid #ccc;border-radius:4px;padding:8px;">
        <p style="font-size:9px;font-weight:700;color:#666;margin-bottom:4px;">CHECKLIST ACABAMENTO</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px;">
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Limpeza</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Etiqueta / SILK</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Embalagem</label>
          <label style="display:flex;align-items:center;gap:4px;"><span style="display:inline-block;width:14px;height:14px;border:2px solid #333;border-radius:2px;"></span> Inspeção Final</label>
        </div>
      </div>`;
    }
  }

  const headerFontSize = Math.round(20 * fontScale);
  const opFontSize = Math.round(14 * fontScale);
  const modelFontSize = Math.round(13 * fontScale);
  const colorFontSize = Math.round(12 * fontScale);
  const leftColWidth = settings.showImage ? (settings.imageSize === 'small' ? '36mm' : settings.imageSize === 'large' ? '62mm' : '46mm') : '0';

  const strapsHtml = settings.showStraps && effectiveStrapsLabel ? `<p style="font-size:${Math.round(11 * fontScale)}px;font-weight:700;color:#c00;margin-top:2px;">🎨 Tiras: ${escapeHtml(effectiveStrapsLabel)}</p>` : '';
  const obsHtml = settings.showObservation && observationText ? `<div style="margin-top:4px;padding:4px 6px;background:#fff8e1;border:1px solid #f0d060;border-radius:3px;font-size:${Math.round(10 * fontScale)}px;"><strong>📝 Obs:</strong> ${escapeHtml(observationText)}</div>` : '';

  const soHtml = settings.showSaleOrderInfo
    ? (isGrouped
      ? `
        <div style="margin-top:6px;font-size:${Math.round(10 * fontScale)}px;display:grid;grid-template-columns:1fr;gap:2px 12px;">
          ${groupData!.saleOrderNumbers.length > 0 ? `<div><strong>PVs:</strong> ${escapeHtml(groupData!.saleOrderNumbers.join(', '))}</div>` : ''}
          ${groupData!.clientNames.length > 0 ? `<div><strong>Cliente:</strong> ${escapeHtml(groupData!.clientNames.join(', '))}</div>` : ''}
          ${groupData!.clientOrderNumbers.length > 0 ? `<div><strong>Ped. Cliente:</strong> ${escapeHtml(groupData!.clientOrderNumbers.join(', '))}</div>` : ''}
        </div>`
      : `
        <div style="margin-top:6px;font-size:${Math.round(10 * fontScale)}px;display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;">
          ${so?.order_number ? `<div><strong>PV:</strong> ${escapeHtml(so.order_number)}</div>` : ''}
          ${so?.client_name ? `<div><strong>Cliente:</strong> ${so.client_number ? `<span style="font-weight:800;color:#1a56db;">${escapeHtml(so.client_number)}</span> — ` : ''}${escapeHtml(so.client_name)}</div>` : ''}
          ${so?.client_order_number ? `<div><strong>Ped. Cliente:</strong> ${escapeHtml(so.client_order_number)}</div>` : ''}
        </div>`)
    : '';

  const signatureHtml = settings.showSignature ? `
    <div style="margin-top:10px;padding-top:6px;border-top:1px solid #ccc;display:flex;justify-content:space-between;font-size:${Math.round(9 * fontScale)}px;color:#666;">
      <span>Operador: ________________________</span>
      <span>Data: ____/____/________</span>
      <span>Hora Início: ________ Fim: ________</span>
    </div>` : '';

  const gradeTableHtml = isGrouped
    ? buildGroupedGradeTable(groupData!.totalBySize, activeSizes, totalPairs)
    : buildDualGradeTable(singleGradeData!.baseGrade, singleGradeData!.scaledGrade, activeSizes, singleGradeData!.gradeSum, totalPairs);

  const titleText = `${sectorEmoji} ${isGrouped ? 'Ficha Agrupada de' : 'Ficha de'} ${escapeHtml(sectorName)}`;
  const opText = isGrouped ? `OPs: ${escapeHtml(groupData!.orderNumbers.join(', '))}` : `OP: ${escapeHtml(order.order_number)}`;

  return `
    <div style="border:2px solid #222;padding:6px;page-break-inside:avoid;margin:0 0 4mm 0;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #222;padding-bottom:4px;margin-bottom:4px;">
        <div>
          <h1 style="font-size:${Math.round(headerFontSize * 0.85)}px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;margin:0;">${titleText}</h1>
          <p style="font-size:${Math.round(opFontSize * 0.9)}px;font-weight:700;color:#333;margin:1px 0;">${opText}</p>
          <span style="display:inline-block;border:1px solid #222;padding:1px 6px;font-size:${Math.round(9 * fontScale)}px;font-weight:600;border-radius:3px;margin-top:1px;">
            Entrega: ${escapeHtml(deliveryDate)}
          </span>
        </div>
        <div style="display:flex;gap:8px;align-items:flex-start;">
          ${silkHtml}
          <div style="text-align:right;font-size:8px;color:#666;">
            <div style="width:44px;height:44px;border:1px solid #ccc;display:flex;align-items:center;justify-content:center;font-size:6px;color:#aaa;">${escapeHtml(order.id.substring(0, 8))}</div>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:${settings.showImage ? leftColWidth + ' ' : ''}minmax(0,1fr);gap:6px;align-items:flex-start;">
        ${settings.showImage ? `<div>
          ${imageHtml}
          <div style="margin-top:3px;">
            <p style="font-size:${Math.round(8 * fontScale)}px;font-weight:700;color:#888;text-transform:uppercase;">Modelo</p>
            <p style="font-size:${Math.round(modelFontSize * 0.9)}px;font-weight:700;line-height:1.15;">${escapeHtml(refCode)}</p>
            <p style="font-size:${Math.round(10 * fontScale)}px;color:#555;margin-top:1px;">${escapeHtml(refName)}</p>
            <p style="font-size:${Math.round(colorFontSize * 0.9)}px;font-weight:900;color:#111;margin-top:3px;background:#f0f0e0;padding:2px 6px;border-radius:3px;display:inline-block;">COR: ${escapeHtml(order.color || '—')}</p>
            ${strapsHtml}
            ${obsHtml}
          </div>
        </div>` : ''}

        <div style="min-width:0;">
          ${!settings.showImage ? `<div style="margin-bottom:4px;">
            <p style="font-size:${Math.round(modelFontSize * 0.9)}px;font-weight:700;">${escapeHtml(refCode)}</p>
            <p style="font-size:${Math.round(10 * fontScale)}px;color:#555;">${escapeHtml(refName)}</p>
            <p style="font-size:${Math.round(colorFontSize * 0.9)}px;font-weight:900;color:#111;margin-top:2px;background:#f0f0e0;padding:2px 6px;border-radius:3px;display:inline-block;">COR: ${escapeHtml(order.color || '—')}</p>
            ${strapsHtml}${obsHtml}
          </div>` : ''}
          <p style="font-size:${Math.round(9 * fontScale)}px;font-weight:700;color:#555;text-transform:uppercase;margin-bottom:1px;">Grade de Produção (Pares)</p>
          ${gradeTableHtml}
          ${soHtml}
          ${importantInfoHtml}
          ${sectorSpecific}
        </div>
      </div>

      ${signatureHtml}
    </div>`;
}

function buildSolagemGroupCard(
  soleColor: string,
  totalsBySize: Record<string, number>,
  totalPairs: number,
  orderNumbers: string[],
  activeSizes: string[],
  sectorEmoji: string,
  layoutSettings?: WorkSheetLayoutSettings,
): string {
  const settings = layoutSettings || loadWorkSheetSettings();
  const fontScale = settings.fontSize === 'small' ? 0.85 : settings.fontSize === 'large' ? 1.15 : 1;
  const headerFontSize = Math.round(20 * fontScale);
  const isPreto = (soleColor || '').toLowerCase().includes('pret') || (soleColor || '').toLowerCase().includes('black');
  const borderColor = isPreto ? '#222' : '#92400e';
  const bgColor = isPreto ? '#f5f5f5' : '#fffbeb';
  const titleColor = isPreto ? '#111' : '#92400e';

  const gradeBlock = buildMiniGradeRow(
    'GRADE TOTAL DE SOLAGEM',
    sectorEmoji,
    bgColor,
    borderColor,
    false,
    activeSizes,
    totalsBySize,
    totalPairs,
    true,
  );

  return `
    <div style="border:2px solid ${borderColor};padding:6px;page-break-inside:avoid;margin:0 0 4mm 0;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;background:${bgColor};">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid ${borderColor};padding-bottom:4px;margin-bottom:4px;">
        <div>
          <h1 style="font-size:${Math.round(headerFontSize * 0.85)}px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;margin:0;color:${titleColor};">
            ${sectorEmoji} FICHA DE SOLAGEM — ${escapeHtml(soleColor.toUpperCase())}
          </h1>
          <p style="font-size:10px;font-weight:700;color:${titleColor};margin:2px 0 0;">
            OPs: ${escapeHtml(orderNumbers.join(', '))}
          </p>
        </div>
        <span style="font-size:14px;font-weight:900;background:${borderColor};color:#fff;padding:2px 8px;border-radius:4px;">${totalPairs} PARES</span>
      </div>
      <div style="margin-top:4px;">${gradeBlock}</div>
      <div style="margin-top:10px;padding-top:6px;border-top:1px solid ${borderColor};display:flex;justify-content:space-between;font-size:9px;color:${titleColor};">
        <span>Operador: ________________________</span>
        <span>Data: ____/____/________</span>
      </div>
    </div>`;
}

async function buildSectorWorkSheetsHtml(
  options: WorkSheetOptions,
  caches?: RenderCaches,
): Promise<{ html: string; preloadLinks: string; cardCount: number }> {
  const { sectorName, sectorEmoji, orders, references, saleOrders, getStrapsLabel, getSoleColor, getSoleReference, layoutSettings } = options;
  const settings = layoutSettings || loadWorkSheetSettings();
  if (orders.length === 0) return { html: '', preloadLinks: '', cardCount: 0 };

  const localCaches: RenderCaches = caches || {
    variantImages: new Map(),
    silkUrls: new Map(),
    importantInfos: new Map(),
  };

  const imageUrls = new Set<string>();
  const refIds = [...new Set(orders.map(o => o.reference_id))];
  const colors = [...new Set(orders.map(o => o.color).filter(Boolean))];

  // Pré-carrega TODAS as variantes em uma única query e popula o cache
  if (refIds.length > 0 && colors.length > 0) {
    try {
      const { data: variants } = await supabase
        .from('reference_color_variants')
        .select('reference_id, color, image_url')
        .in('reference_id', refIds)
        .in('color', colors);
      (variants || []).forEach(v => {
        const key = `${v.reference_id}|${v.color}`;
        if (!localCaches.variantImages.has(key)) {
          localCaches.variantImages.set(key, v.image_url || '');
        }
        if (v.image_url) imageUrls.add(v.image_url);
      });
    } catch { /* ignore */ }
  }

  for (const order of orders) {
    const ref = references.find(r => r.id === order.reference_id);
    if (ref) {
      const url = (ref.images as string[] | null)?.[0] || ref.image_url || '';
      if (url) imageUrls.add(url);
    }
  }
  const preloadLinks = Array.from(imageUrls)
    .map(url => `<link rel="preload" as="image" href="${url}" crossorigin="anonymous" />`)
    .join('\n');

  const cardItems = buildWorkSheetCardItems(
    sectorName,
    orders,
    references,
    saleOrders,
    getStrapsLabel,
    getSoleColor,
    getSoleReference,
  );

  let html = '';
  if (sectorName === 'Corte') {
    const itemsBySole = new Map<string, WorkSheetCardItem[]>();
    for (const item of cardItems) {
      const sole = item.soleColor || 'Sem Solado';
      if (!itemsBySole.has(sole)) itemsBySole.set(sole, []);
      itemsBySole.get(sole)!.push(item);
    }

    const allCards: string[] = [];
    for (const [sole, items] of itemsBySole.entries()) {
      const orderCards = await Promise.all(
        items.map(item =>
          buildOrderCard(
            item.order,
            item.ref,
            sectorName,
            sectorEmoji,
            saleOrders,
            item.strapsLabel,
            item.soleColor,
            item.soleReferenceName,
            settings,
            item.groupData,
            localCaches,
          )
        )
      );
      allCards.push(...orderCards);

      const totalsBySize: Record<string, number> = {};
      let totalPairsForSole = 0;
      for (const item of items) {
        const sg = item.groupData 
          ? { scaledGrade: item.groupData.totalBySize, totalPairs: item.groupData.totalPairs, activeSizes: item.groupData.activeSizes } 
          : getScaledGrade(item.order);
        totalPairsForSole += sg.totalPairs;
        for (const s of sg.activeSizes) {
          totalsBySize[s] = (totalsBySize[s] || 0) + (sg.scaledGrade[s] || 0);
        }
      }
      const activeSizesSole = SIZES.filter(s => (totalsBySize[s] || 0) > 0);
      if (activeSizesSole.length > 0) {
        const summaryCard = await buildPalmilhaSummaryCard(sole, totalsBySize, totalPairsForSole, activeSizesSole, sectorEmoji, settings);
        allCards.push(summaryCard);
      }
    }
    html = allCards.join('');
  } else if (sectorName === 'Solagem') {
    const soleGroupMap = new Map<string, { totalsBySize: Record<string, number>; totalPairs: number; orderNumbers: string[] }>();
    for (const order of orders) {
      const ref = references.find(r => r.id === order.reference_id);
      const soleColor = getSoleColor
        ? (getSoleColor(order.color) || deriveSoleType(order.color, ref))
        : deriveSoleType(order.color, ref);
      if (!soleGroupMap.has(soleColor)) {
        soleGroupMap.set(soleColor, { totalsBySize: {}, totalPairs: 0, orderNumbers: [] });
      }
      const group = soleGroupMap.get(soleColor)!;
      group.orderNumbers.push(order.order_number);
      const { scaledGrade, totalPairs } = getScaledGrade(order);
      group.totalPairs += totalPairs;
      for (const s of SIZES) {
        const qty = scaledGrade[s] || 0;
        if (qty > 0) group.totalsBySize[s] = (group.totalsBySize[s] || 0) + qty;
      }
    }
    const soleCards: string[] = [];
    for (const [soleColor, data] of [...soleGroupMap.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))) {
      const activeSizes = SIZES.filter(s => (data.totalsBySize[s] || 0) > 0);
      if (activeSizes.length > 0) {
        soleCards.push(buildSolagemGroupCard(soleColor, data.totalsBySize, data.totalPairs, data.orderNumbers, activeSizes, sectorEmoji, settings));
      }
    }
    html = soleCards.join('');
  } else {
    const cards = await Promise.all(
      cardItems.map(item =>
        buildOrderCard(
          item.order,
          item.ref,
          sectorName,
          sectorEmoji,
          saleOrders,
          item.strapsLabel,
          item.soleColor,
          item.soleReferenceName,
          settings,
          item.groupData,
          localCaches,
        )
      )
    );
    html = cards.join('');
  }

 async function buildPalmilhaSummaryCard(
   soleColor: string,
   totalsBySize: Record<string, number>,
   totalPairs: number,
   activeSizes: string[],
   sectorEmoji: string,
   layoutSettings?: WorkSheetLayoutSettings,
 ): Promise<string> {
   const settings = layoutSettings || loadWorkSheetSettings();
   const fontScale = settings.fontSize === 'small' ? 0.85 : settings.fontSize === 'large' ? 1.15 : 1;
   const headerFontSize = Math.round(20 * fontScale);

   const palmilhaBlock = buildMiniGradeRow(
     'FICHA PALMILHA (UNIFICADA)',
     '🦶',
     '#f0fdf4',
     '#16a34a',
     false,
     activeSizes,
     totalsBySize,
     totalPairs,
     true
   );

   return `
     <div style="border:2px solid #16a34a;padding:6px;page-break-inside:avoid;margin:0 0 4mm 0;width:100%;max-width:100%;box-sizing:border-box;overflow:hidden;background:#f0fdf4;">
       <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #16a34a;padding-bottom:4px;margin-bottom:4px;">
         <div>
           <h1 style="font-size:${Math.round(headerFontSize * 0.85)}px;font-weight:900;text-transform:uppercase;letter-spacing:-0.5px;margin:0;color:#16a34a;">
             ${sectorEmoji} FICHA DE PALMILHA — ${escapeHtml(soleColor.toUpperCase())}
           </h1>
           <p style="font-size:11px;font-weight:700;color:#16a34a;margin:1px 0;">Resumo unificado por solado</p>
         </div>
         <div style="text-align:right;">
            <span style="font-size:14px;font-weight:900;background:#16a34a;color:#fff;padding:2px 8px;border-radius:4px;">${totalPairs} PARES</span>
         </div>
       </div>
       <div style="margin-top:4px;">
         ${palmilhaBlock}
       </div>
       <div style="margin-top:10px;padding-top:6px;border-top:1px solid #16a34a;display:flex;justify-content:space-between;font-size:9px;color:#16a34a;">
         <span>Operador: ________________________</span>
         <span>Data: ____/____/________</span>
       </div>
     </div>`;
 }
  return { html, preloadLinks, cardCount: cardItems.length };
}

export async function printSectorWorkSheets(options: WorkSheetOptions) {
  const { sectorName } = options;
  const { html, preloadLinks, cardCount } = await buildSectorWorkSheetsHtml(options);
  if (cardCount === 0) return;

  const wrappedHtml = `<style>@page{size:A4 portrait;margin:8mm 10mm;}body{margin:0;padding:0 !important;background:#fff;}.worksheet-stack{width:190mm;max-width:190mm;margin:0 auto;}</style><!-- preload -->${preloadLinks}<div class="worksheet-stack">${html}</div>`;

  printHtml(`Fichas ${sectorName} (${cardCount})`, wrappedHtml);
}

/**
 * Gera fichas de operador de TODOS os setores produtivos em um único documento PDF/impressão.
 * Ordem: Corte → Aviamento → Solagem → Costura → Montagem → Acabamento.
 * Cada setor inicia em nova página com cabeçalho separador.
 */
export async function printAllSectorsWorkSheets(
  baseOptions: Omit<WorkSheetOptions, 'sectorName' | 'sectorEmoji'>,
  selectedSectors?: string[],
) {
  // Ordem canônica pós PR1-PR3: prep (Palmilha‖Forração‖Aviamento) → Costura → seq.
  // "Mesa" antigo virou "Aviamento" (PR 1); removido pra não duplicar setor.
  const allSectors: Array<{ name: string; emoji: string }> = [
    { name: 'Corte Palmilha', emoji: '✂️' },
    { name: 'Corte Forração', emoji: '✂️' },
    { name: 'Aviamento', emoji: '🧷' },
    { name: 'Costura', emoji: '🧵' },
    { name: 'Silk', emoji: '🎨' },
    { name: 'Colagem', emoji: '💨' },
    { name: 'Montagem', emoji: '🔧' },
    { name: 'Solagem', emoji: '🦶' },
    { name: 'Acabamento', emoji: '✨' },
    { name: 'Expedição', emoji: '📦' },
  ];
  const sectors = selectedSectors && selectedSectors.length > 0
    ? allSectors.filter(s => selectedSectors.includes(s.name))
    : allSectors;

  if (baseOptions.orders.length === 0) return;

  // Cache compartilhado entre todos os 6 setores: evita refetch das mesmas variantes/silks
  const sharedCaches: RenderCaches = {
    variantImages: new Map(),
    silkUrls: new Map(),
    importantInfos: new Map(),
  };

  const allPreloads = new Set<string>();
  let totalCards = 0;

  // Processa os 6 setores EM PARALELO (antes era sequencial)
  const sectorResults = await Promise.all(
    sectors.map(({ name, emoji }) =>
      buildSectorWorkSheetsHtml(
        { ...baseOptions, sectorName: name, sectorEmoji: emoji },
        sharedCaches,
      ).then(result => ({ ...result, name, emoji })),
    ),
  );

  const sectorBlocks: string[] = [];
  for (const { name, emoji, html, preloadLinks, cardCount } of sectorResults) {
    if (cardCount === 0) continue;
    preloadLinks.split('\n').filter(Boolean).forEach(link => allPreloads.add(link));
    totalCards += cardCount;
    const isFirst = sectorBlocks.length === 0;
    sectorBlocks.push(
      `<div class="sector-block" style="${isFirst ? '' : 'page-break-before: always;'}">
        <div class="sector-divider" style="text-align:center;font-size:14px;font-weight:700;padding:6px 0 8px;border-bottom:2px solid #111;margin-bottom:8px;color:#111;letter-spacing:0.5px;">
          ${emoji} ${name.toUpperCase()} — ${cardCount} ficha(s)
        </div>
        ${html}
      </div>`
    );
  }

  if (sectorBlocks.length === 0) return;

  const wrappedHtml = `<style>
    @page{size:A4 portrait;margin:8mm 10mm;}
    body{margin:0;padding:0 !important;background:#fff;}
    .worksheet-stack{width:190mm;max-width:190mm;margin:0 auto;}
    .sector-block{break-inside:auto;}
  </style>
  <!-- preload -->${Array.from(allPreloads).join('\n')}
  <div class="worksheet-stack">${sectorBlocks.join('')}</div>`;

  printHtml(`Fichas de Operador — Todos os Setores (${totalCards})`, wrappedHtml);
}
