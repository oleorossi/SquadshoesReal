import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, MagnifyingGlass, Trash, WhatsappLogo, Share, ChartBar, Clock } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  deleteDraft,
  enqueueOrder,
  loadDraft,
  loadMobileOrderCatalog,
  saveDraft,
  saveMobileOrderCatalog,
} from '@/lib/mobile/offlineQueue';
import { useOnlineStatus } from '@/lib/mobile/networkStatus';
import { triggerSync } from '@/lib/mobile/syncEngine';
import { fetchClientPriceList, fetchClientHistory, type PriceLookup, type ClientHistory } from '@/lib/mobile/clientContext';
import { searchMatchesAllTerms, searchNormOrFilter } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SignatureCanvas } from '@/components/mobile/SignatureCanvas';
import type { SaleOrderItemFormData } from '@/hooks/useSaleOrders';
import { ensureTechnicalStrapLineIds, isUuid, technicalStrapLineId } from '@/lib/technicalStrapLines';
import {
  normalizeStrapColorKey,
  setStrapSourcing,
  type StrapSourcingMap,
} from '@/lib/strapSourcing';
import { useStrapStockLines } from '@/hooks/useStrapStockLines';
import { useArtisanalStrapCatalog, type ArtisanalStrapCatalog } from '@/hooks/useArtisanalStraps';
import { isoToMonthWeek } from '@/lib/billingWeek';
import { listMissingTechnicalStrapSnapshots } from '@/lib/strapSnapshotGuard';
import { submitMobileSaleOrderAtomic } from '@/lib/mobile/atomicSaleOrder';
import { strapColorsForIdentity } from '@/lib/officialStrapColors';
import { strapIdentityBasis } from '@/lib/strapIdentity';
import {
  resolveSaleOrderItemPrice,
  type SaleOrderPriceSource,
} from '@/lib/saleOrderPricing';
import {
  activeProductColorsForGroup,
  resolveMaterialVariantColorGroup,
} from '@/lib/materialVariantColorGroup';

interface ClientLite {
  id: string;
  razao_social: string;
  nome_fantasia?: string | null;
  cnpj?: string | null;
  cidade?: string | null;
  estado?: string | null;
}

interface RefLite {
  id: string;
  name: string;
  sale_price?: number | null;
  shoe_category_id?: string | null;
  has_straps?: boolean | null;
  strap_colors?: any[] | null;
  variant_drives_upper?: boolean | null;
  variant_drives_lining?: boolean | null;
}

interface ReferenceColorVariantLite {
  reference_id: string;
  color: string;
  image_url?: string | null;
}

interface MaterialVariantLite {
  id: string;
  reference_id: string;
  material_name: string;
  sku?: string | null;
  unit_price_override?: number | null;
  main_material_group_id?: string | null;
  upper_material_product_id?: string | null;
  upper_material_group_id?: string | null;
  lining_material_product_id?: string | null;
  lining_material_group_id?: string | null;
  active?: boolean | null;
  display_order?: number | null;
}

interface ProductLite {
  id: string;
  group_id?: string | null;
  color?: string | null;
  active?: boolean | null;
}

interface ProductGroupLite {
  id: string;
  name: string;
}

interface MobileOrderCatalog {
  references: RefLite[];
  referenceColorVariants: ReferenceColorVariantLite[];
  materialVariants: MaterialVariantLite[];
  products: ProductLite[];
  productGroups: ProductGroupLite[];
}

export interface DraftItem {
  reference_id: string;
  reference_name: string;
  color: string;
  image_url?: string | null;
  grade: Record<string, number>;
  unit_price: number;
  unit_price_source?: SaleOrderPriceSource | 'manual';
  material_variant_id?: string | null;
  material_variant_name?: string | null;
  material_variant_sku?: string | null;
  strap_colors?: any[];
  strap_sourcing?: StrapSourcingMap;
}

type Step = 'client' | 'items' | 'review';

// UUID gerado uma vez por draft, identificador único pro server dedup
const newRequestId = () => crypto.randomUUID();

const SIZE_RANGE_ADULT = ['33','34','35','36','37','38','39','40'];

export const MOBILE_TECHNICAL_SHEET_SELECT = 'id, name, sale_price, shoe_category_id, has_straps, strap_colors, variant_drives_upper, variant_drives_lining';

const draftItemQuantity = (item: DraftItem) =>
  Object.values(item.grade).reduce((sum, value) => sum + (value || 0), 0);

export function repriceMobileDraftItems(
  items: DraftItem[],
  lookup: PriceLookup,
  references: RefLite[],
  materialVariants: MaterialVariantLite[],
): DraftItem[] {
  let changed = false;
  const repriced = items.map((item) => {
    // Rascunhos antigos não registravam a origem. Um valor positivo sem origem
    // pode ter sido digitado pelo vendedor e, por segurança, permanece congelado.
    if (item.unit_price_source === 'manual' || (!item.unit_price_source && item.unit_price > 0)) {
      return item;
    }
    const reference = references.find((entry) => entry.id === item.reference_id);
    if (!reference) return item;
    const variant = materialVariants.find((entry) => entry.id === item.material_variant_id);
    const resolution = resolveSaleOrderItemPrice({
      lookup,
      referenceId: item.reference_id,
      color: item.color,
      quantity: draftItemQuantity(item),
      variantPrice: variant?.unit_price_override,
      sheetPrice: reference.sale_price,
    });
    if (Math.abs(item.unit_price - resolution.price) < 0.005
        && item.unit_price_source === resolution.source) {
      return item;
    }
    changed = true;
    return {
      ...item,
      unit_price: resolution.price,
      unit_price_source: resolution.source,
    };
  });
  return changed ? repriced : items;
}

export function referencesWithMissingStrapSnapshot(items: DraftItem[], references: RefLite[]) {
  const missingIndexes = new Set(
    listMissingTechnicalStrapSnapshots(items, references).map((entry) => entry.index),
  );
  return items.filter((_, index) => missingIndexes.has(index));
}

function alignReferenceBaseStrapsToMainColor(
  straps: NonNullable<DraftItem['strap_colors']>,
  mainColor: string,
  sourcing: StrapSourcingMap | null | undefined,
) {
  const color = (mainColor || '').trim();
  const colorKey = normalizeStrapColorKey(color);
  const strapColors = straps.map((strap) => {
    if (strapIdentityBasis(strap) === 'finished_product_group') return strap;

    const sameColor = !!colorKey && normalizeStrapColorKey(strap.color) === colorKey;
    if (sameColor && strap.color === color) return strap;
    return {
      ...strap,
      color,
      color_id: sameColor ? strap.color_id || null : null,
    };
  });

  // O wrapper atômico compara cor + variante antes de decidir se uma origem
  // histórica ainda é válida. O cliente conserva o snapshot completo e deixa
  // essa decisão transacional para o servidor.
  return { strapColors, strapSourcing: sourcing || {} };
}

