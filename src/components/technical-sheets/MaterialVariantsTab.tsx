 import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
  import { Plus, CircleNotch as Loader2, Package, Tag, Barcode, Trash as Trash2, DotsSixVertical as GripVertical, PencilSimple as Pencil, Check, X, ToggleLeft, ToggleRight, Hash, ShoppingCart, CurrencyDollar as DollarSign, Info, CaretUpDown as ChevronsUpDown, MagnifyingGlass as Search, Copy, CaretUp as ChevronUp, CaretDown as ChevronDown, Sparkle as Sparkles } from '@phosphor-icons/react';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
  import { Badge } from '@/components/ui/badge';
  import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
  import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
  import { cn } from '@/lib/utils';
 import { Switch } from '@/components/ui/switch';
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
 import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogDescription,
   DialogFooter,
 } from '@/components/ui/dialog';
 import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
 import {
   useReferenceMaterialVariants,
   useAddReferenceMaterialVariant,
   useUpdateReferenceMaterialVariant,
   useDeleteReferenceMaterialVariant,
   useReorderReferenceMaterialVariants,
   useDuplicateReferenceMaterialVariant,
   findMaterialVariantSkuCollision,
   MATERIAL_VARIANT_SKU_MAX_LENGTH,
   ReferenceMaterialVariant
 } from '@/hooks/useReferenceMaterialVariants';
 import { useProducts } from '@/hooks/useProducts';
 import { useGroups, type ProductGroup } from '@/hooks/useGroups';
 import { sectorLabel, sectorOfGroup } from '@/lib/categoryFromGroup';
import {
  listVariantCascadeSlots,
  seedVariantCascade,
  variantDrivesNoComponent,
  type VariantCascadeSelection,
} from '@/lib/materialVariantColorGroup';
 import { getGroupPath } from '@/lib/groupHierarchy';
 import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * Setores (`product_groups.sector`) cujos grupos são MATERIAL cortado por par —
 * os elegíveis nos quatro seletores da variante. Solado fica de fora porque tem
 * pin próprio (`sole_material_product_id`); embalagem, ferramenta, fôrma e
 * químico não são cortados por par.
 *
 * ⚠ NÃO voltar a filtrar UM setor por seletor. `sector` diz onde o grupo mora no
 * Estoque, não o que ele pode virar: a MESMA napa é cabedal, forração e palmilha
 * conforme a ficha — é exatamente isso que `variant_drives_*` faz. Filtrar
 * "Material principal" por 'Cabedal' escondia GLOW METALIC (setor 'Componente'),
 * NAPA SOFT ('Palmilha') e NAPA SUDANI ('Forração da Palmilha') — os 3 materiais
 * que respondem por TODAS as variantes ativas de hoje. Nenhuma delas podia ser
 * cadastrada por esta tela; as que existem vieram de migration, e o dono via no
 * PV só as referências que alguma migration alcançou. Os seletores da própria
 * ficha (`sheetSelectors.GroupMaterialSelect`) nunca restringiram setor.
 */
export const VARIANT_MATERIAL_SECTORS = [
  'Cabedal',
  'Forração da Palmilha',
  'Palmilha',
  'Componente',
] as const;

/** Grupo elegível como material de uma variante. Setor vazio cai na dedução por
 *  nome de `sectorOfGroup` (grupo legado sem backfill) — que devolve
 *  'Componente' quando não reconhece nada, então grupo sem grupo nenhum
 *  passaria: daí o guard de entrada vazia. */
export function isVariantMaterialGroup(
  group: { sector?: string | null; name?: string | null } | null | undefined,
): boolean {
  if (!group) return false;
  return (VARIANT_MATERIAL_SECTORS as readonly string[]).includes(sectorOfGroup(group));
}

/** Sugere um sufixo de SKU a partir do nome do grupo (2 primeiras palavras,
 *  sem acento, MAIÚSCULO, só alfanumérico). Ex.: "NAPA SANTORINE" → "NAPASANTORINE". */
function skuSlug(groupName: string): string {
  return (groupName || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/\s+/).slice(0, 2).join('')
    .toUpperCase().replace(/[^A-Z0-9]/g, '');
}
 
  interface MaterialVariantsTabProps {
    sheetId: string;
    sheetCode?: string;
  }

/**
 * Seletor de grupo de material (product_groups) com busca. Reusado para
 * Cabedal / Forro / Placa-EVA da palmilha. `allowInherit` mostra "Herda a ficha"
 * (limpa a seleção → o motor resolve pela ficha).
 */
