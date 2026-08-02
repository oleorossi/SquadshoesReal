import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { CircleNotch as Loader2, Package, Warning as AlertTriangle, Check, PencilSimple as Pencil, Flask as FlaskConical, ArrowRight, Scissors } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { sanitizeUuidFields, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { UNITS, LOCATIONS } from '@/types/inventory';
import { sectorOfGroup, sectorLabel } from '@/lib/categoryFromGroup';
// Normalizador ESTRITO agora vem da fonte única — era a TERCEIRA cópia no
// projeto (spec `duplicata-no-cadastro.md` R1.2). Implementação idêntica: a
// regra de duplicata desta tela, que já trava por confirmação e conhece
// particularidades da tira, NÃO mudou.
import { normalizeStrict as normalizeForComparison } from '@/lib/duplicateDetection';
import { useGroups } from '@/hooks/useGroups';
import { useContractors } from '@/hooks/useContractors';
import { useCreateArtisanalRecipe } from '@/hooks/useArtisanalRecipes';

/** Normaliza p/ comparar cor/nome sem acento nem caixa (napa CAFÉ = CAFE etc). */
const normKey = (v: string) =>
  (v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  groupName: string;
  color: string;
  onCreated: () => void;
  /**
   * Ficha técnica do item do PV. Quando informada, a FAMÍLIA da napa-base sai
   * dela (`strap_base_family_for_sheet`) — a mesma fonte que reserva/débito
   * usam. Sem ela o diálogo cai na família escolhida à mão (uso fora do PV,
   * ex.: Estoque → Grupos).
   */
  referenceId?: string | null;
  /**
   * Variante de material do item do PV. A MESMA ficha vende em NAPA SOFT, GLOW
   * METALIC e NAPA SUDANI — a variante é quem diz de qual napa a tira sai, e
   * ela VENCE o material da ficha (mig 20261026120000). Sem isso o diálogo
   * mostrava a família da ficha e acusava o usuário de divergir, enquanto o
   * débito travava a OP procurando napa numa família que o item não usa.
   */
  materialVariantId?: string | null;
}

type SimilarProduct = {
  id: string;
  name: string;
  color: string;
  category: string;
  group_id: string | null;
  quantity: number;
  unit: string;
  sku?: string;
  unit_price?: number;
};

/** Produto + nome do grupo — base da checagem de duplicata ENTRE grupos. */
type ProductWithGroup = SimilarProduct & { groupName: string };

/** Resolução da napa-base (RPC resolve_strap_base_napa) exibida na criação. */
type NapaResolution = {
  base_product_id: string | null;
  base_product_name: string | null;
  yield_per_meter: number | null;
  recipe_id: string | null;
  block_reason: string | null;
};


const fuzzyMatch = (a: string, b: string) => {
  const na = normalizeForComparison(a);
  const nb = normalizeForComparison(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check token overlap
  const tokensA = new Set(a.toLowerCase().split(/[\s:,\-_/]+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/[\s:,\-_/]+/).filter(Boolean));
  let overlap = 0;
  for (const t of tokensA) {
    for (const tb of tokensB) {
      if (t === tb || t.includes(tb) || tb.includes(t)) { overlap++; break; }
    }
  }
  return overlap >= Math.min(tokensA.size, tokensB.size) && overlap >= 1;
};

const normalizeSkuPart = (value: string, fallback: string, maxLength: number) => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, maxLength);

  return normalized || fallback;
};

const deriveSkuFromBase = (baseSku: string, color: string) => {
  const trimmedBase = baseSku.trim();
  if (!trimmedBase) return '';

  const parts = trimmedBase.split('-').filter(Boolean);
  const colorToken = normalizeSkuPart(color, 'COR', 4);

  if (parts.length > 1) {
    parts[parts.length - 1] = colorToken;
    return parts.join('-');
  }

  return `${trimmedBase}-${colorToken}`;
};

const buildFallbackSku = (groupName: string, color: string, attempt = 0) => {
  const groupToken = normalizeSkuPart(groupName, 'TIRA', 6);
  const colorToken = normalizeSkuPart(color, 'COR', 4);
  const timeToken = Date.now().toString(36).toUpperCase().slice(-4);
  const attemptToken = String(attempt).padStart(2, '0');

  return `${groupToken}-${colorToken}-${timeToken}${attemptToken}`;
};