export function buildMobileSaleOrderItemsPayload(items: DraftItem[]): SaleOrderItemFormData[] {
  return items.map((item) => {
    const aligned = alignReferenceBaseStrapsToMainColor(
      item.strap_colors || [],
      item.color,
      item.strap_sourcing,
    );
    return {
      reference_id: item.reference_id,
      material_variant_id: item.material_variant_id || null,
      color: item.color,
      quantity: Object.values(item.grade).reduce((sum, value) => sum + (value || 0), 0),
      grade: item.grade,
      unit_price: item.unit_price,
      observation: '',
      strap_colors: aligned.strapColors,
      strap_sourcing: aligned.strapSourcing,
    } as SaleOrderItemFormData;
  });
}

/**
 * `finished_product_group` conserva cor própria, mas a origem buy_ready é
 * derivada pelo writer atômico. O cliente valida somente a identidade que o
 * servidor não pode inventar: linha/família/medida/grupo e cor canônica.
 */
export function mobileFinishedStrapIdentityIssues(
  items: DraftItem[],
  catalog?: ArtisanalStrapCatalog,
): string[] {
  return items.flatMap((item) => (item.strap_colors || []).flatMap((strap, index) => {
    if (strapIdentityBasis(strap) !== 'finished_product_group') return [];
    const label = String(strap.label || `Tira ${index + 1}`).trim();
    const context = `${item.reference_name}: ${label}`;
    if (!technicalStrapLineId(strap)
        || !isUuid(strap.strap_type_id)
        || !isUuid(strap.measure_id)
        || !isUuid(strap.identity_group_id)) {
      return [`${context} está sem identidade estrutural completa no cadastro.`];
    }
    if (!String(strap.color || '').trim() || !isUuid(strap.color_id)) {
      return [`${context} exige uma cor canônica própria.`];
    }
    if (catalog && !strapColorsForIdentity(catalog, strap, undefined)
      .some((color) => color.id === strap.color_id)) {
      return [`${context} não possui produto ativo para a cor selecionada.`];
    }
    return [];
  }));
}

export function mobileMaterialSelectionIssues(
  items: DraftItem[],
  references: RefLite[],
  materialVariants: MaterialVariantLite[],
  products: ProductLite[],
  productGroups: ProductGroupLite[],
): string[] {
  return items.flatMap((item) => {
    const variants = materialVariants.filter((variant) =>
      variant.reference_id === item.reference_id && variant.active !== false
    );
    if (item.material_variant_id && !variants.some((variant) => variant.id === item.material_variant_id)) {
      return [`${item.reference_name}: a variante de material salva não está mais ativa`];
    }
    if (variants.length === 0) return [];
    const variant = variants.find((entry) => entry.id === item.material_variant_id);
    if (!variant) return [`${item.reference_name}: selecione o material antes da cor`];
    const reference = references.find((entry) => entry.id === item.reference_id);
    const group = resolveMaterialVariantColorGroup({
      variant,
      sheet: reference,
      products,
      groups: productGroups,
    });
    if (!group) return [`${item.reference_name}: variante sem grupo efetivo de cor`];
    const colors = activeProductColorsForGroup(products, group.id);
    if (!item.color || !colors.includes(item.color.trim().toUpperCase())) {
      return [`${item.reference_name}: selecione uma cor ativa do material ${variant.material_name}`];
    }
    return [];
  });
}

