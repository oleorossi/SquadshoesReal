export const GROUPED_REPORT_SIZES = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

export type GroupedOrderData = {
  id: string;
  order_number: string;
  reference_id: string;
  color: string | null;
  quantity: number;
  grade: Record<string, number> | null;
  status: string;
};

export type GroupedReferenceData = {
  id: string;
  code: string;
  name: string;
  shoe_category?: string | null;
  image_url?: string | null;
  images?: unknown;
};

export type IndividualOrderGrade = {
  opNumber: string;
  sizes: Record<string, number>;
  perFichaSizes: Record<string, number>;
  pairsPerFicha: number;
  fichaCount: number;
  totalPairs: number;
};

 export interface SilkInfo {
   silk_name: string;
   silk_url: string | null;
 }
 
 export type GroupedReportItem = {
   groupKey: string;
   refId: string;
   refCode: string;
   refName: string;
   color: string;
   imageUrl: string;
   sizes: Record<string, number>;
   totalPairs: number;
   opNumbers: string[];
   category: string;
   strapsLabel?: string;
   individualGrades: IndividualOrderGrade[];
   /** Base grade for 1 ficha (raw grade from the first OP) */
   baseGrade: Record<string, number>;
   baseGradeSum: number;
   soleType: string;
   silk?: SilkInfo;
 };

export type GroupedReportCategory = {
  category: string;
  items: GroupedReportItem[];
  totalPairs: number;
  sizeTotals: Record<string, number>;
};

export type GroupedReportSummaryData = {
  items: GroupedReportItem[];
  categories: GroupedReportCategory[];
  allActiveSizes: string[];
  grandTotalPairs: number;
  grandTotalOps: number;
  grandSizeTotals: Record<string, number>;
};

function classifyCategory(shoeCategory: string | undefined | null): string {
  const cat = (shoeCategory || '').toLowerCase().trim();
  if (cat.includes('infantil') || cat.includes('kids') || cat.includes('criança') || cat.includes('bebe') || cat.includes('bebê')) return 'Infantil';
  if (cat.includes('adulto') || cat.includes('adult') || cat.includes('feminino') || cat.includes('masculino')) return 'Adulto';
  if (cat) return cat.charAt(0).toUpperCase() + cat.slice(1);
  return 'Sem Categoria';
}

function deriveSoleType(color: string): string {
  const c = (color || '').toLowerCase().normalize('NFC').trim();
  if (c.includes('pret') || c.includes('black') || c === 'pb') return 'Solado Preto';
  return 'Solado Caramelo';
}

function getReferenceImage(reference?: GroupedReferenceData): string {
  if (!reference) return '';

  const images = Array.isArray(reference.images) ? reference.images : [];
  const firstImage = images[0];

  if (typeof firstImage === 'string') return firstImage;
  if (firstImage && typeof firstImage === 'object' && 'url' in firstImage && typeof (firstImage as { url?: unknown }).url === 'string') {
    return (firstImage as { url: string }).url;
  }

  return reference.image_url || '';
}

function sortCategories(a: string, b: string) {
  if (a === 'Adulto') return -1;
  if (b === 'Adulto') return 1;
  if (a === 'Infantil') return -1;
  if (b === 'Infantil') return 1;
  return a.localeCompare(b, 'pt-BR');
}

const getBaseName = (name: string) => name.replace(/\s*-\s*(Preto|Caramelo|Branco|Nude|Vermelho|Azul|Rosa|Verde|Cinza|Ouro|Prata)$/i, '').trim();


