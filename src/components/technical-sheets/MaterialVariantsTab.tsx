 import { useState, useMemo, useId, type ReactNode } from 'react';
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
  evaluateUpperMaterialStructureCompatibility,
  hasVariantComponentPin,
  listVariantCascadeSlots,
  resolvePinnedMaterialGroupId,
  resolveStrapBaseReadout,
  seedVariantCascade,
  variantDrivesNoComponent,
  type MaterialVariantGroupLayer,
  type VariantCascadeSelection,
} from '@/lib/materialVariantColorGroup';
import { strapIdentityBasis } from '@/lib/strapIdentity';
 import { getGroupPath } from '@/lib/groupHierarchy';
 import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  resolveCompositeMaterialVariant,
  shouldVariantLiningFollowMainMaterial,
  type CompositeMaterialLayer,
} from '@/lib/compositeMaterialVariant';

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

async function loadProductGroupLayers(groupId: string): Promise<MaterialVariantGroupLayer[]> {
  const { data, error } = await supabase
    .from('product_group_layers')
    .select('id,component_group_id,component_label,role,display_order,is_color_source')
    .eq('composite_group_id', groupId)
    .order('display_order');
  if (error) throw error;
  return (data || []) as MaterialVariantGroupLayer[];
}
 
  interface MaterialVariantsTabProps {
    sheetId: string;
    sheetCode?: string;
  }

/**
 * Ajuda longa que NÃO ocupa altura no formulário. O texto continua o mesmo — só
 * sai do fluxo vertical.
 *
 * ⚠ Motivo de existir: os 2 parágrafos fixos sob "Material principal" somavam
 * ~490 caracteres (~96px) contra um controle de 38px, e empurravam metade do
 * diálogo pra fora da dobra. Não voltar a soltar parágrafo longo no fluxo —
 * uma linha curta fica visível e o resto vem pra cá.
 */