function OrderProgress({ current }: { current: Step }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'client', label: 'Cliente' },
    { key: 'items', label: 'Itens' },
    { key: 'review', label: 'Revisão' },
  ];
  const currentIndex = steps.findIndex((step) => step.key === current);
  return (
    <ol aria-label="Progresso do novo pedido" className="grid grid-cols-3 gap-2">
      {steps.map((step, index) => (
        <li key={step.key} className="min-w-0">
          <div className={`h-1 rounded-full ${index <= currentIndex ? 'bg-primary' : 'bg-muted'}`} />
          <span className={`mt-1 block truncate text-[11px] font-semibold ${index === currentIndex ? 'text-primary' : 'text-muted-foreground'}`}>
            {index + 1}. {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function MobileStrapIdentityEditor({
  item,
  billingDate,
  catalog,
  onChange,
}: {
  item: DraftItem;
  billingDate: string;
  catalog?: ArtisanalStrapCatalog;
  onChange: (item: DraftItem) => void;
}) {
  const aligned = useMemo(() => alignReferenceBaseStrapsToMainColor(
    item.strap_colors || [],
    item.color,
    item.strap_sourcing,
  ), [item.color, item.strap_colors, item.strap_sourcing]);
  const quantity = Object.values(item.grade).reduce((sum, value) => sum + (value || 0), 0);
  const { data: lines = [], isLoading } = useStrapStockLines({
    referenceId: item.reference_id,
    materialVariantId: item.material_variant_id || null,
    itemColor: item.color,
    strapColors: aligned.strapColors,
    strapSourcing: aligned.strapSourcing,
    quantity,
    grade: item.grade,
    requiredAt: billingDate || null,
    billingWeek: billingDate || null,
  });
  const lineById = useMemo(() => new Map(lines.map((line) => [line.technicalStrapLineId, line])), [lines]);

  useEffect(() => {
    if (!billingDate) return;
    const fixed = aligned.strapColors.filter((strap) =>
      strapIdentityBasis(strap) === 'finished_product_group'
    );
    if (fixed.length === 0) return;
    let next = aligned.strapSourcing;
    let changed = false;
    fixed.forEach((strap) => {
      const lineId = technicalStrapLineId(strap);
      const line = lineId ? lineById.get(lineId) : undefined;
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
      if (current && (Object.keys(candidate) as Array<keyof typeof candidate>).every(
        (key) => current[key] === candidate[key],
      )) return;
      next = setStrapSourcing(next, lineId, candidate);
      changed = true;
    });
    if (changed) onChange({
      ...item,
      strap_colors: aligned.strapColors,
      strap_sourcing: next,
    });
  }, [aligned, billingDate, item, lineById, onChange]);

  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Identidade das tiras</p>
      {!billingDate && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          Informe a semana de faturamento acima para calcular quando as tiras serão necessárias.
        </p>
      )}
      {aligned.strapColors.map((strap, strapIndex) => {
        const lineId = technicalStrapLineId(strap);
        const line = lineId ? lineById.get(lineId) : undefined;
        const selection = lineId ? aligned.strapSourcing[lineId] : null;
        const usesFinishedGroup = strapIdentityBasis(strap) === 'finished_product_group';
        if (!usesFinishedGroup) {
          return (
            <div key={lineId || strapIndex} className="space-y-2 rounded-md border p-2">
              <p className="text-xs font-semibold">{strap.label || `Tira ${strapIndex + 1}`}</p>
              <div className={`rounded-md border px-3 py-2 text-xs ${item.color ? 'bg-muted/30' : 'border-destructive/50 text-destructive'}`}>
                <p className="font-semibold">{item.color || 'Defina a cor principal do item'}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Mesma cor e mesma napa do cabedal</p>
              </div>
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]">
                <p className="font-semibold text-primary">
                  {selection?.source_mode === 'buy_ready'
                    ? 'Origem comprada preservada do histórico'
                    : 'Produção interna com a napa do cabedal'}
                </p>
                {!selection?.source_mode && (
                  <p className="mt-0.5 text-muted-foreground">
                    Ao enviar, o servidor cadastra a tira exata e registra a origem automaticamente.
                  </p>
                )}
              </div>
              {!isLoading && line && !line.baseGroupId && (
                <p className="text-xs text-destructive">A referência não identifica a napa-base por UUID. Corrija o cadastro no hub.</p>
              )}
            </div>
          );
        }

        const identityColors = strapColorsForIdentity(catalog, strap, line?.baseGroupId);
        const selectedColor = catalog?.colors.find((entry) => entry.id === strap.color_id);
        const colorIsAvailable = !!strap.color_id
          && identityColors.some((entry) => entry.id === strap.color_id);
        const displayedColors = selectedColor && !colorIsAvailable
          ? [selectedColor, ...identityColors]
          : identityColors;
        const identityGroupResolved = usesFinishedGroup ? !!strap.identity_group_id : !!line?.baseGroupId;
        return (
          <div key={lineId || strapIndex} className="space-y-2 rounded-md border p-2">
            <p className="text-xs font-semibold">{strap.label || `Tira ${strapIndex + 1}`}</p>
            <Select
              value={strap.color_id || undefined}
              disabled={!catalog || isLoading || !identityGroupResolved}
              onValueChange={(colorId) => {
                const color = identityColors.find((entry) => entry.id === colorId);
                if (!color) return;
                const straps = [...(item.strap_colors || [])];
                straps[strapIndex] = { ...strap, color_id: color.id, color: color.name };
                onChange({
                  ...item,
                  strap_colors: straps,
                  strap_sourcing: setStrapSourcing(item.strap_sourcing, lineId, null),
                });
              }}
            >
              <SelectTrigger className={!strap.color_id ? 'border-amber-500/60' : ''}>
                <SelectValue placeholder={strap.color ? `${strap.color} — confirme` : 'Cor canônica'} />
              </SelectTrigger>
              <SelectContent>
                {displayedColors.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id} disabled={!identityColors.some((color) => color.id === entry.id)}>{entry.name}{entry.id === strap.color_id && !colorIsAvailable ? ' · vínculo inválido' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isLoading && !identityGroupResolved && <p className="text-xs text-destructive">A ficha não identifica o grupo do produto acabado por UUID.</p>}
            {!!catalog && identityGroupResolved && identityColors.length === 0 && <p className="text-xs text-destructive">O grupo comprado não possui produto ativo com cor canônica.</p>}
            {!!catalog && !!strap.color_id && !colorIsAvailable && <p className="text-xs text-destructive">A cor atual não pertence ao grupo de identidade resolvido.</p>}
            <div className={`min-h-10 rounded-md border px-2 py-2 text-center text-[11px] font-semibold ${selection?.source_mode === 'buy_ready' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}>
              Comprada pronta · origem fixa
            </div>
            {!!selection?.source_mode && selection.source_mode !== 'buy_ready' && (
              <p className="text-xs text-destructive">A origem registrada não corresponde ao grupo comprado. Selecione novamente a cor.</p>
            )}
            {selection?.source_mode && line?.blockReason && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{line.blockReason}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MobileNewOrder() {
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [step, setStep] = useState<Step>('client');
  const [requestId, setRequestId] = useState<string>(newRequestId());

  // Cliente
  const [clientSearch, setClientSearch] = useState('');
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);
  // F3: contexto do cliente — tabela de preço + histórico
  const [priceLookup, setPriceLookup] = useState<PriceLookup>({ byRefColor: new Map(), byRef: new Map() });
  const [priceLookupLoading, setPriceLookupLoading] = useState(false);
  const [clientHistory, setClientHistory] = useState<ClientHistory | null>(null);

  // Items
  const [refs, setRefs] = useState<RefLite[]>([]);
  const [referenceColorVariants, setReferenceColorVariants] = useState<ReferenceColorVariantLite[]>([]);
  const [materialVariants, setMaterialVariants] = useState<MaterialVariantLite[]>([]);
  const [materialProducts, setMaterialProducts] = useState<ProductLite[]>([]);
  const [materialProductGroups, setMaterialProductGroups] = useState<ProductGroupLite[]>([]);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [refSearch, setRefSearch] = useState('');
  const [billingDate, setBillingDate] = useState('');
  const { data: strapCatalog } = useArtisanalStrapCatalog(false);

  // F3: assinatura do cliente
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);
  // F3: PV criado pra share via WhatsApp pós-submit
  const [createdPvNumber, setCreatedPvNumber] = useState<string | null>(null);

  // ── Restore draft on mount ──
  useEffect(() => {
    (async () => {
      // Tenta restaurar o último rascunho não-finalizado (mais recente).
      // Simplificação: usamos uma chave fixa pra "draft em andamento".
      const draftId = localStorage.getItem('mobile-current-draft-id');
      if (draftId) {
        const data = await loadDraft(draftId);
        if (data) {
          setRequestId(draftId);
          setSelectedClient(data.client);
          setItems(data.items || []);
          setBillingDate(data.billingDate || '');
          if (data.priceLookup?.byRefColor instanceof Map && data.priceLookup?.byRef instanceof Map) {
            setPriceLookup(data.priceLookup);
          }
          if (data.client) setStep('items');
        }
      } else {
        localStorage.setItem('mobile-current-draft-id', requestId);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── F3: ao selecionar cliente, carrega price list + histórico ──
  useEffect(() => {
    let cancelled = false;
    if (!selectedClient?.id) {
      setPriceLookup({ byRefColor: new Map(), byRef: new Map() });
      setPriceLookupLoading(false);
      setClientHistory(null);
      return;
    }
    if (!online) {
      setPriceLookupLoading(false);
      return;
    }
    setPriceLookupLoading(true);
    void fetchClientPriceList(selectedClient.id)
      .then((lookup) => {
        if (!cancelled) setPriceLookup(lookup);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPriceLookupLoading(false);
      });
    void fetchClientHistory(selectedClient.id)
      .then((history) => {
        if (!cancelled) setClientHistory(history);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [selectedClient?.id, online]);

  // ── Autosave draft ──
  useEffect(() => {
    if (!selectedClient && items.length === 0) return;
    const t = setTimeout(() => {
      void saveDraft(requestId, { client: selectedClient, items, billingDate, priceLookup });
    }, 500);
    return () => clearTimeout(t);
  }, [selectedClient, items, billingDate, priceLookup, requestId]);

  // ── Carrega clientes ──
  useEffect(() => {
    if (step !== 'client') return;
    const t = setTimeout(async () => {
      let q = supabase
        .from('clients')
        .select('id, razao_social, nome_fantasia, cnpj, cidade, estado')
        .eq('active', true)
        .limit(40);
      if (clientSearch.length >= 2) {
        // search_norm (banco) ignora acento/caixa/espaço — "tamara" casa "TÂMARA".
        // searchNormOrFilter tokeniza por espaço/"/" com AND entre termos.
        const orFilter = searchNormOrFilter(clientSearch);
        if (orFilter) q = q.or(orFilter);
      }
      const { data } = await q;
      setClients(data ?? []);
    }, 200);
    return () => clearTimeout(t);
  }, [step, clientSearch]);

  // ── Carrega refs (preload no step de items) ──
  useEffect(() => {
    if (step !== 'items') return;
    let cancelled = false;
    const applyCatalog = (catalog: MobileOrderCatalog) => {
      if (cancelled) return;
      setRefs(catalog.references);
      setReferenceColorVariants(catalog.referenceColorVariants);
      setMaterialVariants(catalog.materialVariants);
      setMaterialProducts(catalog.products);
      setMaterialProductGroups(catalog.productGroups);
    };
    (async () => {
      const cached = await loadMobileOrderCatalog<MobileOrderCatalog>().catch(() => null);
      if (cached) applyCatalog(cached);
      if (!online) return;

      const { data, error } = await supabase
        .from('technical_sheets')
        .select(MOBILE_TECHNICAL_SHEET_SELECT)
        .order('name')
        .limit(100);
      if (error) throw error;
      const references = (data ?? []).map((reference) => ({
        ...reference,
        strap_colors: Array.isArray(reference.strap_colors) ? reference.strap_colors : [],
      })) as RefLite[];

      const refIds = references.map((reference) => reference.id);
      let referenceColors: ReferenceColorVariantLite[] = [];
      let activeVariants: MaterialVariantLite[] = [];
      if (refIds.length) {
        const [colorResult, materialResult] = await Promise.all([
          supabase
          .from('reference_color_variants')
          .select('reference_id, color, image_url')
          .in('reference_id', refIds),
          supabase
            .from('reference_material_variants')
            .select('id, reference_id, material_name, sku, unit_price_override, main_material_group_id, upper_material_product_id, upper_material_group_id, lining_material_product_id, lining_material_group_id, active, display_order')
            .in('reference_id', refIds)
            .eq('active', true)
            .order('display_order'),
        ]);
        if (colorResult.error) throw colorResult.error;
        if (materialResult.error) throw materialResult.error;
        referenceColors = (colorResult.data || []) as ReferenceColorVariantLite[];
        activeVariants = (materialResult.data || []) as MaterialVariantLite[];
      }

      const pinnedIds = Array.from(new Set(activeVariants.flatMap((variant) => [
        variant.upper_material_product_id,
        variant.lining_material_product_id,
      ]).filter(Boolean))) as string[];
      let pinnedProducts: ProductLite[] = [];
      if (pinnedIds.length) {
        const { data: pinned, error: pinnedError } = await supabase
          .from('products')
          .select('id, group_id, color, active')
          .in('id', pinnedIds);
        if (pinnedError) throw pinnedError;
        pinnedProducts = (pinned || []) as ProductLite[];
      }

      const pinnedGroupByProduct = new Map(pinnedProducts.map((product) => [product.id, product.group_id]));
      const groupIds = Array.from(new Set(activeVariants.flatMap((variant) => [
        variant.upper_material_group_id,
        variant.lining_material_group_id,
        variant.main_material_group_id,
        variant.upper_material_product_id ? pinnedGroupByProduct.get(variant.upper_material_product_id) : null,
        variant.lining_material_product_id ? pinnedGroupByProduct.get(variant.lining_material_product_id) : null,
      ]).filter(Boolean))) as string[];

      let products = pinnedProducts;
      let productGroups: ProductGroupLite[] = [];
      if (groupIds.length) {
        const [productResult, groupResult] = await Promise.all([
          supabase.from('products').select('id, group_id, color, active').in('group_id', groupIds),
          supabase.from('product_groups').select('id, name').in('id', groupIds),
        ]);
        if (productResult.error) throw productResult.error;
        if (groupResult.error) throw groupResult.error;
        products = Array.from(new Map(
          [...pinnedProducts, ...((productResult.data || []) as ProductLite[])]
            .map((product) => [product.id, product]),
        ).values());
        productGroups = (groupResult.data || []) as ProductGroupLite[];
      }

      const catalog: MobileOrderCatalog = {
        references,
        referenceColorVariants: referenceColors,
        materialVariants: activeVariants,
        products,
        productGroups,
      };
      applyCatalog(catalog);
      await saveMobileOrderCatalog(catalog);
    })().catch(() => {
      // O cache permanece utilizável. O submit ainda valida toda identidade.
    });
    return () => { cancelled = true; };
  }, [step, online]);

  const filteredRefs = useMemo(() => {
    if (!refSearch) return refs;
    return refs.filter(r => searchMatchesAllTerms(
      refSearch,
      r.name,
      ...referenceColorVariants.filter(v => v.reference_id === r.id).map(v => v.color),
      ...materialVariants.filter(v => v.reference_id === r.id).flatMap(v => [v.material_name, v.sku || '']),
    ));
  }, [refs, referenceColorVariants, materialVariants, refSearch]);

  const totalPairs = items.reduce(
    (s, it) => s + Object.values(it.grade).reduce((a, b) => a + (b || 0), 0),
    0,
  );
  const totalValue = items.reduce(
    (s, it) => s + Object.values(it.grade).reduce((a, b) => a + (b || 0), 0) * (it.unit_price || 0),
    0,
  );
  const unresolvedStrapSnapshots = useMemo(
    () => referencesWithMissingStrapSnapshot(items, refs),
    [items, refs],
  );
  const unresolvedStrapReferenceIds = useMemo(
    () => new Set(unresolvedStrapSnapshots.map((item) => item.reference_id)),
    [unresolvedStrapSnapshots],
  );
  const materialSelectionIssues = useMemo(
    () => mobileMaterialSelectionIssues(
      items,
      refs,
      materialVariants,
      materialProducts,
      materialProductGroups,
    ),
    [items, refs, materialVariants, materialProducts, materialProductGroups],
  );

  const variantsForReference = (referenceId: string) => materialVariants.filter((variant) =>
    variant.reference_id === referenceId && variant.active !== false
  );

  const colorsForMaterialVariant = (reference: RefLite | undefined, variant: MaterialVariantLite | undefined) => {
    const group = resolveMaterialVariantColorGroup({
      variant,
      sheet: reference,
      products: materialProducts,
      groups: materialProductGroups,
    });
    return group ? activeProductColorsForGroup(materialProducts, group.id) : [];
  };

  const automaticPrice = (
    referenceId: string,
    color: string | null,
    variant?: MaterialVariantLite,
    grade: Record<string, number> = {},
  ) => resolveSaleOrderItemPrice({
    lookup: priceLookup,
    referenceId,
    color,
    quantity: Object.values(grade).reduce((sum, value) => sum + (value || 0), 0),
    variantPrice: variant?.unit_price_override,
    sheetPrice: refs.find((entry) => entry.id === referenceId)?.sale_price,
  });

  // A tabela e o catálogo chegam de forma assíncrona (ou do cache offline).
  // Reaplica a cadeia somente aos preços automáticos; edição manual permanece.
  useEffect(() => {
    setItems((current) => repriceMobileDraftItems(
      current,
      priceLookup,
      refs,
      materialVariants,
    ));
  }, [priceLookup, refs, materialVariants]);

  const strapsForReference = (reference: RefLite, color: string) =>
    alignReferenceBaseStrapsToMainColor(
      ensureTechnicalStrapLineIds(Array.isArray(reference.strap_colors) ? reference.strap_colors : []),
      color,
      {},
    ).strapColors;

  // ── Submit ──
  const handleSubmit = async () => {
    if (!selectedClient) {
      toast.error('Selecione um cliente');
      return;
    }
    if (items.length === 0 || totalPairs === 0) {
      toast.error('Adicione ao menos 1 item com quantidade');
      return;
    }
    if (priceLookupLoading) {
      toast.error('Aguarde a tabela de preços do cliente terminar de carregar.');
      setStep('items');
      return;
    }
    if (materialSelectionIssues.length > 0) {
      toast.error(materialSelectionIssues[0]);
      setStep('items');
      return;
    }
    if (unresolvedStrapSnapshots.length > 0) {
      toast.error('Há referência com tiras habilitadas, mas sem linhas técnicas no snapshot. Corrija a ficha técnica no desktop antes de enviar.');
      setStep('items');
      return;
    }
    const hasStraps = items.some((item) => (item.strap_colors || []).length > 0);
    if (hasStraps && !billingDate) {
      toast.error('Informe o primeiro dia da semana de faturamento para calcular a necessidade das tiras.');
      setStep('items');
      return;
    }
    const missingMainStrapColor = items.find((item) =>
      !item.color.trim()
      && (item.strap_colors || []).some((strap) =>
        strapIdentityBasis(strap) === 'reference_base'
      )
    );
    if (missingMainStrapColor) {
      toast.error(`${missingMainStrapColor.reference_name}: defina a cor principal do cabedal antes de enviar.`);
      setStep('items');
      return;
    }
    const finishedIdentityIssues = mobileFinishedStrapIdentityIssues(items, strapCatalog);
    if (finishedIdentityIssues.length > 0) {
      toast.error(finishedIdentityIssues[0]);
      setStep('items');
      return;
    }

    const billing = billingDate ? isoToMonthWeek(billingDate) : null;

    // Strings vazias em colunas date/numeric quebram o PostgREST com
    // "invalid input syntax" (auditoria 24/05/2026). Campos opcionais
    // vão como null quando vazios.
    const orderPayload: any = {
      client_request_id: requestId,
      client_id: selectedClient.id,
      client_name: selectedClient.razao_social,
      client_cnpj: selectedClient.cnpj || '',
      client_contact: '',
      client_order_number: '',
      representative: '',
      payment_condition: '',
      delivery_deadline: billingDate || null,
      delivery_week: billing?.week || '',
      delivery_month: billing?.month || '',
      notes: '',
      status: 'Aprovado',
      nfe: '',
      remessa: '',
      is_factoring: false,
      factoring_config_id: null,
      // F3 (24/05/2026): assinatura digital opcional
      client_signature_data_url: signatureDataUrl,
      client_signature_at: signatureDataUrl ? new Date().toISOString() : null,
    };

    // sale_order_items NÃO tem coluna reference_name (auditoria 24/05/2026
    // mostrou HTTP 400 "column does not exist"). Nome vem via JOIN com
    // technical_sheets quando exibido.
    const itemsPayload = buildMobileSaleOrderItemsPayload(items);

    // Se online, tenta enviar direto. Senão (ou se falhar), enfileira.
    // Bug fix 24/05/2026: incluir `total` calculado no payload — sem isso,
    // sale_orders gravava total=0 (campo é populated client-side, não
    // tem default no schema).
    orderPayload.total = totalValue;

    let sent = false;
    let pvNumberLocal: string | null = null;
    if (online) {
      try {
        const created = await submitMobileSaleOrderAtomic({
          order: orderPayload,
          items: itemsPayload,
          client_id: selectedClient.id,
        });
        const { data: createdHeader, error: headerError } = await supabase
          .from('sale_orders')
          .select('order_number')
          .eq('id', created.order_id)
          .single();
        if (headerError) throw headerError;
        sent = true;
        pvNumberLocal = createdHeader?.order_number || null;
        setCreatedPvNumber(pvNumberLocal);
        toast.success(`PV ${createdHeader?.order_number || ''} enviado!`);
      } catch (e) {
        // Fall through to enqueue
      }
    }

    if (!sent) {
      await enqueueOrder({
        order: orderPayload,
        items: itemsPayload,
        client_id: selectedClient.id,
      });
      toast.success(`Pedido salvo (${online ? 'tentando reenviar' : 'modo offline'})`);
      if (online) void triggerSync();
    }

    // Limpa rascunho local
    await deleteDraft(requestId);
    localStorage.removeItem('mobile-current-draft-id');
    // F3: se PV foi criado direto (online), mostra tela de sucesso com
    // share antes de voltar pra home. Offline volta direto pra home.
    // NOTA: usa `pvNumberLocal` (variável local) em vez de `createdPvNumber`
    // state — setState é async e o closure leria valor antigo (null).
    if (sent && pvNumberLocal !== null) {
      setStep('success' as any);
    } else {
      navigate('/m');
    }
  };

  // F3: gera link WhatsApp pré-preenchido com PV details
  const shareWhatsApp = () => {
    if (!selectedClient) return;
    const pv = createdPvNumber || requestId.slice(0, 8);
    const itemsLines = items.map(it => {
      const qty = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
      return `· ${it.reference_name} ${it.color} · ${qty} pares · R$ ${(qty * it.unit_price).toFixed(2)}`;
    }).join('\n');
    const text = encodeURIComponent(
      `Pedido ${pv} — ${selectedClient.razao_social}\n\n${itemsLines}\n\nTotal: R$ ${totalValue.toFixed(2)} (${totalPairs} pares)`,
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  // ── Renderização por step ──
  if (step === 'client') {
    return (
      <div className="p-4 space-y-4">
        <OrderProgress current="client" />
        <div>
          <h2 className="text-xl font-bold">Escolha o cliente</h2>
          <p className="mt-1 text-sm text-muted-foreground">Depois você inclui referências, cores e grades.</p>
        </div>
        <SearchInput
          value={clientSearch}
          onChange={setClientSearch}
          placeholder="Buscar por nome, fantasia ou nº do cliente…"
          inputClassName="h-12 text-base rounded-lg"
          hideHint
          autoFocus
        />
        <ul className="divide-y divide-border">
          {clients.map(c => (
            <li key={c.id}>
              <button
                onClick={() => {
                  // Nunca deixa a tabela do cliente anterior precificar o novo.
                  setPriceLookup({ byRefColor: new Map(), byRef: new Map() });
                  setPriceLookupLoading(online);
                  setClientHistory(null);
                  setSelectedClient(c);
                  setStep('items');
                }}
                className="min-h-14 w-full rounded-md p-3 text-left transition-colors active:bg-muted/40"
              >
                <p className="font-bold text-foreground">{c.nome_fantasia || c.razao_social}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {c.cidade || '—'}{c.estado ? `/${c.estado}` : ''} · {c.cnpj || 'sem CNPJ'}
                </p>
              </button>
            </li>
          ))}
          {clients.length === 0 && (
            clientSearch.trim().length >= 2 ? (
              <li>
                <EmptyState
                  size="sm"
                  icon={MagnifyingGlass}
                  title={`Nenhum resultado para "${clientSearch}"`}
                  action={
                    <Button variant="outline" size="sm" onClick={() => setClientSearch('')}>
                      Limpar busca
                    </Button>
                  }
                />
              </li>
            ) : (
              <li className="p-6 text-center text-muted-foreground text-sm">
                Nenhum cliente encontrado. Digite ao menos 2 letras.
              </li>
            )
          )}
        </ul>
      </div>
    );
  }

  if (step === 'items') {
    return (
      <div className="p-4 space-y-4 pb-32">
        <OrderProgress current="items" />
        <div className="flex items-center justify-between">
          <button onClick={() => setStep('client')} className="flex items-center gap-1 text-muted-foreground">
            <ArrowLeft className="h-5 w-5" />
            <span className="text-sm">Cliente</span>
          </button>
          <button
            onClick={() => {
              if (priceLookupLoading) {
                toast.error('Aguarde a tabela de preços do cliente terminar de carregar.');
                return;
              }
              if (materialSelectionIssues.length > 0) {
                toast.error(materialSelectionIssues[0]);
                return;
              }
              setStep('review');
            }}
            disabled={priceLookupLoading || items.length === 0 || unresolvedStrapSnapshots.length > 0 || materialSelectionIssues.length > 0}
            className="text-primary font-bold disabled:text-muted-foreground"
          >
            Revisar →
          </button>
        </div>

        <div className="bg-muted/40 rounded-lg p-3">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Cliente</p>
          <p className="font-bold text-sm">{selectedClient?.razao_social}</p>
          {priceLookupLoading && (
            <p className="mt-1 text-xs text-muted-foreground">Atualizando tabela de preços…</p>
          )}
        </div>

        <div>
          <h2 className="text-xl font-bold">Inclua os itens</h2>
          <p className="mt-1 text-sm text-muted-foreground">Revise grade e preço de cada referência antes de confirmar.</p>
        </div>

        {unresolvedStrapSnapshots.length > 0 && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <p className="font-bold text-destructive">Demanda de tira não resolvida</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {unresolvedStrapSnapshots.map((entry) => entry.reference_name).join(', ')} usa tira, mas não possui linhas técnicas no snapshot. Corrija a ficha técnica no desktop; o app não inventa linhas de consumo.
            </p>
          </div>
        )}

        {materialSelectionIssues.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-bold text-amber-800 dark:text-amber-300">Identidade comercial incompleta</p>
            <p className="mt-1 text-xs text-muted-foreground">{materialSelectionIssues[0]}</p>
          </div>
        )}

        {items.some((entry) => (entry.strap_colors || []).length > 0) && (
          <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
            <label htmlFor="mobile-billing-week" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Primeiro dia da semana de faturamento *
            </label>
            <Input
              id="mobile-billing-week"
              type="date"
              value={billingDate}
              onChange={(event) => setBillingDate(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              A necessidade é recalculada retroativamente a partir desta semana, sem apagar identidades já resolvidas.
            </p>
          </div>
        )}

        {/* Items atuais */}
        {items.map((it, idx) => {
          const itemTotal = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
          const reference = refs.find((entry) => entry.id === it.reference_id);
          const itemMaterialVariants = variantsForReference(it.reference_id);
          const selectedMaterialVariant = itemMaterialVariants.find((entry) => entry.id === it.material_variant_id);
          const materialColors = colorsForMaterialVariant(reference, selectedMaterialVariant);
          return (
            <div key={idx} className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
              <div className="flex items-start gap-3">
                {it.image_url ? (
                  <img src={it.image_url} alt={it.reference_name} width="56" height="56" loading="lazy" decoding="async" className="h-14 w-14 object-cover rounded" />
                ) : (
                  <div className="h-14 w-14 bg-muted rounded" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm truncate">{it.reference_name}</p>
                  <p className="text-xs text-muted-foreground uppercase">{it.color}</p>
                  {(selectedMaterialVariant || it.material_variant_name) && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {selectedMaterialVariant?.material_name || it.material_variant_name}
                      {(selectedMaterialVariant?.sku || it.material_variant_sku)
                        ? ` · SKU ${selectedMaterialVariant?.sku || it.material_variant_sku}`
                        : ''}
                    </p>
                  )}
                  <p className="text-sm font-mono mt-1">
                    {itemTotal} pares · R$ {(itemTotal * it.unit_price).toFixed(2)}
                  </p>
                  {it.unit_price > 0 && (
                    <p className="text-[10px] text-emerald-700 font-mono mt-0.5">
                      R$ {it.unit_price.toFixed(2)}/par ({it.unit_price_source === 'material_variant'
                        ? 'preço próprio da variante'
                        : it.unit_price_source === 'manual'
                          ? 'editado e congelado'
                          : it.unit_price_source?.startsWith('table_')
                            ? 'tabela'
                            : 'preço congelado'})
                    </p>
                  )}
                </div>
                <button aria-label={`Remover ${it.reference_name}`} onClick={() => setItems(items.filter((_, i) => i !== idx))} className="-mr-2 -mt-2 min-h-11 min-w-11 text-destructive">
                  <Trash className="h-5 w-5" />
                </button>
              </div>
              {itemMaterialVariants.length > 0 && (
                <div className="mt-3 grid gap-2 rounded-md border bg-muted/20 p-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Material *
                    </label>
                    <Select
                      value={it.material_variant_id || undefined}
                      onValueChange={(variantId) => {
                        const variant = itemMaterialVariants.find((entry) => entry.id === variantId);
                        if (!variant) return;
                        setItems((current) => current.map((entry, currentIndex) => {
                          if (currentIndex !== idx) return entry;
                          const price = automaticPrice(entry.reference_id, null, variant, entry.grade);
                          return {
                            ...entry,
                            material_variant_id: variant.id,
                            material_variant_name: variant.material_name,
                            material_variant_sku: variant.sku || null,
                            color: '',
                            image_url: undefined,
                            unit_price: price.price,
                            unit_price_source: price.source,
                            strap_colors: reference ? strapsForReference(reference, '') : [],
                            strap_sourcing: {},
                          };
                        }));
                      }}
                    >
                      <SelectTrigger className={!it.material_variant_id ? 'border-amber-500/60' : ''}>
                        <SelectValue placeholder="Selecione o material primeiro" />
                      </SelectTrigger>
                      <SelectContent>
                        {itemMaterialVariants.map((variant) => (
                          <SelectItem key={variant.id} value={variant.id}>
                            {variant.material_name}{variant.sku ? ` · SKU ${variant.sku}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      Cor *
                    </label>
                    <Select
                      value={it.color || undefined}
                      disabled={!selectedMaterialVariant || materialColors.length === 0}
                      onValueChange={(color) => {
                        if (!selectedMaterialVariant || !materialColors.includes(color)) return;
                        const image = referenceColorVariants.find((variant) =>
                          variant.reference_id === it.reference_id
                          && variant.color.trim().toUpperCase() === color
                        )?.image_url;
                        setItems((current) => current.map((entry, currentIndex) => {
                          if (currentIndex !== idx) return entry;
                          const price = automaticPrice(
                            entry.reference_id,
                            color,
                            selectedMaterialVariant,
                            entry.grade,
                          );
                          return {
                            ...entry,
                            color,
                            image_url: image || undefined,
                            unit_price: price.price,
                            unit_price_source: price.source,
                            strap_colors: reference ? strapsForReference(reference, color) : [],
                            strap_sourcing: {},
                          };
                        }));
                      }}
                    >
                      <SelectTrigger className={!it.color ? 'border-amber-500/60' : ''}>
                        <SelectValue placeholder={selectedMaterialVariant ? 'Selecione a cor do grupo efetivo' : 'Escolha o material antes'} />
                      </SelectTrigger>
                      <SelectContent>
                        {materialColors.map((color) => <SelectItem key={color} value={color}>{color}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    {selectedMaterialVariant && materialColors.length === 0 && (
                      <p className="mt-1 text-xs text-destructive">O grupo efetivo não possui produto ativo com cor.</p>
                    )}
                  </div>
                </div>
              )}
              {unresolvedStrapReferenceIds.has(it.reference_id) && (
                <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs font-medium text-destructive">
                  Ficha com tiras habilitadas e snapshot vazio — item bloqueado.
                </p>
              )}
              <details className="mt-2">
                <summary className="text-xs text-primary cursor-pointer">Editar grade</summary>
                <GradeEditor
                  grade={it.grade}
                  onChange={(grade) => setItems((current) => {
                    const withGrade = current.map((entry, currentIndex) =>
                      currentIndex === idx ? { ...entry, grade } : entry
                    );
                    return repriceMobileDraftItems(
                      withGrade,
                      priceLookup,
                      refs,
                      materialVariants,
                    );
                  })}
                />
                <div className="mt-2 flex items-center gap-2">
                  <label className="text-xs text-muted-foreground">Preço/par:</label>
                  <NumberInput
                    value={it.unit_price}
                    onChange={n => setItems(items.map((x, i) => i === idx ? { ...x, unit_price: n, unit_price_source: 'manual' } : x))}
                    className="w-24 px-2 py-1 text-sm border rounded font-mono"
                  />
                </div>
              </details>
              {(it.strap_colors || []).length > 0 && (
                <MobileStrapIdentityEditor
                  item={it}
                  billingDate={billingDate}
                  catalog={strapCatalog}
                  onChange={(next) => setItems(items.map((current, currentIndex) => currentIndex === idx ? next : current))}
                />
              )}
            </div>
          );
        })}

        {/* Adicionar novo item */}
        <details className="border-[1.5px] border-dashed border-foreground/20 rounded-lg p-3" open={items.length === 0}>
          <summary className="font-bold text-sm cursor-pointer">+ Adicionar referência</summary>
          <SearchInput
            className="mt-2"
            inputClassName="h-9 text-sm"
            value={refSearch}
            onChange={setRefSearch}
            placeholder="Buscar referência por nome ou cor…"
            resultCount={filteredRefs.length}
            totalCount={refs.length}
            hideHint
          />
          {refSearch && filteredRefs.length === 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span className="truncate">Nenhum resultado para "{refSearch}"</span>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => setRefSearch('')}>
                Limpar busca
              </Button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mt-2 max-h-64 overflow-y-auto">
            {filteredRefs.slice(0, 30).map(r => {
              const refColorVariants = referenceColorVariants.filter(v => v.reference_id === r.id);
              const refMaterialVariants = variantsForReference(r.id);
              return (
                <div key={r.id} className="border rounded p-2">
                  <p className="text-xs font-bold truncate">{r.name}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {refMaterialVariants.length > 0 ? (
                      <button
                        onClick={() => {
                          setItems([...items, {
                            reference_id: r.id,
                            reference_name: r.name,
                            material_variant_id: null,
                            material_variant_name: null,
                            material_variant_sku: null,
                            color: '',
                            grade: {},
                            unit_price: 0,
                            strap_colors: strapsForReference(r, ''),
                            strap_sourcing: {},
                          }]);
                          setRefSearch('');
                        }}
                        className="rounded bg-primary/10 px-2 py-1 text-xs font-semibold text-primary"
                      >+ escolher material</button>
                    ) : refColorVariants.length === 0 ? (
                      <button
                        onClick={() => {
                          setItems([...items, {
                            reference_id: r.id,
                            reference_name: r.name,
                            color: '',
                            grade: {},
                            unit_price: automaticPrice(r.id, null).price,
                            unit_price_source: automaticPrice(r.id, null).source,
                            strap_colors: strapsForReference(r, ''),
                            strap_sourcing: {},
                          }]);
                          setRefSearch('');
                        }}
                        className="text-xs px-2 py-1 bg-muted rounded"
                      >+ sem cor</button>
                    ) : refColorVariants.slice(0, 4).map(v => (
                      <button
                        key={v.color}
                        onClick={() => {
                          setItems([...items, {
                            reference_id: r.id,
                            reference_name: r.name,
                            color: v.color,
                            image_url: v.image_url || undefined,
                            grade: {},
                            unit_price: automaticPrice(r.id, v.color).price,
                            unit_price_source: automaticPrice(r.id, v.color).source,
                            strap_colors: strapsForReference(r, v.color),
                            strap_sourcing: {},
                          }]);
                          setRefSearch('');
                        }}
                        className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded uppercase"
                      >{v.color}</button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    );
  }

  // F3: Success screen pós-submit (com share WhatsApp)
  if (step === ('success' as any)) {
    return (
      <div className="p-4 space-y-4 text-center">
        <div className="py-8">
          <div className="inline-flex h-16 w-16 rounded-full bg-emerald-500/20 items-center justify-center">
            <Check className="h-8 w-8 text-emerald-600" weight="bold" />
          </div>
        </div>
        <h2 className="text-2xl font-bold">Pedido enviado!</h2>
        {createdPvNumber && (
          <p className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
            {createdPvNumber}
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {totalPairs} pares · R$ {totalValue.toFixed(2)}
        </p>
        <div className="space-y-2 pt-4">
          {/* Verde WhatsApp — cor de marca, exceção deliberada aos tokens */}
          <button
            onClick={shareWhatsApp}
            className="w-full bg-[#25D366] text-white rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2"
          >
            <WhatsappLogo className="h-5 w-5" weight="bold" />
            Enviar pelo WhatsApp
          </button>
          <button
            onClick={() => {
              if (navigator.share && selectedClient) {
                navigator.share({
                  title: `Pedido ${createdPvNumber || ''}`,
                  text: `${selectedClient.razao_social} · ${totalPairs} pares · R$ ${totalValue.toFixed(2)}`,
                }).catch(() => {});
              }
            }}
            className="w-full border-[1.5px] border-foreground/20 rounded-lg py-3 font-bold uppercase tracking-wide flex items-center justify-center gap-2"
          >
            <Share className="h-4 w-4" />
            Compartilhar
          </button>
          <button
            onClick={() => navigate('/m')}
            className="w-full text-muted-foreground rounded-lg py-3 text-sm uppercase tracking-wide"
          >
            Voltar ao início
          </button>
        </div>
      </div>
    );
  }

  // Review step
  return (
    <div className="p-4 space-y-4 pb-32">
      <OrderProgress current="review" />
      <div className="flex items-center justify-between">
        <button onClick={() => setStep('items')} className="flex items-center gap-1 text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
          <span className="text-sm">Itens</span>
        </button>
        <span className="text-xs font-mono uppercase tracking-widest text-muted-foreground">3 · Revisão</span>
      </div>

      <h2 className="text-xl font-bold">Confirmar pedido</h2>

      <div className="bg-muted/40 rounded-lg p-3">
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Cliente</p>
        <p className="font-bold">{selectedClient?.razao_social}</p>
        <p className="text-xs text-muted-foreground">{selectedClient?.cnpj}</p>
      </div>

      {billingDate && items.some((entry) => (entry.strap_colors || []).length > 0) && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Semana de faturamento</p>
          <p className="font-semibold">{new Date(`${billingDate}T12:00:00`).toLocaleDateString('pt-BR')}</p>
        </div>
      )}

      {/* F3: Histórico do cliente (últimos 12 meses) */}
      {clientHistory && clientHistory.totalOrders > 0 && (
        <div className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
          <div className="flex items-center gap-1.5 mb-2">
            <ChartBar className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
              Histórico (12m)
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-xl font-bold tabular-nums">{clientHistory.totalOrders}</p>
              <p className="text-[10px] text-muted-foreground uppercase">pedidos</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">{clientHistory.totalPairs}</p>
              <p className="text-[10px] text-muted-foreground uppercase">pares</p>
            </div>
            <div>
              <p className="text-xl font-bold tabular-nums">
                {clientHistory.avgTicket > 1000
                  ? `${(clientHistory.avgTicket / 1000).toFixed(1)}k`
                  : clientHistory.avgTicket.toFixed(0)}
              </p>
              <p className="text-[10px] text-muted-foreground uppercase">ticket</p>
            </div>
          </div>
          {clientHistory.lastOrderDate && (
            <p className="text-[10px] text-muted-foreground text-center mt-2 flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Último: {new Date(clientHistory.lastOrderDate).toLocaleDateString('pt-BR')}
            </p>
          )}
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-widest text-muted-foreground font-mono mb-1">Itens ({items.length})</p>
        <ul className="divide-y divide-border border rounded-lg">
          {items.map((it, idx) => {
            const qty = Object.values(it.grade).reduce((a, b) => a + (b || 0), 0);
            return (
              <li key={idx} className="p-3 flex items-center gap-3">
                {it.image_url && <img src={it.image_url} alt="" width="40" height="40" loading="lazy" decoding="async" className="h-10 w-10 object-cover rounded" />}
                <div className="flex-1">
                  <p className="text-sm font-bold">{it.reference_name}</p>
                  <p className="text-xs text-muted-foreground">{it.color} · {qty} pares</p>
                  {it.material_variant_name && (
                    <p className="text-[11px] text-muted-foreground">
                      {it.material_variant_name}{it.material_variant_sku ? ` · SKU ${it.material_variant_sku}` : ''}
                    </p>
                  )}
                </div>
                <span className="font-mono text-sm">R$ {(qty * it.unit_price).toFixed(2)}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t-2 border-foreground pt-3 flex items-baseline justify-between">
        <span className="text-sm uppercase tracking-widest text-muted-foreground font-mono">Total</span>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums">R$ {totalValue.toFixed(2)}</p>
          <p className="text-xs text-muted-foreground">{totalPairs} pares</p>
        </div>
      </div>

      {/* F3: Assinatura digital do cliente — opcional, fica gravada como
          PNG base64 em sale_orders.client_signature_data_url. */}
      <div className="border-[1.5px] border-foreground/15 rounded-lg p-3 bg-card">
        {signatureDataUrl ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
                Assinatura confirmada
              </span>
              <button
                onClick={() => { setSignatureDataUrl(null); setShowSignature(false); }}
                className="text-xs text-destructive"
              >
                Refazer
              </button>
            </div>
            <img
              src={signatureDataUrl}
              alt="Assinatura"
              style={{ background: '#fff' }}
              className="w-full max-h-32 object-contain border border-border rounded"
            />
          </div>
        ) : showSignature ? (
          <SignatureCanvas
            onConfirm={(url) => { setSignatureDataUrl(url); setShowSignature(false); }}
            label="Cliente assina aqui"
          />
        ) : (
          <button
            onClick={() => setShowSignature(true)}
            className="w-full py-3 text-sm text-foreground border-[1.5px] border-dashed border-foreground/30 rounded-lg uppercase tracking-wide"
          >
            + Capturar assinatura (opcional)
          </button>
        )}
      </div>

      {!online && (
        <div className="border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg p-3 text-sm">
          ⚠ Você está offline. O pedido vai pra fila e será enviado quando a rede voltar.
        </div>
      )}

      <button
        onClick={handleSubmit}
        className="w-full bg-primary text-primary-foreground rounded-lg py-4 font-bold uppercase tracking-wide active:opacity-80 flex items-center justify-center gap-2"
      >
        <Check className="h-5 w-5" weight="bold" />
        {online ? 'Enviar pedido' : 'Salvar offline'}
      </button>
    </div>
  );
}

// ── Helper: editor de grade ─────────────────────────────────────────────────

function GradeEditor({ grade, onChange }: { grade: Record<string, number>; onChange: (g: Record<string, number>) => void }) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-2">
      {SIZE_RANGE_ADULT.map(sz => (
        <div key={sz} className="border rounded p-1 text-center">
          <p className="text-[10px] font-mono uppercase">{sz}</p>
          <NumberInput
            min={0}
            decimals={0}
            value={grade[sz]}
            onChange={n => onChange({ ...grade, [sz]: n })}
            className="w-full text-center text-sm font-mono py-1"
          />
        </div>
      ))}
    </div>
  );
}