function GroupCombobox({
  value, onChange, groups, allGroups, describe, placeholder, allowInherit = false, ariaLabel,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  groups: Array<ProductGroup & { pathLabel: string; familyLabel: string | null }>;
  allGroups: ProductGroup[];
  describe?: (groupId: string) => string | null;
  placeholder: string;
  allowInherit?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? groups.find(g => g.id === value) : null;
  const unavailableSelected = value && !selected ? allGroups.find(g => g.id === value) : null;
  const unavailableIsContainer = !!unavailableSelected
    && allGroups.some(group => group.parent_group_id === unavailableSelected.id);
  const sections = useMemo(() => {
    const byFamily = new Map<string, {
      label: string;
      options: Array<ProductGroup & { pathLabel: string; familyLabel: string | null }>;
    }>();
    for (const group of groups) {
      const key = group.familyLabel || '__SEM_FAMILIA__';
      const section = byFamily.get(key) || {
        label: group.familyLabel || 'Grupos sem família',
        options: [],
      };
      section.options.push(group);
      byFamily.set(key, section);
    }
    return Array.from(byFamily.entries())
      .map(([key, section]) => ({ key, ...section }))
      .sort((a, b) => {
        if (a.key === '__SEM_FAMILIA__') return 1;
        if (b.key === '__SEM_FAMILIA__') return -1;
        return a.label.localeCompare(b.label, 'pt-BR');
      });
  }, [groups]);

  return (
    <div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            className="w-full justify-between font-normal h-9 text-sm"
          >
            <span className={cn('truncate', !selected && !unavailableSelected && 'text-muted-foreground')}>
              {selected?.pathLabel
                || unavailableSelected?.name
                || (allowInherit ? 'Herda a ficha' : placeholder)}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[300px] max-w-[calc(100vw-2rem)] p-0" align="start">
          <Command>
            <CommandInput placeholder="Buscar família, grupo, SKU ou cor…" className="h-9" />
            <CommandList>
              <CommandEmpty>Nenhum grupo-folha encontrado.</CommandEmpty>
              {allowInherit && (
                <CommandGroup heading="Comportamento">
                <CommandItem value="__herda__" onSelect={() => { onChange(null); setOpen(false); }} className="text-sm py-2">
                  <Check className={cn('mr-2 h-4 w-4', !value ? 'opacity-100' : 'opacity-0')} />
                  <span className="text-muted-foreground">Herda a ficha</span>
                </CommandItem>
                </CommandGroup>
              )}
              {sections.map(section => (
                <CommandGroup
                  key={section.key}
                  heading={section.key === '__SEM_FAMILIA__'
                    ? section.label
                    : `${section.label} · família`}
                >
                  {section.options.map(group => {
                    const sub = describe?.(group.id);
                    return (
                      <CommandItem
                        key={group.id}
                        value={group.pathLabel}
                        keywords={sub ? [group.name, sub] : [group.name]}
                        onSelect={() => { onChange(group.id); setOpen(false); }}
                        className="text-sm py-2"
                      >
                        <Check className={cn('mr-2 h-4 w-4', value === group.id ? 'opacity-100' : 'opacity-0')} />
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium truncate">{group.pathLabel}</span>
                          {sub && <span className="text-xs text-muted-foreground font-mono truncate">{sub}</span>}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {unavailableIsContainer && (
        <p className="mt-1 text-xs text-warning">
          {unavailableSelected?.name} é uma família. Escolha um grupo dentro dela.
        </p>
      )}
    </div>
  );
}

  export function MaterialVariantsTab({ sheetId, sheetCode }: MaterialVariantsTabProps) {
   const qc = useQueryClient();
   const { data: variants = [], isLoading } = useReferenceMaterialVariants(sheetId);
   const { data: products = [] } = useProducts();
   const { data: groups = [] } = useGroups();

   // Material que a ficha usa hoje. Serve pra avisar quando NENHUMA variante o
   // representa: nesse caso quem vender sem escolher variante recebe um material
   // diferente do que qualquer variante promete, em silêncio. Foi assim que o
   // PV-00141 (EC23) vendeu NAPA SOFT e a produção cortou NAPA SUDANI.
   //
   // As travas `variant_drives_*` vêm junto: elas moram na FICHA mas a decisão
   // ("este componente sai da napa da variante?") é tomada aqui, ao cadastrar a
   // variante. Sem isso, material principal escolhido virava no-op silencioso.
   const { data: sheetMaterials, refetch: refetchSheetCascade } = useQuery({
     queryKey: ['sheet_variant_cascade', sheetId],
     queryFn: async () => {
       const { data, error } = await (supabase as any)
         .from('technical_sheets')
         .select('upper_material, lining_material, variant_drives_upper, variant_drives_lining, variant_drives_fachete')
         .eq('id', sheetId)
         .maybeSingle();
       if (error) throw error;
       return data as {
         upper_material: string | null;
         lining_material: string | null;
         variant_drives_upper: boolean | null;
         variant_drives_lining: boolean | null;
         variant_drives_fachete: boolean | null;
       } | null;
     },
     enabled: !!sheetId,
     staleTime: 60_000,
   });

   /** Material da ficha não coberto por nenhuma variante ativa. */
   const materialDaFichaSemVariante = useMemo(() => {
     const alvo = (sheetMaterials?.upper_material?.trim() || sheetMaterials?.lining_material?.trim() || '');
     if (!alvo || variants.length === 0) return '';
     const key = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
     const cobertos = new Set(
       variants.filter(v => v.active).map(v => {
         const gid = v.main_material_group_id || v.upper_material_group_id
           || v.lining_material_group_id || v.insole_material_group_id;
         return key(groups.find(g => g.id === gid)?.name || v.material_name || '');
       }),
     );
     return cobertos.has(key(alvo)) ? '' : alvo;
   }, [sheetMaterials, variants, groups]);

   // Pool dos quatro seletores da variante. Famílias/containers nunca são
   // materiais: somente folhas COM item ativo entram (sem SKU/cor no grupo o PV
   // não tem o que resolver). O setor não filtra — ver VARIANT_MATERIAL_SECTORS.
   const parentGroupIds = useMemo(
     () => new Set(groups.map(group => group.parent_group_id).filter(Boolean) as string[]),
     [groups],
   );
   const activeProductGroupIds = useMemo(
     () => new Set(products.filter(product => product.active && product.group_id).map(product => product.group_id as string)),
     [products],
   );
   const leafGroups = useMemo(() => groups
     .filter(group => !parentGroupIds.has(group.id))
     .filter(group => activeProductGroupIds.has(group.id))
     .map(group => {
       const path = getGroupPath(groups, group.id);
       const familyLabel = path.slice(0, -1).map(node => node.name).join(' › ') || null;
       return {
         ...group,
         pathLabel: path.map(node => node.name).join(' › ') || group.name,
         familyLabel,
       };
     })
     .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, 'pt-BR')), [groups, parentGroupIds, activeProductGroupIds]);
   const materialGroups = useMemo(() => leafGroups.filter(isVariantMaterialGroup), [leafGroups]);

   // Produto representativo de um grupo (1º ativo por nome) — fonte das sugestões
   // de SKU/NCM/preço e do resumo (cores) no seletor.
   const groupProducts = useMemo(() => {
     const m = new Map<string, typeof products>();
     for (const p of products) {
       if (!p.group_id || !p.active) continue;
       const arr = m.get(p.group_id) ?? [];
       arr.push(p);
       m.set(p.group_id, arr);
     }
     for (const arr of m.values()) arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
     return m;
   }, [products]);
   const repProduct = (groupId?: string | null) => (groupId ? groupProducts.get(groupId)?.[0] : undefined);
   const groupColorCount = (groupId?: string | null) =>
     groupId ? new Set((groupProducts.get(groupId) ?? []).map(p => (p.color || '').trim()).filter(Boolean)).size : 0;
   // Subtítulo do item no seletor: setor onde o grupo mora no Estoque + SKU do
   // produto representativo + nº de cores. O setor entrou aqui quando deixou de
   // filtrar a lista: sem ele, dois grupos de nome parecido ficam indistinguíveis.
   const describeGroup = (groupId: string): string | null => {
     const rp = repProduct(groupId);
     const cc = groupColorCount(groupId);
     const grp = groups.find(g => g.id === groupId);
     const parts = [
       grp ? sectorLabel(sectorOfGroup(grp)) : null,
       (rp as any)?.sku ? `SKU ${(rp as any).sku}` : null,
       cc > 0 ? `${cc} cor${cc > 1 ? 'es' : ''}` : null,
     ].filter(Boolean) as string[];
     return parts.length ? parts.join(' · ') : null;
   };

   const addVariant = useAddReferenceMaterialVariant();
   const updateVariant = useUpdateReferenceMaterialVariant();
   const deleteVariant = useDeleteReferenceMaterialVariant();
   const reorderVariants = useReorderReferenceMaterialVariants();
   const duplicateVariant = useDuplicateReferenceMaterialVariant();

   const [isDialogOpen, setIsDialogOpen] = useState(false);
   const [editingVariant, setEditingVariant] = useState<Partial<ReferenceMaterialVariant> | null>(null);
   const [duplicatingFromId, setDuplicatingFromId] = useState<string | null>(null);

   // Componentes que seguem o material principal desta variante. O valor mora na
   // FICHA (`technical_sheets.variant_drives_*`) e vale pra TODAS as variantes
   // dela — por isso o estado local é só um override do que está gravado, e é
   // limpo a cada abertura do diálogo. `null` = "ainda não mexi", e aí a tela
   // mostra o seed (o gravado, ou o único componente possível numa ficha nunca
   // configurada). Isso também evita travar o seed num render em que a query da
   // ficha ainda não tinha respondido.
   const [cascadeOverride, setCascadeOverride] = useState<VariantCascadeSelection | null>(null);
   const cascadeSlots = useMemo(() => listVariantCascadeSlots(sheetMaterials), [sheetMaterials]);
   const cascade = cascadeOverride ?? seedVariantCascade(sheetMaterials);
   const cascadeDirty = !!sheetMaterials && (
     cascade.upper !== !!sheetMaterials.variant_drives_upper
     || cascade.lining !== !!sheetMaterials.variant_drives_lining
   );
   
   // Temporary state for the form
    const [formData, setFormData] = useState<Partial<ReferenceMaterialVariant>>({
      material_name: '',
      sku: '',
      barcode: '',
      ncm: '',
      description_override: '',
      unit_price_override: null,
      active: true,
      main_material_group_id: null,
      upper_material_product_id: null,
      upper_material_group_id: null,
      upper_consumption_override: null,
      lining_material_product_id: null,
      lining_material_group_id: null,
      lining_consumption_override: null,
      insole_material_product_id: null,
      insole_material_group_id: null,
      insole_consumption_override: null,
      sole_material_product_id: null,
      sole_consumption_override: null,
    });

  const [suggestingNcm, setSuggestingNcm] = useState(false);

  const handleSuggestNcm = async () => {
    const name = formData.material_name || '';
    const desc = formData.description_override || '';
    if (!name && !desc) {
      toast.error('Preencha o nome do material antes de sugerir o NCM');
      return;
    }
    setSuggestingNcm(true);
    // Timeout de 8s — função suggest-ncm chama LLM externa que pode hang.
    // Sem timeout, o spinner girava indefinidamente até o user fechar a aba.
    const TIMEOUT_MS = 8_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timeout (8s) — sugestão de NCM demorou demais')), TIMEOUT_MS);
    });
    try {
      const invokePromise = supabase.functions.invoke('suggest-ncm', {
        body: { productName: name, description: desc },
      });
      const { data, error } = await Promise.race([invokePromise, timeoutPromise]) as Awaited<typeof invokePromise>;
      if (error) {
        // supabase-js só expõe "Edge Function returned a non-2xx status code"
        // quando há HTTP não-2xx. A mensagem REAL do servidor está em
        // error.context.response.json().error — tentar extrair antes de
        // mostrar o genérico.
        let serverMessage: string | null = null;
        try {
          const resp = (error as any)?.context?.response;
          if (resp && typeof resp.clone === 'function') {
            const body = await resp.clone().json();
            serverMessage = body?.error || null;
          }
        } catch { /* ignore parse error */ }
        throw new Error(serverMessage || error.message || 'Falha ao consultar suggest-ncm');
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      if (data?.ncm) {
        setFormData(prev => ({ ...prev, ncm: data.ncm }));
        const confLabel = data.confidence === 'alta' ? '✅ Alta' : data.confidence === 'média' ? '⚠️ Média' : '❓ Baixa';
        toast.success(`NCM sugerido: ${data.ncm}`, {
          description: `${data.description} — Confiança: ${confLabel}`,
          duration: 6000,
        });
      }
    } catch (err: any) {
      console.error('Erro ao sugerir NCM:', err);
      const isTimeout = String(err?.message || '').toLowerCase().includes('timeout');
      // Audit visual F1+F11: toast persistente com botão de retry. Antes
      // sumia em 4-6s e usuário não conseguia agir; agora fica até clicar
      // (duration: Infinity) e oferece retry inline.
      // Timeout usa warning (amber, visível em dark) em vez de error (rosa).
      const toastFn = isTimeout ? toast.warning : toast.error;
      toastFn(
        isTimeout ? '⏱ Tempo esgotado pra sugerir NCM' : 'Falha ao sugerir NCM',
        {
          description: isTimeout
            ? 'O serviço de IA não respondeu em 8s. Tente novamente ou preencha manualmente.'
            : err?.message ?? 'Tente novamente em alguns segundos.',
          duration: Infinity,
          action: {
            label: '↻ Tentar de novo',
            onClick: () => handleSuggestNcm(),
          },
        }
      );
    } finally {
      setSuggestingNcm(false);
    }
  };

    const incrementLastNumber = (str: string) => {
      const match = str.match(/(\d+)(?!.*\d)/);
      if (!match) return str + '1';
      const num = parseInt(match[0], 10) + 1;
      const startIdx = match.index!;
      return str.substring(0, startIdx) + num.toString().padStart(match[0].length, '0') + str.substring(startIdx + match[0].length);
    };

    const generateNextSku = () => {
      if (variants.length > 0) {
        const lastSku = variants[variants.length - 1].sku;
        if (lastSku) return incrementLastNumber(lastSku);
      }
      if (sheetCode) return incrementLastNumber(sheetCode);
      return '';
    };
 
   const handleOpenDialog = (variant?: ReferenceMaterialVariant) => {
     setDuplicatingFromId(null);
     setCascadeOverride(null);
     if (variant) {
       setEditingVariant(variant);
       setFormData(variant);
      } else {
        setEditingVariant(null);
        const nextSku = generateNextSku();
        setFormData({
          material_name: '',
          sku: nextSku,
          barcode: '',
          ncm: '',
          description_override: '',
          unit_price_override: null,
          active: true,
          main_material_group_id: null,
          upper_material_product_id: null,
          upper_material_group_id: null,
          lining_material_group_id: null,
          insole_material_group_id: null,
          display_order: variants.length
        });
      }
     setIsDialogOpen(true);
   };

   // MATERIAL PRINCIPAL: é o que a variante É. Cascateia pros componentes que a
   // ficha liberou (variant_drives_*), então define nome/SKU/NCM da variante.
   // NÃO auto-preenche `unit_price_override`: esse campo é o PREÇO DE VENDA do
   // par, e o `unit_price` do grupo é o custo por dm² da napa — foi assim que o
   // EC23 ficou com "R$ 0,8668" de preço.
   const handlePickMainGroup = (groupId: string | null) => {
     const group = groupId ? materialGroups.find(g => g.id === groupId) : null;
     const rep = repProduct(groupId);
     setFormData(prev => ({
       ...prev,
       main_material_group_id: groupId,
       material_name: group?.name ?? prev.material_name ?? '',
       sku: prev.sku && prev.sku.trim() ? prev.sku : (group ? `${sheetCode ? sheetCode + '-' : ''}${skuSlug(group.name)}` : prev.sku),
       ncm: prev.ncm && prev.ncm.trim() ? prev.ncm : ((rep as any)?.ncm ?? prev.ncm ?? ''),
     }));
   };

   // Exceção por componente: aponta o grupo daquele slot e LIMPA o pin de
   // produto legado (pra o motor resolver por grupo+cor). Vence o principal.
   const handlePickCabedalGroup = (groupId: string | null) => {
     setFormData(prev => ({
       ...prev,
       upper_material_group_id: groupId,
       upper_material_product_id: null,
       upper_consumption_override: null,
     }));
   };
   const handlePickLiningGroup = (groupId: string | null) =>
     setFormData(prev => ({ ...prev, lining_material_group_id: groupId, lining_material_product_id: null, lining_consumption_override: null }));
   const handlePickInsoleGroup = (groupId: string | null) =>
     setFormData(prev => ({ ...prev, insole_material_group_id: groupId, insole_material_product_id: null, insole_consumption_override: null }));

   const handleOpenDuplicateDialog = (source: ReferenceMaterialVariant) => {
     setEditingVariant(null);
     setDuplicatingFromId(source.id);
     setCascadeOverride(null);
     setFormData({
       material_name: `${source.material_name} (cópia)`,
       sku: generateNextSku(),
       barcode: '',
       ncm: source.ncm,
       description_override: source.description_override,
       unit_price_override: source.unit_price_override,
       active: source.active,
       main_material_group_id: source.main_material_group_id,
       upper_material_product_id: source.upper_material_product_id,
       upper_material_group_id: source.upper_material_group_id,
       lining_material_group_id: source.lining_material_group_id,
       insole_material_group_id: source.insole_material_group_id,
       display_order: variants.length,
     });
     setIsDialogOpen(true);
   };

   /**
    * Grava as travas na ficha. `.select('id')` porque RLS que barra o UPDATE
    * devolve 0 linhas sem erro — e aí a variante salvaria "configurada" com a
    * ficha intacta, que é exatamente o no-op que este fluxo existe pra impedir.
    */
   const persistCascade = async () => {
     const { data, error } = await supabase
       .from('technical_sheets')
       .update({
         variant_drives_upper: cascade.upper,
         variant_drives_lining: cascade.lining,
       })
       .eq('id', sheetId)
       .select('id');
     if (error || !data || data.length === 0) {
       // O catch do handleSave é mudo de propósito (as mutations já avisam), e
       // aqui não há mutation nenhuma — sem este toast a variante salvaria e a
       // cascata falharia em silêncio.
       toast.error('Variante salva, mas a cascata não foi gravada', {
         description: error?.message
           || 'A ficha não aceitou a alteração (permissão). Marque os componentes na aba Materiais da ficha.',
         duration: 10000,
       });
       throw error || new Error('technical_sheets: 0 linhas afetadas');
     }
     await refetchSheetCascade();
     qc.invalidateQueries({ queryKey: ['technical_sheets'] });
   };

   const handleSave = async () => {
     if (!formData.material_name?.trim()) {
       toast.error('O nome do material é obrigatório');
       return;
     }
     const sku = formData.sku?.trim() || '';
     if (formData.active && !sku) {
       toast.error('O SKU é obrigatório para variante ativa');
       return;
     }
     if (sku.length > MATERIAL_VARIANT_SKU_MAX_LENGTH) {
       toast.error(`O SKU deve ter no máximo ${MATERIAL_VARIANT_SKU_MAX_LENGTH} caracteres`);
       return;
     }

     // Fichas legadas podem chegar com uma família-container gravada. Ela não
     // aparece mais nas opções e também não pode ser salva de novo: sem um
     // grupo-folha não existem SKUs/cores determinísticos para o PV resolver.
     const selectedGroupIds = [
       formData.main_material_group_id,
       formData.upper_material_group_id,
       formData.lining_material_group_id,
       formData.insole_material_group_id,
     ].filter(Boolean) as string[];
     const selectedContainer = groups.find(group =>
       selectedGroupIds.includes(group.id) && parentGroupIds.has(group.id));
     if (selectedContainer) {
       toast.error(`"${selectedContainer.name}" é uma família`, {
         description: 'Escolha um grupo dentro dessa família para definir os SKUs e cores da variante.',
       });
       return;
     }
     const selectedWithoutActiveProduct = groups.find(group =>
       selectedGroupIds.includes(group.id) && !activeProductGroupIds.has(group.id));
     if (selectedWithoutActiveProduct) {
       toast.error(`"${selectedWithoutActiveProduct.name}" não possui item ativo`, {
         description: 'Cadastre ao menos um SKU/cor no grupo antes de usá-lo em uma variante.',
       });
       return;
     }

     // Sem material principal a variante não troca material nenhum — vira um
     // rótulo com SKU próprio. Foi exatamente esse no-op silencioso que fez o
     // PV-00141 (EC23) vender NAPA SOFT e debitar NAPA SUDANI.
     if (!formData.main_material_group_id
         && !formData.upper_material_group_id
         && !formData.lining_material_group_id
         && !formData.insole_material_group_id
         && !formData.upper_material_product_id) {
       toast.error('Escolha o material principal da variante', {
         description: 'Sem ele a variante não troca material nenhum: o PV mostra um nome/SKU diferente, mas a produção continua cortando o material da ficha.',
       });
       return;
     }

     // Segunda metade do MESMO no-op: material principal escolhido, mas nenhum
     // componente liberado pra segui-lo. Os resolvers (TS e SQL) só caem no
     // principal depois de conferir `variant_drives_*`, então salvar assim
     // devolve lista de cores vazia no PV e mantém o corte no material da ficha
     // — foi o que aconteceu com SR02/GLOW METALIC em 20/08/2026.
     if (variantDrivesNoComponent({ variant: formData, sheet: sheetMaterials, cascade })) {
       toast.error('Nenhum componente segue esta variante', {
         description: cascadeSlots.length === 0
           ? 'A ficha não tem cabedal nem forração cadastrados: sem material na ficha não há o que a variante substitua. Preencha o material na aba Materiais e volte aqui.'
           : 'Marque em "Componentes que seguem esta variante" quais peças saem do material principal. Sem isso o PV mostra o SKU da variante mas a produção corta o material da ficha.',
       });
       return;
     }

     const normalized = formData.material_name.trim().toLowerCase();
     const collision = variants.find(v =>
       v.id !== editingVariant?.id &&
       v.material_name.trim().toLowerCase() === normalized
     );
     if (collision) {
       toast.error(`Já existe variante com nome "${collision.material_name}" nesta ficha`);
       return;
     }

     try {
       if (sku) {
         const skuCollision = await findMaterialVariantSkuCollision(sku, editingVariant?.id);
         if (skuCollision) {
           toast.error(`O SKU "${sku}" já está em uso`, {
             description: `Variante: ${skuCollision.material_name}. Espaços nas extremidades e diferença entre maiúsculas/minúsculas não criam outro SKU.`,
           });
           return;
         }
       }
       if (editingVariant?.id) {
         await updateVariant.mutateAsync({
           id: editingVariant.id,
           data: formData
         });
       } else if (duplicatingFromId) {
         // Só sobrescrevemos os campos que o usuário REALMENTE editou no diálogo
         // de duplicação (nome/SKU/EAN/NCM/descrição/preço/ativo + cabedal). Os
         // overrides de consumo (dm²/par) e os pins de SKU (forro/palmilha/solado)
         // NÃO têm campo no diálogo de duplicação, então não vão em `overrides`:
         // assim o hook os copia da variante de origem via `...sourceData`. Se
         // mandássemos `undefined` explícito aqui, o spread `{...sourceData,
         // ...overrides}` zeraria (clobber → NULL) os overrides/pins da origem.
         const { material_name, sku, barcode, ncm, description_override,
                 unit_price_override, active, main_material_group_id, upper_material_product_id,
                 upper_material_group_id, lining_material_group_id, insole_material_group_id } = formData;
         await duplicateVariant.mutateAsync({
           source_variant_id: duplicatingFromId,
           sheet_id: sheetId,
           overrides: {
             material_name,
             sku,
             barcode,
             ncm,
             description_override,
             unit_price_override,
             active,
             main_material_group_id,
             upper_material_product_id,
             upper_material_group_id,
             lining_material_group_id,
             insole_material_group_id,
             display_order: variants.length,
           },
         });
       } else {
         await addVariant.mutateAsync({
           ...formData,
           reference_id: sheetId,
           display_order: variants.length
         });
       }
       // A trava mora na ficha, então só é gravada DEPOIS que a variante salvou:
       // ligar a cascata e falhar o insert deixaria a ficha dirigida por uma
       // variante que não existe.
       if (cascadeDirty) await persistCascade();
       setIsDialogOpen(false);
       setDuplicatingFromId(null);
       setCascadeOverride(null);
     } catch (err) {
       // Error handled by mutation
     }
   };
 
   const handleToggleActive = async (variant: ReferenceMaterialVariant) => {
     if (!variant.active && !variant.sku?.trim()) {
       toast.error('Cadastre um SKU antes de ativar esta variante');
       return;
     }
     await updateVariant.mutateAsync({
       id: variant.id,
       data: { active: !variant.active }
     });
   };
 
   const handleMove = async (index: number, direction: 'up' | 'down') => {
     const newVariants = [...variants];
     const targetIndex = direction === 'up' ? index - 1 : index + 1;
     
     if (targetIndex < 0 || targetIndex >= newVariants.length) return;
     
     const temp = newVariants[index];
     newVariants[index] = newVariants[targetIndex];
     newVariants[targetIndex] = temp;
     
     const updates = newVariants.map((v, i) => ({
       id: v.id,
       display_order: i
     }));
     
     await reorderVariants.mutateAsync(updates);
   };
 
   if (isLoading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
 
   return (
     <div className="space-y-4">
       <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
         <p className="font-medium text-primary mb-1">Como funciona</p>
         <p>
           Cada variante aponta pra outro <strong>grupo de material</strong> (ex.: <strong>NAPA
           SANTORINE</strong>, <strong>NAPA TITANIUM</strong>) — mesma referência, mesma <strong>área
           (dm²/par)</strong> da ficha. Muda só a origem: o <strong>SKU</strong> e o <strong>valor de
           consumo</strong> (metros/custo) saem sozinhos da largura da ficha de componente e do preço
           do grupo. A <strong>cor</strong> vem do PV. No PV, a referência aparece com dropdown pra
           escolher a variante.
         </p>
       </div>

       {materialDaFichaSemVariante && (
         <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
           <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
             O material da ficha não tem variante
           </p>
           <p className="text-amber-700 dark:text-amber-400">
             A ficha usa <strong>{materialDaFichaSemVariante}</strong>, mas nenhuma variante ativa
             representa esse material. Quem vender esta referência <strong>sem escolher variante</strong> vai
             produzir em {materialDaFichaSemVariante} — sem que nada no PV diga isso. Cadastre uma variante
             para {materialDaFichaSemVariante} (ou corrija o material da ficha, se ele estiver errado).
           </p>
         </div>
       )}

       <div className="flex justify-between items-center">
         <div className="space-y-0.5">
           <h3 className="text-sm font-semibold flex items-center gap-2">
             <Package className="h-4 w-4 text-primary" />
             Variantes de Material
           </h3>
           <p className="text-xs text-muted-foreground">Defina variações de material para esta referência (ex: Napa, Verniz, Couro)</p>
         </div>
         <Button size="sm" onClick={() => handleOpenDialog()} className="h-8 gap-2">
           <Plus className="h-3.5 w-3.5" /> Adicionar Variante
         </Button>
       </div>
 
       <div className="rounded-md border bg-card">
         <Table>
           <TableHeader>
             <TableRow className="bg-muted/50">
               <TableHead className="w-[50px]"></TableHead>
               <TableHead>Material</TableHead>
               <TableHead>SKU / Barcode</TableHead>
               <TableHead>Preço Unit.</TableHead>
               <TableHead className="text-center w-[100px]">Status</TableHead>
               <TableHead className="text-right w-[120px]">Ações</TableHead>
             </TableRow>
           </TableHeader>
           <TableBody>
             {variants.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                   Nenhuma variante de material cadastrada.
                 </TableCell>
               </TableRow>
             ) : (
               variants.map((v, index) => (
                 <TableRow key={v.id} className={!v.active ? 'opacity-60' : ''}>
                   <TableCell>
                     <div className="flex flex-col gap-0.5">
                       <button 
                         disabled={index === 0} 
                         onClick={() => handleMove(index, 'up')}
                         className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                       >
                         <ChevronUp className="h-4 w-4" />
                       </button>
                       <button 
                         disabled={index === variants.length - 1} 
                         onClick={() => handleMove(index, 'down')}
                         className="text-muted-foreground hover:text-foreground disabled:opacity-20"
                       >
                         <ChevronDown className="h-4 w-4" />
                       </button>
                     </div>
                   </TableCell>
                   <TableCell className="font-medium">
                     <div className="flex flex-col">
                       <span>{v.material_name}</span>
                       {v.ncm && <span className="text-xs text-muted-foreground font-mono">NCM: {v.ncm}</span>}
                     </div>
                   </TableCell>
                   <TableCell>
                     <div className="flex flex-col gap-1">
                       {v.sku && <Badge variant="outline" className="w-fit text-xs font-mono py-0">{v.sku}</Badge>}
                       {v.barcode && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Barcode className="h-3 w-3" /> {v.barcode}</div>}
                     </div>
                   </TableCell>
                   <TableCell>
                     {/* Cast: tipo é number|null, mas o guard defensivo contra '' (dado legado de form) é mantido. */}
                     {v.unit_price_override != null && (v.unit_price_override as unknown) !== '' ? (
                       <span className="text-sm font-semibold text-green-600">R$ {Number(v.unit_price_override).toFixed(2)}</span>
                     ) : (
                       <span className="text-xs text-muted-foreground italic">Padrão da ficha</span>
                     )}
                   </TableCell>
                   <TableCell className="text-center">
                     <button onClick={() => handleToggleActive(v)}>
                       {v.active ? (
                         <Badge className="bg-green-500 hover:bg-green-600">Ativo</Badge>
                       ) : (
                         <Badge variant="secondary">Inativo</Badge>
                       )}
                     </button>
                   </TableCell>
                   <TableCell className="text-right">
                     <div className="flex justify-end gap-1">
                       <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(v)} title="Editar variante">
                         <Pencil className="h-3.5 w-3.5" />
                       </Button>
                       <Button
                         variant="ghost"
                         size="icon"
                         className="h-8 w-8"
                         onClick={() => handleOpenDuplicateDialog(v)}
                         title="Duplicar variante (copia BOM específico)"
                       >
                         <Copy className="h-3.5 w-3.5" />
                       </Button>
                       <DeleteConfirmButton
                         onConfirm={() => deleteVariant.mutateAsync(v.id)}
                         title="Excluir variante?"
                         description="O BOM específico desta variante será removido."
                         size="h-8 w-8"
                       />
                     </div>
                   </TableCell>
                 </TableRow>
               ))
             )}
           </TableBody>
         </Table>
       </div>
 
       <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) setDuplicatingFromId(null); }}>
         <DialogContent className="sm:max-w-[500px]">
           <DialogHeader>
             <DialogTitle>
               {editingVariant ? 'Editar Variante' : duplicatingFromId ? 'Duplicar Variante' : 'Nova Variante de Material'}
             </DialogTitle>
             <DialogDescription className="sr-only">
               Nome do material, SKU, EAN/GTIN e status da variante.
             </DialogDescription>
           </DialogHeader>

           {duplicatingFromId && (
             <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
               Os itens de BOM específicos da variante de origem serão copiados para a nova.
               Itens compartilhados (sem variante atrelada) continuam valendo automaticamente.
               Ajuste o <strong>nome do material</strong>, <strong>SKU</strong> e <strong>EAN/GTIN</strong> antes de salvar.
             </div>
           )}

            <div className="space-y-5 py-2 max-h-[65vh] overflow-y-auto px-0.5">
              {/* SEÇÃO — Material (grupos). A variante aponta GRUPOS; a cor vem do PV.
                  Área (dm²/par) é sempre a da ficha; muda só a origem do material. */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material</h4>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Material principal <span className="text-destructive">*</span></Label>
                  <GroupCombobox
                    value={formData.main_material_group_id}
                    onChange={handlePickMainGroup}
                    groups={materialGroups}
                    allGroups={groups}
                    describe={describeGroup}
                    placeholder="Selecionar grupo de napa…"
                    ariaLabel="Material principal da variante"
                  />
                  <p className="text-xs text-muted-foreground">
                    É o que esta variante É. Substitui o material da ficha em todos os
                    componentes que a ficha liberar (Cabedal, Forração, Fachete e a base da
                    tira artesanal). A placa/EVA da palmilha usa o seletor próprio abaixo. A
                    área (dm²/par) continua sendo a da ficha.
                  </p>
                </div>

                {/* Quais componentes seguem o material principal. Vive em
                    `technical_sheets.variant_drives_*` e vale pra TODAS as
                    variantes da ficha — mas a decisão é tomada aqui, junto com
                    o material. Antes esta caixa só existia escondida na aba
                    Materiais, e o texto daqui apenas apontava pra lá: variante
                    nova nascia sem cascata, sem cor no PV e cortando o material
                    da ficha (SR02/GLOW METALIC, 20/08/2026). */}
                {formData.main_material_group_id && (
                  <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                    <Label className="text-xs font-medium">
                      Componentes que seguem esta variante <span className="text-destructive">*</span>
                    </Label>
                    {cascadeSlots.length === 0 ? (
                      <p className="text-xs text-warning">
                        Esta ficha não tem Cabedal nem Forração cadastrados, então não há
                        componente que a variante possa substituir. Preencha o material na aba
                        <strong> Materiais</strong> da ficha antes de criar variantes.
                      </p>
                    ) : (
                      <>
                        {cascadeSlots.map(slot => {
                          const pinnedGroupId = slot.key === 'upper'
                            ? formData.upper_material_group_id
                            : formData.lining_material_group_id;
                          const pinnedGroup = pinnedGroupId
                            ? groups.find(group => group.id === pinnedGroupId)
                            : null;
                          const mainGroupName = groups.find(g => g.id === formData.main_material_group_id)?.name || 'material principal';
                          return (
                            <label
                              key={slot.key}
                              className={cn(
                                'flex items-start gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5',
                                pinnedGroup ? 'opacity-70' : 'cursor-pointer',
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 accent-primary"
                                checked={!pinnedGroup && cascade[slot.key]}
                                disabled={!!pinnedGroup}
                                onChange={e => setCascadeOverride({ ...cascade, [slot.key]: e.target.checked })}
                                aria-label={`${slot.label} segue o material principal da variante`}
                              />
                              <span className="text-[11px] leading-snug text-muted-foreground">
                                <strong className="text-foreground">{slot.label}</strong>
                                {pinnedGroup
                                  ? <> — exceção própria: sai de <strong className="text-foreground">{pinnedGroup.name}</strong>, não do material principal.</>
                                  : cascade[slot.key]
                                    ? <> — hoje <span className="line-through">{slot.sheetMaterial}</span> → sai de <strong className="text-foreground">{mainGroupName}</strong> ao vender esta variante.</>
                                    : <> — continua saindo de <strong className="text-foreground">{slot.sheetMaterial}</strong> mesmo vendendo esta variante.</>}
                              </span>
                            </label>
                          );
                        })}
                        <p className="text-xs text-muted-foreground">
                          Vale para todas as variantes desta ficha. Desmarcar preserva material de
                          identidade (ex.: cabedal de palha, que não deve virar napa porque o PV
                          vendeu outra variante). O Fachete tem caixa própria na aba
                          <strong> Materiais</strong> da ficha.
                        </p>
                      </>
                    )}
                  </div>
                )}

                <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Exceção por componente (opcional)
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      Use só quando um componente sai de um material <em>diferente</em> do principal.
                      Preenchido aqui, vence o material principal.
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Cabedal</Label>
                      <GroupCombobox
                        value={formData.upper_material_group_id}
                        onChange={handlePickCabedalGroup}
                        groups={materialGroups}
                        allGroups={groups}
                        describe={describeGroup}
                        placeholder="Segue o material principal"
                        allowInherit
                        ariaLabel="Grupo de cabedal"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Forro</Label>
                        <GroupCombobox
                          value={formData.lining_material_group_id}
                          onChange={handlePickLiningGroup}
                          groups={materialGroups}
                          allGroups={groups}
                          describe={describeGroup}
                          placeholder="Segue o material principal"
                          allowInherit
                          ariaLabel="Grupo de forro"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Placa / EVA da palmilha</Label>
                        <GroupCombobox
                          value={formData.insole_material_group_id}
                          onChange={handlePickInsoleGroup}
                          groups={materialGroups}
                          allGroups={groups}
                          describe={describeGroup}
                          placeholder="Segue o material principal"
                          allowInherit
                          ariaLabel="Grupo da placa ou EVA da palmilha"
                        />
                      </div>
                    </div>
                  </div>
                </details>
              </section>

              {/* SEÇÃO — Identidade fiscal (auto-preenchida do grupo, editável) */}
              <section className="space-y-3 border-t border-border/60 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-primary" />
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identidade fiscal</h4>
                  </div>
                  {formData.main_material_group_id && (
                    <span className="text-[10px] text-muted-foreground">Auto-preenchido · editável</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="material_name" className="text-xs font-medium">Nome da variante <span className="text-destructive">*</span></Label>
                  <Input
                    id="material_name"
                    className="h-9"
                    value={formData.material_name || ''}
                    onChange={e => setFormData(prev => ({ ...prev, material_name: e.target.value }))}
                    placeholder="ex: NAPA SANTORINE"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sku" className="text-xs font-medium">
                    SKU {formData.active && <span className="text-destructive">*</span>}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="sku"
                      className="h-9 flex-1 font-mono text-sm"
                      value={formData.sku || ''}
                      onChange={e => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                      maxLength={MATERIAL_VARIANT_SKU_MAX_LENGTH}
                      placeholder="Código do produto"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5"
                      onClick={() => setFormData(prev => ({ ...prev, sku: generateNextSku() }))}
                      title="Gerar próximo SKU"
                    >
                      <Hash className="h-3.5 w-3.5" /> Gerar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Identifica esta oferta comercial, deve ser único em todas as referências e ter até {MATERIAL_VARIANT_SKU_MAX_LENGTH} caracteres.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="barcode" className="text-xs font-medium">EAN / GTIN</Label>
                    <Input
                      id="barcode"
                      className="h-9 font-mono text-sm"
                      value={formData.barcode || ''}
                      onChange={e => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                      placeholder="Código de barras"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ncm" className="text-xs font-medium">NCM</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="ncm"
                        className="h-9 flex-1 font-mono text-sm"
                        value={formData.ncm || ''}
                        onChange={e => setFormData(prev => ({ ...prev, ncm: e.target.value }))}
                        placeholder="Classificação fiscal"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        onClick={handleSuggestNcm}
                        disabled={suggestingNcm}
                        title="Sugerir NCM via IA"
                        aria-label="Sugerir NCM via IA"
                      >
                        {suggestingNcm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="price" className="text-xs font-medium flex items-center gap-1.5">
                    Preço de venda do par <span className="font-normal text-muted-foreground">(opcional)</span>
                    <span title="Preço sugerido ao escolher esta variante no PV. A tabela de preço do cliente continua tendo prioridade. Não é custo — o custo vem do custeio da ficha.">
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  </Label>
                  <Input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    className="h-9 tabular-nums"
                    value={formData.unit_price_override ?? ''}
                    onChange={e => setFormData(prev => ({ ...prev, unit_price_override: e.target.value ? parseFloat(e.target.value) : null }))}
                    placeholder="Sem preço próprio"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sugerido no PV quando o preço do item ainda está zerado. Prioridade:
                    tabela do cliente &gt; preço da variante &gt; preço da ficha.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="description" className="text-xs font-medium">
                    Descrição NF-e <span className="font-normal text-muted-foreground">(opcional)</span>
                  </Label>
                  <textarea
                    id="description"
                    className="min-h-[64px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    value={formData.description_override || ''}
                    onChange={e => setFormData(prev => ({ ...prev, description_override: e.target.value }))}
                    placeholder="Descrição específica para esta variante"
                  />
                </div>

                <div className="flex items-center gap-3 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                  <Switch
                    id="active"
                    checked={formData.active}
                    onCheckedChange={checked => setFormData(prev => ({ ...prev, active: checked }))}
                  />
                  <Label htmlFor="active" className="text-sm cursor-pointer flex-1">
                    {formData.active ? 'Disponível para pedidos' : 'Variante oculta'}
                  </Label>
                </div>

             </section>
            </div>

           <DialogFooter>
             <Button variant="outline" onClick={() => { setIsDialogOpen(false); setDuplicatingFromId(null); }}>Cancelar</Button>
             <Button onClick={handleSave} disabled={addVariant.isPending || updateVariant.isPending || duplicateVariant.isPending}>
               {(addVariant.isPending || updateVariant.isPending || duplicateVariant.isPending) && <Loader2 className="h-3 w-3 mr-2 animate-spin" />}
               {duplicatingFromId ? 'Duplicar Variante' : 'Salvar Variante'}
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
     </div>
   );
 }