function HelpPopover({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] text-xs leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Seletor de grupo de material (product_groups) com busca. Reusado para
 * Cabedal / Forro / Placa-EVA da palmilha. `allowInherit` mostra "Herda a ficha"
 * (limpa a seleção → o motor resolve pela ficha).
 */
function GroupCombobox({
  value, onChange, groups, allGroups, describe, placeholder, allowInherit = false, ariaLabel,
  ariaDescribedBy, triggerClassName, invalid = false, footerNote,
}: {
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  groups: Array<ProductGroup & { pathLabel: string; familyLabel: string | null }>;
  allGroups: ProductGroup[];
  describe?: (groupId: string) => string | null;
  placeholder: string;
  allowInherit?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  /** Altura/tipografia do gatilho. O seletor de material principal usa um
   *  controle maior — é o campo que define o que a variante É. */
  triggerClassName?: string;
  invalid?: boolean;
  /** Rodapé fixo do popover (fora do `Command`, pra a busca não filtrá-lo). */
  footerNote?: string;
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
            aria-describedby={ariaDescribedBy}
            className={cn(
              'w-full justify-between font-normal h-9 text-sm',
              invalid && 'border-destructive text-destructive-foreground ring-1 ring-destructive/40',
              triggerClassName,
            )}
          >
            <span className={cn('truncate', !selected && !unavailableSelected && 'text-muted-foreground')}>
              {selected?.pathLabel
                || unavailableSelected?.name
                || placeholder}
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
          {footerNote && (
            <div className="border-t border-border/60 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
              {footerNote}
            </div>
          )}
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
   const upperStructureFeedbackId = useId();
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
         .select('upper_material, upper_material_group_id, upper_material_product_id, lining_material, lining_material_product_id, primary_sole_id, has_straps, strap_colors, strap_base_group_id, variant_drives_upper, variant_drives_lining, variant_drives_fachete')
         .eq('id', sheetId)
         .maybeSingle();
       if (error) throw error;
       return data as {
         upper_material: string | null;
         upper_material_group_id: string | null;
         upper_material_product_id: string | null;
         lining_material: string | null;
         lining_material_product_id: string | null;
         primary_sole_id: string | null;
         has_straps: boolean | null;
         strap_colors: Array<{
           identity_basis?: 'reference_base' | 'finished_product_group' | null;
         }> | null;
         strap_base_group_id: string | null;
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

   /**
    * O fachete não é campo da ficha: o grupo vem de
    * `products.fachete_material_group_id` do SOLADO principal (fallback no forro
    * da ficha) e a trava só faz sentido quando o solado é fachetado. Sem esta
    * consulta o slot não teria como aparecer no diálogo — foi por isso que a
    * trava dele sobreviveu escondida na aba Materiais depois do PR #146.
    */
   const { data: soleCascadeContext } = useQuery({
     queryKey: ['sheet_variant_cascade_sole', sheetMaterials?.primary_sole_id],
     queryFn: async () => {
       const { data, error } = await supabase
         .from('products')
         .select('is_fachetado, fachete_material_group_id')
         .eq('id', sheetMaterials?.primary_sole_id ?? '')
         .maybeSingle();
       if (error) throw error;
       return data;
     },
     enabled: !!sheetMaterials?.primary_sole_id,
     staleTime: 60_000,
   });
   const soleContext = useMemo(() => ({
     soleIsFachetado: !!soleCascadeContext?.is_fachetado,
     facheteGroupName: soleCascadeContext?.fachete_material_group_id
       ? groups.find(group => group.id === soleCascadeContext.fachete_material_group_id)?.name ?? null
       : null,
   }), [soleCascadeContext, groups]);

   /**
    * Componentes que o MATERIAL PRINCIPAL substitui, lidos de `variant_drives_*`
    * na ficha. Vira chip no diálogo: escolher o grupo passou a responder
    * "cascateia pra onde?" em vez de deixar isso num parágrafo.
    *
    * ⚠ Não existe `variant_drives_insole` — a coluna foi DROPADA (ver
    * `variantMainMaterial.contract.test.ts`). A placa/EVA da palmilha só muda
    * pelo seletor de exceção, nunca pelo material principal. Não invente um
    * chip "Palmilha" aqui.
    */
   const drivenComponents = useMemo(() => ([
     { key: 'upper', label: 'Cabedal', on: !!sheetMaterials?.variant_drives_upper },
     { key: 'lining', label: 'Forração', on: !!sheetMaterials?.variant_drives_lining },
     { key: 'fachete', label: 'Fachete', on: !!sheetMaterials?.variant_drives_fachete },
   ]), [sheetMaterials]);
   /**
    * Ficha que não liberou componente nenhum: o material principal não cascateia
    * pra lugar algum e a variante vira rótulo com SKU próprio — o mesmo no-op
    * silencioso que fez o PV-00141 (EC23) vender NAPA SOFT e debitar NAPA SUDANI.
    *
    * ⚠ NÃO tratar o aviso como barulho de default. Medido em 20/08/2026: das 57
    * fichas, 29 têm alguma flag e 28 não têm nenhuma — e as 29 que possuem
    * variante ativa são EXATAMENTE as 29 com flag (zero variante ativa em ficha
    * sem flag). Ou seja, o aviso só aparece em ficha ainda não preparada, que é
    * precisamente quando ele é verdadeiro e acionável.
    */
   const nenhumComponenteLiberado = drivenComponents.every(component => !component.on);

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

   /**
    * Estrutura física do Cabedal. O pin de produto vence o grupo, igual aos
    * resolvers; a partir daí a decisão usa SOMENTE `product_group_layers`.
    * Setor e nome do grupo não participam da compatibilidade.
    */
   const sheetUpperBaseGroupId = useMemo(() => resolvePinnedMaterialGroupId({
     productId: sheetMaterials?.upper_material_product_id,
     groupId: sheetMaterials?.upper_material_group_id,
     products,
   }),
   [products, sheetMaterials?.upper_material_product_id, sheetMaterials?.upper_material_group_id]);
   const explicitUpperOverrideGroupId = useMemo(() => resolvePinnedMaterialGroupId({
     productId: formData.upper_material_product_id,
     groupId: formData.upper_material_group_id,
     products,
   }),
   [products, formData.upper_material_product_id, formData.upper_material_group_id]);
   // Pin de produto inativo não é override: o SQL o ignora e continua pelo
   // grupo/ficha. A UI precisa tomar a decisão pelo mesmo grupo efetivo.
   const hasExplicitUpperOverride = !!explicitUpperOverrideGroupId;

   const compositeCatalogQuery = useQuery({
     queryKey: ['product_group_layers', 'variant_catalog'],
     enabled: isDialogOpen,
     queryFn: async () => {
       const { data, error } = await supabase.from('product_group_layers')
         .select('composite_group_id,component_group_id,component_label,role,display_order,is_color_source');
       if (error) throw error;
       return (data || []) as CompositeMaterialLayer[];
     },
     staleTime: 0,
   });
   const compositeResolution = resolveCompositeMaterialVariant({
     baseGroupId: sheetUpperBaseGroupId,
     mainGroupId: formData.main_material_group_id,
     groups,
     layers: compositeCatalogQuery.data || [],
   });
   const automaticUpper = !hasExplicitUpperOverride && compositeResolution.status === 'resolved'
     ? compositeResolution : null;
   const automaticUpperRequested = !hasExplicitUpperOverride
     && compositeResolution.status !== 'not_applicable';
   const liningBaseGroupId = resolvePinnedMaterialGroupId({
     productId: sheetMaterials?.lining_material_product_id,
     groupId: groups.find(group => group.name.trim().toLocaleLowerCase('pt-BR')
       === sheetMaterials?.lining_material?.trim().toLocaleLowerCase('pt-BR'))?.id,
     products,
   });
   const automaticLiningGroupId = formData.main_material_group_id
     && !resolvePinnedMaterialGroupId({
       productId: formData.lining_material_product_id,
       groupId: formData.lining_material_group_id,
       products,
     })
     && shouldVariantLiningFollowMainMaterial({
       baseGroupId: sheetUpperBaseGroupId,
       liningGroupId: liningBaseGroupId,
       layers: compositeCatalogQuery.data || [],
     }) ? formData.main_material_group_id : null;
   const resolvedVariantData = {
     ...formData,
     ...(automaticUpper ? { upper_material_group_id: automaticUpper.groupId, upper_material_product_id: null } : {}),
     ...(automaticLiningGroupId ? { lining_material_group_id: automaticLiningGroupId, lining_material_product_id: null } : {}),
   };
   const [preparingComposite, setPreparingComposite] = useState(false);
   const prepareComposite = async () => {
     setPreparingComposite(true);
     try {
       const { error } = await supabase.rpc('prepare_composite_upper_variant' as never, {
         p_sheet_id: sheetId,
         p_main_group_id: formData.main_material_group_id,
       } as never);
       if (error) throw error;
       await Promise.all([
         qc.invalidateQueries({ queryKey: ['product_groups'] }),
         qc.invalidateQueries({ queryKey: ['product_group_layers'] }),
       ]);
       toast.success('Composição preparada. Cadastre as cores, dimensões e custo do material dublado em Grupos.');
     } catch (error) {
       toast.error((error as { message?: string })?.message || 'Não foi possível preparar a dublagem.');
     } finally {
       setPreparingComposite(false);
     }
   };

   // Mesma query/key usada pelo editor da composição: além de evitar uma fonte
   // paralela, uma alteração no grupo invalida exatamente estes dados.
   const baseUpperLayersQuery = useQuery({
     queryKey: ['product_group_layers', sheetUpperBaseGroupId],
     queryFn: () => loadProductGroupLayers(sheetUpperBaseGroupId!),
     enabled: isDialogOpen && !!sheetUpperBaseGroupId,
     staleTime: 60_000,
   });
   const overrideUpperLayersQuery = useQuery({
     queryKey: ['product_group_layers', explicitUpperOverrideGroupId],
     queryFn: () => loadProductGroupLayers(explicitUpperOverrideGroupId!),
     enabled: isDialogOpen && !!explicitUpperOverrideGroupId,
     staleTime: 60_000,
   });
   const upperStructureCompatibility = evaluateUpperMaterialStructureCompatibility({
     baseLayers: baseUpperLayersQuery.data || [],
     overrideLayers: overrideUpperLayersQuery.data || [],
     hasExplicitOverride: hasExplicitUpperOverride,
   });
   const upperBaseIsComposite = upperStructureCompatibility.baseIsComposite;
   const compositeCatalogIncomplete = upperBaseIsComposite && !!formData.main_material_group_id
     && compositeResolution.status === 'not_applicable';
   const upperStructurePending = compositeCatalogQuery.isFetching
     || (!!sheetUpperBaseGroupId && baseUpperLayersQuery.isLoading)
     || (upperBaseIsComposite && hasExplicitUpperOverride
       && !!explicitUpperOverrideGroupId && overrideUpperLayersQuery.isLoading);
   const upperStructureLoadFailed = compositeCatalogQuery.isError
     || (!!sheetUpperBaseGroupId && baseUpperLayersQuery.isError)
     || (upperBaseIsComposite && hasExplicitUpperOverride
       && !!explicitUpperOverrideGroupId && overrideUpperLayersQuery.isError);
   const upperStructureError = upperStructureLoadFailed
     ? 'Não foi possível carregar a composição do Cabedal. Recarregue e tente novamente.'
     : upperBaseIsComposite && hasExplicitUpperOverride && !upperStructurePending
         && !upperStructureCompatibility.compatible
       ? 'Cabedal incompatível: escolha um grupo composto que preserve todas as camadas fixas do Cabedal da ficha.'
       : '';

   // Componentes que seguem o material principal desta variante. O valor mora na
   // FICHA (`technical_sheets.variant_drives_*`) e vale pra TODAS as variantes
   // dela — por isso o estado local é só um override do que está gravado, e é
   // limpo a cada abertura do diálogo. `null` = "ainda não mexi", e aí a tela
   // mostra o seed (o gravado, ou o único componente possível numa ficha nunca
   // configurada). Cabedal composto usa o grupo dublado derivado; nunca recebe
   // o grupo puro inteiro, porque isso descartaria as camadas fixas.
   const [cascadeOverride, setCascadeOverride] = useState<VariantCascadeSelection | null>(null);
   const cascadeSlots = useMemo(
     () => listVariantCascadeSlots(sheetMaterials, soleContext),
     [sheetMaterials, soleContext],
   );
   const seededCascade = cascadeOverride ?? seedVariantCascade(sheetMaterials, soleContext);
   const cascade: VariantCascadeSelection = upperBaseIsComposite
     ? { ...seededCascade, upper: false }
     : seededCascade;

   /**
    * Fora da correção estrutural, o bloco de checkboxes e a gravação continuam
    * sob o mesmo gate (`main_material_group_id`). A única exceção é o Cabedal
    * composto: a UI mostra o bloqueio e persiste `variant_drives_upper=false`
    * mesmo quando a variante usa apenas um override explícito.
    */
   /**
    * Base da napa da TIRA artesanal, espelhando `resolve_strap_base_group_id`.
    * Só aparece em ficha de tiras — nas demais é ruído.
    *
    * `technical_sheets` não tem `lining_material_group_id`: o forro é resolvido
    * por NOME (`lining_material`), então a tradução nome→grupo é feita aqui e o
    * helper continua puro.
    */
   const strapBaseReadout = useMemo(() => {
     if (!sheetMaterials?.has_straps) return null;
     const hasReferenceBaseLine = (sheetMaterials.strap_colors || [])
       .some(line => strapIdentityBasis(line) === 'reference_base');
     if (!hasReferenceBaseLine) return null;
     const liningGroupByName = groups.find(group =>
         (group.name || '').trim().toLocaleLowerCase('pt-BR')
           === (sheetMaterials.lining_material || '').trim().toLocaleLowerCase('pt-BR'))?.id;
     const liningGroupId = resolvePinnedMaterialGroupId({
       productId: sheetMaterials.lining_material_product_id,
       groupId: liningGroupByName,
       products,
     });
     const readout = resolveStrapBaseReadout({
       variant: formData,
       sheet: {
         ...sheetMaterials,
         lining_material_group_id: liningGroupId,
       },
       cascade,
       products,
     });
     if (!readout) return null;
     return {
       ...readout,
       groupName: groups.find(group => group.id === readout.groupId)?.name ?? 'material da ficha',
       liningGroupName: groups.find(group => group.id === liningGroupId)?.name
         ?? sheetMaterials.lining_material ?? 'forração da ficha',
     };
   }, [sheetMaterials, formData, cascade, groups, products]);

   // Com material principal, persiste o que o usuário marcou. Mesmo sem ele,
   // uma ficha composta precisa persistir `variant_drives_upper=false` para
   // limpar uma cascata legada estruturalmente insegura.
   const cascadeEditable = !!formData.main_material_group_id || upperBaseIsComposite;
   const cascadeDirty = cascadeEditable && !!sheetMaterials && (
     cascade.upper !== !!sheetMaterials.variant_drives_upper
     || cascade.lining !== !!sheetMaterials.variant_drives_lining
     || cascade.fachete !== !!sheetMaterials.variant_drives_fachete
   );

  /**
   * Campos reprovados por `handleSave`. O toast continua — mas ele some em
   * segundos e não diz QUAL campo, então o usuário voltava ao formulário sem
   * saber onde corrigir. A marca fica até ele mexer no campo.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const upperStructureFeedback = fieldErrors.upper_material_group_id
    || (upperStructurePending
      ? 'Conferindo as camadas do Cabedal…'
      : upperStructureError
        || (upperBaseIsComposite && hasExplicitUpperOverride
          && upperStructureCompatibility.compatible
          ? 'Composição compatível: as camadas fixas do Cabedal foram preservadas.'
          : ''));
  const upperStructureFeedbackIsError = !!fieldErrors.upper_material_group_id
    || !!upperStructureError;
  const clearFieldError = (field: string) => setFieldErrors(prev => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });
  /** Marca o campo E dispara o toast (o toast nunca deixa de existir). */
  const failField = (field: string, inline: string, toastMessage: string, description?: string) => {
    setFieldErrors({ [field]: inline });
    toast.error(toastMessage, description ? { description } : undefined);
  };

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
     setFieldErrors({});
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
       ...(compositeResolution.status === 'resolved'
         && prev.upper_material_group_id === compositeResolution.groupId
         && !prev.upper_material_product_id
         ? { upper_material_group_id: null } : {}),
       ...(prev.lining_material_group_id === prev.main_material_group_id
         && !prev.lining_material_product_id
         ? { lining_material_group_id: null } : {}),
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
       // Preserva o pin enquanto o grupo não for alterado; trocar o grupo no
       // diálogo limpa esse pin também no payload da duplicação.
       lining_material_product_id: source.lining_material_product_id,
       lining_material_group_id: source.lining_material_group_id,
       insole_material_group_id: source.insole_material_group_id,
       display_order: variants.length,
     });
     setFieldErrors({});
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
         variant_drives_fachete: cascade.fachete,
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
     setFieldErrors({});
     if (upperStructurePending || preparingComposite) return;
     if (upperStructureLoadFailed) {
       failField('upper_material_group_id', 'Não foi possível conferir a composição. Recarregue e tente novamente.',
         'Não foi possível conferir a dublagem');
       return;
     }
     if (compositeCatalogIncomplete && !hasExplicitUpperOverride) {
       failField('upper_material_group_id', 'A composição foi alterada. Reabra a variante para conferir a dublagem atual.',
         'Atualize o cadastro da dublagem');
       return;
     }
     if (automaticUpperRequested && !automaticUpper) {
       failField('upper_material_group_id',
         compositeResolution.status === 'missing'
           ? `Cadastre ${compositeResolution.expectedGroupName} com suas cores antes de salvar.`
           : compositeResolution.status === 'ambiguous'
             ? 'Há mais de uma dublagem compatível. Escolha o Cabedal em Exceção por componente.'
             : 'Confira a composição do Cabedal e o material principal escolhido.',
         'A dublagem da variante precisa ser definida');
       return;
     }
     if (automaticUpper && !activeProductGroupIds.has(automaticUpper.groupId)) {
       failField('upper_material_group_id', `Cadastre as cores, dimensões e custo de ${automaticUpper.groupName} em Grupos.`,
         'O material dublado ainda não tem cores cadastradas');
       return;
     }
     if (!formData.material_name?.trim()) {
       failField('material_name', 'Obrigatório.', 'O nome do material é obrigatório');
       return;
     }
     const sku = formData.sku?.trim() || '';
     if (formData.active && !sku) {
       failField('sku', 'Obrigatório enquanto a variante estiver ativa.', 'O SKU é obrigatório para variante ativa');
       return;
     }
     if (sku.length > MATERIAL_VARIANT_SKU_MAX_LENGTH) {
       failField('sku', `Máximo ${MATERIAL_VARIANT_SKU_MAX_LENGTH} caracteres.`,
         `O SKU deve ter no máximo ${MATERIAL_VARIANT_SKU_MAX_LENGTH} caracteres`);
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
     // Qual dos quatro seletores está segurando o grupo reprovado — sem isso a
     // marca cairia sempre no principal, mesmo quando o erro é de uma exceção.
     const fieldOfGroup = (groupId: string) =>
       formData.main_material_group_id === groupId ? 'main_material_group_id'
       : formData.upper_material_group_id === groupId ? 'upper_material_group_id'
       : formData.lining_material_group_id === groupId ? 'lining_material_group_id'
       : 'insole_material_group_id';
     if (selectedContainer) {
       failField(fieldOfGroup(selectedContainer.id),
         `"${selectedContainer.name}" é uma família — escolha um grupo dentro dela.`,
         `"${selectedContainer.name}" é uma família`,
         'Escolha um grupo dentro dessa família para definir os SKUs e cores da variante.');
       return;
     }
     const selectedWithoutActiveProduct = groups.find(group =>
       selectedGroupIds.includes(group.id) && !activeProductGroupIds.has(group.id));
     if (selectedWithoutActiveProduct) {
       failField(fieldOfGroup(selectedWithoutActiveProduct.id),
         `"${selectedWithoutActiveProduct.name}" não tem SKU/cor ativo.`,
         `"${selectedWithoutActiveProduct.name}" não possui item ativo`,
         'Cadastre ao menos um SKU/cor no grupo antes de usá-lo em uma variante.');
       return;
     }

     // Cabedal composto não pode ser substituído por um grupo inteiro via
     // `variant_drives_upper`: isso apagaria Massa Box/forros estruturais. O
     // override explícito só passa quando a composição mantém a assinatura das
     // camadas que não fornecem cor.
     if (sheetUpperBaseGroupId && baseUpperLayersQuery.isLoading) {
       failField('upper_material_group_id', 'Aguarde a conferência da composição.',
         'Conferindo a composição do Cabedal');
       return;
     }
     if (sheetUpperBaseGroupId && baseUpperLayersQuery.isError) {
       failField('upper_material_group_id',
         'Não foi possível carregar a composição. Recarregue e tente novamente.',
         'Não foi possível conferir a composição do Cabedal',
         'A variante não foi salva para evitar substituir um Cabedal composto sem validar suas camadas fixas.');
       return;
     }
     if (upperBaseIsComposite && hasExplicitUpperOverride) {
       if (overrideUpperLayersQuery.isLoading) {
         failField('upper_material_group_id', 'Aguarde a conferência da composição.',
           'Conferindo a composição do Cabedal escolhido');
         return;
       }
       if (overrideUpperLayersQuery.isError) {
         failField('upper_material_group_id',
           'Não foi possível carregar a composição. Recarregue e tente novamente.',
           'Não foi possível conferir o Cabedal escolhido');
         return;
       }
       if (!upperStructureCompatibility.compatible) {
         failField('upper_material_group_id',
           'Não preserva todas as camadas fixas do Cabedal da ficha.',
           'Cabedal incompatível com a ficha',
           'Escolha um grupo composto com as mesmas camadas não-color-source. Só a camada que fornece a cor pode mudar.');
         return;
       }
     }

     // Sem material principal a variante não troca material nenhum — vira um
     // rótulo com SKU próprio. Foi exatamente esse no-op silencioso que fez o
     // PV-00141 (EC23) vender NAPA SOFT e debitar NAPA SUDANI.
     if (!formData.main_material_group_id
         && !hasVariantComponentPin(formData, products)) {
       failField('main_material_group_id',
         'Sem ele a variante não troca material nenhum.',
         'Escolha o material principal da variante',
         'Sem ele a variante não troca material nenhum: o PV mostra um nome/SKU diferente, mas a produção continua cortando o material da ficha.');
       return;
     }

     // Segunda metade do MESMO no-op: material principal escolhido, mas nenhum
     // componente liberado pra segui-lo. Os resolvers (TS e SQL) só caem no
     // principal depois de conferir `variant_drives_*`, então salvar assim
     // devolve lista de cores vazia no PV e mantém o corte no material da ficha
     // — foi o que aconteceu com SR02/GLOW METALIC em 20/08/2026.
     if (variantDrivesNoComponent({
       variant: resolvedVariantData,
       sheet: sheetMaterials,
       sole: soleContext,
       cascade,
       products,
     })) {
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
       failField('material_name', 'Já existe uma variante com este nome nesta ficha.',
         `Já existe variante com nome "${collision.material_name}" nesta ficha`);
       return;
     }

     try {
       if (sku) {
         const skuCollision = await findMaterialVariantSkuCollision(sku, editingVariant?.id);
         if (skuCollision) {
           failField('sku', `Já em uso pela variante "${skuCollision.material_name}".`,
             `O SKU "${sku}" já está em uso`,
             `Variante: ${skuCollision.material_name}. Espaços nas extremidades e diferença entre maiúsculas/minúsculas não criam outro SKU.`);
           return;
         }
       }
       if (editingVariant?.id) {
         await updateVariant.mutateAsync({
           id: editingVariant.id,
           data: resolvedVariantData
         });
       } else if (duplicatingFromId) {
         // Só sobrescrevemos os campos que o usuário REALMENTE editou no diálogo
         // de duplicação (nome/SKU/EAN/NCM/descrição/preço/ativo + cabedal). Os
         // overrides de consumo (dm²/par) e os pins de SKU (palmilha/solado)
         // NÃO têm campo no diálogo de duplicação, então não vão em `overrides`:
         // assim o hook os copia da variante de origem via `...sourceData`. Se
         // O pin de forro acompanha o seletor visível e pode ser limpo. Se
         // mandássemos `undefined` nos demais, o spread `{...sourceData,
         // ...overrides}` zeraria (clobber → NULL) os overrides/pins da origem.
         const { material_name, sku, barcode, ncm, description_override,
                 unit_price_override, active, main_material_group_id, upper_material_product_id,
                 upper_material_group_id, lining_material_product_id, lining_material_group_id, insole_material_group_id } = resolvedVariantData;
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
             lining_material_product_id,
             insole_material_group_id,
             display_order: variants.length,
           },
         });
       } else {
         await addVariant.mutateAsync({
           ...resolvedVariantData,
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
         {/* 1040px em vez de 500px. O DialogContent já traz `max-h-[90dvh]
             overflow-y-auto`, então o corpo NÃO leva scroll próprio: dois
             contêineres roláveis aninhados era o que fazia o formulário rolar
             por dentro numa tela de 1920px. */}
         <DialogContent className="sm:max-w-[1040px]">
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

            <div className="grid grid-cols-1 gap-0 py-2 lg:grid-cols-2">
              {/* COLUNA 1 — A DECISÃO. A variante aponta GRUPOS; a cor vem do PV.
                  Área (dm²/par) é sempre a da ficha; muda só a origem do material. */}
              <section className="space-y-3 px-0.5 pb-4 lg:pb-0 lg:pr-6">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-primary" />
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material</h4>
                </div>

                <div className="space-y-1.5">
                  {/* Campo herói: sem ele a variante não troca material nenhum, então
                      não pode ter o mesmo peso tipográfico de "EAN / GTIN". */}
                  <Label className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    Material principal <span className="text-destructive">*</span>
                    <HelpPopover label="O que o material principal substitui">
                      É o que esta variante É. Substitui o material da ficha em todos os
                      componentes que a ficha liberar (Cabedal, Forração, Fachete e a base
                      da tira artesanal). A placa/EVA da palmilha usa o seletor próprio da
                      exceção. Quais componentes seguem é definido na aba{' '}
                      <strong>Materiais</strong> da ficha: componente não liberado mantém o
                      material cadastrado — é o que preserva material de identidade
                      (ex.: cabedal de palha).
                    </HelpPopover>
                  </Label>
                  <GroupCombobox
                    value={formData.main_material_group_id}
                    onChange={groupId => { clearFieldError('main_material_group_id'); handlePickMainGroup(groupId); }}
                    groups={materialGroups}
                    allGroups={groups}
                    describe={describeGroup}
                    placeholder="Buscar grupo de material…"
                    ariaLabel="Material principal da variante"
                    triggerClassName="h-11 text-[15px]"
                    invalid={!!fieldErrors.main_material_group_id}
                    footerNote={`${materialGroups.length} grupos · ${VARIANT_MATERIAL_SECTORS.length} setores · solado não entra (tem pin próprio)`}
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
                            ? resolvedVariantData.upper_material_group_id
                            : slot.key === 'lining' ? resolvedVariantData.lining_material_group_id : null;
                          const pinnedGroup = pinnedGroupId
                            ? groups.find(group => group.id === pinnedGroupId)
                            : null;
                          const structureBlocked = slot.key === 'upper' && upperBaseIsComposite;
                          const automaticSlot = slot.key === 'upper' ? !!automaticUpper
                            : slot.key === 'lining' && !!automaticLiningGroupId;
                          const disabled = !!pinnedGroup || structureBlocked;
                          const mainGroupName = groups.find(g => g.id === formData.main_material_group_id)?.name || 'material principal';
                          return (
                            <label
                              key={slot.key}
                              className={cn(
                                'flex items-start gap-2 rounded-md border border-border/60 bg-background/60 px-2 py-1.5',
                                disabled ? 'opacity-70' : 'cursor-pointer',
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-3.5 w-3.5 accent-primary"
                                checked={!disabled && cascade[slot.key]}
                                disabled={disabled}
                                onChange={e => setCascadeOverride({ ...cascade, [slot.key]: e.target.checked })}
                                aria-label={`${slot.label} segue o material principal da variante`}
                              />
                              <span className="text-[11px] leading-snug text-muted-foreground">
                                <strong className="text-foreground">{slot.label}</strong>
                                {pinnedGroup
                                  ? automaticSlot
                                    ? <> — acompanha esta variante: <strong className="text-foreground">{pinnedGroup.name}</strong>.</>
                                    : <> — exceção própria: sai de <strong className="text-foreground">{pinnedGroup.name}</strong>.</>
                                  : structureBlocked
                                    ? <> — troca a camada externa e conserva as camadas fixas da dublagem.</>
                                  : cascade[slot.key]
                                    ? <> — hoje <span className="line-through">{slot.sheetMaterial}</span> → sai de <strong className="text-foreground">{mainGroupName}</strong> ao vender esta variante.</>
                                    : <> — continua saindo de <strong className="text-foreground">{slot.sheetMaterial}</strong> mesmo vendendo esta variante.</>}
                              </span>
                            </label>
                          );
                        })}
                        <p className="text-xs text-muted-foreground">
                          {upperBaseIsComposite
                            ? 'A dublagem conserva as camadas fixas. Use Exceção por componente para escolher outro material compatível.'
                            : 'As opções de acompanhamento valem para todas as variantes desta ficha. Desmarcar mantém o material original do componente.'}
                        </p>
                        {upperBaseIsComposite && (
                          <div className="space-y-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
                            <p className="font-medium">Cabedal composto protegido</p>
                            {hasExplicitUpperOverride ? (
                              <p>Usa a exceção de Cabedal selecionada abaixo, preservando as camadas fixas.</p>
                            ) : automaticUpper ? (
                              <p>Cabedal: <strong>{automaticUpper.groupName}</strong>.
                                {!activeProductGroupIds.has(automaticUpper.groupId)
                                  && ' Cadastre as cores, dimensões e custo deste dublado em Grupos antes de salvar.'}
                              </p>
                            ) : compositeResolution.status === 'missing' ? (
                              <>
                                <p>Cabedal: <strong>{compositeResolution.expectedGroupName}</strong> ainda não cadastrado.
                                  Prepare a composição e cadastre suas cores, dimensões e custo em Grupos.</p>
                                <Button type="button" size="sm" variant="outline" disabled={preparingComposite}
                                  onClick={prepareComposite}>
                                  {preparingComposite ? 'Preparando…' : 'Preparar composição da dublagem'}
                                </Button>
                              </>
                            ) : compositeResolution.status === 'ambiguous' ? (
                              <p role="alert" className="text-warning">Há mais de uma dublagem compatível.
                                Escolha o grupo em Exceção por componente.</p>
                            ) : compositeResolution.status === 'invalid' ? (
                              <p role="alert" className="text-warning">Confira se a dublagem tem uma única camada externa
                                e se o material principal é o material puro dessa camada.</p>
                            ) : <p>Escolha o material principal para conferir a dublagem.</p>}
                            {automaticLiningGroupId && <p>Forração: <strong>{groups.find(g => g.id === automaticLiningGroupId)?.name}</strong>.</p>}
                            <p className="text-muted-foreground">A área por par é a mesma da ficha. O cabedal usa o estoque do material já dublado.</p>
                            <a href={`/grupos?q=${encodeURIComponent(automaticUpper?.groupName || (compositeResolution.status === 'missing' ? compositeResolution.expectedGroupName : ''))}`}
                              target="_blank" rel="noopener noreferrer" className="font-medium underline">Abrir cadastro de grupos</a>
                          </div>
                        )}
                        {strapBaseReadout && (
                          <p className={cn(
                            'rounded-md border px-2 py-1.5 text-[11px] leading-snug',
                            strapBaseReadout.divergesFromLining
                              ? 'border-warning/40 bg-warning/10 text-warning'
                              : 'border-border/60 bg-background/60 text-muted-foreground',
                          )}>
                            <strong className="text-foreground">Base da tira:</strong>{' '}
                            sai de <strong className="text-foreground">{strapBaseReadout.groupName}</strong>
                            {strapBaseReadout.divergesFromLining
                              ? <> — ⚠ diferente da Forração (<strong>{strapBaseReadout.liningGroupName}</strong>).
                                  Revise a Forração da ficha antes de liberar esta variante.</>
                              : <> · segue a Forração. Para trocar esse material na variante, altere a
                                  <strong> Forração</strong>; Forração e tira mudam juntas.</>}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {upperStructureFeedback && (
                  <p
                    id={upperStructureFeedbackId}
                    role={upperStructureFeedbackIsError ? 'alert' : 'status'}
                    aria-live={upperStructureFeedbackIsError ? 'assertive' : 'polite'}
                    aria-atomic="true"
                    className={cn(
                      'rounded-md border px-2 py-1.5 text-xs',
                      upperStructureFeedbackIsError
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : upperStructurePending
                          ? 'border-border/60 bg-muted/20 text-muted-foreground'
                          : 'border-success/40 bg-success/10 text-success',
                    )}
                  >
                    {upperStructureFeedback}
                  </p>
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
                        onChange={groupId => { clearFieldError('upper_material_group_id'); handlePickCabedalGroup(groupId); }}
                        groups={materialGroups}
                        allGroups={groups}
                        describe={describeGroup}
                        placeholder={upperBaseIsComposite
                          ? automaticUpper?.groupName || 'Dublagem conforme o material principal'
                          : 'Segue o material principal'}
                        allowInherit
                        ariaLabel="Grupo de cabedal"
                        ariaDescribedBy={upperStructureFeedback ? upperStructureFeedbackId : undefined}
                        invalid={!!fieldErrors.upper_material_group_id}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Forro</Label>
                        <GroupCombobox
                          value={formData.lining_material_group_id}
                          onChange={groupId => { clearFieldError('lining_material_group_id'); handlePickLiningGroup(groupId); }}
                          groups={materialGroups}
                          allGroups={groups}
                          describe={describeGroup}
                          placeholder={automaticLiningGroupId ? groups.find(g => g.id === automaticLiningGroupId)?.name || 'Segue o material principal' : 'Segue o material principal'}
                          allowInherit
                          ariaLabel="Grupo de forro"
                          invalid={!!fieldErrors.lining_material_group_id}
                        />
                        {fieldErrors.lining_material_group_id && (
                          <p className="text-xs text-destructive">{fieldErrors.lining_material_group_id}</p>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Placa / EVA da palmilha</Label>
                        <GroupCombobox
                          value={formData.insole_material_group_id}
                          onChange={groupId => { clearFieldError('insole_material_group_id'); handlePickInsoleGroup(groupId); }}
                          groups={materialGroups}
                          allGroups={groups}
                          describe={describeGroup}
                          placeholder="Segue o material principal"
                          allowInherit
                          ariaLabel="Grupo da placa ou EVA da palmilha"
                          invalid={!!fieldErrors.insole_material_group_id}
                        />
                        {fieldErrors.insole_material_group_id && (
                          <p className="text-xs text-destructive">{fieldErrors.insole_material_group_id}</p>
                        )}
                      </div>
                    </div>
                  </div>
                </details>
              </section>

              {/* SEÇÃO — Identidade fiscal (auto-preenchida do grupo, editável) */}
              {/* COLUNA 2 — O CADASTRO. Empilha e ganha borda superior abaixo de lg. */}
              <section className="space-y-3 border-t border-border/60 px-0.5 pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
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
                    className={cn('h-9', fieldErrors.material_name && 'border-destructive focus-visible:ring-destructive')}
                    aria-invalid={!!fieldErrors.material_name}
                    value={formData.material_name || ''}
                    onChange={e => { clearFieldError('material_name'); setFormData(prev => ({ ...prev, material_name: e.target.value })); }}
                    placeholder="ex: NAPA SANTORINE"
                  />
                  {fieldErrors.material_name && (
                    <p className="text-xs text-destructive">{fieldErrors.material_name}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sku" className="text-xs font-medium">
                    SKU {formData.active && <span className="text-destructive">*</span>}
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="sku"
                      className={cn('h-9 flex-1 font-mono text-sm', fieldErrors.sku && 'border-destructive focus-visible:ring-destructive')}
                      aria-invalid={!!fieldErrors.sku}
                      value={formData.sku || ''}
                      onChange={e => { clearFieldError('sku'); setFormData(prev => ({ ...prev, sku: e.target.value })); }}
                      maxLength={MATERIAL_VARIANT_SKU_MAX_LENGTH}
                      placeholder="Código do produto"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 gap-1.5"
                      onClick={() => { clearFieldError('sku'); setFormData(prev => ({ ...prev, sku: generateNextSku() })); }}
                      title="Gerar próximo SKU"
                    >
                      <Hash className="h-3.5 w-3.5" /> Gerar
                    </Button>
                  </div>
                  {fieldErrors.sku && (
                    <p className="text-xs text-destructive">{fieldErrors.sku}</p>
                  )}
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
                    <HelpPopover label="Como o preço da variante é usado">
                      Preço sugerido ao escolher esta variante no PV, quando o preço do item
                      ainda está zerado. Prioridade: tabela do cliente &gt; preço da variante
                      &gt; preço da ficha. Não é custo — o custo vem do custeio da ficha.
                    </HelpPopover>
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
             <Button
               onClick={handleSave}
               disabled={upperStructurePending || preparingComposite || addVariant.isPending || updateVariant.isPending || duplicateVariant.isPending}
             >
               {(upperStructurePending || addVariant.isPending || updateVariant.isPending || duplicateVariant.isPending) && (
                 <Loader2 className="h-3 w-3 mr-2 animate-spin" />
               )}
               {upperStructurePending
                 ? 'Conferindo Cabedal…'
                 : duplicatingFromId ? 'Duplicar Variante' : 'Salvar Variante'}
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
     </div>
   );
 }