const resolveUniqueSku = async (preferredSku: string, groupName: string, color: string) => {
  const candidates = [preferredSku.trim(), ...Array.from({ length: 6 }, (_, idx) => buildFallbackSku(groupName, color, idx))]
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);

  const tried = new Set<string>();

  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    const { data: existingSku } = await supabase
      .from('products')
      .select('id')
      .eq('sku', candidate)
      .maybeSingle();

    if (!existingSku) return candidate;
  }

  return `${normalizeSkuPart(groupName, 'TIRA', 6)}-${normalizeSkuPart(color, 'COR', 4)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
};

export default function CreateStrapProductDialog({ open, onOpenChange, groupId, groupName, color, onCreated, referenceId, materialVariantId }: Props) {
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const { data: contractors = [] } = useContractors();
  const createRecipe = useCreateArtisanalRecipe();
  const group = groups.find(g => g.id === groupId);
  const [loading, setLoading] = useState(false);
  const [prefilling, setPrefilling] = useState(true);
  const [similarProducts, setSimilarProducts] = useState<ProductWithGroup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SimilarProduct | null>(null);
  /** Catálogo ativo (≈200 linhas) com o nome do grupo — duplicata ENTRE grupos. */
  const [catalog, setCatalog] = useState<ProductWithGroup[]>([]);
  /** Segundo clique libera a criação mesmo com duplicata (aviso, não bloqueio). */
  const [dupAck, setDupAck] = useState(false);
  /** Família da napa que a PRODUÇÃO vai usar (variante do item > ficha). */
  const [sheetFamily, setSheetFamily] = useState('');
  /** true quando a família acima veio da VARIANTE do item, não da ficha crua. */
  const [familyFromVariant, setFamilyFromVariant] = useState(false);
  /** Produto-sonda do grupo: resolve_strap_base_napa lê o GRUPO dele, não a cor. */
  const [probeProductId, setProbeProductId] = useState<string | null>(null);
  const [napa, setNapa] = useState<NapaResolution | null>(null);
  const [napaLoading, setNapaLoading] = useState(false);

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  // Cor como CAMPO explícito (products.color = fonte única de cor). Inicializa do
  // clique no PV mas é editável; ao mudar, re-deriva Nome e SKU.
  const [colorInput, setColorInput] = useState('');
  const [groupColors, setGroupColors] = useState<string[]>([]);
  const [skuBase, setSkuBase] = useState('');
  const [category, setCategory] = useState('');
  // Default 'm' pra grupos de tira/elástico (são sempre vendidos por metro).
  // Antes default 'un' deixava o débito por metros divergente do estoque.
  const isStrapLikeGroup = /tira|elastic|tranç/i.test(groupName || '');
  const [unit, setUnit] = useState(isStrapLikeGroup ? 'm' : 'un');
  const [unitPrice, setUnitPrice] = useState(0);
  const [location, setLocation] = useState('');
  const [minStock, setMinStock] = useState(0);
  const [maxStock, setMaxStock] = useState(0);
  const [initialStock, setInitialStock] = useState(0);
  const [yieldPerMeter, setYieldPerMeter] = useState<number | null>(null);
  const [yieldUnit, setYieldUnit] = useState('dm²');
  const [dimLength, setDimLength] = useState(0);
  const [dimWidth, setDimWidth] = useState(0);
  const [dimThickness, setDimThickness] = useState(0);
  const [dimUnit, setDimUnit] = useState('mm');

  // ── Produção artesanal (a tira é CORTADA de uma napa base da MESMA cor) ──────
  // Cadastrar "como nas outras tiras" = criar o produto final + marcar artesanal
  // + garantir a receita (tipo → base). A base é POR COR: o mesmo tipo pode ter
  // 2 receitas (ex.: NAPA SOFT e NAPA MADRID) — o débito da OS resolve pela
  // receita escolhida na produção, então nada aqui reescreve a base das outras cores.
  const [isArtisanal, setIsArtisanal] = useState(false);
  // Só grupos de tira (ou que já têm receita) mostram a seção artesanal — pro
  // reuso deste dialog em cabedal/forração (napa) não aparecer seção irrelevante.
  const [canBeArtisanal, setCanBeArtisanal] = useState(false);
  const [baseMaterial, setBaseMaterial] = useState('');
  const [recipeYield, setRecipeYield] = useState(1);
  const [recipeCutWidth, setRecipeCutWidth] = useState(0);
  const [recipeLabor, setRecipeLabor] = useState(0);
  const [contractorId, setContractorId] = useState('');
  // Grupos (nomes normalizados) que TÊM a cor atual — pra checagem de cobertura da base.
  const [colorBaseNorm, setColorBaseNorm] = useState<Set<string>>(new Set());

  // Grupos ativos que TÊM um produto na cor `c` (ex.: NAPA MADRID tem CAPUCCINO).
  // Serve pra pré-escolher a base e avisar quando a napa não cobre a cor.
  const loadColorBases = async (c: string): Promise<string[]> => {
    const col = (c || '').trim();
    if (!col) { setColorBaseNorm(new Set()); return []; }
    const { data } = await supabase
      .from('products')
      .select('color, product_groups(name)')
      .eq('active', true)
      .ilike('color', col);
    const names = Array.from(new Set(
      (data || [])
        .filter((r: any) => normKey(r.color) === normKey(col))
        .map((r: any) => (r.product_groups?.name || '').trim())
        .filter(Boolean),
    ));
    setColorBaseNorm(new Set(names.map(normKey)));
    return names;
  };

  useEffect(() => {
    if (!open || !groupId) return;
    setPrefilling(true);
    setSimilarProducts([]);
    // Sem tela-interstício: o formulário abre DIRETO e os similares viram um
    // aviso no topo dele. Antes todo cadastro de cor que tivesse qualquer
    // similar exigia um clique extra em "Cadastrar novo mesmo assim".
    setShowForm(true);
    setDupAck(false);
    setNapa(null);
    setSheetFamily('');
    setProbeProductId(null);
    setColorInput(color);

    (async () => {
      const { data: lastProduct } = await supabase
        .from('products')
        .select('*')
        .eq('group_id', groupId)
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (lastProduct) {
        setCategory(lastProduct.category || '');
        // Se o grupo é tira/elástico, força 'm' independente do produto anterior
        // (que pode estar com unit errado — bug conhecido em alguns cadastros).
        setUnit(isStrapLikeGroup ? 'm' : (lastProduct.unit || 'un'));
        setUnitPrice(lastProduct.unit_price || 0);
        setLocation(lastProduct.location || '');
        setMinStock(lastProduct.min_stock || 0);
        setMaxStock(lastProduct.max_stock || 0);
        setYieldPerMeter(lastProduct.yield_per_meter);
        setYieldUnit(lastProduct.yield_unit || 'dm²');
        setDimLength(lastProduct.dimensions_length || 0);
        setDimWidth(lastProduct.dimensions_width || 0);
        setDimThickness(lastProduct.dimensions_thickness || 0);
        setDimUnit(lastProduct.dimensions_unit || 'mm');

        setSkuBase(lastProduct.sku || '');
        const derivedSku = deriveSkuFromBase(lastProduct.sku || '', color);
        setSku(derivedSku || buildFallbackSku(groupName, color));
      } else {
        setSkuBase('');
        setSku(buildFallbackSku(groupName, color));
      }
      setInitialStock(0);

      const proposedName = color.trim() ? `${groupName}: ${color.trim()}` : '';
      setName(proposedName);

      const normalizedColor = color.trim().toLowerCase();
      const normalizedGroup = groupName.trim().toLowerCase();
      // BUG ANTIGO: buscávamos similares em TODOS os grupos e mostrávamos
      // produtos de outras famílias (ex: "Verde Lima" em NAPA Sudani
      // aparecia quando o usuário queria cadastrar "Verde Lima" em
      // Tira Strass). Se ele clicasse no similar errado, o produto era
      // RENOMEADO/MOVIDO pra outra família via handleUseExisting:219.
      // FIX: filtrar similares APENAS dentro do mesmo group_id da tira
      // selecionada. Se a cor não existe nesse grupo específico, vai
      // direto pro form de criação (sem desvio).
      // Catálogo inteiro (≈200 ativos) numa tacada: serve pros similares do
      // grupo E pra checagem de duplicata ENTRE grupos (o cadastro tem a mesma
      // "Tira Strass 6mm" escrita de 4 jeitos, em grupos diferentes).
      const { data: catalogRows } = await supabase
        .from('products')
        .select('id, name, color, category, group_id, quantity, unit, sku, unit_price, product_groups(name)')
        .eq('active', true);
      const fullCatalog: ProductWithGroup[] = (catalogRows || []).map((p: any) => ({
        ...p,
        groupName: (p.product_groups?.name || '').trim(),
      }));
      setCatalog(fullCatalog);

      const allMatches = fullCatalog.filter(p => p.group_id === groupId);
      // Sonda pro resolve_strap_base_napa: ele lê o GRUPO do produto (pra achar
      // a receita) e recebe a cor por parâmetro — qualquer irmão do grupo serve,
      // inclusive de outra cor. Grupo vazio (1ª cor) fica sem sonda.
      setProbeProductId(allMatches[0]?.id ?? null);

      setGroupColors(Array.from(new Set(allMatches.map((p: any) => (p.color || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR')));

      const similar = normalizedColor
        ? allMatches.filter((p: any) => {
            const pName = p.name?.trim().toLowerCase() || '';
            const pColor = p.color?.trim().toLowerCase() || '';
            // Match exato da cor dentro do MESMO grupo (já filtrado acima)
            if (pColor === normalizedColor) return true;
            if (fuzzyMatch(pColor, color)) return true;
            if (proposedName && fuzzyMatch(pName, proposedName)) return true;
            if (pName.endsWith(`: ${normalizedColor}`) || pName.endsWith(` - ${normalizedColor}`) || pName.endsWith(` ${normalizedColor}`)) return true;
            return false;
          })
        : [];

      setSimilarProducts(similar as ProductWithGroup[]);

      // Família da napa — MESMA fonte que a reserva e o débito usam
      // (strap_base_family_for_sheet). Precedência: grupo de cabedal da VARIANTE
      // do item > grupo de forração da variante > cabedal da ficha > forração da
      // ficha. Sem isso o cadastro escolhe uma família e a produção procura
      // outra — a origem do furo da spec §1.
      let fichaFamily = '';
      if (referenceId) {
        const sb = supabase as any;
        const askFamily = async (variantId: string | null) => {
          const { data } = await sb.rpc('strap_base_family_for_sheet',
            variantId
              ? { p_reference_id: referenceId, p_variant_id: variantId }
              : { p_reference_id: referenceId });
          return (typeof data === 'string' ? data : '').trim();
        };

        fichaFamily = await askFamily(materialVariantId || null);
        setSheetFamily(fichaFamily);

        // A família mudou por causa da variante? Só pra escrever o aviso na
        // linguagem certa ("a variante deste item usa X", não "a ficha usa X").
        // Sem variante nem chama de novo — a resposta seria a mesma.
        if (materialVariantId) {
          const bare = await askFamily(null);
          setFamilyFromVariant(!!fichaFamily && normKey(bare) !== normKey(fichaFamily));
        } else {
          setFamilyFromVariant(false);
        }
      }

      // ── Defaults da produção artesanal ────────────────────────────────────
      // A tira final é cortada de uma napa base da MESMA cor. Buscamos as receitas
      // deste tipo (pode haver >1 base) e os grupos que têm a cor, pra pré-escolher
      // a base — preferindo NAPA MADRID quando ela cobre a cor.
      const [{ data: recipeRows }, colorBases] = await Promise.all([
        supabase.from('artisanal_recipes').select('id, artisanal_product_name, base_product_name, yield_per_meter, cut_width_mm, labor_cost_per_meter, default_contractor_id'),
        loadColorBases(color),
      ]);
      const typeNorm = normKey(groupName);
      const forType = (recipeRows || []).filter((r: any) => normKey(r.artisanal_product_name) === typeNorm);
      const coveredNorm = new Set(colorBases.map(normKey));
      const preferBase = (names: string[]) => names.find(n => normKey(n) === normKey('NAPA MADRID')) || names[0] || '';
      const recipeBasesCovering = forType.map((r: any) => r.base_product_name).filter((b: string) => coveredNorm.has(normKey(b)));
      const napaCovering = colorBases.filter((n) => /napa|couro|dublagem/i.test(n));
      // A ficha MANDA: se o modelo declara a família do cabedal/forração, é dela
      // que a tira sai — o palpite por cobertura de cor só vale sem ficha.
      const defBase = fichaFamily
        || (recipeBasesCovering.length ? preferBase(recipeBasesCovering)
        : napaCovering.length ? preferBase(napaCovering)
        : forType.length ? forType[0].base_product_name
        : '');
      const recForDefaults = forType.find((r: any) => normKey(r.base_product_name) === normKey(defBase)) || forType[0];

      const artisanalGroup = isStrapLikeGroup || forType.length > 0 || (lastProduct as any)?.is_artisanal === true;
      setCanBeArtisanal(artisanalGroup);
      setIsArtisanal(artisanalGroup);
      setBaseMaterial(defBase);
      setRecipeYield(recForDefaults ? Number(recForDefaults.yield_per_meter) || 1 : 1);
      setRecipeCutWidth(recForDefaults?.cut_width_mm ? Number(recForDefaults.cut_width_mm) : 0);
      setRecipeLabor(recForDefaults ? Number(recForDefaults.labor_cost_per_meter) || 0 : 0);
      setContractorId(recForDefaults?.default_contractor_id || '');

      setPrefilling(false);
    })();
    // referenceId/materialVariantId entram aqui porque a família da napa sai
    // deles: trocar a variante do item sem re-rodar deixaria a base velha.
  }, [open, groupId, groupName, color, referenceId, materialVariantId]);

  // Aplica uma cor (chip do grupo ou digitada) e re-deriva Nome + SKU.
  const applyColor = (c: string) => {
    setColorInput(c);
    setDupAck(false); // cor nova ⇒ duplicata nova: exige novo "criar mesmo assim"
    const t = c.trim();
    setName(t ? `${groupName}: ${t}` : '');
    setSku(skuBase ? deriveSkuFromBase(skuBase, t) : `${normalizeSkuPart(groupName, 'TIRA', 6)}-${normalizeSkuPart(t, 'COR', 4)}`);
    // Recalcula a cobertura da base pra nova cor (aviso âmbar ✓/⚠).
    void loadColorBases(t);
  };

  // ── De qual napa a tira sai (spec §3.1 e §3.2) ─────────────────────────────
  // Roda a MESMA função que reserva/débito rodam (resolve_strap_base_napa), com
  // a família da ficha e a cor digitada. Devolve napa-base + rendimento, ou o
  // `block_reason` pronto quando falta receita/rendimento/napa na cor — que sem
  // isso viraria consumo 0 em silêncio, já com o PV em produção.
  useEffect(() => {
    if (!open || !isArtisanal) { setNapa(null); return; }
    const family = (baseMaterial || '').trim();
    const col = colorInput.trim();
    if (!probeProductId || !family || !col) { setNapa(null); return; }
    let cancelled = false;
    setNapaLoading(true);
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc('resolve_strap_base_napa', {
          p_strap_product_id: probeProductId,
          p_family: family,
          p_color: col,
        });
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : data;
        setNapa((row as NapaResolution) ?? null);
        if (error) setNapa(null);
      } catch {
        if (!cancelled) setNapa(null);
      } finally {
        if (!cancelled) setNapaLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, isArtisanal, probeProductId, baseMaterial, colorInput]);

  // ── Duplicata normalizada (spec §3.3) ──────────────────────────────────────
  // No espírito do índice único de product_groups.name (lower(trim(name))), mas
  // ignorando também acento e pontuação/espaço: "Tira Strass 6mm",
  // "TIRA STRASS 6 MM" e "Tira-Strass 6MM" são o MESMO conceito. Olha o catálogo
  // INTEIRO, não só o grupo atual — as 4 grafias da Tira Strass vivem em grupos
  // diferentes, então uma busca escopada no grupo nunca as acharia.
  const duplicates = useMemo(() => {
    const col = colorInput.trim();
    if (!col || catalog.length === 0) return [] as ProductWithGroup[];
    const targetPair = normalizeForComparison(`${groupName} ${col}`);
    const targetName = normalizeForComparison(name || `${groupName}: ${col}`);
    return catalog.filter((p) => {
      const pPair = normalizeForComparison(`${p.groupName} ${p.color || ''}`);
      const pName = normalizeForComparison(p.name || '');
      return (!!targetPair && pPair === targetPair) || (!!targetName && pName === targetName);
    });
  }, [catalog, groupName, colorInput, name]);

  /** Duplicata em OUTRO grupo — o caso que a busca escopada nunca pegava. */
  const crossGroupDuplicates = useMemo(
    () => duplicates.filter((p) => p.group_id !== groupId),
    [duplicates, groupId],
  );

  /** Duplicatas exatas primeiro, depois os parecidos do grupo (sem repetir). */
  const existingCandidates = useMemo(() => {
    const seen = new Set(duplicates.map(p => p.id));
    return [...duplicates, ...similarProducts.filter(p => !seen.has(p.id))];
  }, [duplicates, similarProducts]);

  // Cobertura da base escolhida: a napa base tem produto na cor selecionada?
  const baseCovered = !!baseMaterial && colorBaseNorm.has(normKey(baseMaterial));
  // Opções de base: grupos "material base" (napa/couro/dublagem) + o já escolhido.
  const baseOptions = Array.from(new Set([
    ...groups.filter(g => /napa|couro|dublagem|material/i.test(g.name || '')).map(g => g.name),
    ...(baseMaterial ? [baseMaterial] : []),
  ])).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(n => ({ value: n, label: n }));

  const handleUseExisting = async (product: SimilarProduct, openEdit = false) => {
    if (product.group_id !== groupId) {
      await supabase.from('products').update({ group_id: groupId }).eq('id', product.id);
      toast.success(`"${product.name}" vinculado ao grupo ${groupName}`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
    } else {
      toast.info(`"${product.name}" já está cadastrado neste grupo`);
    }

    if (openEdit) {
      setEditingProduct(product);
    } else {
      onCreated();
      onOpenChange(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingProduct) return;
    setLoading(true);
    try {
      const updates: Record<string, any> = {
        name: name.trim(),
        color: color.trim(),
        category,
        unit,
        unit_price: unitPrice,
        location,
        min_stock: minStock,
        max_stock: maxStock,
      };
      if (sku.trim()) updates.sku = sku.trim();
      const { error } = await supabase.from('products').update(updates).eq('id', editingProduct.id);
      if (error) throw error;
      toast.success(`"${updates.name}" atualizado!`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
      onCreated();
      onOpenChange(false);
      setEditingProduct(null);
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Garante que exista a receita (tipo → base escolhida) pro tipo desta tira.
  // NÃO mexe em receitas de OUTRAS bases: o mesmo tipo pode ter 2 bases (ex.:
  // NAPA SOFT e NAPA MADRID) — o débito da OS resolve pela receita escolhida na
  // produção. artisanal_product_name = NOME EXATO do grupo (findProductByNameColor
  // casa a saída por grupo).
  const ensureRecipeForBase = async () => {
    const base = baseMaterial.trim();
    const yieldVal = Number(recipeYield) || 0;
    if (!base || yieldVal <= 0) return;
    const { data: existing } = await supabase
      .from('artisanal_recipes')
      .select('id, artisanal_product_name, base_product_name');
    const typeNorm = normKey(groupName);
    const already = (existing || []).some((r: any) =>
      normKey(r.artisanal_product_name) === typeNorm && normKey(r.base_product_name) === normKey(base));
    if (already) return;
    // Não deixa a falha da receita derrubar o cadastro do produto (é o produto
    // que destrava o PV; a receita pode ser ajustada depois em Terceirizados).
    try {
      await createRecipe.mutateAsync({
        name: `Receita: ${groupName} — ${base}`,
        artisanal_product_name: groupName,
        base_product_name: base,
        yield_per_meter: yieldVal,
        cut_width_mm: recipeCutWidth ? Math.round(Number(recipeCutWidth)) : null,
        labor_cost_per_meter: Number(recipeLabor) || 0,
        default_contractor_id: contractorId || null,
        active: true,
      } as any);
    } catch {
      /* createRecipe já emite toast.error; produto segue criado */
    }
  };

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    const trimmedColor = colorInput.trim();

    if (!trimmedColor) {
      toast.error('Cor é obrigatória');
      return;
    }
    if (!trimmedName) {
      toast.error('Nome é obrigatório');
      return;
    }

    // Rendimento é o que converte metro de tira em metro de napa. Zerado, a
    // receita nasce inútil e o consumo da tira sai 0 sem ninguém perceber —
    // exatamente o silêncio que a spec §3.2 manda acabar.
    if (isArtisanal && !(Number(recipeYield) > 0)) {
      toast.error('Informe o rendimento (m de tira por m de napa) — sem ele o consumo desta tira sai ZERO no PV.');
      return;
    }

    // Duplicata: AVISA e exige confirmação, não bloqueia (spec §3.3).
    if (duplicates.length > 0 && !dupAck) {
      setDupAck(true);
      const first = duplicates[0];
      toast.warning(
        `Já existe "${first.name}"${first.groupName && first.group_id !== groupId ? ` no grupo ${first.groupName}` : ''}` +
        `${duplicates.length > 1 ? ` (e mais ${duplicates.length - 1})` : ''}. ` +
        'Use o item existente ou clique de novo em "Criar mesmo assim".',
      );
      return;
    }

    setLoading(true);
    try {
      const normalizedName = trimmedName.toLowerCase();
      const normalizedColor = trimmedColor.toLowerCase();

      const { data: existingInGroup } = await supabase
        .from('products')
        .select('id, name, color, group_id')
        .eq('group_id', groupId)
        .eq('active', true);

      const existingProduct = (existingInGroup || []).find((p: any) => {
        const pName = (p.name || '').trim().toLowerCase();
        const pColor = (p.color || '').trim().toLowerCase();
        return pName === normalizedName || pColor === normalizedColor;
      });

      if (existingProduct) {
        // Produto já existe na cor — mesmo assim garante a marcação artesanal +
        // a receita da base escolhida (ex.: cadastrar a variante NAPA MADRID de
        // uma cor que só tinha receita NAPA SOFT).
        if (isArtisanal) {
          await supabase.from('products').update({ is_artisanal: true } as any).eq('id', existingProduct.id);
          await ensureRecipeForBase();
          qc.invalidateQueries({ queryKey: ['artisanal_recipes'] });
        }
        toast.info(`"${existingProduct.name}" já está cadastrado neste grupo`);
        qc.invalidateQueries({ queryKey: ['products'] });
        qc.invalidateQueries({ queryKey: ['products_for_colors'] });
        onCreated();
        onOpenChange(false);
        return;
      }

      const finalSku = await resolveUniqueSku(sku, groupName, trimmedColor);
      // Defesa: category é NOT NULL no DB. Se o state ficou vazio (sem
      // produto anterior no grupo pra pré-preencher), deriva do groupName.
      const safeCategory = (category && category.trim()) || sectorOfGroup(group ?? { name: groupName });
      const productData = sanitizeUuidFields({
        name: trimmedName,
        sku: finalSku,
        category: safeCategory,
        color: trimmedColor,
        unit,
        unit_price: unitPrice,
        location,
        min_stock: minStock,
        max_stock: maxStock,
        quantity: Math.max(0, Number(initialStock) || 0),
        group_id: groupId,
        active: true,
        image_url: '',
        is_artisanal: isArtisanal,
        yield_per_meter: yieldPerMeter,
        yield_unit: yieldUnit,
        dimensions_length: dimLength,
        dimensions_width: dimWidth,
        dimensions_thickness: dimThickness,
        dimensions_unit: dimUnit,
      });

      let { error } = await supabase.from('products').insert(productData as any);
      if (error?.code === '23505') {
        const retrySku = await resolveUniqueSku('', groupName, trimmedColor);
        ({ error } = await supabase.from('products').insert({ ...productData, sku: retrySku } as any));
      }
      if (error) throw error;

      // Vincula a receita de produção (tipo → base) — "como nas outras tiras".
      if (isArtisanal) {
        await ensureRecipeForBase();
        qc.invalidateQueries({ queryKey: ['artisanal_recipes'] });
      }

      toast.success(`Produto "${trimmedName}" criado no estoque!`);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
      onCreated();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Erro ao criar produto: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Cadastrar Item no Estoque
          </DialogTitle>
        <DialogDescription className="sr-only">Cadastro de produto de tira com dimensões e preço.</DialogDescription>
        </DialogHeader>

        {prefilling ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {editingProduct && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
                  <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-semibold">Editando: {editingProduct.name}</p>
                    <p className="text-xs text-muted-foreground">Atualize os dados e salve.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Nome</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">SKU</Label>
                    <Input value={sku} onChange={e => setSku(e.target.value)} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Input value={category} disabled className="h-9 text-sm bg-muted" />
                  </div>
                  <div>
                    <Label className="text-xs">Unidade</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Preço Unitário</Label>
                    <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} className="h-9 text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs">Localização</Label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => { setEditingProduct(null); }} disabled={loading}>
                    Voltar
                  </Button>
                  <Button onClick={handleSaveEdit} disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar Alterações
                  </Button>
                </DialogFooter>
              </div>
            )}

            {showForm && !editingProduct && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary">{groupName}</Badge>
                  <span>•</span>
                  <Badge variant="outline">{colorInput}</Badge>
                </div>

                {/* Já existe? Duplicata normalizada (exata) primeiro, similares
                    aproximados do grupo depois — tudo no MESMO formulário, sem
                    tela intermediária. */}
                {existingCandidates.length > 0 && (
                  <div className={cn(
                    'rounded-lg border p-3',
                    duplicates.length > 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-muted/40',
                  )}>
                    <div className="flex items-start gap-2">
                      <AlertTriangle className={cn(
                        'mt-0.5 h-4 w-4 shrink-0',
                        duplicates.length > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                      )} />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {duplicates.length > 0
                            ? 'Este item JÁ EXISTE no estoque'
                            : 'Itens parecidos já cadastrados'}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {duplicates.length > 0
                            ? 'Mesmo grupo + cor ignorando acento, caixa e espaço. Use o existente em vez de criar outra grafia da mesma tira.'
                            : 'Confira se não é o mesmo produto antes de cadastrar mais uma cor.'}
                          {crossGroupDuplicates.length > 0 && ' Há duplicata em OUTRO grupo — o cadastro tem a mesma tira escrita de vários jeitos.'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
                      {existingCandidates.map(p => (
                        <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{p.name}</p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {p.groupName && p.group_id !== groupId && (
                                <Badge variant="secondary" className="text-xs">{p.groupName}</Badge>
                              )}
                              {p.color && <Badge variant="outline" className="text-xs">{p.color}</Badge>}
                              <span className="text-xs text-muted-foreground">
                                Estoque: {p.quantity} {p.unit}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => handleUseExisting(p, false)}>
                              <Check className="h-3 w-3" />
                              Usar
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => handleUseExisting(p, true)}>
                              <Pencil className="h-3 w-3" />
                              Editar
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Label className="text-xs">Cor *</Label>
                    <Input
                      value={colorInput}
                      onChange={e => applyColor(e.target.value)}
                      placeholder="Ex.: COGUMELO"
                      className="h-9 text-sm uppercase"
                    />
                    {groupColors.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <span className="text-[11px] text-muted-foreground mr-0.5">Cores do grupo:</span>
                        {groupColors.map(c => (
                          <button
                            type="button"
                            key={c}
                            onClick={() => applyColor(c)}
                            className={cn(
                              'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                              colorInput.trim().toLowerCase() === c.trim().toLowerCase()
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                            )}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Cor travada na do item: a napa-base é resolvida por
                        família + COR DA TIRA. Divergir aqui manda a produção
                        procurar napa numa cor que a tira não usa. Aviso, não
                        bloqueio — tira de cor contrastante é legítima. */}
                    {color.trim() && colorInput.trim()
                      && normKey(colorInput) !== normKey(color) && (
                      <div className="mt-1.5 flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          A tira do PV é <strong>{color.trim().toUpperCase()}</strong>, mas você está cadastrando{' '}
                          <strong>{colorInput.trim().toUpperCase()}</strong>. A produção procura a napa na cor da TIRA —
                          se for de propósito (tira em cor contrastante), pode seguir.
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Escolha uma cor do grupo ou digite uma nova — vira a cor do produto no estoque e atualiza Nome e SKU.
                    </p>
                  </div>

                  <div className="col-span-2">
                    <Label className="text-xs">Nome</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">SKU</Label>
                    <Input value={sku} onChange={e => setSku(e.target.value)} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">Tipo</Label>
                    <Input value={sectorLabel(sectorOfGroup(group ?? { name: groupName }))} disabled className="h-9 text-sm bg-muted" />
                  </div>

                  <div>
                    <Label className="text-xs">Unidade</Label>
                    <Select value={unit} onValueChange={setUnit}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-xs">Preço Unitário</Label>
                    <NumberInput value={unitPrice} onChange={setUnitPrice} step="0.01" min={0} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">Localização</Label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {LOCATIONS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2">
                    <Label className="text-xs">Estoque Inicial ({unit})</Label>
                    <NumberInput value={initialStock} onChange={setInitialStock} min={0} step="0.01" className="h-9 text-sm" />
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quantidade que entra no estoque agora (deixe 0 se for ajustar depois).
                    </p>
                  </div>

                  <div>
                    <Label className="text-xs">Estoque Mín.</Label>
                    <NumberInput value={minStock} onChange={setMinStock} min={0} className="h-9 text-sm" />
                  </div>

                  <div>
                    <Label className="text-xs">Estoque Máx.</Label>
                    <NumberInput value={maxStock} onChange={setMaxStock} min={0} className="h-9 text-sm" />
                  </div>
                </div>

                {(dimLength > 0 || dimWidth > 0) && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-xs font-semibold text-muted-foreground">Dimensões</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <Label className="text-xs">Comp.</Label>
                        <NumberInput value={dimLength} onChange={setDimLength} min={0} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs">Larg.</Label>
                        <NumberInput value={dimWidth} onChange={setDimWidth} min={0} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs">Espess.</Label>
                        <NumberInput value={dimThickness} onChange={setDimThickness} min={0} className="h-8 text-xs" />
                      </div>
                      <div>
                        <Label className="text-xs">Un.</Label>
                        <Select value={dimUnit} onValueChange={setDimUnit}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mm">mm</SelectItem>
                            <SelectItem value="cm">cm</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}

                {yieldPerMeter != null && yieldPerMeter > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Rendimento/m</Label>
                      <NumberInput value={yieldPerMeter || 0} onChange={v => setYieldPerMeter(v)} min={0} step="0.01" className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Unidade Rendimento</Label>
                      <Select value={yieldUnit} onValueChange={setYieldUnit}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dm²">dm²</SelectItem>
                          <SelectItem value="par">par</SelectItem>
                          <SelectItem value="un">un</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* ── Produção artesanal: base (napa) + receita — "como nas outras tiras" ── */}
                {canBeArtisanal && (
                <div className={cn('rounded-lg border', isArtisanal ? 'border-primary/30' : 'border-border')}>
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
                    <div className="flex items-center gap-2">
                      <FlaskConical className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-sm font-semibold leading-none">Produção artesanal</p>
                        <p className="text-xs text-muted-foreground mt-0.5">A tira é cortada de uma napa base da mesma cor.</p>
                      </div>
                    </div>
                    <Switch checked={isArtisanal} onCheckedChange={setIsArtisanal} aria-label="Produto artesanal" />
                  </div>

                  {isArtisanal && (
                    <div className="p-3 space-y-3">
                      {/* Conversão base → tira */}
                      <div className="flex items-center gap-2 text-sm">
                        <div className="flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1.5 flex-1 min-w-0 text-blue-700 dark:text-blue-400">
                          <Package className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs font-medium">{baseMaterial || '(napa base)'}{colorInput.trim() ? ` · ${colorInput.trim().toUpperCase()}` : ''}</span>
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex items-center gap-1.5 rounded bg-emerald-500/10 px-2 py-1.5 flex-1 min-w-0 text-emerald-700 dark:text-emerald-400">
                          <Scissors className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate text-xs font-medium">{groupName}{colorInput.trim() ? ` · ${colorInput.trim().toUpperCase()}` : ''}</span>
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Matéria-prima base (grupo)</Label>
                        <SearchableSelect
                          value={baseMaterial}
                          onChange={setBaseMaterial}
                          options={baseOptions}
                          placeholder="Selecione a napa base..."
                        />
                      </div>

                      {/* Quem define a família na produção é a VARIANTE do item
                          (caindo na ficha quando não há variante) — divergir
                          aqui é o que faz a compra ir numa napa e a reserva
                          noutra (spec §1). O aviso só aparece quando o usuário
                          troca a base à mão: com a variante lida corretamente,
                          o default já nasce igual. */}
                      {sheetFamily && normKey(sheetFamily) !== normKey(baseMaterial) && (
                        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            {familyFromVariant
                              ? <>A <strong>variante de material deste item</strong> é <strong>{sheetFamily}</strong> — é nessa família</>
                              : <>A ficha deste modelo usa <strong>{sheetFamily}</strong> no cabedal/forração — é nessa família</>}
                            {' '}que a produção vai procurar a receita. Cadastrar a base como <strong>{baseMaterial || '(vazia)'}</strong> faz
                            compra e reserva discordarem.
                          </span>
                        </div>
                      )}

                      {/* Napa-base resolvida — MESMA RPC que reserva e débito
                          usam. Sem ela o cadastro nasce sem vínculo e o consumo
                          da tira sai 0 calado (spec §3.1 e §3.2). */}
                      {baseMaterial && colorInput.trim() && (
                        napaLoading ? (
                          <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Resolvendo a napa-base…
                          </div>
                        ) : !probeProductId ? (
                          <div className="flex items-start gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-xs text-muted-foreground">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              Primeira cor do grupo — a napa-base só pode ser conferida depois deste cadastro.
                              A receita <strong>{groupName} → {baseMaterial}</strong> será criada com o rendimento abaixo.
                            </span>
                          </div>
                        ) : napa?.block_reason ? (
                          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              <strong>Não dá pra saber de qual napa esta tira sai.</strong> {napa.block_reason}
                              {' '}Preencha rendimento e base abaixo — a receita é criada junto com o produto.
                            </span>
                          </div>
                        ) : napa?.base_product_id ? (
                          <div className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span>
                              Sai de <strong>{napa.base_product_name}</strong>
                              {' '}(família {baseMaterial} · cor {colorInput.trim().toUpperCase()}) —
                              rendimento <strong>{Number(napa.yield_per_meter)} m</strong> de tira por metro de napa.
                            </span>
                          </div>
                        ) : baseCovered ? (
                          <div className="flex items-start gap-2 rounded-md bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span><strong>{baseMaterial}</strong> tem a cor <strong>{colorInput.trim().toUpperCase()}</strong> — a produção não trava por falta de matéria-prima.</span>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-2.5 py-2 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span><strong>{baseMaterial}</strong> não tem a cor <strong>{colorInput.trim().toUpperCase()}</strong> cadastrada. Cadastre a napa nessa cor antes de produzir, ou escolha outra base.</span>
                          </div>
                        )
                      )}

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">Rend. (m/m base)</Label>
                          <NumberInput value={recipeYield} onChange={setRecipeYield} min={0} step="0.01" className="h-9 text-sm" />
                          {!(Number(recipeYield) > 0) && (
                            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                              Obrigatório — sem rendimento o consumo da tira sai ZERO.
                            </p>
                          )}
                        </div>
                        <div>
                          <Label className="text-xs">Largura corte (mm)</Label>
                          <NumberInput value={recipeCutWidth} onChange={setRecipeCutWidth} min={0} className="h-9 text-sm" />
                        </div>
                        <div>
                          <Label className="text-xs">MO / metro (R$)</Label>
                          <NumberInput value={recipeLabor} onChange={setRecipeLabor} min={0} step="0.01" className="h-9 text-sm" />
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs">Terceirizado padrão</Label>
                        <Select value={contractorId || 'none'} onValueChange={v => setContractorId(v === 'none' ? '' : v)}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Nenhum</SelectItem>
                            {contractors.filter((c: any) => c.active).map((c: any) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {baseMaterial && Number(recipeYield) > 0 && (
                        <div className="rounded bg-primary/5 border border-primary/20 px-3 py-2 text-xs">
                          1 m de <span className="font-semibold">{baseMaterial}</span> → <span className="font-semibold text-primary">{Number(recipeYield)} m</span> de <span className="font-semibold">{groupName}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmit} disabled={loading || prefilling}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {dupAck && duplicates.length > 0 ? 'Criar mesmo assim' : 'Criar Produto'}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
