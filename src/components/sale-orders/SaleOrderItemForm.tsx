import { useState, useEffect, useMemo, useRef, memo } from 'react';
import { Link } from 'react-router-dom';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trash as Trash2, Lock, CaretUpDown as ChevronsUpDown, Check, Package, ArrowSquareOut as ExternalLink, Palette, Plus, X, ChatText as MessageSquare, Warning, ArrowsClockwise as RefreshCw, Tag, CurrencyDollar, Wrench } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { ReferenceLink } from '@/components/ui/reference-link';
import { cn } from '@/lib/utils';
import { resolvePrice, type PriceLookup } from '@/lib/mobile/clientContext';
import { resolveSaleOrderItemPrice, type SaleOrderPriceResolution } from '@/lib/saleOrderPricing';
import {
  SaleOrderItemFormData,
  isProductionExcludedSaleOrderItem,
} from '@/hooks/useSaleOrders';
import { useAccessControl } from '@/hooks/useAccessControl';
// StockAvailabilityBadge removido do form — checagem só no save
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import StrapCatalogResolutionDrawer, {
  type StrapCatalogResolutionLine,
} from './StrapCatalogResolutionDrawer';
import { ProductFormDialog } from '@/components/inventory/ProductFormDialog';
import { useAddProduct, ProductSchema } from '@/hooks/useProducts';
import { useAddComponentSheet } from '@/hooks/useComponentSheets';
import type { ProductFormData } from '@/types/inventory';
import { toast } from 'sonner';
import { type ReferenceMaterialVariant, type VariantSummary } from '@/hooks/useReferenceMaterialVariants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { normalizeForSearch, searchMatchesAllTerms } from '@/lib/searchUtils';
import {
  getStrapSourcingSelection,
  getStrapSourcingOverride,
  isCompleteStrapSourcingSelection,
  normalizeStrapColorKey,
  setStrapSourcing,
  strapSourcingKey,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';
import { useStrapStockLines } from '@/hooks/useStrapStockLines';
import { useInternalStrapReadiness } from '@/hooks/useInternalStrapReadiness';
import {
  useArtisanalStrapCatalog,
  useArtisanalStrapCatalogDiagnostics,
} from '@/hooks/useArtisanalStraps';
import { ArtisanalStrapEditor } from '@/components/artisanal-straps/ArtisanalStrapEditor';
import { listBuyReadyStrapGaps, type BuyReadyStrapGap } from '@/lib/buyReadyStrapGap';
import {
  isUuid,
  technicalStrapLineId,
} from '@/lib/technicalStrapLines';
import { strapColorsForIdentity } from '@/lib/officialStrapColors';
import {
  isPurchasedReadyStrap,
  strapIdentityBasis,
  type StrapIdentityBasis,
} from '@/lib/strapIdentity';
import {
  activeProductColorsForGroup,
  hasVariantComponentPin,
  resolveMaterialVariantColorGroup,
  resolveSheetCommercialColorGroup,
} from '@/lib/materialVariantColorGroup';
import { SearchInput } from '@/components/ui/search-input';
import { ItemSectorOutsourcingSection } from '@/components/sale-orders/ItemSectorOutsourcingSection';
import { SignedImage } from '@/components/ui/signed-image';
import { resolveReferenceThumbnailUrl } from '@/lib/referenceImage';

interface ReferenceOption {
  id: string;
  code: string;
  name: string;
  colors?: string | null;
  sale_price?: number;
  sizes?: string | null;
  shoe_category?: string | null;
  images?: unknown;
  image_url?: string | null;
  ncm?: string | null;
  suggested_price?: number | null;
  packaging_box_dimensions?: string | null;
  status_ficha?: string | null;
  status?: string | null;
  retired_at?: string | null;
  has_straps?: boolean | null;
  strap_colors?: any[] | null;
  updated_at?: string | null;
}

interface SaleOrderStrapResolutionLine extends StrapCatalogResolutionLine {
  identity_basis?: StrapIdentityBasis | null;
  identity_group_id?: string | null;
}

type SaleOrderItemStrap = NonNullable<SaleOrderItemFormData['strap_colors']>[number];
type SaleOrderStrapPresentationLine = SaleOrderStrapResolutionLine & SaleOrderItemStrap;

interface Props {
  item: SaleOrderItemFormData;
  index: number;
  references: ReferenceOption[];
  canRemove: boolean;
  isAdmin: boolean;
  onUpdate: (idx: number, field: string, value: any) => void;
  onRemove: (idx: number) => void;
  onCopyGradeFromPrevious?: (idx: number) => void;
  onSaveStateAndNavigate?: () => void;
  /** Bulk select (20/05/2026): checkbox no header pra marcar pra edição em lote. */
  isSelected?: boolean;
  onToggleSelect?: (idx: number) => void;
  /** Tabela de preço do cliente (price_list_items) — auto-aplica preço por ref/cor. */
  priceLookup?: PriceLookup;
  /** Desconto máximo permitido (clients.max_discount_pct) — avisa quando furar. */
  maxDiscountPct?: number;
  /** Mapa compartilhado pelo formulário inteiro. Evita uma assinatura/query de
   *  variantes por item em PVs longos. */
  variantsByRef?: ReadonlyMap<string, readonly ReferenceMaterialVariant[]>;
  /** Reporta ao pai se este item tem cor não cadastrada (cabedal/forração/tira),
   *  pra BLOQUEAR o salvamento do PV até cadastrar. null = sem pendência. */
  onColorIssueChange?: (index: number, info: { color: string; materials: string[]; message?: string } | null) => void;
  /** Reporta se o material da própria ficha está oferecido no seletor deste
   *  item. Quem sabe disso é o item (resolve grupo da ficha × grupo efetivo de
   *  cada variante); o painel precisa saber pra não barrar o salvamento
   *  chamando de "sem escolha" o que é a escolha "material da ficha". */
  onSheetMaterialSelectableChange?: (index: number, selectable: boolean) => void;
  /** Contexto do cronograma usado pelo preview canônico das tiras. */
  saleOrderId?: string | null;
  /** Status canônico do PV. Aprovado/Em Produção congelam o snapshot operacional. */
  saleOrderStatus?: string | null;
  billingWeek?: string | null;
  requiredAt?: string | null;
}

function parseSizeRange(sizes?: string | null, shoeCategory?: string | null): number[] {
  if (shoeCategory === 'Infantil' && (!sizes || sizes === '33-41' || sizes === '34-40')) {
    return Array.from({ length: 13 }, (_, i) => 21 + i);
  }
  if (sizes && sizes.includes('-')) {
    const [start, end] = sizes.split('-').map(Number);
    if (!isNaN(start) && !isNaN(end) && start <= end) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }
  return [34, 35, 36, 37, 38, 39, 40];
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const EMPTY_VARIANTS_BY_REF = new Map<string, readonly ReferenceMaterialVariant[]>();
const EMPTY_STRAP_SOURCING_MAP = Object.freeze({}) as StrapSourcingMap;

// Sentinela do seletor de material: Radix nao aceita SelectItem com value "",
// e nulo no item significa "material da propria ficha", que agora e escolha
// legitima e nao mais ausencia de escolha.
const SHEET_MATERIAL_OPTION = '__ficha__';

function SaleOrderItemFormInner({ item, index, references, canRemove, isAdmin, onUpdate, onRemove, onCopyGradeFromPrevious, onSaveStateAndNavigate, isSelected, onToggleSelect, priceLookup, maxDiscountPct = 0, variantsByRef = EMPTY_VARIANTS_BY_REF, onColorIssueChange, onSheetMaterialSelectableChange, saleOrderId, saleOrderStatus, billingWeek, requiredAt }: Props) {
  const qc = useQueryClient();
  const { canSeeFinancialValues } = useAccessControl();
  const productionExcluded = isProductionExcludedSaleOrderItem(item);
  const { data: strapCatalog, isLoading: strapCatalogLoading } = useArtisanalStrapCatalog(false);
  const fichas = item.fichas || 1;
  const setFichas = (v: number) => onUpdate(index, 'fichas', v);

  // editColorsDialog removido — variante de cor não é mais editada no PV.
  const [strapResolutionOpen, setStrapResolutionOpen] = useState(false);
  // Cadastro comercial da tira COMPRADA PRONTA, aberto a partir da linha exata
  // que trava o salvamento. Não relaxa a regra do servidor (o PV segue exigindo
  // variante ativa); só evita que o operador tenha de caçar a pendência no hub.
  const [buyReadyGapTarget, setBuyReadyGapTarget] = useState<BuyReadyStrapGap | null>(null);

  // Cadastro da COR PRINCIPAL (forração/cabedal) via a MESMA tela do Estoque
  // (ProductFormDialog), aberta como modal aqui no PV. Só o caminho da cor
  // principal usa isto. As tiras artesanais são materializadas automaticamente
  // pela intenção do PV; não abrem cadastro manual de produto neste formulário.
  const addProductMut = useAddProduct();
  const addComponentSheetMut = useAddComponentSheet();
  const [colorProductDialogOpen, setColorProductDialogOpen] = useState(false);
  const [colorProductGroupId, setColorProductGroupId] = useState<string | null>(null);
  const [colorProductColor, setColorProductColor] = useState('');

  // onSubmit do ProductFormDialog: insere o produto igual ao Estoque
  // (MaterialsTab.handleAdd) — valida, cria, cria ficha de componente quando o
  // grupo é auto_component_sheet, revalida o pool de cores e seleciona a cor nova.
  const handleCreateColorProduct = async (data: ProductFormData, createSheet?: boolean) => {
    const validated = ProductSchema.parse(data);
    const result = await addProductMut.mutateAsync(validated as any);
    const grp = (productGroups as any[]).find(g => g.id === data.group_id);
    if ((createSheet || grp?.auto_component_sheet) && result?.id) {
      try {
        await addComponentSheetMut.mutateAsync({
          product_id: result.id,
          dimensions_length: data.dimensions_length || 0,
          dimensions_width: data.dimensions_width || 0,
          dimensions_thickness: data.dimensions_thickness || 0,
          dimensions_unit: data.dimensions_unit || 'mm',
          yield_per_size: {},
          notes: '',
        });
      } catch (err) {
        console.error('Erro ao criar ficha de componente automática:', err);
      }
    }
    // Revalida os caches que alimentam as opções de cor do item.
    qc.invalidateQueries({ queryKey: ['products_for_colors'] });
    qc.invalidateQueries({ queryKey: ['group_supplier_materials_for_colors'] });
    qc.invalidateQueries({ queryKey: ['product_groups_colors'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    // Seleciona a cor recém-criada no item (o form não edita cor → é a semeada).
    const createdColor = (data.color || colorProductColor || '').trim();
    if (createdColor) onUpdate(index, 'color', createdColor);
  };
  const prevRefId = useRef(item.reference_id);
  const isFirstRender = useRef(true);
  // Tracks the last reference_id for which strap structure was synced. Prevents
  // re-running the sync whenever the query cache refreshes strap_colors for the
  // same reference (which would restore straps the user intentionally removed).
  const strapSyncedForRef = useRef<string>('');
  // Um item comprometido (Aprovado/Em Produção) pode ter demanda/reserva
  // congelada por identidade legada. A primeira hidratação nunca reescreve esse
  // snapshot; rascunhos continuam corrigíveis pelo fluxo normal.
  const preservedCommittedStrapItemId = useRef<string | null>(null);
  const previousStrapMaterialVariantRef = useRef({
    initialized: false,
    value: null as string | null,
  });
  const previousStrapMainColorRef = useRef({
    itemId: item.id || null,
    initialized: false,
    value: '',
    pendingChange: false,
  });
  // Latest-ref pattern: avoids stale closures when items are reordered (sortedIndices
  // in the parent shifts `index` between renders) without triggering effect re-runs.
  const latestRef = useRef({ index, onUpdate });
  latestRef.current = { index, onUpdate };

  const grade = item.grade as Record<string, number>;
  const selectedRef = references.find(r => r.id === item.reference_id);
  const referenceStrapDefinitions = useMemo(
    () => Array.isArray(selectedRef?.strap_colors)
      ? selectedRef.strap_colors as SaleOrderStrapResolutionLine[]
      : [],
    [selectedRef?.strap_colors],
  );
  const preserveCommittedStrapSnapshot = !!item.id
    && (saleOrderStatus === 'Aprovado' || saleOrderStatus === 'Em Produção');
  const strapPresentationDefinitions = useMemo(() => {
    const snapshots = Array.isArray(item.strap_colors)
      ? item.strap_colors as SaleOrderStrapPresentationLine[]
      : [];
    if (referenceStrapDefinitions.length === 0) return snapshots;

    // Somente apresentação/preview: a ficha publicada fornece identidade e
    // medida; cor e demais escolhas históricas continuam vindo do item. UUID
    // canônico nunca casa por ordinal com outro UUID — o fallback ordinal vale
    // exclusivamente para snapshots legados sem identidade estável.
    return snapshots.map((snapshot, ordinal) => {
      const snapshotLineId = technicalStrapLineId(snapshot);
      const exactReference = snapshotLineId
        ? referenceStrapDefinitions.find(
          (reference) => technicalStrapLineId(reference) === snapshotLineId,
        )
        : null;
      const ordinalReference = referenceStrapDefinitions[ordinal];
      const reference = exactReference
        || (!snapshotLineId ? ordinalReference : null);
      if (!reference) return snapshot;

      const referenceLineId = technicalStrapLineId(reference);
      return {
        ...snapshot,
        id: referenceLineId || snapshot.id,
        technical_strap_line_id: referenceLineId || snapshot.technical_strap_line_id,
        label: reference.label || snapshot.label,
        strap_type_id: reference.strap_type_id || null,
        measure_id: reference.measure_id || null,
        identity_basis: strapIdentityBasis(reference),
        identity_group_id: reference.identity_group_id || null,
        internal_production_enabled: reference.internal_production_enabled ?? null,
        group_id: reference.group_id || null,
        group_name: reference.group_name || null,
        consumption: (reference as SaleOrderItemStrap).consumption ?? snapshot.consumption,
        consumption_per_size: (reference as SaleOrderItemStrap).consumption_per_size
          ?? snapshot.consumption_per_size,
        // Escolhas do PV nunca vêm da ficha.
        color: snapshot.color,
        color_id: snapshot.color_id || null,
      } as SaleOrderStrapPresentationLine;
    });
  }, [item.strap_colors, referenceStrapDefinitions]);

  const gradeTotal = Object.values(grade).reduce((s, v) => s + (v || 0), 0);
  const totalPairs = gradeTotal * fichas;
  const itemTotal = totalPairs * (item.unit_price || 0);
  const pdv = selectedRef?.suggested_price || selectedRef?.sale_price || 0;

  const { data: sheetSpecs } = useQuery({
    queryKey: ['sheet_specs_for_colors', item.reference_id],
    enabled: !!item.reference_id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('technical_sheets')
        // variant_drives_*: quais componentes seguem o MATERIAL PRINCIPAL da
        // variante (mig 20261027120000). Sem eles a tela não consegue espelhar a
        // cascata do motor e ofereceria as cores do grupo errado.
        .select('upper_material, upper_material_group_id, lining_material, insole_material, lining_accessories, components_accessories, sole_group_id, sole_material, has_straps, variant_drives_upper, variant_drives_lining')
        .eq('id', item.reference_id!)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const { data: soleSizeRange } = useQuery({
    queryKey: ['sole_size_range_specific', sheetSpecs?.sole_group_id, sheetSpecs?.sole_material],
    enabled: !!sheetSpecs?.sole_group_id,
    queryFn: async () => {
      // Prioriza a VARIANTE específica configurada na ficha (sole_material).
      // Também retorna a classificação (tipo) do solado matched pro form
      // poder mostrar o badge contextual.
      const { data } = await supabase
        .from('products')
        .select('name, stock_grade, sole_classification')
        .eq('group_id', sheetSpecs!.sole_group_id!)
        .eq('category', 'Solado')
        .eq('active', true)
        .not('stock_grade', 'is', null);
      if (!data || data.length === 0) return null;

      const aggregate = (rows: typeof data): { sizeFrom: number; sizeTo: number; classification?: string } | null => {
        let minFrom: number | null = null;
        let maxTo: number | null = null;
        for (const row of rows) {
          const g = (row as any).stock_grade as Record<string, any> | null;
          if (!g) continue;
          const sf = g._size_from != null ? Number(g._size_from) : null;
          const st = g._size_to != null ? Number(g._size_to) : null;
          if (sf != null) minFrom = minFrom == null ? sf : Math.min(minFrom, sf);
          if (st != null) maxTo = maxTo == null ? st : Math.max(maxTo, st);
        }
        if (minFrom == null || maxTo == null || minFrom > maxTo) return null;
        return { sizeFrom: minFrom, sizeTo: maxTo };
      };

      const soleMat = (sheetSpecs?.sole_material || '').trim().toLowerCase();
      if (soleMat) {
        const matched = (data as any[]).filter(p => {
          const n = (p.name || '').toLowerCase().trim();
          if (!n) return false;
          if (n === soleMat) return true;
          for (const sep of [' ', '-', '/', '_']) {
            if (n.startsWith(soleMat + sep)) return true;
            if (soleMat.startsWith(n + sep)) return true;
          }
          return false;
        });
        const specificRange = aggregate(matched as typeof data);
        if (specificRange) {
          // Pega a classificação da primeira variante matched
          specificRange.classification = (matched[0] as any)?.sole_classification || 'tradicional';
          return specificRange;
        }
      }

      const fallback = aggregate(data);
      if (fallback) {
        fallback.classification = (data[0] as any)?.sole_classification || 'tradicional';
      }
      return fallback;
    },
    staleTime: 5 * 60_000,
  });

  const { data: soleConjugations = [] } = useQuery({
    queryKey: ['sole_size_conjugations', sheetSpecs?.sole_group_id],
    enabled: !!sheetSpecs?.sole_group_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('sole_size_conjugations')
        .select('size_key, sizes, display_order')
        .eq('sole_group_id', sheetSpecs!.sole_group_id!)
        .order('display_order');
      return (data || []) as Array<{ size_key: string; sizes: number[]; display_order: number }>;
    },
    staleTime: 5 * 60_000,
  });

  // Grade size list — RANGE vem do SOLADO (fonte da verdade física).
  //
  // Decisão (2026-05): o solado define quais tamanhos podem ser produzidos.
  // Ficha técnica e PV refletem isso. Trigger no DB sincroniza ficha.sizes
  // automaticamente quando sole_group_id muda. Aqui usamos:
  //   1. soleSizeRange (stock_grade._size_from/_to)
  //   2. fallback: conjugações
  //   3. último fallback: ficha.sizes (caso solado não tenha range cadastrado)
  const SIZES = useMemo((): string[] => {
    let sf: number | null = soleSizeRange?.sizeFrom ?? null;
    let st: number | null = soleSizeRange?.sizeTo ?? null;

    if ((sf == null || st == null) && soleConjugations.length > 0) {
      const allSizes = soleConjugations.flatMap(c => c.sizes);
      if (allSizes.length > 0) {
        sf = sf ?? Math.min(...allSizes);
        st = st ?? Math.max(...allSizes);
      }
    }

    let baseSizes: string[];
    if (sf != null && st != null && sf <= st) {
      if (soleConjugations.length > 0) {
        const result: string[] = [];
        const added = new Set<string>();
        for (let s = sf; s <= st; s++) {
          const conj = soleConjugations.find(c => c.sizes.includes(s));
          if (conj) {
            if (!added.has(conj.size_key)) { result.push(conj.size_key); added.add(conj.size_key); }
          } else {
            result.push(String(s));
          }
        }
        baseSizes = result;
      } else {
        baseSizes = Array.from({ length: st - sf + 1 }, (_, i) => String(sf! + i));
      }
    } else {
      baseSizes = parseSizeRange(selectedRef?.sizes, selectedRef?.shoe_category).map(String);
    }

    // Audit visual #15 (CRÍTICO): preservar tamanhos do grade original que
    // estão FORA do range atual do solado. Antes esses pares ficavam invisíveis
    // no editor — ao salvar com matriz "vazia", o usuário sobrescrevia e perdia
    // a distribuição original. Agora mesclamos: range atual primeiro, depois
    // tamanhos órfãos (do grade salvo) ordenados numericamente.
    const gradeKeys = Object.keys(grade || {}).filter(
      k => Number(grade[k]) > 0 && !baseSizes.includes(k),
    );
    if (gradeKeys.length === 0) return baseSizes;

    // Tamanhos órfãos: ordena pelo número inicial (suporta "33/34")
    const orphanSorted = gradeKeys.sort((a, b) => {
      const na = Number(a.split('/')[0]) || 0;
      const nb = Number(b.split('/')[0]) || 0;
      return na - nb;
    });

    // Merge inteligente: insere os órfãos na ordem numérica correta entre baseSizes
    const merged: string[] = [];
    const allKeys = [...baseSizes, ...orphanSorted];
    const seen = new Set<string>();
    for (const k of allKeys.sort((a, b) => {
      const na = Number(a.split('/')[0]) || 0;
      const nb = Number(b.split('/')[0]) || 0;
      return na - nb;
    })) {
      if (!seen.has(k)) { merged.push(k); seen.add(k); }
    }
    return merged;
  }, [soleSizeRange, soleConjugations, selectedRef?.sizes, selectedRef?.shoe_category, grade]);

  // Set de keys que vêm do grade salvo mas NÃO fazem parte do range atual do
  // SOLADO. Pode acontecer se o solado teve seu range alterado depois do PV
  // ser criado — preservamos visualmente pra não perder a distribuição original.
  const orphanSizes = useMemo(() => {
    let sf = soleSizeRange?.sizeFrom;
    let st = soleSizeRange?.sizeTo;
    if ((sf == null || st == null) && soleConjugations.length > 0) {
      const allSizes = soleConjugations.flatMap(c => c.sizes);
      if (allSizes.length > 0) {
        sf = sf ?? Math.min(...allSizes);
        st = st ?? Math.max(...allSizes);
      }
    }
    if (sf == null || st == null) return new Set<string>();
    const baseRangeKeys = new Set<string>();
    if (soleConjugations.length > 0) {
      for (let s = sf; s <= st; s++) {
        const conj = soleConjugations.find(c => c.sizes.includes(s));
        if (conj) baseRangeKeys.add(conj.size_key);
        else baseRangeKeys.add(String(s));
      }
    } else {
      for (let s = sf; s <= st; s++) baseRangeKeys.add(String(s));
    }
    return new Set(
      Object.keys(grade || {}).filter(k => Number(grade[k]) > 0 && !baseRangeKeys.has(k)),
    );
  }, [soleSizeRange, soleConjugations, grade]);

  // colorVariants removido — variante de cor sai do escopo da ficha técnica.
  // As cores disponíveis vêm dos produtos ativos dos grupos efetivos. O campo
  // legado `available_colors` não governa novos itens.

  const activeMaterialVariants = variantsByRef.get(item.reference_id || '') ?? [];
  const selectedMaterialVariant = activeMaterialVariants.find(v => v.id === item.material_variant_id);

  const { data: allProducts = [] } = useQuery({
    queryKey: ['products_for_colors'],
    queryFn: async () => {
      // Inclui inativos de propósito: os ponteiros *_material_product_id das
      // variantes resolvem grupo via find por id — se o produto apontado for
      // desativado, o filtro active aqui mataria TODAS as cores do grupo em
      // silêncio. A enumeração de CORES filtra p.active === false caso a caso.
      const { data } = await supabase.from('products').select('id, name, color, group_id, category, active');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  const { data: productGroups = [] } = useQuery({
    queryKey: ['product_groups_colors'],
    queryFn: async () => {
      const { data } = await supabase.from('product_groups').select('id, name, colors, is_color_agnostic');
      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  // Resolve o group_id da cor principal do item — usado pra cadastrar a cor
  // do material no ProductFormDialog. Prioriza a variante explicitamente
  // selecionada; sem variante, resolve UMA família canônica da ficha. Retorna
  // null quando não consegue identificar a família (UI
  // esconde o botão "+ Cadastrar" nesse caso).
  const mainGroupForNewColor = useMemo<{ id: string; name: string } | null>(() => {
    if (item.material_variant_id) {
      const variant = activeMaterialVariants.find(v => v.id === item.material_variant_id);
      // A variante selecionada governa um único componente: cabedal primeiro;
      // quando ele não foi delegado/preenchido, forração. Retornar null aqui é
      // intencional — cair no pool legado ofereceria cores de outro componente.
      return resolveMaterialVariantColorGroup({
        variant,
        sheet: sheetSpecs,
        products: allProducts,
        groups: productGroups,
      });
    }
    return resolveSheetCommercialColorGroup({
      sheet: sheetSpecs,
      groups: productGroups,
    });
  }, [item.material_variant_id, activeMaterialVariants, allProducts, sheetSpecs, productGroups]);

  // Família do material da PRÓPRIA ficha, sempre — independente de haver
  // variante selecionada. Regra do dono (21/08/2026): cadastrar variante NÃO
  // substitui o material principal da ficha, apenas acrescenta uma opção no PV.
  // Sem isto o material da ficha não tem como ser representado no seletor.
  const sheetBaseGroup = useMemo(
    () => resolveSheetCommercialColorGroup({ sheet: sheetSpecs, groups: productGroups }),
    [sheetSpecs, productGroups],
  );

  // A família da ficha já é vendável por alguma variante? Compara o grupo
  // EFETIVO de cada variante (mesma resolução do resolver estrutural), não o
  // nome — variante chamada "NAPA SOFT" pode apontar outra família.
  const baseCoveredByVariant = useMemo(() => {
    if (!sheetBaseGroup) return false;
    return activeMaterialVariants.some(v => {
      const grp = resolveMaterialVariantColorGroup({
        variant: v, sheet: sheetSpecs, products: allProducts, groups: productGroups,
      });
      return grp?.id === sheetBaseGroup.id;
    });
  }, [activeMaterialVariants, sheetBaseGroup, sheetSpecs, allProducts, productGroups]);

  // ── Cor não cadastrada (BLOQUEIA salvar o PV) ────────────────────────────
  // Materiais de área (cabedal/forração) cuja cor principal NÃO tem produto no
  // grupo (gerido por cor) → débito PULA (vira ruptura). Carrega o group_id pra
  // cadastrar inline. Fonte única do aviso amarelo + do report ao pai.
  //
  // VARIANT-AWARE (2026-07): com variante de material no item, o gate valida os
  // grupos que a variante REALMENTE resolve (grupo da variante > grupo da ficha)
  // — antes validava sempre o grupo da ficha, deixando passar cor inexistente no
  // grupo trocado pela variante (e vice-versa). Componente com produto PINADO na
  // variante (legado) fica fora: o débito baixa aquele produto exato, a cor do
  // item não participa da resolução. Palmilha NÃO entra no gate bloqueante: a
  // cor dela pode vir de mapeamento (technical_sheet_palmilha_colors), que este
  // form não carrega — checar a cor do item direto geraria bloqueio falso.
  const coverColorIssues = useMemo<{ name: string; groupId: string }[]>(() => {
    const color = (item.color || '').trim().toLowerCase();
    if (!color) return [];
    const sel = item.material_variant_id
      ? activeMaterialVariants.find(v => v.id === item.material_variant_id)
      : undefined;
    type ColorTarget = { name?: string; groupId?: string };
    // Espelha a precedência dos resolvers SQL: pin de produto legado > grupo do
    // slot > MATERIAL PRINCIPAL da variante (só nos slots que a ficha liberou) >
    // grupo da ficha. Sem o material principal aqui, variante criada só com ele
    // caía no grupo da FICHA e a tela avisava a cor errada.
    const resolveTarget = (
      pinProductId: string | null | undefined,
      variantGroupId: string | null | undefined,
      drivenByMain: boolean,
      sheetName: string | null | undefined,
    ): ColorTarget | null => {
      if (pinProductId) return null; // pin legado: produto fixo, sem resolução por cor
      if (variantGroupId) return { groupId: variantGroupId };
      if (drivenByMain && sel?.main_material_group_id) return { groupId: sel.main_material_group_id };
      const nm = (sheetName || '').trim();
      return nm ? { name: nm } : null;
    };
    const targets = [
      resolveTarget(sel?.upper_material_product_id, sel?.upper_material_group_id,
        !!(sheetSpecs as any)?.variant_drives_upper, sheetSpecs?.upper_material),
      resolveTarget(sel?.lining_material_product_id, sel?.lining_material_group_id,
        !!(sheetSpecs as any)?.variant_drives_lining, sheetSpecs?.lining_material),
    ].filter(Boolean) as ColorTarget[];
    const out: { name: string; groupId: string }[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
      const grp = t.groupId
        ? (productGroups as any[]).find((g: any) => g.id === t.groupId)
        : (productGroups as any[]).find((g: any) => (g.name || '').trim().toLowerCase() === String(t.name).toLowerCase());
      if (!grp || seen.has(grp.id)) continue;
      seen.add(grp.id);
      if (grp.is_color_agnostic) continue; // material base (EVA/cola): cor não se aplica
      const groupProds = (allProducts as any[]).filter((p: any) => p.group_id === grp.id && p.active !== false);
      const colorManaged = groupProds.some((p: any) => (p.color || '').trim() !== '');
      if (!colorManaged) continue; // grupo sem cores = genérico → débito ok
      const hasColor = groupProds.some((p: any) => (p.color || '').trim().toLowerCase() === color);
      if (!hasColor) out.push({ name: grp.name || String(t.name || ''), groupId: grp.id });
    }
    return out;
  }, [item.color, item.material_variant_id, activeMaterialVariants, sheetSpecs, productGroups, allProducts]);

  // MUTEX tiras × cabedal (TechnicalSheets: habilitar tiras limpa o cabedal): um
  // modelo é OU de tiras OU de cabedal, nunca os dois. Ficha COM cabedal NÃO é
  // modelo de tiras — strap_colors presente aí é órfão (ex.: DS21, cabedal "TIRA",
  // has_straps=false) e é ignorado no PV. Modelos de tira reais têm cabedal vazio,
  // então não são afetados.
  const modelHasCabedal = !!String(sheetSpecs?.upper_material || '').trim();

  // Snapshot de atendimento por UUID da linha técnica. Nas tiras artesanais a
  // origem interna é derivada da intenção do PV; em grupo acabado permanece fixa
  // em buy_ready. O mapa completo continua preservado ao editar pedidos antigos.
  // Não materialize variante/catálogo aqui: abandonar o rascunho deixaria órfãos.
  // Essa escrita pertence exclusivamente ao writer atômico do salvamento.
  const strapSourcingMap = item.strap_sourcing || EMPTY_STRAP_SOURCING_MAP;
  const latestStrapSourcingMapRef = useRef(strapSourcingMap);
  latestStrapSourcingMapRef.current = strapSourcingMap;
  const { data: strapLines = [], isLoading: strapLinesLoading } = useStrapStockLines(
    {
      saleOrderId,
      saleOrderItemId: item.id || null,
      referenceId: item.reference_id,
      materialVariantId: item.material_variant_id,
      itemColor: item.color,
      // A projeção pode usar a estrutura atual da ficha para explicar o
      // cadastro, sem reescrever o snapshot persistido do item.
      strapColors: strapPresentationDefinitions,
      strapSourcing: strapSourcingMap,
      quantity: item.quantity,
      grade: item.grade,
      billingWeek,
      requiredAt,
    },
    !modelHasCabedal,
  );
  const strapLineByKey = useMemo(
    () => new Map(strapLines.map((l) => [l.key, l])),
    [strapLines],
  );
  // A linha `reference_base` sem `strap_sourcing` (todo item novo) nunca chega a
  // `blocked` no bloco de Origem abaixo — `effective` é null —, então o cadastro
  // faltando da napa-base só aparecia como texto cru do Postgres DEPOIS de o PV
  // inteiro ser montado. Esta consulta espelha o writer do save, em leitura.
  const { data: internalStrapReadiness } = useInternalStrapReadiness(
    {
      referenceId: item.reference_id,
      materialVariantId: item.material_variant_id,
      color: item.color,
    },
    !modelHasCabedal,
  );
  const canonicalStrapColorByKey = useMemo(() => {
    const candidates = new Map<string, Set<string>>();
    const add = (label: string | null | undefined, colorId: string) => {
      const key = normalizeStrapColorKey(label);
      if (!key) return;
      const ids = candidates.get(key) || new Set<string>();
      ids.add(colorId);
      candidates.set(key, ids);
    };
    (strapCatalog?.colors || [])
      .filter((color) => color.active)
      .forEach((color) => add(color.name, color.id));
    (strapCatalog?.aliases || [])
      .filter((alias) => alias.status === 'approved')
      .forEach((alias) => add(alias.alias, alias.canonical_color_id));

    const unique = new Map<string, { id: string; name: string }>();
    candidates.forEach((ids, key) => {
      if (ids.size !== 1) return;
      const id = Array.from(ids)[0];
      const color = strapCatalog?.colors.find((entry) => entry.id === id && entry.active);
      if (color) unique.set(key, color);
    });
    return unique;
  }, [strapCatalog?.aliases, strapCatalog?.colors]);
  const canonicalMainStrapColor = canonicalStrapColorByKey.get(
    normalizeStrapColorKey(item.color),
  );
  const strapStructuralContext = useMemo(() => {
    if (modelHasCabedal) {
      return {
        hasIssue: false,
        issueCount: 0,
        suggestedBaseGroupId: null as string | null,
        requiresReferenceBase: false,
        hasPurchasedReady: false,
      };
    }
    // A ficha publicada é a autoridade estrutural. O snapshot do item conserva
    // somente escolhas comerciais (como cor) e pode ser legado/incompleto.
    const straps = referenceStrapDefinitions;
    let issueCount = 0;
    const resolvedBaseGroups = new Set<string>();
    let requiresReferenceBase = false;
    let hasPurchasedReady = false;
    straps.forEach((strap) => {
      const lineId = technicalStrapLineId(strap);
      const resolvedLine = lineId ? strapLineByKey.get(lineId) : undefined;
      const resolvedBaseGroupId = resolvedLine?.baseGroupId;
      const identityBasis = strapIdentityBasis(strap);
      const usesReferenceBase = identityBasis === 'reference_base';
      const usesFinishedGroup = identityBasis === 'finished_product_group';
      requiresReferenceBase ||= usesReferenceBase;
      hasPurchasedReady ||= usesFinishedGroup;
      const identityGroupResolved = usesFinishedGroup
        ? isUuid(strap.identity_group_id)
        : isUuid(resolvedBaseGroupId);
      const canonicalMeasure = isUuid(strap.measure_id)
        ? strapCatalog?.measures.find((entry) => entry.id === strap.measure_id && entry.active !== false)
        : null;
      const measureResolved = isUuid(strap.strap_type_id)
        && !!canonicalMeasure
        && canonicalMeasure.strap_type_id === strap.strap_type_id;
      const canonicalIdsMissing = !isUuid(strap.measure_id) || !isUuid(strap.strap_type_id);
      if (!usesFinishedGroup && isUuid(resolvedBaseGroupId)) {
        resolvedBaseGroups.add(resolvedBaseGroupId);
      }
      // Enquanto o preview carrega, só a ausência já conhecida da medida abre
      // a pendência; isso evita piscar o CTA em fichas canônicas.
      if (canonicalIdsMissing
          || (!strapCatalogLoading && !measureResolved)
          || (!strapLinesLoading && !identityGroupResolved)) issueCount += 1;
    });
    return {
      hasIssue: issueCount > 0,
      issueCount,
      suggestedBaseGroupId: resolvedBaseGroups.size === 1
        ? Array.from(resolvedBaseGroups)[0]
        : null,
      requiresReferenceBase,
      hasPurchasedReady,
    };
  }, [
    modelHasCabedal,
    referenceStrapDefinitions,
    strapCatalog?.measures,
    strapCatalogLoading,
    strapLineByKey,
    strapLinesLoading,
  ]);

  // Tira comprada pronta sem variante comercial ativa: o servidor recusa o
  // salvamento inteiro do PV com "Tira comprada pronta nao possui variante
  // comercial ativa exata". Só as linhas por grupo acabado (STRASS) exigem esse
  // cadastro — as demais tiras seguem sendo materializadas automaticamente.
  const hasPurchasedReadyStrapLine = useMemo(
    () => ((item.strap_colors as SaleOrderStrapResolutionLine[]) || [])
      .some((strap) => strapIdentityBasis(strap) === 'finished_product_group'),
    [item.strap_colors],
  );
  const { data: strapCatalogDiagnostics } = useArtisanalStrapCatalogDiagnostics(
    hasPurchasedReadyStrapLine && !!strapCatalog?.capabilities.manage_strap_catalog,
  );
  const buyReadyStrapGaps = useMemo(
    () => listBuyReadyStrapGaps(
      (item.strap_colors as SaleOrderStrapResolutionLine[]) || [],
      strapCatalog,
      strapCatalogDiagnostics,
    ),
    [item.strap_colors, strapCatalog, strapCatalogDiagnostics],
  );
  const buyReadyGapByLineId = useMemo(
    () => new Map(buyReadyStrapGaps.map((gap) => [gap.lineId, gap] as const)),
    [buyReadyStrapGaps],
  );

  // A linha técnica por grupo acabado não oferece uma decisão de origem: assim
  // que cor e variante canônicas resolvem, congela buy_ready no snapshot do PV.
  useEffect(() => {
    // Origem histórica comprometida só muda no writer após edição explícita;
    // hidratar a tela não pode criar demanda/reserva nova.
    if (preserveCommittedStrapSnapshot) return;
    const fixed = (item.strap_colors || [])
      .filter((strap) => isPurchasedReadyStrap(strap));
    if (fixed.length === 0) return;
    let next = strapSourcingMap;
    let changed = false;
    fixed.forEach((strap) => {
      const lineId = technicalStrapLineId(strap);
      const line = lineId ? strapLineByKey.get(lineId) : undefined;
      const colorId = line?.colorId || strap.color_id || null;
      if (!lineId || !line?.strapVariantId || !colorId || !line.canBuyReady) return;
      const candidate = {
        source_mode: 'buy_ready' as const,
        color_id: colorId,
        strap_variant_id: line.strapVariantId,
        recipe_id: null,
        gross_required_m: line.strapRequiredM,
        required_at: line.requiredAt,
        main_production_start: line.mainProductionStart,
        schedule_revision: line.scheduleRevision,
      };
      const current = next[lineId];
      if (current && Object.entries(candidate).every(
        ([key, value]) => (current as Record<string, unknown>)[key] === value,
      )) return;
      next = setStrapSourcing(next, lineId, candidate);
      changed = true;
    });
    if (changed) latestRef.current.onUpdate(latestRef.current.index, 'strap_sourcing', next);
  }, [item.strap_colors, preserveCommittedStrapSnapshot, strapLineByKey, strapSourcingMap]);

  const availableColors: string[] = useMemo(() => {
    // Variante selecionada: a cor vem EXCLUSIVAMENTE do grupo efetivo que o
    // resolver estrutural escolheu. `available_colors` é legado/auditoria.
    if (item.material_variant_id) {
      const effectiveGroupId = mainGroupForNewColor?.id;
      return effectiveGroupId
        ? activeProductColorsForGroup(allProducts, effectiveGroupId)
        : [];
    }

    // Sem variante selecionada, a cor vem de UMA família exata da ficha — a
    // própria. A união antiga misturava NAPA SUDANI/NAPA SOFT/GLOW METALIC e
    // deixava salvar OURO LIGHT como cor da napa errada; resolver UMA família
    // não tem esse problema.
    //
    // ⚠ Aqui havia `if (activeMaterialVariants.length > 0) return [];`. Com ele,
    // cadastrar UMA variante apagava o material da ficha das opções — e como o
    // efeito era mudo (lista vazia, não erro), 27 das 30 referências com
    // variante contornaram cadastrando uma variante que DUPLICA o material da
    // própria ficha. As 3 que não contornaram (DS19, DS21, SR02) ficaram sem
    // conseguir vender no material base.
    // Quando a familia da ficha JA e vendavel por uma variante (as 27 que
    // fizeram o contorno), continuar exigindo a escolha: deixar salvar sem
    // variante entregaria o mesmo material sem o SKU/NCM que a variante carrega,
    // e as duas opcoes sao indistinguiveis na tela. A mudanca de comportamento
    // fica restrita as referencias em que o material da ficha nao tem variante
    // nenhuma cobrindo — DS19, DS21 e SR02 na medicao de 21/08/2026.
    if (baseCoveredByVariant) return [];
    if (mainGroupForNewColor?.id) {
      return activeProductColorsForGroup(allProducts, mainGroupForNewColor.id);
    }

    // Último fallback apenas para fichas antigas sem identidade de material.
    // Não infere família pela cor; mantém somente a lista comercial da própria
    // referência até o cadastro ser regularizado.
    return (selectedRef?.colors || '')
      .split(',')
      .map((color) => color.trim().toUpperCase())
      .filter(Boolean)
      .filter((color, position, colors) => colors.indexOf(color) === position)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [item.material_variant_id, mainGroupForNewColor, baseCoveredByVariant, selectedRef?.colors, allProducts]);

  // Cor da VARIAÇÃO do material (cabedal): products.color do produto apontado
  // por upper_material_product_id da variante selecionada. É o "nome da variação
  // de cor" que deve aparecer no item do PV, na NF-e e na etiqueta (pedido user
  // 21/06/2026). Ex.: variante "NAPA SOFT" → produto NAPA SOFT MARROM → "MARROM".
  // Normaliza UPPER pra casar com products.color (trigger normalize_product_color).
  const variantCabedalColor = useMemo(() => {
    if (!item.material_variant_id) return '';
    const v = activeMaterialVariants.find(x => x.id === item.material_variant_id);
    if (!v?.upper_material_product_id) return '';
    const prod = allProducts.find((p) => p.id === v.upper_material_product_id);
    return (prod?.color || '').trim().toUpperCase();
  }, [item.material_variant_id, activeMaterialVariants, allProducts]);

  // "Tem tiras habilitadas": modelo com tiras na ficha OU tiras já no item.
  // A cor principal identifica o cabedal; as linhas artesanais reference_base
  // seguem essa cor, enquanto grupos acabados continuam independentes.
  const hasStrapsEffective = useMemo(() => {
    if (modelHasCabedal) return false; // cabedal presente → não é modelo de tiras (MUTEX)
    const itemStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
    const refStrapDefs = referenceStrapDefinitions;
    return itemStraps.length > 0 || !!selectedRef?.has_straps || refStrapDefs.length > 0;
  }, [item.strap_colors, modelHasCabedal, referenceStrapDefinitions, selectedRef?.has_straps]);
  const strapSnapshotMissing = hasStrapsEffective
    && (!Array.isArray(item.strap_colors) || item.strap_colors.length === 0);
  const hasReferenceBaseStraps = strapPresentationDefinitions.some(
    (strap) => strapIdentityBasis(strap) === 'reference_base',
  );
  const strapCanonicalMainMissing = hasReferenceBaseStraps
    && !!item.color?.trim()
    && !!strapCatalog
    && !strapCatalogLoading
    && !canonicalMainStrapColor;
  const hasColorIssue = coverColorIssues.length > 0
    || strapSnapshotMissing
    || strapCanonicalMainMissing;
  const colorIssueKey = hasColorIssue
    ? `${item.color}|${coverColorIssues.map(i => i.name).join(',')}|${strapSnapshotMissing}|${strapCanonicalMainMissing}`
    : '';

  // Reporta a pendência ao pai (chave estável evita churn) + limpa no unmount.
  useEffect(() => {
    onColorIssueChange?.(index, hasColorIssue
      ? {
        color: item.color || '',
        materials: [
          ...coverColorIssues.map(i => i.name),
          ...(strapSnapshotMissing ? ['ficha técnica sem linhas de tira'] : []),
          ...(strapCanonicalMainMissing ? ['identidade canônica da cor das tiras'] : []),
        ],
        message: strapSnapshotMissing
          ? 'Esta referência exige tiras, mas o item não possui snapshot das linhas técnicas. Abra a ficha técnica, cadastre as tiras e volte ao pedido; nenhuma cor ou variante será inferida.'
          : strapCanonicalMainMissing
            ? 'A cor do cabedal não corresponde a uma cor canônica ou alias aprovado. Corrija essa identidade no estoque antes de salvar.'
            : undefined,
      }
      : null);
  }, [colorIssueKey, index]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onColorIssueChange?.(index, null), []); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetMaterialSelectable = !!sheetBaseGroup && !baseCoveredByVariant;
  useEffect(() => {
    onSheetMaterialSelectableChange?.(index, sheetMaterialSelectable);
  }, [index, sheetMaterialSelectable, onSheetMaterialSelectableChange]);
  // Remover o item tem que limpar o report, senão o índice liberado por ele
  // ficaria valendo pro item que assumir a posição.
  useEffect(() => () => onSheetMaterialSelectableChange?.(index, false), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Limpa strap_colors órfão quando o modelo é de CABEDAL (MUTEX tiras×cabedal).
  // Cobre a corrida do sheetSpecs (query async separada do selectedRef) e PVs já
  // salvos com tira órfã: com item.strap_colors vazio, a seção "Cores das Tiras"
  // não renderiza (gate por strap_colors.length), o guard de save não bloqueia e
  // o item não grava tira fantasma no débito.
  useEffect(() => {
    if (modelHasCabedal && Array.isArray(item.strap_colors) && item.strap_colors.length > 0) {
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'strap_colors', []);
    }
  }, [modelHasCabedal, item.strap_colors]);

  const automaticPriceResolution = useMemo(() => resolveSaleOrderItemPrice({
    lookup: priceLookup,
    referenceId: selectedRef?.id,
    color: item.color,
    quantity: item.quantity,
    variantPrice: selectedMaterialVariant?.unit_price_override,
    sheetPrice: selectedRef?.sale_price,
  }), [
    priceLookup,
    selectedRef?.id,
    selectedRef?.sale_price,
    item.color,
    item.quantity,
    selectedMaterialVariant?.unit_price_override,
  ]);

  // Guarda o último preço realmente aplicado pelo motor. Se o valor atual
  // deixar de coincidir, a edição é manual e mudanças de cor/quantidade não a
  // sobrescrevem. A origem continua rastreável na própria linha do pedido.
  const lastAppliedAutoPrice = useRef<{
    referenceId: string;
    price: number;
    resolution: SaleOrderPriceResolution;
  } | null>(null);
  const manualPriceEdited = useRef(false);

  useEffect(() => {
    const currentStraps = Array.isArray(item.strap_colors) ? (item.strap_colors as any[]) : [];
    const { index: idx, onUpdate: update } = latestRef.current;

    // Strap sync: only run once per reference change. If the same reference's
    // strap_colors refresh in the query cache, skip — otherwise a cache update
    // would silently restore straps the user deliberately removed.
    const refIdForStraps = selectedRef?.id ?? item.reference_id ?? '';
    // BUG ANTIGO 2026-05-12: exigíamos selectedRef.has_straps=true. Mas
    // várias fichas técnicas existem com strap_colors configuradas (TIRA 1,
    // 2…) e has_straps=false (estado inconsistente vindo do save da ficha).
    // Resultado: PV nunca populava as tiras → section "Cores das Tiras"
    // ficava invisível mesmo após cor principal escolhida (SP117/SP119).
    // FIX: derivar — se a ficha tem strap_colors.length>0, considera que
    // tem tiras (independente do flag has_straps).
    const refStrapDefs = Array.isArray(selectedRef?.strap_colors) ? selectedRef!.strap_colors : [];
    const refHasStrapsEffective = (!!selectedRef?.has_straps || refStrapDefs.length > 0) && !modelHasCabedal;
    if (preserveCommittedStrapSnapshot
        && item.id
        && preservedCommittedStrapItemId.current !== item.id) {
      preservedCommittedStrapItemId.current = item.id;
      strapSyncedForRef.current = refIdForStraps;
      return;
    }
    if (strapSyncedForRef.current !== refIdForStraps) {
      strapSyncedForRef.current = refIdForStraps;

      if (refHasStrapsEffective && refStrapDefs.length > 0 && currentStraps.length === 0) {
        const straps = refStrapDefs.map((s: any) => {
          const lineId = technicalStrapLineId(s);
          return {
            id: lineId || s.id || null,
            technical_strap_line_id: lineId,
            label: s.label || 'TIRA',
            color: '',
            strap_type_id: s.strap_type_id || null,
            measure_id: s.measure_id || null,
            identity_basis: s.identity_basis || 'reference_base',
            identity_group_id: s.identity_group_id || null,
            internal_production_enabled: s.internal_production_enabled ?? null,
            group_id: s.group_id || '',
            group_name: s.group_name || '',
            consumption: s.consumption || 0,
            consumption_per_size: s.consumption_per_size || {},
          };
        });
        update(idx, 'strap_colors', straps);
      } else if (refHasStrapsEffective && refStrapDefs.length > 0 && currentStraps.length > 0) {
        // Sync structure with current reference definition (straps added/removed in sheet)
        // but preserve colors the user already selected. Snapshots legados sem
        // UUID casam somente por ordinal; não geramos UUID local que a ficha não
        // possua, pois ele seria persistido sem uma identidade server-side.
        const refStrapIds = new Set(
          refStrapDefs.map((strap) => technicalStrapLineId(strap)).filter(Boolean),
        );
        const updatedStraps = refStrapDefs.map((refStrap: any, ordinal: number) => {
          const lineId = technicalStrapLineId(refStrap);
          const existingByLineId = lineId
            ? currentStraps.find((strap) => technicalStrapLineId(strap) === lineId)
            : null;
          const ordinalLegacy = currentStraps[ordinal];
          const existing = existingByLineId
            || (!technicalStrapLineId(ordinalLegacy) ? ordinalLegacy : null);
          return {
            id: lineId || refStrap.id || null,
            technical_strap_line_id: lineId,
            label: refStrap.label || 'TIRA',
            color: existing?.color || '',
            color_id: isUuid(existing?.color_id) ? existing.color_id : null,
            strap_type_id: refStrap.strap_type_id || null,
            measure_id: refStrap.measure_id || null,
            identity_basis: refStrap.identity_basis || 'reference_base',
            identity_group_id: refStrap.identity_group_id || null,
            internal_production_enabled: refStrap.internal_production_enabled ?? null,
            group_id: refStrap.group_id || '',
            group_name: refStrap.group_name || '',
            consumption: refStrap.consumption || 0,
            consumption_per_size: refStrap.consumption_per_size || {},
          };
        });
        // Re-propaga também quando o MATERIAL da tira mudou na ficha (mesma id,
        // mas trocou group/consumo/label) — antes só repropagava mudança de
        // ESTRUTURA (qtd/ids), então editar o material da tira na ficha (ex.:
        // 11mm→8mm) nunca chegava nos PVs já criados. A cor é sempre preservada
        // (o PV só escolhe cor; o material vem da ficha).
        const materialChanged = updatedStraps.some((u: any, ordinal: number) => {
          const lineId = technicalStrapLineId(u);
          const existingByLineId = lineId
            ? currentStraps.find((strap) => technicalStrapLineId(strap) === lineId)
            : null;
          const ordinalLegacy = currentStraps[ordinal];
          const c = existingByLineId
            || (!technicalStrapLineId(ordinalLegacy) ? ordinalLegacy : null);
          if (!c) return true;
          return (c.group_id || '') !== (u.group_id || '')
            || (c.group_name || '') !== (u.group_name || '')
            || (c.identity_basis || 'reference_base') !== (u.identity_basis || 'reference_base')
            || (c.identity_group_id || '') !== (u.identity_group_id || '')
            || (c.internal_production_enabled ?? null) !== (u.internal_production_enabled ?? null)
            || (c.label || '') !== (u.label || '')
            || Number(c.consumption || 0) !== Number(u.consumption || 0)
            || JSON.stringify(c.consumption_per_size || {}) !== JSON.stringify(u.consumption_per_size || {});
        });
        if (updatedStraps.length !== currentStraps.length
            || !currentStraps.every((s) => {
              const lineId = technicalStrapLineId(s);
              return !lineId || refStrapIds.has(lineId);
            })
            || materialChanged) {
          update(idx, 'strap_colors', updatedStraps);
          let nextSourcing = latestStrapSourcingMapRef.current;
          let sourcingChanged = false;
          currentStraps.forEach((current, ordinal) => {
            const lineId = technicalStrapLineId(current);
            const updatedByLineId = lineId
              ? updatedStraps.find((strap) => technicalStrapLineId(strap) === lineId)
              : null;
            const updated = updatedByLineId || (!lineId ? updatedStraps[ordinal] : null);
            const identityChanged = !updated
              || current.strap_type_id !== updated.strap_type_id
              || current.measure_id !== updated.measure_id
              || strapIdentityBasis(current) !== strapIdentityBasis(updated)
              || current.identity_group_id !== updated.identity_group_id
              || current.internal_production_enabled !== updated.internal_production_enabled
              || current.group_id !== updated.group_id;
            if (!identityChanged || !getStrapSourcingSelection(nextSourcing, lineId)) return;
            nextSourcing = setStrapSourcing(nextSourcing, lineId, null);
            sourcingChanged = true;
          });
          if (sourcingChanged) update(idx, 'strap_sourcing', nextSourcing);
        }
      }
    }
  }, [
    item.id,
    item.reference_id,
    item.strap_colors,
    modelHasCabedal,
    preserveCommittedStrapSnapshot,
    referenceStrapDefinitions,
    selectedRef,
  ]);

  // Recalcula toda a cadeia comercial quando muda referência, material, cor,
  // quantidade/faixa ou tabela do cliente. Só substitui campo vazio ou o último
  // valor que o próprio motor aplicou; preço digitado pelo usuário é preservado.
  useEffect(() => {
    if (!selectedRef) return;
    const current = Number(item.unit_price) || 0;
    const previousAuto = lastAppliedAutoPrice.current;
    const currentIsPreviousAuto = !!previousAuto
      && Math.abs(current - previousAuto.price) < 0.005;

    if (current > 0 && !currentIsPreviousAuto) return;
    if (automaticPriceResolution.price <= 0) {
      if (currentIsPreviousAuto) lastAppliedAutoPrice.current = null;
      return;
    }

    lastAppliedAutoPrice.current = {
      referenceId: selectedRef.id,
      price: automaticPriceResolution.price,
      resolution: automaticPriceResolution,
    };
    manualPriceEdited.current = false;
    if (Math.abs(current - automaticPriceResolution.price) >= 0.005) {
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'unit_price', automaticPriceResolution.price);
    }
  }, [selectedRef?.id, automaticPriceResolution, item.unit_price]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevRefId.current = item.reference_id;
      return;
    }
    const refChanged = prevRefId.current !== item.reference_id && prevRefId.current !== '';
    if (refChanged) {
      const { index: idx, onUpdate: update } = latestRef.current;
      // Referência é identidade do produto: preço da referência anterior nunca
      // pode atravessar a troca, mesmo para admin. O motor reaplica a nova fonte
      // no render seguinte; se ela não existir, o guard deixa o item pendente.
      lastAppliedAutoPrice.current = null;
      manualPriceEdited.current = false;
      update(idx, 'unit_price', 0);
      update(idx, 'grade', {});
      update(idx, 'color', '');
      update(idx, 'strap_colors', []);
      update(idx, 'strap_sourcing', {});
      update(idx, 'material_variant_id', null);
      // A configuração externa pertence à ficha anterior. Preservá-la na
      // troca de referência poderia mandar a nova OP para um prestador/setor
      // que o usuário nunca escolheu para este produto.
      update(idx, 'selected_terceirizacao_ids', []);
      update(idx, 'terceirizacao_quantities', {});
      update(idx, 'outsourced_sectors', {});
      // A limpeza acima vence o update do efeito de sincronização neste render;
      // libere a próxima passagem para materializar a estrutura da nova ficha.
      strapSyncedForRef.current = '';
    }
    prevRefId.current = item.reference_id;
  }, [item.reference_id]);

  // ⚠ Aqui havia auto-selecao da variante quando existia exatamente UMA. Com o
  // material da ficha valendo como opcao, auto-selecionar a unica variante
  // escolhia por conta propria o material do item e tornava o material base
  // inalcancavel — era o sintoma relatado na SR02 (uma variante, GLOW METALIC:
  // "so aparece a selecao para o material Glow Metallic"). Nao ha nada a
  // auto-escolher: nulo ja significa "material da ficha".

  // Trocar o material do cabedal invalida somente a identidade das tiras que
  // dependem dele. A primeira hidratação preserva o fato histórico completo;
  // mudanças posteriores deixam o writer do save congelar a nova variante.
  useEffect(() => {
    const current = item.material_variant_id || null;
    const previous = previousStrapMaterialVariantRef.current;
    if (!previous.initialized) {
      previousStrapMaterialVariantRef.current = { initialized: true, value: current };
      return;
    }
    if (previous.value === current) return;
    previousStrapMaterialVariantRef.current = { initialized: true, value: current };

    let next = strapSourcingMap;
    let changed = false;
    ((item.strap_colors as SaleOrderItemStrap[]) || []).forEach((strap) => {
      if (strapIdentityBasis(strap) !== 'reference_base') return;
      const lineId = technicalStrapLineId(strap);
      if (!getStrapSourcingSelection(next, lineId)) return;
      next = setStrapSourcing(next, lineId, null);
      changed = true;
    });
    if (changed) latestRef.current.onUpdate(latestRef.current.index, 'strap_sourcing', next);
  }, [item.material_variant_id, item.strap_colors, strapSourcingMap]);

  // Linhas reference_base sempre seguem a cor do cabedal. A identidade canônica
  // é reaproveitada quando o texto principal é um alias aprovado; uma origem
  // histórica completa só é removida se a intenção de cor realmente mudou.
  // Reabrir um PV cujo alias/cor saiu do catálogo não pode apagar o UUID
  // congelado nem impedir uma edição não relacionada.
  // Linhas finished_product_group ficam fora deste efeito e seguem independentes.
  useEffect(() => {
    const straps = (item.strap_colors as SaleOrderItemStrap[]) || [];
    const currentItemId = item.id || null;
    const currentColorKey = normalizeStrapColorKey(item.color);
    const observed = previousStrapMainColorRef.current;
    if (observed.itemId !== currentItemId) {
      previousStrapMainColorRef.current = {
        itemId: currentItemId,
        initialized: true,
        value: currentColorKey,
        pendingChange: false,
      };
    } else if (!observed.initialized) {
      observed.initialized = true;
      observed.value = currentColorKey;
    } else if (observed.value !== currentColorKey) {
      observed.value = currentColorKey;
      observed.pendingChange = true;
    }

    const colorObservation = previousStrapMainColorRef.current;
    if (!item.color?.trim() || straps.length === 0 || !strapCatalog || strapCatalogLoading) return;
    const mainColorChanged = colorObservation.pendingChange;
    // Abertura/refresh de PV comprometido é leitura: até snapshots legados ou
    // incompletos permanecem congelados. Rascunho continua normalizável.
    if (preserveCommittedStrapSnapshot && !mainColorChanged) {
      colorObservation.pendingChange = false;
      return;
    }

    const targetColor = canonicalMainStrapColor?.name || item.color.trim();
    const targetColorId = canonicalMainStrapColor?.id || null;
    let nextSourcing = strapSourcingMap;
    let colorsChanged = false;
    let sourcingChanged = false;
    const updated = straps.map((strap, ordinal) => {
      const presentation = strapPresentationDefinitions[ordinal] || strap;
      if (strapIdentityBasis(presentation) !== 'reference_base') return strap;
      const lineId = technicalStrapLineId(strap);
      const frozen = getStrapSourcingSelection(strapSourcingMap, lineId);
      const frozenSnapshotComplete = isCompleteStrapSourcingSelection(frozen)
        && (frozen.source_mode === 'buy_ready'
          || (isUuid(frozen.recipe_id) && isUuid(frozen.base_product_id)));
      const preserveHistoricalIdentity = preserveCommittedStrapSnapshot
        && !mainColorChanged
        && isUuid(strap.color_id)
        && frozenSnapshotComplete
        && frozen?.color_id === strap.color_id;
      if (preserveHistoricalIdentity) return strap;
      const sameIdentity = targetColorId
        ? strap.color_id === targetColorId || frozen?.color_id === targetColorId
        : normalizeStrapColorKey(strap.color) === normalizeStrapColorKey(targetColor);
      if (!sameIdentity && lineId) {
        nextSourcing = setStrapSourcing(nextSourcing, lineId, null);
        sourcingChanged = true;
      }
      if (strap.color === targetColor && (strap.color_id || null) === targetColorId) return strap;
      colorsChanged = true;
      return { ...strap, color: targetColor, color_id: targetColorId };
    });

    const { index: idx, onUpdate: update } = latestRef.current;
    if (colorsChanged) update(idx, 'strap_colors', updated);
    if (sourcingChanged) update(idx, 'strap_sourcing', nextSourcing);
    colorObservation.pendingChange = false;
  }, [
    canonicalMainStrapColor,
    item.color,
    item.id,
    item.strap_colors,
    preserveCommittedStrapSnapshot,
    strapCatalog,
    strapCatalogLoading,
    strapPresentationDefinitions,
    strapSourcingMap,
  ]);

  // Em finished_product_group, confirma automaticamente apenas uma
  // correspondência inequívoca já aprovada. Reference_base fica fora: sua
  // identidade é a cor principal e o writer atômico a materializa no save.
  useEffect(() => {
    // Não normalize silenciosamente um snapshot histórico ao apenas abrir o PV.
    if (preserveCommittedStrapSnapshot) return;
    if (!strapCatalog || strapLinesLoading) return;
    const straps = (item.strap_colors as any[]) || [];
    let changed = false;
    let nextSourcing = strapSourcingMap;
    const updated = straps.map((strap) => {
      if (strapIdentityBasis(strap) === 'reference_base') return strap;
      if (isUuid(strap.color_id)) return strap;
      const canonical = canonicalStrapColorByKey.get(normalizeStrapColorKey(strap.color));
      if (!canonical) return strap;
      const lineId = technicalStrapLineId(strap);
      const resolvedLine = lineId ? strapLineByKey.get(lineId) : undefined;
      const available = strapColorsForIdentity(
        strapCatalog,
        strap,
        resolvedLine?.baseGroupId,
      ).some((color) => color.id === canonical.id);
      if (!available) return strap;
      changed = true;
      nextSourcing = setStrapSourcing(nextSourcing, technicalStrapLineId(strap), null);
      return { ...strap, color: canonical.name, color_id: canonical.id };
    });
    if (!changed) return;
    const { index: idx, onUpdate: update } = latestRef.current;
    update(idx, 'strap_colors', updated);
    update(idx, 'strap_sourcing', nextSourcing);
  }, [
    canonicalStrapColorByKey,
    item.strap_colors,
    preserveCommittedStrapSnapshot,
    strapCatalog,
    strapLineByKey,
    strapLinesLoading,
    strapSourcingMap,
  ]);

  // Auto-preenche a Cor Principal com a cor da VARIAÇÃO do material (cabedal),
  // garantindo que PV/NF/etiqueta mostrem o nome da variação de cor (user
  // 21/06/2026). SEM tiras: sincroniza sempre (cabedal = forração = cor única) —
  // a cor fica travada na variação. COM tiras: só quando a cor está vazia, pra
  // preservar override manual (forração/tiras podem ter cor própria) e não
  // quebrar o débito da forração por cor.
  useEffect(() => {
    if (preserveCommittedStrapSnapshot && hasStrapsEffective) return;
    if (!variantCabedalColor) return;
    const current = (item.color || '').trim().toUpperCase();
    const shouldSync = hasStrapsEffective ? current === '' : current !== variantCabedalColor;
    if (shouldSync) {
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'color', variantCabedalColor);
    }
  }, [variantCabedalColor, hasStrapsEffective, item.color, preserveCommittedStrapSnapshot]);

  useEffect(() => {
    if (totalPairs !== item.quantity) {
      const { index: idx, onUpdate: update } = latestRef.current;
      update(idx, 'quantity', totalPairs);
    }
  }, [totalPairs, item.quantity]);

  const handleGradeChange = (size: string, value: number) => {
    onUpdate(index, 'grade', { ...grade, [size]: value });
  };

  const finalGrade: Record<string, number> = {};
  SIZES.forEach(s => {
    const key = s; // SIZES is already string[] (may contain "24/25" for conjugated soles)
    const val = (grade[key] || 0) * fichas;
    if (val > 0) finalGrade[key] = val;
  });

  const isInfantil = selectedRef?.shoe_category === 'Infantil';
  const appliedAutoPrice = lastAppliedAutoPrice.current;
  const priceMatchesAuto = !!appliedAutoPrice
    && appliedAutoPrice.referenceId === selectedRef?.id
    && Math.abs((Number(item.unit_price) || 0) - appliedAutoPrice.price) < 0.005;
  const priceSourceLabel = priceMatchesAuto
    ? appliedAutoPrice!.resolution.sourceLabel
    : item.unit_price > 0
      ? manualPriceEdited.current ? 'Informado manualmente' : 'Preço salvo no pedido'
      : automaticPriceResolution.sourceLabel;
  const priceIsManual = item.unit_price > 0 && !priceMatchesAuto && manualPriceEdited.current;

  return (
    <div
      className={`rounded-lg border shadow-sm overflow-hidden mb-4 transition-all hover:border-primary/30 ${isSelected ? 'bg-primary/5 border-primary/40' : 'bg-card'}`}
      aria-disabled={productionExcluded || undefined}
    >
      {/* Item header bar */}
      <div className="flex items-center justify-between bg-muted/20 px-4 py-2 border-b">
        <div className="flex items-center gap-3">
          {/* Checkbox de seleção pra bulk-edit (grade/preço/fichas em lote) */}
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={!!isSelected}
              onChange={() => onToggleSelect(index)}
              className="h-4 w-4 rounded border-input cursor-pointer"
              aria-label={`Selecionar item #${index + 1}`}
              title="Selecionar pra edição em lote"
            />
          )}
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 rounded-md border bg-muted overflow-hidden flex-shrink-0">
              {(() => {
                const imgSrc = resolveReferenceThumbnailUrl(selectedRef, 64);
                return imgSrc ? (
                  <SignedImage
                    src={imgSrc}
                    alt={selectedRef?.name || selectedRef?.code || 'Referência'}
                    width={64}
                    height={64}
                    className="h-full w-full"
                  />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-muted-foreground">
                    <Package className="h-7 w-7" />
                  </div>
                );
              })()}
            </div>
            <div className="flex flex-col text-left">
              <div className="flex items-center gap-2">
                {/* Número do item DENTRO do pedido. Pedido do dono em 20/08/2026:
                    com vários itens da mesma referência variando só cor/material,
                    "o terceiro card" era a única forma de apontar um deles — na
                    tela, no telefone e na conferência. O índice já existia no
                    componente (só o aria-label do checkbox usava). */}
                <span
                  className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[11px] font-bold tabular-nums text-foreground"
                  title={`Item ${index + 1} do pedido`}
                >
                  {index + 1}
                </span>
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Ref</span>
                {/* Código da ref → abre a ficha técnica em NOVA ABA (não perde
                    o que está sendo editado no pedido). Pedido user 09/06/2026. */}
                <ReferenceLink referenceId={selectedRef?.id} newTab title="Abrir ficha técnica (nova aba)">
                  <span className="font-mono font-bold text-sm">{selectedRef?.code || '—'}</span>
                </ReferenceLink>
                {productionExcluded && (
                  <Badge variant="outline" className="h-5 gap-1 border-warning/40 bg-warning/10 text-warning-foreground">
                    <Warning className="h-3 w-3" weight="fill" />
                    Retirado da produção
                  </Badge>
                )}
                {/* Badge NCM da ficha — fica amber quando inválido (faltando ou
                    fora do formato 8 dígitos). NF-e exige NCM válido pra emissão;
                    mostrando aqui o usuário enxerga problema antes mesmo de
                    tentar emitir. */}
                {selectedRef && (() => {
                  const ncm = (selectedRef as any).ncm as string | null | undefined;
                  const valid = ncm && /^\d{8}$/.test(ncm);
                  if (!ncm) {
                    return (
                      <Badge variant="outline" className="h-4 gap-1 text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40" title="Ficha sem NCM — NF-e será bloqueada">
                        <Warning className="h-3.5 w-3.5" /> NCM
                      </Badge>
                    );
                  }
                  if (!valid) {
                    return (
                      <Badge variant="outline" className="h-4 text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40 font-mono" title="NCM precisa de 8 dígitos">
                        NCM {ncm}
                      </Badge>
                    );
                  }
                  return (
                    <Badge variant="outline" className="h-4 text-xs font-mono opacity-60" title="NCM válido">
                      {ncm}
                    </Badge>
                  );
                })()}
              </div>
              <span className="text-xs font-medium text-foreground truncate max-w-[200px]">{selectedRef?.name || 'Selecione uma referência'}</span>
            </div>
          </div>
          {item.color && (
            <>
              <div className="h-8 w-px bg-border mx-1" />
              <Badge variant="outline" className="h-5 px-1.5 text-xs bg-primary/5 text-primary border-primary/20">
                {item.color}
              </Badge>
            </>
          )}
          {item.material_variant_id && (() => {
            const sel = activeMaterialVariants.find(v => v.id === item.material_variant_id);
            if (sel) {
              return (
                <>
                  <div className="h-8 w-px bg-border mx-1" />
                  <Badge variant="secondary" className="h-5 px-1.5 text-xs gap-1 font-normal">
                    <span className="font-medium">{sel.material_name}</span>
                    {sel.sku && <span className="font-mono text-primary opacity-70">· {sel.sku}</span>}
                  </Badge>
                </>
              );
            }
            // Variant was deactivated/removed since the item was saved.
            return (
              <>
                <div className="h-8 w-px bg-border mx-1" />
                <Badge variant="destructive" className="h-5 px-1.5 text-xs gap-1 font-normal">
                  Material inativo — NF-e será bloqueada
                </Badge>
              </>
            );
          })()}
          {/* StockAvailabilityBadge removido: a verificação de estoque/cor
              fica APENAS no save (via checkSoleAvailability +
              enrichMaterialShortages em SaleOrderForm). Antes, o badge
              rodava o RPC check_stock_availability a cada mudança de
              qtd/cor — gerava ruído visual e chamadas desnecessárias. */}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-xs text-muted-foreground uppercase font-bold leading-none">Pares</p>
            <p className="font-mono font-bold text-sm leading-tight">{totalPairs}</p>
          </div>
          {canSeeFinancialValues && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase font-bold leading-none">Subtotal</p>
              <p className="font-mono font-bold text-sm text-primary leading-tight">{formatCurrency(itemTotal)}</p>
            </div>
          )}
          {canRemove && !productionExcluded && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => onRemove(index)} aria-label="Remover item" title="Remover item">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {productionExcluded && (
        <div role="status" className="border-b border-warning/40 bg-warning/10 px-4 py-3 text-warning-foreground">
          <div className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" weight="fill" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Item preservado e bloqueado para edição</p>
              <p className="mt-0.5 text-xs leading-relaxed">
                Esta linha foi retirada da carga de produção e permanece no Pedido de Venda apenas para manter o histórico comercial.
              </p>
              <p className="mt-1 break-words text-xs font-medium">
                Motivo: {item.production_exclusion_reason || 'Exclusão administrativa registrada sem motivo informado.'}
              </p>
            </div>
          </div>
        </div>
      )}

      <fieldset
        disabled={productionExcluded}
        className="m-0 min-w-0 border-0 p-4 space-y-4 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {/* Main Selection Row
            Layout varies by whether this reference has material groups:
            • No groups:  Ref(4) | Cor(3) | Preço(2) | Fichas(1) | Grade(2) = 12
            • Com grupos: Ref(3) | Material*(3) | Cor(3) | Preço(2) | Fichas(1) = 12
              (grade copy button moves to the grade section header)
        */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Referência — narrower when material groups exist.
              Popover auto-abre quando item NÃO tem reference_id ainda
              (= item recém-criado via "+ Novo Item"). Economiza 1 clique:
              user clica "+ Novo Item" → picker aparece direto pra digitar
              a referência. Pedido user 20/05/2026. */}
          <div className={cn("md:col-span-4", activeMaterialVariants.length > 0 && "md:col-span-3")}>
            <Label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">Modelo / Referência</Label>
            <ReferencePickerControlled
              references={references}
              variantsByRef={variantsByRef}
              selectedRef={selectedRef}
              currentId={item.reference_id || ''}
              onSelect={(refId) => onUpdate(index, 'reference_id', refId)}
            />
          </div>

          {/* Material — shown BEFORE color when groups exist (fiscal SKU varies by material) */}
          {activeMaterialVariants.length > 0 && (
            <div className="md:col-span-3">
              <Label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
                Material *
              </Label>
              <div className="flex gap-1">
                <Select
                  value={item.material_variant_id || SHEET_MATERIAL_OPTION}
                  onValueChange={v => {
                    onUpdate(index, 'material_variant_id',
                      v === SHEET_MATERIAL_OPTION ? null : (v || null));
                    // Clear color — available colors may differ per material group
                    onUpdate(index, 'color', '');
                  }}
                >
                  <SelectTrigger className="h-9 text-xs flex-1">
                    <SelectValue placeholder="Selecione o material…" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* O material da PROPRIA ficha e uma opcao como as demais:
                        variante acrescenta, nao substitui (regra do dono).
                        ⚠ So aparece quando NENHUMA variante ja resolve para a
                        mesma familia. Das 30 referencias com variante, 27
                        cadastraram uma variante que repete o material da ficha
                        como contorno deste bug — e essas 27 carregam SKU
                        proprio (25 com NCM, 1 ja usada em PV). Oferecer as duas
                        criaria entradas identicas no seletor, uma delas sem o
                        SKU, e escolher a errada e invisivel na tela. */}
                    {sheetBaseGroup && !baseCoveredByVariant && (
                      <SelectItem value={SHEET_MATERIAL_OPTION}>
                        <span className="font-medium">{sheetBaseGroup.name}</span>
                        <span className="ml-1.5 text-muted-foreground">
                          {['da ficha',
                            activeProductColorsForGroup(allProducts, sheetBaseGroup.id).length > 0
                              ? `${activeProductColorsForGroup(allProducts, sheetBaseGroup.id).length} cores`
                              : ''].filter(Boolean).join(' · ')}
                        </span>
                      </SelectItem>
                    )}
                    {activeMaterialVariants.map(v => {
                      const effectiveGroup = resolveMaterialVariantColorGroup({
                        variant: v,
                        sheet: sheetSpecs,
                        products: allProducts,
                        groups: productGroups,
                      });
                      const colorCount = effectiveGroup
                        ? activeProductColorsForGroup(allProducts, effectiveGroup.id).length
                        : 0;
                      return (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="font-medium">{v.material_name}</span>
                          <span className="ml-1.5 text-muted-foreground">
                            {[v.sku, colorCount > 0 ? `${colorCount} cores` : '', Number(v.unit_price_override) > 0 ? formatCurrency(Number(v.unit_price_override)) : '']
                              .filter(Boolean).join(' · ')}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  title="Configurar variações desta referência"
                  aria-label="Configurar variações desta referência"
                  onClick={() => window.open(`/fichas-tecnicas?ref=${selectedRef?.id || ''}&tab=variants`, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              </div>
              {selectedMaterialVariant && (
                <p className="mt-1 truncate text-[11px] text-muted-foreground" title={selectedMaterialVariant.sku || undefined}>
                  {selectedMaterialVariant.sku ? `SKU ${selectedMaterialVariant.sku}` : 'Sem SKU próprio'}
                  {Number(selectedMaterialVariant.unit_price_override) > 0
                    ? ` · preço próprio ${formatCurrency(Number(selectedMaterialVariant.unit_price_override))}`
                    : ' · usa preço da tabela/ficha'}
                </p>
              )}
              {/* Variante que não resolve grupo nenhum: `variant_drives_*` da
                  ficha está desligado e a variante não tem exceção por
                  componente. O sintoma era mudo — a lista de cores vinha vazia
                  ("Nenhuma cor encontrada") e a produção seguia cortando o
                  material da ficha. Diz o motivo e leva ao lugar de resolver.

                  ⚠ `mainGroupForNewColor` sozinho NÃO prova no-op:
                  `resolveMaterialVariantColorGroup` só olha cabedal e forração,
                  então a variante que troca apenas a PLACA/EVA da palmilha
                  (`insole_material_*`) resolve de verdade em
                  `resolve_insole_material_for_variant` e cairia neste aviso
                  dizendo uma falsidade. `hasVariantComponentPin` cobre os pinos
                  de palmilha — é o mesmo helper que o guard de save usa. */}
              {selectedMaterialVariant
                && !mainGroupForNewColor
                && !hasVariantComponentPin(selectedMaterialVariant) && (
                <p className="mt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  Esta variante não substitui componente nenhum desta ficha: não há cores dela
                  para escolher e o corte/débito continua saindo do material da ficha.{' '}
                  <button
                    type="button"
                    className="underline font-medium"
                    onClick={() => window.open(`/fichas-tecnicas?ref=${selectedRef?.id || ''}&tab=variants`, '_blank', 'noopener,noreferrer')}
                  >
                    Marque os componentes que seguem a variante
                  </button>.
                </p>
              )}
            </div>
          )}

          {/* Fallback: ficha tem upper_material textual mas zero variantes
              cadastradas em reference_material_variants. Mostra read-only pro
              user saber qual cabedal vai ser usado. Débito continua via BOM
              da ficha (sheet_materials). Reportado em 20/05/2026 — user
              cadastrou Napa Santorine no campo Cabedal e estranhou não
              aparecer nada no PV. */}
          {activeMaterialVariants.length === 0 && mainGroupForNewColor && (
            <div className="md:col-span-3">
              <Label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">
                Material
              </Label>
              <div className="h-9 px-3 rounded-md border bg-muted/30 flex items-center text-xs text-muted-foreground">
                {mainGroupForNewColor.name}
                <span className="ml-auto text-xs text-muted-foreground/70 uppercase tracking-wider">
                  da ficha
                </span>
              </div>
            </div>
          )}

          {/* Cor — o material nunca fica "por escolher": nulo = material da ficha.
              O bloqueio "escolha o material primeiro" saiu junto com o estado
              que ele protegia; na SR02 ele deixava a cor sem opção alguma. */}
          {(() => {
            // Sem tiras + variante com cor de cabedal resolvida: a cor fica
            // TRAVADA na variação (read-only) — garante o nome da variação de cor
            // no PV, NF-e e etiqueta. Com tiras, mantém o seletor (forração/tiras
            // podem ter cor própria).
            const lockedToVariation = !hasStrapsEffective && !!variantCabedalColor;
            return (
          <div className="md:col-span-3">
            <Label className="text-xs font-bold uppercase mb-1 block flex items-center gap-1 text-muted-foreground">
              Cor Principal
              {lockedToVariation && (
                <span
                  className="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-xs font-bold border border-primary/20 normal-case"
                  title="Sem tiras, a cor segue a variação do material (cabedal) — vai pro PV, NF-e e etiqueta"
                >
                  variação
                </span>
              )}
            </Label>
            {lockedToVariation ? (
              <div
                className="h-9 px-3 rounded-md border bg-muted/30 flex items-center gap-2 text-xs"
                title="Cor travada na variação do material (cabedal). Sem tiras, a sandália é de cor única — esta cor vai pro PV, NF-e e etiqueta."
              >
                <Palette className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <span className="font-semibold text-foreground uppercase truncate">{variantCabedalColor}</span>
                <span className="ml-auto text-xs text-muted-foreground/70 uppercase tracking-wider whitespace-nowrap">da variação</span>
              </div>
            ) : (
            <div className="flex gap-1">
              <ColorSearchSelect
                colors={availableColors}
                value={item.color}
                onSelect={(v) => onUpdate(index, 'color', v)}
                emptyHint={selectedMaterialVariant && !mainGroupForNewColor && !hasVariantComponentPin(selectedMaterialVariant)
                  ? `A variante ${selectedMaterialVariant.material_name} não substitui componente nenhum desta ficha, então não há cores dela para listar.`
                  : selectedMaterialVariant && !mainGroupForNewColor
                  ? `A variante ${selectedMaterialVariant.material_name} troca só a placa/EVA da palmilha, que não tem cor comercial — a cor aqui continua vindo do material da ficha.`
                  : mainGroupForNewColor
                    ? `Nenhum item ativo com cor no grupo ${mainGroupForNewColor.name}.`
                    : undefined}
                onAddNew={mainGroupForNewColor ? (color) => {
                  // Cor principal (forração/cabedal) → abre a MESMA tela do
                  // Estoque (ProductFormDialog) como modal, com grupo + cor
                  // pré-preenchidos. Tiras são preparadas automaticamente.
                  setColorProductGroupId(mainGroupForNewColor.id);
                  setColorProductColor(color);
                  setColorProductDialogOpen(true);
                } : undefined}
              />
              {onSaveStateAndNavigate && activeMaterialVariants.length === 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 flex-shrink-0"
                  title="Cadastrar material no estoque"
                  aria-label="Cadastrar material no estoque"
                  onClick={onSaveStateAndNavigate}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            )}
          </div>
            );
          })()}

          {canSeeFinancialValues && (
            <div className="md:col-span-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase mb-1 block">Preço Unitário</Label>
              <div className="relative">
                <NumberInput
                  value={item.unit_price}
                  // Clamp >=0: o NumberInput não impede negativo colado (min é
                  // prop morta lá), e preço negativo entrava no total/AR/margem.
                  onChange={(v) => {
                    lastAppliedAutoPrice.current = null;
                    manualPriceEdited.current = true;
                    onUpdate(index, 'unit_price', Math.max(0, v));
                  }}
                  className="h-9 font-mono text-xs"
                  decimals={2}
                />
                {pdv > 0 && !isAdmin && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Lock className="h-3 w-3 text-muted-foreground opacity-30" /></div>}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
                <CurrencyDollar className={cn('h-3 w-3', priceIsManual ? 'text-amber-600' : 'text-primary')} />
                <span className={cn(priceIsManual && 'text-amber-700 dark:text-amber-300')}>{priceSourceLabel}</span>
                {priceMatchesAuto && appliedAutoPrice?.resolution.tableRule?.tier.minQty
                  ? <span>· a partir de {appliedAutoPrice.resolution.tableRule.tier.minQty} pares</span>
                  : null}
              </div>
              {(() => {
                // Teto de desconto (c): avisa (não bloqueia) quando o preço cai mais
                // que max_discount_pct abaixo do preço de tabela do cliente.
                if (!priceLookup || !selectedRef || maxDiscountPct <= 0) return null;
                const tablePrice = resolvePrice(priceLookup, selectedRef.id, item.color || '', Number(item.quantity) || 0);
                if (tablePrice <= 0 || !(item.unit_price > 0)) return null;
                const floor = tablePrice * (1 - maxDiscountPct / 100);
                if (item.unit_price >= floor - 0.005) return null;
                const descPct = ((tablePrice - item.unit_price) / tablePrice) * 100;
                return (
                  <p className="text-[11px] text-amber-600 mt-1 font-medium leading-tight">
                    Desconto {descPct.toFixed(1)}% &gt; teto {maxDiscountPct.toFixed(0)}% · tabela {formatCurrency(tablePrice)}, mín {formatCurrency(floor)}
                  </p>
                );
              })()}
            </div>
          )}

          <div className="md:col-span-1">
            <Label className="text-xs font-bold text-muted-foreground uppercase mb-1 block text-center">Fichas</Label>
              <NumberInput
                value={fichas}
                onChange={(v) => setFichas(Math.max(1, v))}
                className="h-9 font-mono text-xs text-center"
                min={1}
                step="1"
              />
          </div>

          {/* Grade copy button — only in main row when no material groups (to keep 12-col total).
              When material groups exist, this button moves to the grade section header. */}
          {activeMaterialVariants.length === 0 && (
            <div className="md:col-span-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-3 gap-1.5 text-xs font-bold uppercase tracking-widest w-full"
                onClick={() => onCopyGradeFromPrevious?.(index)}
                disabled={index === 0}
              >
                <Check className="h-3.5 w-3.5 text-primary" /> Grade
              </Button>
            </div>
          )}
        </div>

        {activeMaterialVariants.length === 0 && !!item.material_variant_id && !selectedMaterialVariant && (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-bold text-destructive">Variante de material inativa</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Esta referência não possui outra variante ativa. Limpe o vínculo antigo para voltar ao material publicado na ficha.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                onUpdate(index, 'material_variant_id', null);
                onUpdate(index, 'color', '');
              }}
            >
              Usar material da ficha
            </Button>
          </div>
        )}

        {/* Linha de decisão comercial: o operador enxerga a sequência fabril
            completa sem reabrir campos — referência → material → produção →
            preço. Além de reduzir erro, torna explícita a origem do preço. */}
        <div className="grid grid-cols-1 divide-y rounded-md border bg-muted/10 sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', selectedRef ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>1</span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Referência</p>
              <p className="truncate text-xs font-medium">
                {selectedRef?.code || 'Pendente'}
                {selectedRef?.status_ficha && <span className="ml-1 font-normal text-muted-foreground">· {selectedRef.status_ficha.replace('_', ' ')}</span>}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', 'bg-primary text-primary-foreground')}>2</span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Material</p>
              <p className="truncate text-xs font-medium">{selectedMaterialVariant?.material_name || sheetBaseGroup?.name || sheetSpecs?.upper_material || 'Da ficha'}</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', item.color && totalPairs > 0 ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>3</span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cor e grade</p>
              <p className="truncate text-xs font-medium">{item.color || 'Sem cor'} · {totalPairs} pares</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 px-3 py-2">
            <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', item.unit_price > 0 ? 'bg-primary text-primary-foreground' : 'bg-destructive/15 text-destructive')}>4</span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Preço</p>
              <p className="truncate text-xs font-medium">{item.unit_price > 0 ? formatCurrency(item.unit_price) : 'Pendente'} · <span className="font-normal text-muted-foreground">{priceSourceLabel}</span></p>
            </div>
          </div>
        </div>

        {/* Grade Section */}
        <div className="rounded-lg border border-border/60 overflow-hidden bg-muted/5">
          {/* Badge contextual do tipo de solado — ajuda a entender por que a
              grade mostra números individuais vs conjugados, e qual a regra
              de palmilha (cortada vs pronta na cor). */}
          {soleSizeRange?.classification && (
            <div className={`px-3 py-1 text-xs font-bold uppercase tracking-wider flex items-center gap-2
              ${soleSizeRange.classification === 'tradicional' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-b border-emerald-200 dark:border-emerald-800' : ''}
              ${soleSizeRange.classification === 'palmilha_pronta' ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-b border-violet-200 dark:border-violet-800' : ''}
              ${soleSizeRange.classification === 'conjugado' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-b border-amber-200 dark:border-amber-800' : ''}
            `}>
              <span>Solado</span>
              <span className="opacity-50">·</span>
              <span>{soleSizeRange.classification === 'tradicional' ? 'Tradicional' : soleSizeRange.classification === 'palmilha_pronta' ? 'Palmilha Pronta' : 'Conjugado'}</span>
              {soleSizeRange.classification === 'conjugado' && soleConjugations.length > 0 && (
                <span className="opacity-70 normal-case font-medium tracking-normal">
                  · {soleConjugations.length} slot{soleConjugations.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
          <div className="bg-muted/30 px-3 py-1.5 border-b flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Distribuição por Numeração</span>
            <div className="flex items-center gap-2">
              {/* Grade copy button moves here when material groups are present */}
              {activeMaterialVariants.length > 0 && index > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 gap-1 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                  onClick={() => onCopyGradeFromPrevious?.(index)}
                >
                  <Check className="h-3 w-3 text-primary" /> Copiar grade
                </Button>
              )}
              <div className="text-xs font-bold">
                {fichas > 1 ? (
                  <>
                    {gradeTotal} <span className="text-muted-foreground font-normal">×</span> {fichas} ={' '}
                    <span className="text-primary">{totalPairs}</span>
                    <span className="text-muted-foreground font-normal"> pares</span>
                  </>
                ) : (
                  <>
                    {gradeTotal} <span className="text-muted-foreground font-normal">pares</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="p-3">
            <div className="flex gap-1.5 justify-center flex-wrap">
              {SIZES.map(size => {
                const val = grade[size] || 0;
                const isConjugated = size.includes('/');
                // Audit visual #15: tamanho órfão = está no grade mas fora do
                // range atual do solado. Marcado em âmbar pra usuário ver
                // claramente que é dado preservado (não vai sumir ao salvar).
                const isOrphan = orphanSizes.has(size);
                return (
                  <div key={size} className="text-center relative" style={{ width: isConjugated ? '5.2rem' : (isInfantil ? '3.5rem' : '3.8rem') }}>
                    {isOrphan && (
                      <span
                        className="absolute -top-1 -right-1 z-10 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-white text-xs font-bold border border-background shadow-sm"
                        title={`Tamanho ${size} fora do range atual do solado, mas preservado do PV original`}
                      >
                        ⚠
                      </span>
                    )}
                    <label
                      className={cn(
                        "text-xs font-bold block mb-1",
                        isOrphan
                          ? 'text-amber-700 dark:text-amber-300'
                          : isConjugated ? 'text-primary' : 'text-muted-foreground',
                      )}
                      title={isOrphan
                        ? `Tamanho ${size} fora do range atual do solado, mas preservado do PV original`
                        : undefined}
                    >
                      {size}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={val || ''}
                      onChange={e => {
                        const raw = e.target.value.replace(',', '.');
                        const parsed = Number(raw);
                        const safe = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
                        handleGradeChange(size, safe);
                      }}
                      onBlur={e => {
                        const raw = e.target.value.replace(',', '.');
                        const parsed = Number(raw);
                        if (Number.isFinite(parsed) && parsed !== Math.floor(parsed)) {
                          e.target.value = String(Math.floor(Math.max(0, parsed)));
                        }
                      }}
                      onFocus={e => e.target.select()}
                      className={cn(
                        "w-full h-10 text-sm font-mono text-center rounded border transition-all",
                        val > 0 ? 'border-primary/50 bg-primary/5 font-bold ring-1 ring-primary/10' : 'border-input hover:bg-muted/30',
                        isConjugated && 'border-primary/30',
                        isOrphan && 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-300/40',
                      )}
                      placeholder="–"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Aviso: cor principal não cadastrada nos materiais de área coloridos
            (forração / cabedal). Espelha o aviso das tiras. O débito (SQL)
            resolve esses materiais pela cor principal do PV; se o grupo é
            gerido por cor mas a cor não existe, o débito PULA o material
            (vira ruptura) em vez de baixar a cor errada. Avisar aqui evita
            a surpresa só na produção. */}
        {coverColorIssues.length > 0 && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-400 space-y-2">
            <p>
              <strong>⚠ Cor "{item.color}" não cadastrada</strong> no estoque {coverColorIssues.length === 1 ? 'do material' : 'dos materiais'}:{' '}
              <strong>{coverColorIssues.map(i => i.name).join(', ')}</strong>. Sem produto nessa cor o débito é <strong>pulado</strong> (vira ruptura) — e o pedido <strong>não salva</strong> até cadastrar:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {coverColorIssues.map(iss => (
                <Button
                  key={iss.groupId}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1 border-amber-500/40 bg-card hover:bg-amber-500/10 text-amber-700 dark:text-amber-400"
                  onClick={() => {
                    setColorProductGroupId(iss.groupId);
                    setColorProductColor(item.color || '');
                    setColorProductDialogOpen(true);
                  }}
                  title={`Cadastrar produto "${iss.name} - ${item.color}" no estoque`}
                >
                  <Plus className="h-3 w-3" /> Cadastrar "{iss.name}"
                </Button>
              ))}
            </div>
          </div>
        )}

        {strapSnapshotMissing && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-3 text-sm">
            <div className="flex items-start gap-2">
              <Warning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1">
                <p className="font-semibold text-destructive">Demanda de tira não resolvida</p>
                <p className="text-xs text-muted-foreground">
                  A ficha indica que esta referência usa tiras, mas não há linhas técnicas no snapshot do item. O pedido não pode ser salvo sem identidade canônica.
                </p>
                <ReferenceLink referenceId={item.reference_id} newTab className="text-xs font-semibold">
                  Abrir ficha técnica e cadastrar as tiras
                </ReferenceLink>
              </div>
            </div>
          </div>
        )}

        {/* Straps Section — fluxo sequencial: só abre após cor principal definida.
            Sem isso, ao selecionar referência com tiras o user via cor principal +
            tiras juntas e ficava confuso sobre qual preencher primeiro.
            Fallback: se o item já tem alguma tira com cor (edição de PV existente),
            sempre mostra. */}
        {(() => {
          const straps = strapPresentationDefinitions;
          if (straps.length === 0) return null;
          const anyStrapHasColor = straps.some((s: any) => !!s?.color);
          const principalDefined = !!item.color;
          // Se cor principal ainda não foi escolhida E nenhuma tira ainda tem cor,
          // mostra placeholder com hint em vez da section completa.
          if (!principalDefined && !anyStrapHasColor) {
            return (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground italic flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                Defina a <strong className="text-foreground">Cor Principal</strong> acima para abrir as <strong className="text-foreground">cores das {straps.length} tira{straps.length > 1 ? 's' : ''}</strong>.
              </div>
            );
          }
          return null;
        })()}
        {(item.strap_colors as any[])?.length > 0 && (!!item.color || ((item.strap_colors as any[]) || []).some((s: any) => !!s?.color)) && (() => {
          const straps = strapPresentationDefinitions;
          const snapshotStraps = (item.strap_colors as SaleOrderItemStrap[]) || [];
          const finishedGroupCount = straps.filter(
            (strap) => strapIdentityBasis(strap) === 'finished_product_group',
          ).length;
          const hasOnlyFinishedGroups = finishedGroupCount === straps.length;
          const hasMixedStrapIdentities = finishedGroupCount > 0 && !hasOnlyFinishedGroups;

          return (
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="px-3 py-1.5 border-b flex items-center justify-between bg-muted/30">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Cores das Tiras
                </span>
                <span className="text-xs text-muted-foreground">
                  {hasOnlyFinishedGroups
                    ? 'Produtos acabados mantêm cor própria e saem diretamente do estoque.'
                    : hasMixedStrapIdentities
                      ? 'Tiras internas seguem o cabedal; produtos acabados mantêm cor própria.'
                      : 'As tiras por base da referência seguem a cor do cabedal.'}
                </span>
              </div>

              <div className="px-3 py-2 border-b bg-muted/10">
                <span className="text-xs text-muted-foreground">
                  {hasOnlyFinishedGroups
                    ? 'Estas tiras são compradas prontas: o pedido baixa o SKU acabado da cor escolhida e não movimenta napa-base.'
                    : hasMixedStrapIdentities
                      ? 'O pedido prepara apenas as tiras internas com napa; as compradas prontas baixam o SKU acabado.'
                      : 'Ao salvar, o sistema resolve estas tiras pela napa-base da referência e pela origem configurada no catálogo.'}
                </span>
              </div>

              {strapStructuralContext.hasIssue && (
                <div className="flex flex-col gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <Warning className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div>
                      <p className="text-xs font-semibold text-destructive">
                        Contexto estrutural incompleto em {strapStructuralContext.issueCount} tira{strapStructuralContext.issueCount === 1 ? '' : 's'}
                      </p>
                      <p className="text-xs leading-snug text-muted-foreground">
                        {strapStructuralContext.requiresReferenceBase
                          ? strapStructuralContext.hasPurchasedReady
                            ? 'Vincule a napa-base às linhas que seguem a referência e confirme as medidas e grupos acabados das demais.'
                            : 'Vincule a napa-base e as medidas canônicas das linhas que seguem a referência.'
                          : 'Vincule as medidas e os grupos acabados das tiras compradas. Napa-base não se aplica.'}
                      </p>
                    </div>
                  </div>
                  {preserveCommittedStrapSnapshot ? (
                    <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                      <span className="max-w-xs text-xs font-medium text-muted-foreground sm:text-right">
                        Este pedido já está comprometido. Corrija a ficha para os próximos pedidos; o snapshot atual permanecerá histórico.
                      </span>
                      <ReferenceLink referenceId={item.reference_id} newTab className="text-xs font-semibold">
                        Abrir ficha técnica
                      </ReferenceLink>
                    </div>
                  ) : strapCatalogLoading ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Verificando permissão…</span>
                  ) : strapCatalog?.capabilities.resolve_strap_migration ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5 border-destructive/40 bg-background text-xs"
                      onClick={() => setStrapResolutionOpen(true)}
                    >
                      <Wrench className="h-3.5 w-3.5" /> Corrigir no estoque
                    </Button>
                  ) : (
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      Solicite a correção ao administrador.
                    </span>
                  )}
                </div>
              )}

              {/* O save materializa a tira interna pela napa-base do cabedal e
                  aborta o PV INTEIRO quando falta perfil de largura, SKU oficial
                  da cor ou rendimento aprovado. Antes disso só se descobria pelo
                  texto cru do RAISE, que não nomeia item nem napa. */}
              {internalStrapReadiness?.requiresReferenceBase
                && internalStrapReadiness.ready === false && (
                <div className="flex flex-col gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-2">
                    <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                        Cadastro da tira interna incompleto
                        {internalStrapReadiness.baseGroupName
                          ? <> em <strong>{internalStrapReadiness.baseGroupName}</strong></>
                          : null}
                        {internalStrapReadiness.colorName
                          ? <> · {internalStrapReadiness.colorName}</>
                          : null}
                      </p>
                      <ul className="space-y-0.5">
                        {internalStrapReadiness.issues.map((issue) => (
                          <li
                            key={`${issue.code}-${issue.message}`}
                            className="text-[11px] leading-snug text-muted-foreground"
                          >
                            • {issue.message}
                          </li>
                        ))}
                      </ul>
                      <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-300">
                        Enquanto isso não for resolvido o pedido inteiro não salva.
                      </p>
                    </div>
                  </div>
                  <Button asChild type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 border-amber-500/40 bg-background text-xs">
                    <Link to="/tiras-artesanais?tab=cadastro" target="_blank" rel="noreferrer">
                      Abrir Hub de Tiras
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              )}

              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {straps.map((strap: any, sIdx: number) => {
                  const snapshotStrap = snapshotStraps[sIdx];
                  const lineId = technicalStrapLineId(strap);
                  const resolvedLine = lineId ? strapLineByKey.get(lineId) : undefined;
                  const purchasedReady = isPurchasedReadyStrap(strap);
                  const usesFinishedGroup = strapIdentityBasis(strap) === 'finished_product_group';
                  const persistedLegacySnapshot = preserveCommittedStrapSnapshot && !!snapshotStrap && (
                    !technicalStrapLineId(snapshotStrap)
                    || !isUuid(snapshotStrap.strap_type_id)
                    || !isUuid(snapshotStrap.measure_id)
                    || strapIdentityBasis(snapshotStrap) !== strapIdentityBasis(strap)
                    || (usesFinishedGroup
                      && snapshotStrap.identity_group_id !== strap.identity_group_id)
                  );
                  const identityColors = strapColorsForIdentity(
                    strapCatalog,
                    strap,
                    resolvedLine?.baseGroupId,
                  );
                  const selectedColor = strapCatalog?.colors.find((entry) => entry.id === strap.color_id);
                  const colorIsAvailable = !!strap.color_id
                    && identityColors.some((entry) => entry.id === strap.color_id);
                  const displayedColors = selectedColor && !colorIsAvailable
                    ? [selectedColor, ...identityColors]
                    : identityColors;
                  const identityGroupResolved = usesFinishedGroup
                    ? isUuid(strap.identity_group_id)
                    : isUuid(resolvedLine?.baseGroupId);
                  const canonicalMeasure = isUuid(strap.measure_id)
                    ? strapCatalog?.measures.find((entry) => entry.id === strap.measure_id && entry.active !== false)
                    : null;
                  const measureResolved = isUuid(strap.strap_type_id)
                    && !!canonicalMeasure
                    && canonicalMeasure.strap_type_id === strap.strap_type_id;
                  const buyReadyCatalogIncomplete = usesFinishedGroup
                    && identityGroupResolved
                    && measureResolved
                    && isUuid(strap.color_id)
                    && !strapLinesLoading
                    && !!resolvedLine
                    && (!resolvedLine.strapVariantId || !resolvedLine.canBuyReady);
                  const hasBuyReadyVariant = isUuid(resolvedLine?.strapVariantId);
                  const buyReadyCatalogHref = hasBuyReadyVariant
                    ? `/tiras-artesanais?tab=cadastro&editor=1&mode=review&origin=pv&purpose=stock_variant&variantId=${encodeURIComponent(resolvedLine.strapVariantId)}`
                    : '/tiras-artesanais?tab=diagnostico';
                  const canManageBuyReadyCatalog = strapCatalog?.capabilities.manage_strap_catalog === true;
                  // Lacuna comercial EXATA desta linha (medida, grupo acabado e
                  // cor por UUID). É o que o servidor recusa ao salvar o PV.
                  const buyReadyGap = lineId ? buyReadyGapByLineId.get(lineId) : undefined;
                  return (
                    <div key={strap.id || sIdx} className="space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-muted-foreground uppercase truncate">{strap.label || `Tira ${sIdx + 1}`}</span>
                        {strap.group_name && <span className="text-xs text-muted-foreground opacity-70 truncate max-w-[80px]">({strap.group_name})</span>}
                      </div>
                      {usesFinishedGroup ? persistedLegacySnapshot ? (
                        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 text-sm">
                          <span className="truncate font-medium">
                            {strap.color || 'Cor histórica não informada'}
                          </span>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            histórico
                          </span>
                        </div>
                      ) : (
                        <Select
                          value={strap.color_id || undefined}
                          disabled={!item.reference_id || !strapCatalog || strapLinesLoading || !identityGroupResolved || !measureResolved}
                          onValueChange={(colorId) => {
                            const canonical = identityColors.find((entry) => entry.id === colorId);
                            if (!canonical) return;
                            const updated = [...snapshotStraps];
                            const snapshot = updated[sIdx];
                            if (!snapshot) return;
                            updated[sIdx] = {
                              ...snapshot,
                              color_id: canonical.id,
                              color: canonical.name,
                            };
                            onUpdate(index, 'strap_colors', updated);
                            onUpdate(index, 'strap_sourcing', setStrapSourcing(
                              strapSourcingMap,
                              technicalStrapLineId(snapshot),
                              null,
                            ));
                          }}
                        >
                          <SelectTrigger className={cn('h-9', !strap.color_id && 'border-amber-500/60')}>
                            <SelectValue
                              placeholder={strap.color
                                ? `${strap.color} — confirme no catálogo`
                                : 'Selecione a cor canônica'}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {displayedColors.map((entry) => (
                              <SelectItem key={entry.id} value={entry.id} disabled={!identityColors.some((color) => color.id === entry.id)}>{entry.name}{entry.id === strap.color_id && !colorIsAvailable ? ' · vínculo inválido' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/30 px-3 text-sm">
                          <span className="truncate font-medium">{strap.color || item.color || 'Aguardando cor do cabedal'}</span>
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">cor do cabedal</span>
                        </div>
                      )}
                      {!usesFinishedGroup && !!strapCatalog && !strapCatalogLoading && !!item.color && !canonicalMainStrapColor && (
                        <p className="text-xs leading-tight text-destructive">
                          A cor do cabedal não corresponde a uma cor canônica ou alias aprovado. Corrija essa identidade no estoque antes de salvar.
                        </p>
                      )}
                      {!strapLinesLoading && (!identityGroupResolved || !measureResolved) && (
                        <p className="text-xs leading-tight text-destructive">
                          {!measureResolved
                            ? 'A linha técnica não identifica uma família e medida canônicas coerentes por UUID.'
                            : usesFinishedGroup
                              ? 'A linha técnica não identifica o grupo do produto acabado por UUID.'
                              : 'A referência/variante não identifica a napa-base por UUID. Corrija o cadastro estrutural no estoque.'}
                        </p>
                      )}
                      {usesFinishedGroup && identityGroupResolved && identityColors.length === 0 && (
                        <p className="text-xs leading-tight text-destructive">
                          {usesFinishedGroup
                            ? 'Este grupo acabado não possui produto ativo com cor canônica.'
                            : 'Esta napa-base não possui cor com produção, saldo acabado ou compra pronta disponíveis.'}
                        </p>
                      )}
                      {usesFinishedGroup && !!strap.color_id && !colorIsAvailable && (
                        <p className="text-xs leading-tight text-destructive">
                          {usesFinishedGroup
                            ? 'A cor atual não possui produto ativo no grupo acabado.'
                            : 'A cor atual não possui napa oficial ativa nesta base. Escolha uma opção válida.'}
                        </p>
                      )}
                      {usesFinishedGroup && !persistedLegacySnapshot && !strap.color_id && strap.color && (
                        <p className="text-xs leading-tight text-amber-700 dark:text-amber-400">
                          A cor antiga é apenas texto. Selecione a identidade canônica para continuar.
                        </p>
                      )}
                      {persistedLegacySnapshot && (
                        <p className="text-xs leading-tight text-muted-foreground">
                          Snapshot histórico preservado: a ficha atual identifica esta tira como produto acabado, mas cor e origem deste item ficam somente para leitura para não alterar reservas existentes.
                        </p>
                      )}
                      {(buyReadyCatalogIncomplete || !!buyReadyGap) && (
                        <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-2">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
                              Cadastro da compra pronta incompleto
                            </p>
                            <p className="text-[10px] leading-snug text-muted-foreground">
                              {resolvedLine?.blockReason || 'Cadastre e ative a variante exata deste grupo, medida e cor.'}{' '}
                              Esta tira baixa o SKU acabado e não usa napa-base.
                            </p>
                            {/* Sem nomear a cor o operador não sabe QUAL das tiras do
                                pedido está travando o salvamento. */}
                            {buyReadyGap?.colorName && (
                              <p className="text-[10px] leading-snug text-amber-800 dark:text-amber-300">
                                Falta a variante de <strong>{buyReadyGap.colorName}</strong>
                                {buyReadyGap.finishedProductName
                                  ? <> — produto acabado <strong>{buyReadyGap.finishedProductName}</strong>.</>
                                  : '.'}
                              </p>
                            )}
                          </div>
                          {canManageBuyReadyCatalog ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Cadastra SÓ a tira que este pedido usa, com a
                                  identidade canônica já resolvida pela linha técnica. */}
                              {buyReadyGap && !hasBuyReadyVariant && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1.5 px-2 text-[10px]"
                                  onClick={() => setBuyReadyGapTarget(buyReadyGap)}
                                >
                                  Cadastrar esta tira agora
                                </Button>
                              )}
                              <Button asChild type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[10px]">
                                <Link to={buyReadyCatalogHref} target="_blank" rel="noreferrer">
                                  {hasBuyReadyVariant ? 'Revisar variante no Hub de Tiras' : 'Abrir diagnóstico no Hub de Tiras'}
                                  <ExternalLink className="h-3 w-3" />
                                </Link>
                              </Button>
                            </div>
                          ) : (
                            <p className="text-[10px] font-medium text-muted-foreground">
                              Solicite ao administrador completar o cadastro comercial.
                            </p>
                          )}
                        </div>
                      )}
                      {/* Origem derivada e congelada por UUID da linha técnica. */}
                      {!!technicalStrapLineId(strap) && (() => {
                        const key = strapSourcingKey(lineId);
                        const line = key ? resolvedLine : undefined;
                        const effective = getStrapSourcingOverride(strapSourcingMap, lineId);
                        const complete = isCompleteStrapSourcingSelection(
                          getStrapSourcingSelection(strapSourcingMap, lineId),
                        );
                        const blocked = !!effective && !!line?.blockReason;
                        const fmt = (v: number | null | undefined, d = 2) =>
                          v == null ? '—' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
                        return (
                          <div className={cn(
                            'rounded-md border px-2 py-1.5 space-y-1',
                            blocked ? 'border-amber-500/50 bg-amber-500/10' : 'border-border/60 bg-muted/20',
                          )}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Origem</span>
                              <span className="text-[10px] text-muted-foreground">
                                {purchasedReady
                                  ? 'Comprada pronta · origem fixa'
                                  : effective === 'buy_ready' && complete
                                    ? 'Compra pronta · histórico congelado'
                                    : 'Produção interna automática'}
                              </span>
                            </div>
                            {!usesFinishedGroup && !effective ? (
                              <p className="text-[10px] leading-snug text-muted-foreground">
                                A identidade exata pela napa-base e a origem de estoque serão materializadas na mesma transação do salvamento.
                              </p>
                            ) : strapLinesLoading && !line ? (
                              <p className="text-[10px] leading-tight text-muted-foreground">Resolvendo material e consumo…</p>
                            ) : effective === 'internal' ? (
                              blocked ? (
                                <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-400">
                                  {line?.blockReason}
                                </p>
                              ) : line?.napaProductName ? (
                                <p className="text-[10px] leading-snug text-muted-foreground">
                                  Sai <strong className="text-foreground">{fmt(line.napaRequiredM)} m</strong> de{' '}
                                  <strong className="text-foreground">{line.napaProductName}</strong>{' '}
                                  (rend. {fmt(line.yieldPerMeter, 0)} m/m) para {fmt(line.strapRequiredM, 1)} m de tira.
                                </p>
                              ) : (
                                <p className="text-[10px] leading-snug text-muted-foreground">
                                  Napa-base ainda não resolvida para esta cor.
                                </p>
                              )
                            ) : effective === 'buy_ready' ? (
                              <p className="text-[10px] leading-snug text-muted-foreground">
                                A linha usa a tira pronta; a napa não será movimentada
                                {line ? <> — <strong className="text-foreground">{fmt(line.strapRequiredM, 1)} m</strong></> : null}.
                              </p>
                            ) : (
                              <p className="text-[10px] leading-snug text-muted-foreground">
                                {!usesFinishedGroup
                                  ? 'A cor e a napa do cabedal serão vinculadas automaticamente.'
                                  : buyReadyGap
                                    // Sem isto a tela dizia "aguardando" para um
                                    // estado que só sai com cadastro manual.
                                    ? 'Falta a variante comercial desta cor — cadastre acima para liberar o salvamento.'
                                    : 'Aguardando a identidade canônica do produto acabado.'}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Observation */}
        <div>
          {item.observation !== null && item.observation !== undefined ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-muted-foreground uppercase">Observação</Label>
                <button
                  type="button"
                  onClick={() => onUpdate(index, 'observation', null)}
                  className="text-xs text-muted-foreground hover:text-destructive underline underline-offset-2"
                >
                  remover
                </button>
              </div>
              <div className="relative">
                <textarea
                  value={item.observation || ''}
                  onChange={e => onUpdate(index, 'observation', e.target.value.slice(0, 300))}
                  maxLength={300}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 pr-14 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                  placeholder="Observação para esta referência (aparece nos relatórios)..."
                />
                <span className="absolute bottom-1.5 right-2 text-xs text-muted-foreground/70 font-mono bg-background/80 px-1 rounded pointer-events-none">
                  {(item.observation || '').length}/300
                </span>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs"
              onClick={() => onUpdate(index, 'observation', '')}
            >
              <MessageSquare className="h-3 w-3" /> Observação
            </Button>
          )}
        </div>

        {/* Terceirização por setor deste item (intenção; a OS nasce na entrada
            em produção). Só aparece com referência escolhida — sem ela não há
            OP futura pra receber a OS. */}
        {item.reference_id && (
          <ItemSectorOutsourcingSection
            referenceId={item.reference_id}
            value={item.outsourced_sectors}
            onChange={(next) => onUpdate(index, 'outsourced_sectors', next)}
          />
        )}
      </fieldset>

      {strapResolutionOpen && item.reference_id && (
        <StrapCatalogResolutionDrawer
          open
          onOpenChange={setStrapResolutionOpen}
          referenceId={item.reference_id}
          referenceLabel={selectedRef
            ? `${selectedRef.code} · ${selectedRef.name}`
            : item.reference_id}
          referenceUpdatedAt={selectedRef?.updated_at}
          lines={referenceStrapDefinitions}
          suggestedBaseGroupId={strapStructuralContext.suggestedBaseGroupId}
          onResolved={(strapColors) => {
            // Em item comprometido, o RPC corrige apenas a ficha. Alterar o
            // snapshot local faria o próximo save preparar uma demanda nova e
            // poderia tocar reservas históricas antes de encontrar um bloqueio
            // comercial. Itens novos ainda adotam a estrutura resolvida.
            if (preserveCommittedStrapSnapshot) {
              return;
            }
            const currentStraps = (item.strap_colors as Array<Record<string, unknown>>) || [];
            const currentByLineId = new Map(
              currentStraps
                .map((strap) => [technicalStrapLineId(strap), strap] as const)
                .filter((entry): entry is readonly [string, Record<string, unknown>] => !!entry[0]),
            );
            let nextSourcing = strapSourcingMap;
            const resolvedWithItemColors = strapColors.map((resolved, ordinal) => ({
              ...resolved,
              // Base/medida pertencem a ficha; a cor pertence ao item do PV.
              // Copiar a cor da ficha faria OFF WHITE vencer um pedido COGUMELO.
              ...(() => {
                const lineId = technicalStrapLineId(resolved);
                const currentById = lineId ? currentByLineId.get(lineId) : null;
                const ordinalLegacy = currentStraps[ordinal];
                const current = currentById
                  || (!technicalStrapLineId(ordinalLegacy) ? ordinalLegacy : null);
                const structureChanged = !!current && (
                  current.strap_type_id !== resolved.strap_type_id
                  || current.measure_id !== resolved.measure_id
                  || strapIdentityBasis(current) !== strapIdentityBasis(resolved)
                  || current.identity_group_id !== resolved.identity_group_id
                );
                if (structureChanged && lineId) {
                  nextSourcing = setStrapSourcing(nextSourcing, lineId, null);
                }
                return {
                  color: current?.color || '',
                  color_id: isUuid(current?.color_id) ? current.color_id : null,
                };
              })(),
            }));
            onUpdate(index, 'strap_colors', resolvedWithItemColors);
            if (JSON.stringify(strapSourcingMap) !== JSON.stringify(nextSourcing)) {
              onUpdate(index, 'strap_sourcing', nextSourcing);
            }
          }}
        />
      )}

      {/* Cadastro comercial da tira comprada pronta, na mesma tela do hub. O
          editor recebe medida, grupo acabado, cor e produto EXATOS da linha
          técnica; nada é inferido por nome aqui. */}
      {buyReadyGapTarget && strapCatalog && (
        <ArtisanalStrapEditor
          open
          onOpenChange={(open) => { if (!open) setBuyReadyGapTarget(null); }}
          catalog={strapCatalog}
          capabilities={strapCatalog.capabilities}
          mode="create"
          origin="pv"
          identityBasis="finished_product_group"
          measureId={buyReadyGapTarget.measureId}
          baseGroupId={buyReadyGapTarget.identityGroupId}
          colorId={buyReadyGapTarget.colorId}
          finishedProductId={buyReadyGapTarget.finishedProductId}
          buyReadyReviewId={buyReadyGapTarget.reviewId}
          // Medida, grupo, cor e produto vieram do snapshot canônico da linha
          // técnica: a identidade já está decidida, então nascer em revisão só
          // devolveria o mesmo bloqueio ao operador.
          activateOnCreate
          onSaved={() => {
            setBuyReadyGapTarget(null);
            qc.invalidateQueries({ queryKey: ['artisanal-strap-catalog'] });
            qc.invalidateQueries({ queryKey: ['artisanal-strap-catalog-diagnostics'] });
            qc.invalidateQueries({ queryKey: ['strap_stock_lines_preview'] });
          }}
        />
      )}

      {/* Cadastro da COR PRINCIPAL na MESMA tela do Estoque. Montado só quando
          aberto (o form carrega vários hooks) — evita overhead por item do PV. */}
      {colorProductDialogOpen && colorProductGroupId && (
        <ProductFormDialog
          open
          onOpenChange={(o) => { if (!o) { setColorProductDialogOpen(false); setColorProductGroupId(null); setColorProductColor(''); } }}
          onSubmit={handleCreateColorProduct}
          defaultGroupId={colorProductGroupId}
          defaultColor={colorProductColor}
        />
      )}

      {/* EditColorVariantsDialog removido — variante de cor saiu do escopo. */}
    </div>
  );
}

const SaleOrderItemForm = memo(SaleOrderItemFormInner);
export default SaleOrderItemForm;

function ColorSearchSelect({
  colors, value, onSelect, onAddNew, emptyHint,
}: {
  colors: string[];
  value: string;
  onSelect: (color: string) => void;
  /** Quando definido, mostra "+ Cadastrar 'X' no estoque" se a busca n\u00e3o casar nenhuma cor. */
  onAddNew?: (color: string) => void;
  /** Por que a lista está vazia. Sem isso o popover terminava em "Nenhuma cor
   *  encontrada." e o vendedor não tinha como saber que o problema era cadastro
   *  da variante, não busca. */
  emptyHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = colors.filter(c => searchMatchesAllTerms(search, c));
  const trimmedSearch = search.trim();
  const showAdd = !!onAddNew && trimmedSearch && !colors.some(c => normalizeForSearch(c) === normalizeForSearch(trimmedSearch));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="flex-1 justify-between h-9 text-xs">
          {value || 'Escolha a cor...'}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] sm:w-[340px] p-0" align="start">
        <div className="p-2 space-y-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Buscar por cor ou material..."
            resultCount={filtered.length}
            totalCount={colors.length}
            inputClassName="text-sm"
            autoFocus
          />
          <div className="max-h-[250px] overflow-y-auto space-y-0.5">
            {filtered.length === 0 && !showAdd && (
              trimmedSearch ? (
                <div className="flex flex-col items-center gap-1.5 py-4">
                  <p className="text-xs text-muted-foreground text-center">Nenhum resultado para "{search}"</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
                </div>
              ) : (
                <div className="py-4 px-2 space-y-1">
                  <p className="text-xs text-muted-foreground text-center">Nenhuma cor encontrada.</p>
                  {emptyHint && (
                    <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400 text-center">{emptyHint}</p>
                  )}
                </div>
              )
            )}
            {filtered.map(color => (
              <button
                key={color}
                onClick={() => { onSelect(color); setOpen(false); setSearch(''); }}
                className={cn(
                  "flex items-center justify-between w-full px-3 py-2 text-xs rounded-sm hover:bg-accent text-left",
                  value === color && "bg-accent font-bold"
                )}
              >
                <span>{color}</span>
                {value === color && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
            {showAdd && (
              <button
                onClick={() => {
                  onAddNew!(trimmedSearch);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full text-left px-3 py-2 text-xs text-primary font-medium hover:bg-accent rounded-sm flex items-center gap-1.5"
              >
                <Plus className="h-3 w-3" />
                Cadastrar "{trimmedSearch}" no estoque
              </button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ReferenceSearch({
  references, onSelect, selectedId, variantsByRef, onRefresh, refreshing, onCreate,
}: {
  references: ReferenceOption[];
  onSelect: (ref: ReferenceOption) => void;
  selectedId?: string;
  variantsByRef?: ReadonlyMap<string, readonly VariantSummary[]>;
  onRefresh: () => void;
  refreshing: boolean;
  onCreate: () => void;
}) {
  const [search, setSearch] = useState('');
  const selectableReferences = references.filter(ref => !ref.retired_at || ref.id === selectedId);
  // Match com espaços/acentos/case ignorados — "SP 10"/"sp10"/"Sp-10"
  // devem todos casar com a referência cadastrada como "SP10". Material e SKU
  // também entram no índice: o vendedor pode lembrar "Santorine" sem lembrar a ref.
  const filtered = selectableReferences
    .filter(r => {
      const variants = variantsByRef?.get(r.id) ?? [];
      return searchMatchesAllTerms(
        search,
        r.code,
        r.name,
        r.shoe_category,
        ...variants.flatMap(v => [v.material_name, v.sku || '']),
      );
    })
    .sort((a, b) => {
      if (a.id === selectedId) return -1;
      if (b.id === selectedId) return 1;
      const statusOrder: Record<string, number> = { publicada: 0, validada: 1, em_revisao: 2, rascunho: 3 };
      const byReadiness = (statusOrder[a.status_ficha || ''] ?? 4) - (statusOrder[b.status_ficha || ''] ?? 4);
      return byReadiness || String(a.code || a.name).localeCompare(String(b.code || b.name), 'pt-BR');
    });
  return (
    <div className="p-2 space-y-2">
      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Código, nome, material ou SKU..."
        resultCount={filtered.length}
        totalCount={selectableReferences.length}
        inputClassName="text-sm"
        autoFocus
      />
      {filtered.length > 50 && (
        <p className="px-2 text-xs text-muted-foreground">
          Mostrando 50 de {filtered.length} referências — busque por código ou nome para refinar.
        </p>
      )}
      <div className="max-h-[300px] overflow-y-auto space-y-0.5">
        {filtered.length === 0 && search.trim() && (
          <div className="flex flex-col items-center gap-1.5 py-4">
            <p className="text-xs text-muted-foreground text-center">Nenhum resultado para "{search}"</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
          </div>
        )}
        {filtered.slice(0, 50).map(ref => {
          const variants = variantsByRef?.get(ref.id) ?? [];
          const thumbnailUrl = resolveReferenceThumbnailUrl(ref, 56);
          return (
            <button
              key={ref.id}
              onClick={() => onSelect(ref)}
              className={cn(
                "flex items-start justify-between w-full px-3 py-2 text-xs rounded-sm hover:bg-accent text-left gap-2",
                selectedId === ref.id && "bg-accent font-bold"
              )}
            >
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="h-14 w-14 rounded-md border bg-muted overflow-hidden flex-shrink-0">
                  {thumbnailUrl ? (
                    <SignedImage
                      src={thumbnailUrl}
                      alt={ref.name || ref.code || 'Referência'}
                      width={56}
                      height={56}
                      className="h-full w-full"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-muted-foreground/30">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-mono bg-muted px-1.5 rounded text-muted-foreground w-fit">{ref.code}</span>
                    {ref.status_ficha && (
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1 text-[10px] font-medium capitalize',
                          ref.status_ficha === 'publicada' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                          ref.status_ficha !== 'publicada' && 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
                        )}
                      >
                        {ref.status_ficha.replace('_', ' ')}
                      </Badge>
                    )}
                  </div>
                  <span className="truncate max-w-[200px] font-medium">{ref.name}</span>
                  {variants.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-primary/70 font-medium">
                      <Tag className="h-3 w-3" /> {variants.length} grupo{variants.length !== 1 ? 's' : ''} de material
                    </span>
                  )}
                  <span className={cn('text-[11px]', Number(ref.sale_price) > 0 ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300')}>
                    {Number(ref.sale_price) > 0 ? `Base ${formatCurrency(Number(ref.sale_price))}` : 'Sem preço-base na ficha'}
                  </span>
                </div>
              </div>
              {ref.shoe_category && (
                <Badge variant="outline" className="text-xs h-4 px-1 shrink-0 mt-0.5">{ref.shoe_category}</Badge>
              )}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          Atualizar referências
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onCreate}>
          <Plus className="h-3.5 w-3.5" /> Nova referência
        </Button>
      </div>
    </div>
  );
}

function ColorPickerDropdown({ value, colors, onChange, disabled, onAddNew }: { value: string; colors: string[]; onChange: (v: string) => void; disabled?: boolean; onAddNew?: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = colors.filter(c => searchMatchesAllTerms(search, c));
  const showAdd = search.trim() && !colors.some(c => normalizeForSearch(c) === normalizeForSearch(search));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className={cn("w-full h-8 justify-between text-xs font-normal", !value && "text-muted-foreground")}>
          {value || 'Escolha a cor...'}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] sm:w-[280px] p-1">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar cor..."
          resultCount={filtered.length}
          totalCount={colors.length}
          className="mb-1"
          inputClassName="text-sm"
          autoFocus
        />
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {filtered.length === 0 && !showAdd && search.trim() && (
            <div className="flex flex-col items-center gap-1.5 py-3">
              <p className="text-xs text-muted-foreground text-center">Nenhum resultado para "{search}"</p>
              <Button type="button" variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>
            </div>
          )}
          {filtered.map(c => (
            <button key={c} onClick={() => { onChange(c); setOpen(false); }} className="w-full text-left px-2 py-1.5 text-xs hover:bg-accent rounded-sm break-words">{c}</button>
          ))}
          {showAdd && (
            <button
              onClick={() => {
                if (onAddNew) {
                  onAddNew(search.trim());
                } else {
                  onChange(search.trim());
                }
                setOpen(false);
              }}
              className="w-full text-left px-2 py-1.5 text-xs text-primary font-medium hover:bg-accent rounded-sm"
            >
              + Cadastrar "{search}" no estoque
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Wrapper controlado do ReferenceSearch — abre automaticamente quando o item
 * não tem reference_id e fecha quando uma referência é selecionada.
 * Economiza 1 clique no fluxo "Novo Item → escolher referência".
 */
function ReferencePickerControlled({
  references, variantsByRef, selectedRef, currentId, onSelect,
}: {
  references: ReferenceOption[];
  variantsByRef: ReadonlyMap<string, readonly VariantSummary[]>;
  selectedRef: ReferenceOption | undefined;
  currentId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(!currentId);
  const [refreshing, setRefreshing] = useState(false);
  const qc = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        qc.refetchQueries({ queryKey: ['technical_sheets'] }),
        qc.refetchQueries({ queryKey: ['reference_material_variants', 'all_active'] }),
      ]);
      toast.success('Referências e materiais atualizados.');
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between h-9 text-xs font-mono">
          {selectedRef
            ? (selectedRef.name || selectedRef.code)
            : "Buscar referência..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(400px,calc(100vw-2rem))] p-0" align="start">
        <ReferenceSearch
          references={references}
          onSelect={(ref) => { onSelect(ref.id); setOpen(false); }}
          selectedId={currentId}
          variantsByRef={variantsByRef}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          onCreate={() => window.open('/fichas-tecnicas?new=1', '_blank', 'noopener,noreferrer')}
        />
      </PopoverContent>
    </Popover>
  );
}