function normalizeGroupPart(value: string): string {
  return value.trim().toUpperCase().normalize('NFC');
}

 export function buildGroupedReportSummary(
   selectedOrders: GroupedOrderData[],
   references: GroupedReferenceData[],
   getStrapsLabel?: (order: GroupedOrderData) => string,
   extra?: {
     silkRegistrations?: any[];
     saleOrders?: any[];
     soleMappings?: any[];
   },
   sectorKey?: string,
 ): GroupedReportSummaryData {
   const referenceMap = new Map(references.map((reference) => [reference.id, reference]));
   const groupMap = new Map<string, GroupedReportItem>();
   const silkRegistrations = extra?.silkRegistrations || [];
   const saleOrders = extra?.saleOrders || [];
   const soleMappings = extra?.soleMappings || [];

  for (const order of selectedOrders) {
    const reference = referenceMap.get(order.reference_id);
    if (!reference) continue;

    const grade = order.grade;
    const gradeSum = grade ? Object.values(grade).reduce((sum, value) => sum + Number(value || 0), 0) : 0;
    const totalPairs = Number(order.quantity) || gradeSum || 0;
    const multiplier = gradeSum > 0 ? totalPairs / gradeSum : 0;
    const fichaCount = gradeSum > 0 ? totalPairs / gradeSum : 0;
    const color = (order.color || '—').trim();
    const category = classifyCategory(reference.shoe_category);
    const colorKey = normalizeGroupPart(color);
    const strapsLabel = getStrapsLabel
      ? (() => {
          try {
            return getStrapsLabel(order) || '';
          } catch {
            return '';
          }
        })()
      : '';
    const strapsKey = normalizeGroupPart(strapsLabel || '__NO_STRAPS__');
     const soleMapping = soleMappings.find(m => m.sheet_id === order.reference_id && m.product_color === order.color);
     const soleProductId = soleMapping?.sole_product_id;
     const soleProductName = (soleMapping as any)?.products?.name;
 
     const saleOrder = saleOrders.find(so => so.id === (order as any).sale_order_id);
     const clientId = saleOrder?.client_id;
     const economicGroupId = saleOrder?.economic_group_id;
 
     // Find effective silk
     let effectiveSilk: SilkInfo | undefined;
     if (soleProductId || soleProductName) {
       const baseSoleName = soleProductName ? getBaseName(soleProductName) : null;

       // cat = specific category to match; null = only uncategorized registrations
       const findSilk = (cId?: string | null, gId?: string | null, cat?: string | null) => {
         return silkRegistrations.find(s => {
           const matchesContext = cId ? s.client_id === cId : (gId ? s.economic_group_id === gId : !s.client_id && !s.economic_group_id);
           const matchesProduct = (soleProductId && s.sole_product_id === soleProductId) ||
                                (baseSoleName && s.sole_type && getBaseName(s.sole_type) === baseSoleName);
           const matchesCat = cat !== undefined
             ? (cat ? (s as any).shoe_category === cat : !(s as any).shoe_category)
             : true;
           return matchesProduct && matchesContext && matchesCat;
         });
       };

       // Priority 1: category-specific (adulto/infantil) lookup
       effectiveSilk = findSilk(clientId, null, category);
       if (!effectiveSilk && economicGroupId) effectiveSilk = findSilk(null, economicGroupId, category);
       if (!effectiveSilk) effectiveSilk = findSilk(null, null, category);
       // Priority 2: uncategorized fallback (backwards compatible with existing registrations)
       if (!effectiveSilk && clientId) effectiveSilk = findSilk(clientId, null, null);
       if (!effectiveSilk && economicGroupId) effectiveSilk = findSilk(null, economicGroupId, null);
       if (!effectiveSilk) effectiveSilk = findSilk(null, null, null);
     }
 
     const soleType = deriveSoleType(color);
     const soleKey = normalizeGroupPart(soleType);
     const silkKey = normalizeGroupPart(effectiveSilk?.silk_name || 'NO_SILK');

     // Sector-aware grouping key
     let key: string;
     if (sectorKey === 'solagem') {
       // Solagem: group only by sole type — collapse all refs/colors into one row per solado
       key = soleKey;
     } else {
       key = `${soleKey}|${category}|${order.reference_id}|${colorKey}|${strapsKey}|${silkKey}`;
     }

    if (!groupMap.has(key)) {
      const rawGrade: Record<string, number> = {};
      if (grade) {
        for (const size of GROUPED_REPORT_SIZES) {
          const qty = Number((grade as Record<string, number>)[size]) || 0;
          if (qty > 0) rawGrade[size] = qty;
        }
      }
      const rawSum = Object.values(rawGrade).reduce((s, v) => s + v, 0);

      const isSolagemGroup = sectorKey === 'solagem';
      groupMap.set(key, {
        groupKey: key,
        refId: order.reference_id,
        refCode: isSolagemGroup ? '' : (reference.code || ''),
        refName: isSolagemGroup ? soleType : (reference.name || ''),
        color: isSolagemGroup ? soleType : color,
        imageUrl: isSolagemGroup ? '' : getReferenceImage(reference),
        sizes: {},
        totalPairs: 0,
        opNumbers: [],
        category: isSolagemGroup ? 'Solado' : category,
        strapsLabel: strapsLabel || undefined,
        individualGrades: [],
        baseGrade: rawGrade,
         baseGradeSum: rawSum,
         soleType,
         silk: effectiveSilk ? { silk_name: effectiveSilk.silk_name, silk_url: effectiveSilk.silk_url } : undefined,
       });
     }

    const group = groupMap.get(key)!;
    group.opNumbers.push(order.order_number);
    group.totalPairs += totalPairs;
    if (!group.strapsLabel && strapsLabel) {
      group.strapsLabel = strapsLabel;
    }

    const individualSizes: Record<string, number> = {};
    const perFichaSizes: Record<string, number> = {};
    if (grade) {
      for (const size of GROUPED_REPORT_SIZES) {
        const qty = Number(grade[size]) || 0;
        if (qty > 0) {
          const scaled = Math.round(qty * multiplier);
          group.sizes[size] = (group.sizes[size] || 0) + scaled;
          individualSizes[size] = scaled;
          perFichaSizes[size] = qty;
        }
      }
    }

    group.individualGrades.push({
      opNumber: order.order_number,
      sizes: individualSizes,
      perFichaSizes,
      pairsPerFicha: gradeSum,
      fichaCount,
      totalPairs,
    });
  }

  const items = Array.from(groupMap.values()).sort((a, b) => {
    const bySole = a.soleType.localeCompare(b.soleType, 'pt-BR');
    if (bySole !== 0) return bySole;
    const byCategory = sortCategories(a.category, b.category);
    if (byCategory !== 0) return byCategory;
    const byReference = `${a.refCode} ${a.refName}`.localeCompare(`${b.refCode} ${b.refName}`, 'pt-BR');
    if (byReference !== 0) return byReference;
    return a.color.localeCompare(b.color, 'pt-BR');
  });

  const allActiveSizes = GROUPED_REPORT_SIZES.filter((size) => items.some((item) => (item.sizes[size] || 0) > 0));
  const categoryMap = new Map<string, GroupedReportItem[]>();

  items.forEach((item) => {
    const currentItems = categoryMap.get(item.category) || [];
    currentItems.push(item);
    categoryMap.set(item.category, currentItems);
  });

  const categories = Array.from(categoryMap.entries())
    .sort(([categoryA], [categoryB]) => sortCategories(categoryA, categoryB))
    .map(([category, categoryItems]) => {
      const sizeTotals = Object.fromEntries(allActiveSizes.map((size) => [size, 0]));

      categoryItems.forEach((item) => {
        allActiveSizes.forEach((size) => {
          sizeTotals[size] = (sizeTotals[size] || 0) + (item.sizes[size] || 0);
        });
      });

      return {
        category,
        items: categoryItems,
        totalPairs: categoryItems.reduce((sum, item) => sum + item.totalPairs, 0),
        sizeTotals,
      };
    });

  const grandSizeTotals = Object.fromEntries(allActiveSizes.map((size) => [size, 0]));
  items.forEach((item) => {
    allActiveSizes.forEach((size) => {
      grandSizeTotals[size] = (grandSizeTotals[size] || 0) + (item.sizes[size] || 0);
    });
  });

  return {
    items,
    categories,
    allActiveSizes,
    grandTotalPairs: items.reduce((sum, item) => sum + item.totalPairs, 0),
    grandTotalOps: selectedOrders.length,
    grandSizeTotals,
  };
}
