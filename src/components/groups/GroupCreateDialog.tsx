import { useMemo, useState } from "react";
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "@/components/ui/number-input";
import { Stack as Layers, Truck, Package, Palette, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { useQueryClient } from "@tanstack/react-query";
import { useAddGroup, useGroups, type ProductGroup } from "@/hooks/useGroups";
import { useProducts } from "@/hooks/useProducts";
import { flattenGroupTree } from "@/lib/groupHierarchy";
import { organizationSectorOptions, sectorLabel, sectorOfGroup, MATERIAL_BASE_SECTOR } from "@/lib/categoryFromGroup";
import { getFootwearSectorGuide } from "@/lib/footwearMaterialTaxonomy";
import { AREA_STOCK_UNITS, colorRequirement, createGroupWithColors, normalizeColorList } from "@/lib/createGroupWithColors";
import { isAreaStockUnit } from "@/lib/areaGeometry";
import { findDuplicate, type DuplicateHit } from "@/lib/duplicateDetection";
import { ColorsMultiSelect } from "@/components/references/ColorsMultiSelect";
import { DuplicateSuggestion } from "@/components/inventory/DuplicateSuggestion";
import AreaGeometryFields, { WidthOnlyField, validateAreaGeometryFields } from "@/components/groups/AreaGeometryFields";
import { UNITS, UNIT_LABELS } from "@/types/inventory";
import type { GroupEditTab } from "./GroupEditDialog";
import { cn } from "@/lib/utils";

interface GroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-seleciona o setor (ex.: "Nova família" a partir de um setor da árvore). */
  initialSector?: string;
  /** Pré-vincula a uma família (ex.: "Novo subgrupo" dentro de uma família). */
  initialParentId?: string | null;
  /** Trava setor + pai (fluxo de subgrupo: o setor segue a família e não deve mudar). */
  lockHierarchy?: boolean;
  /** Título do diálogo (default "Novo Grupo de Material"). */
  titleText?: string;
  /** Grupo (não-família) criado: o pai abre a janela do grupo nesta aba —
   *  `colors` quando nasceu com cor, `items` quando o setor não tem cor. */
  onCreated?: (group: ProductGroup, tab: GroupEditTab) => void;
}

/** Setores cujo material é cortado de bobina/placa e tem consumo em dm²/par: sem
 *  largura o motor não converte dm²→metro e o consumo sai ~100× inflado. */
const AREA_SECTORS = new Set(['Cabedal', 'Forração da Palmilha', 'Palmilha']);

/** Material de área estoca em metro linear em todo o cadastro vivo (napas). É
 *  sugestão visível e editável — nunca deduzida em silêncio. */
const suggestedStockUnit = (sector: string | undefined) => (AREA_SECTORS.has(sector ?? '') ? 'm' : '');

export default function GroupCreateDialog({ open, onOpenChange, initialSector, initialParentId, lockHierarchy, titleText, onCreated }: GroupCreateDialogProps) {
  const isFamilyCreation = Boolean(lockHierarchy && initialSector && initialParentId == null);
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    description: "",
    sector: (initialSector ?? "") as string,
    auto_component_sheet: false,
    // Geometria do material. Porta canônica = grupo (L×A quando estoque é área;
    // só largura quando bobina linear neste setor).
    dimensions_width: null as number | null,
    dimensions_length: null as number | null,
    dimensions_unit: 'mm' as string,
    parent_group_id: (initialParentId ?? "") as string,
    is_artisanal_strap: !isFamilyCreation && initialSector === MATERIAL_BASE_SECTOR,
  });
   const [duplicateMatch, setDuplicateMatch] = useState<ProductGroup | null>(null);
   const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
   const { data: allGroups = [] } = useGroups();
   const { data: allProducts = [] } = useProducts();
   const sectorGuide = getFootwearSectorGuide(form.sector);
   const requiresWidth = AREA_SECTORS.has(form.sector) && !isFamilyCreation && !form.is_artisanal_strap;
   const itemCountByGroup = useMemo(() => {
     const counts = new Map<string, number>();
     for (const product of allProducts) {
       if (product.group_id) counts.set(product.group_id, (counts.get(product.group_id) || 0) + 1);
     }
     return counts;
   }, [allProducts]);
   const parentOptions = useMemo(
     () => flattenGroupTree(allGroups).filter((candidate) => (
       !candidate.parent_group_id
       && sectorOfGroup(candidate) === form.sector
       && (candidate.is_family === true || candidate.childCount > 0)
       && (itemCountByGroup.get(candidate.id) || 0) === 0
     )),
     [allGroups, form.sector, itemCountByGroup],
   );
   const checkDuplicateName = (name: string) => {
     if (!name.trim()) { setDuplicateMatch(null); return; }
     const normalizedName = name.trim().toLowerCase();
     const words = normalizedName.split(/\s+/).filter(w => w.length >= 3);
     
     // 1. Exact match
     const exactMatch = allGroups.find(g => g.name.trim().toLowerCase() === normalizedName);
     if (exactMatch && !duplicateConfirmed) {
       setDuplicateMatch(exactMatch);
       return;
     }
 
     // 2. Partial match (2+ words)
     if (words.length >= 2) {
       const partialMatch = allGroups.find(g => {
         const existingWords = g.name.toLowerCase().split(/\s+/);
         const matches = words.filter(w => existingWords.includes(w));
         return matches.length >= 2;
       });
       if (partialMatch && !duplicateConfirmed) {
         setDuplicateMatch(partialMatch);
         return;
       }
     }
     setDuplicateMatch(null);
   };
 

  const addGroup = useAddGroup();

  // ── Cores do grupo (spec grupo-cor-obrigatoria.md) ─────────────────────────
  // Grupo-folha sem item é invisível no seletor da ficha e não tinha como
  // ganhar a 1ª cor pelas abas. Nos setores com cor, ele já nasce com ela.
  const [variesByColor, setVariesByColor] = useState<boolean | null>(null);
  const [colorsText, setColorsText] = useState('');
  const [stockUnit, setStockUnit] = useState(suggestedStockUnit(initialSector));
  const [unitPrice, setUnitPrice] = useState(0);
  const [coresLiberadas, setCoresLiberadas] = useState<Set<string>>(new Set());
  const [creatingWithColors, setCreatingWithColors] = useState(false);

  const requirement = colorRequirement({
    sector: form.sector,
    isFamily: isFamilyCreation,
    isArtisanalStrap: form.is_artisanal_strap,
  });
  const colorsActive = requirement === 'required' || (requirement === 'ask' && variesByColor === true);
  const colors = useMemo(() => normalizeColorList(colorsText.split(',')), [colorsText]);
  const isAreaSector = AREA_SECTORS.has(form.sector);
  const unitOptions: readonly string[] = isAreaSector ? AREA_STOCK_UNITS : UNITS;
  const unitOk = Boolean(stockUnit) && unitOptions.includes(stockUnit);
  const stockIsArea = isAreaStockUnit(stockUnit);
  const requiresAreaGeometry = !isFamilyCreation && !form.is_artisanal_strap && stockIsArea;

  /** Cor da fila que bate com item já cadastrado e ainda não foi liberada. */
  const suspeitas = useMemo(() => {
    const nome = form.name.trim().toUpperCase();
    if (!colorsActive || !nome) return [] as { cor: string; hit: DuplicateHit }[];
    return colors
      .filter(cor => !coresLiberadas.has(cor))
      .map(cor => ({ cor, hit: findDuplicate({ name: nome, color: cor, group_id: null }, allProducts) }))
      .filter((x): x is { cor: string; hit: DuplicateHit } => x.hit != null);
  }, [colorsActive, form.name, colors, coresLiberadas, allProducts]);

  const colorBlocker: string | null =
    requirement === 'ask' && variesByColor === null ? 'Responda se o material varia por cor.'
      : colorsActive && colors.length === 0 ? 'Cadastre ao menos uma cor.'
        : colorsActive && !unitOk ? 'Selecione a unidade de estoque.'
          : colorsActive && suspeitas.length > 0 ? 'Resolva as cores marcadas como possível duplicata.'
            : null;

  const removeColor = (cor: string) => setColorsText(colors.filter(c => c !== cor).join(', '));

  const reset = () => {
    setForm({
      name: "",
      description: "",
      sector: initialSector ?? "",
      auto_component_sheet: false,
      is_artisanal_strap: !isFamilyCreation && initialSector === MATERIAL_BASE_SECTOR,
      dimensions_width: null,
      dimensions_length: null,
      dimensions_unit: 'mm',
      parent_group_id: initialParentId ?? "",
    });
    setVariesByColor(null);
    setColorsText('');
    setStockUnit(suggestedStockUnit(initialSector));
    setUnitPrice(0);
    setCoresLiberadas(new Set());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Botão desabilitado não substitui feedback: o Enter no campo Nome dispara
    // o submit nativo e, sem toast, o form "não faz nada" sem explicar por quê.
    if (duplicateMatch && !duplicateConfirmed) {
      toast.error(`Já existe grupo com nome parecido ("${duplicateMatch.name}") — confirme a duplicata pra prosseguir.`);
      return;
    }
    if (!form.sector) {
      toast.error('Selecione o Setor antes de criar o grupo.');
      return;
    }
    if (requiresAreaGeometry) {
      const geomErr = validateAreaGeometryFields({
        width: form.dimensions_width,
        length: form.dimensions_length,
        dimensionsUnit: form.dimensions_unit,
      }, true);
      if (geomErr) {
        toast.error(geomErr);
        return;
      }
    } else if (requiresWidth && !(Number(form.dimensions_width) > 0)) {
      // Bobina (estoque em m): só largura — fora do escopo L×A de unidade de área.
      toast.error('Informe a largura da bobina (mm) — material sem largura infla o consumo ~100×.');
      return;
    }
    if (colorBlocker) {
      toast.error(colorBlocker);
      return;
    }

    if (colorsActive) {
      setCreatingWithColors(true);
      try {
        const created = await createGroupWithColors({
          group: {
            name: form.name,
            description: form.description,
            sector: form.sector,
            auto_component_sheet: form.auto_component_sheet,
            parent_group_id: form.parent_group_id || null,
            dimensions_width: form.dimensions_width,
            dimensions_length: form.dimensions_length,
            dimensions_unit: form.dimensions_width
              ? (form.dimensions_unit || 'mm')
              : null,
          },
          colors,
          unit: stockUnit,
          unitPrice,
          existingSkus: allProducts.map(product => product.sku),
        });
        qc.invalidateQueries({ queryKey: ['product_groups'] });
        qc.invalidateQueries({ queryKey: ['products'] });
        toast.success(`${created.name} criado com ${colors.length} ${colors.length === 1 ? 'cor' : 'cores'}`);
        reset();
        onOpenChange(false);
        onCreated?.(created, 'colors');
      } catch (error) {
        // Falha no lote já desfez o grupo (createGroupWithColors); o formulário
        // fica preenchido para corrigir e tentar de novo.
        toast.error(error instanceof Error ? error.message : 'Não foi possível criar o grupo.');
      } finally {
        setCreatingWithColors(false);
      }
      return;
    }

    try {
      const created = await addGroup.mutateAsync({
        name: form.name.trim().toUpperCase(),
        description: form.description,
        sector: form.sector,
        auto_component_sheet: form.is_artisanal_strap ? false : form.auto_component_sheet,
        is_artisanal_strap: form.is_artisanal_strap,
        dimensions_width: isFamilyCreation ? null : form.dimensions_width,
        dimensions_length: isFamilyCreation ? null : form.dimensions_length,
        dimensions_unit: !isFamilyCreation && form.dimensions_width
          ? (form.dimensions_unit || 'mm')
          : null,
        parent_group_id: form.parent_group_id || null,
        is_family: isFamilyCreation,
        // Fibra/placa da palmilha e cola não variam por cor. A cor da palmilha
        // entra no forro (setor Forração da Palmilha).
        is_color_agnostic: form.sector === 'Palmilha' || form.sector === 'Cola / Químico',
        // Embalagem NÃO entra: grupo de solado nasce sem caixa e a configuração
        // dos 3 modos é feita em Embalagens → Configuração por Solado.
      });
      reset();
      onOpenChange(false);
      // Família não recebe item; grupo sem cor segue para a aba Itens.
      if (!isFamilyCreation && created) onCreated?.(created as ProductGroup, 'items');
    } catch {
      // errors handled by mutations
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{titleText ?? 'Novo Grupo de Material'}</DialogTitle>
        <DialogDescription>
          {isFamilyCreation
            ? 'A família técnica organiza grupos da mesma natureza dentro deste setor e não recebe itens diretamente.'
            : 'Classifique o material por aplicação, família técnica e grupo/linha.'}
        </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-3">
            {isFamilyCreation && sectorGuide && (
              <div className="border-y border-foreground/15 bg-muted/20 px-3 py-3">
                <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-primary">
                  Famílias usuais em {sectorGuide.label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sectorGuide.purpose}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {sectorGuide.families.map((family) => (
                    <button
                      key={family.name}
                      type="button"
                      onClick={() => setForm((current) => ({
                        ...current,
                        name: family.name,
                        description: family.description,
                      }))}
                      className={cn(
                        'border px-2.5 py-1.5 text-left text-xs transition-colors',
                        form.name.trim().toUpperCase() === family.name
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-foreground/15 bg-background hover:border-foreground/40',
                      )}
                      title={`Exemplos: ${family.examples}`}
                    >
                      <span className="block font-semibold">{family.name}</span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">{family.examples}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="group-name">{isFamilyCreation ? 'Nome da Família *' : 'Nome do Grupo *'}</Label>
              <Input
                id="group-name"
                 value={form.name}
                 onChange={(e) => {
                   const nextName = e.target.value;
                   setForm((f) => ({ ...f, name: nextName }));
                   setDuplicateConfirmed(false);
                   setDuplicateMatch(null);
                 }}
                 onBlur={(e) => checkDuplicateName(e.target.value)}
                 required
                 className="mt-1"
                 placeholder={isFamilyCreation ? 'Ex.: LAMINADOS SINTÉTICOS' : 'Ex.: NAPA SOFT, SOLADO EVA'}
               />
               {duplicateMatch && !duplicateConfirmed && (
                 <div className="mt-2 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 space-y-2">
                   <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                     ⚠️ Já existe um grupo com este nome (ou similar)
                   </p>
                   <p className="text-xs text-amber-700 dark:text-amber-400">
                     "{duplicateMatch.name}" — Descrição: {duplicateMatch.description || 'N/A'}
                   </p>
                   <p className="text-xs text-amber-700 dark:text-amber-400">É o mesmo grupo?</p>
                   <div className="flex gap-2">
                     <Button
                       type="button"
                       variant="outline"
                       size="sm"
                       className="text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                       onClick={() => setDuplicateMatch(null)}
                     >
                       Sim, é o mesmo
                     </Button>
                     <Button
                       type="button"
                       variant="outline"
                       size="sm"
                       className="text-xs"
                       onClick={() => {
                         setDuplicateConfirmed(true);
                         setDuplicateMatch(null);
                       }}
                     >
                       Não, é diferente
                     </Button>
                   </div>
                 </div>
               )}
            </div>
            <div>
              <Label htmlFor="group-sector">Setor *</Label>
              <Select
                value={form.sector || undefined}
                disabled={lockHierarchy}
                onValueChange={(v) => {
                  setForm((f) => {
                    const enteringBase = v === MATERIAL_BASE_SECTOR;
                    const leavingBase = f.sector === MATERIAL_BASE_SECTOR && !enteringBase;
                    return {
                      ...f,
                      sector: v,
                      is_artisanal_strap: enteringBase && !isFamilyCreation ? true : leavingBase ? false : f.is_artisanal_strap,
                      auto_component_sheet: enteringBase ? false : f.auto_component_sheet,
                    };
                  });
                  // "Varia por cor?" é resposta por setor — trocar o setor pede de novo.
                  setVariesByColor(null);
                  if (AREA_SECTORS.has(v) && !(AREA_STOCK_UNITS as readonly string[]).includes(stockUnit)) setStockUnit('m');
                }}
              >
                <SelectTrigger id="group-sector" className="mt-1">
                  <SelectValue placeholder="Selecione o setor" />
                </SelectTrigger>
                <SelectContent>
                  {organizationSectorOptions().map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {sectorGuide?.purpose ?? 'Define a aplicação principal dos produtos deste grupo.'}
              </p>
              {form.sector === MATERIAL_BASE_SECTOR && !isFamilyCreation && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Tira cortada de napa (OVERLOCK, CHATA, meia cana). Cadastre rendimento e cores no Hub de Tiras.
                  STRASS comprada pronta permanece em <strong>Componentes</strong> — não tem material-base.
                </p>
              )}
            </div>
            {requiresAreaGeometry && (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm font-medium text-foreground">Dimensões da placa *</p>
                <AreaGeometryFields
                  idPrefix="group-create-area"
                  required
                  value={{
                    width: form.dimensions_width,
                    length: form.dimensions_length,
                    dimensionsUnit: form.dimensions_unit || 'mm',
                  }}
                  onChange={(next) => setForm((f) => ({
                    ...f,
                    dimensions_width: next.width,
                    dimensions_length: next.length,
                    dimensions_unit: next.dimensionsUnit,
                  }))}
                />
              </div>
            )}
            {!requiresAreaGeometry && requiresWidth && (
              <WidthOnlyField
                value={form.dimensions_width}
                onChange={(n) => setForm((f) => ({ ...f, dimensions_width: n, dimensions_unit: 'mm' }))}
                required
              />
            )}
            {requirement === 'ask' && (
              <div>
                <Label>Varia por cor? *</Label>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={variesByColor === true ? 'default' : 'outline'}
                    onClick={() => setVariesByColor(true)}
                  >
                    Sim, cada cor é um item
                  </Button>
                  <Button
                    type="button"
                    variant={variesByColor === false ? 'default' : 'outline'}
                    onClick={() => setVariesByColor(false)}
                  >
                    Não varia
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Fivela, enfeite e aviamento colorido variam; agulha e ilhós genérico, não.
                  Se variar, o grupo já nasce com as cores.
                </p>
              </div>
            )}
            {colorsActive && (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                <div className="flex items-start gap-2">
                  <Palette className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Cores *</p>
                    <p className="text-xs text-muted-foreground">
                      Grupo sem item <strong>não aparece na ficha técnica</strong>. Cada cor vira um
                      SKU ({form.name.trim() ? `${form.name.trim().toUpperCase()} - COR` : 'GRUPO - COR'}) com saldo 0.
                    </p>
                  </div>
                </div>
                <ColorsMultiSelect
                  value={colorsText}
                  onChange={setColorsText}
                  placeholder="Buscar no catálogo ou cadastrar cor…"
                />
                {/* Uma sugestão por vez — a primeira cor suspeita da fila. */}
                {suspeitas[0] && (
                  <DuplicateSuggestion
                    hit={suspeitas[0].hit}
                    onSameProduct={() => removeColor(suspeitas[0].cor)}
                    onDifferent={() => setCoresLiberadas(prev => new Set(prev).add(suspeitas[0].cor))}
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="group-stock-unit">Unidade de estoque *</Label>
                    <Select value={stockUnit || undefined} onValueChange={setStockUnit}>
                      <SelectTrigger id="group-stock-unit" className="mt-1">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {unitOptions.map((unit) => (
                          <SelectItem key={unit} value={unit}>{UNIT_LABELS[unit] || unit}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="group-unit-price">Preço unitário (R$)</Label>
                    <NumberInput id="group-unit-price" value={unitPrice} onChange={setUnitPrice} min={0} step="0.01" className="mt-1" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isAreaSector
                    ? 'Material de bobina estoca em metro; o consumo da ficha continua em dm²/par e a largura do grupo faz a conversão.'
                    : 'Fornecedor, estoque mínimo e demais dados ficam na aba Em massa do grupo.'}
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="group-desc">Descrição</Label>
              <Textarea
                id="group-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="mt-1"
                rows={2}
                placeholder="Descrição opcional"
              />
            </div>
            {!lockHierarchy && <div>
              <Label htmlFor="group-parent" className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> Família técnica
              </Label>
              <Select
                value={form.parent_group_id || "__root__"}
                disabled={lockHierarchy}
                onValueChange={(v) => setForm((f) => ({ ...f, parent_group_id: v === "__root__" ? "" : v }))}
              >
                <SelectTrigger id="group-parent" className="mt-1">
                  <SelectValue placeholder="Sem pai (grupo raiz)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Sem família (grupo solto)</SelectItem>
                  {parentOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                A família descreve a natureza do material; o grupo descreve a linha técnica/comercial.
              </p>
            </div>}
          </div>

          {!isFamilyCreation && <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <Switch
              id="is-artisanal-strap"
              checked={form.is_artisanal_strap}
              onCheckedChange={(v) => setForm((f) => ({
                ...f,
                is_artisanal_strap: v,
                auto_component_sheet: v ? false : f.auto_component_sheet,
              }))}
            />
            <Label htmlFor="is-artisanal-strap" className="cursor-pointer text-sm">
              Tira acabada (Hub) — não é a napa de origem. Desliga a ficha de componente automática.
              {form.sector === MATERIAL_BASE_SECTOR
                ? ' Obrigatória neste setor: a napa (Soft vs Madrid) é escolhida pela variante da ficha.'
                : ' Tira comprada pronta (STRASS) fica em Componentes; tira cortada de napa vai em Material Base.'}
            </Label>
          </div>}

          {!isFamilyCreation && <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <Switch
              id="auto-bom-create"
              checked={form.auto_component_sheet}
              disabled={form.is_artisanal_strap}
              onCheckedChange={(v) => setForm((f) => ({ ...f, auto_component_sheet: v }))}
            />
            <Label htmlFor="auto-bom-create" className="cursor-pointer text-sm">
              Ficha de Componente (BOM) — itens deste grupo entram automaticamente
            </Label>
          </div>}

          {/* Grupo de solado nasce vazio; a configuração tem porta única no
              setor de Embalagens e nunca é herdada em silêncio. */}
          {!isFamilyCreation && <div className="rounded-md border border-dashed bg-muted/20 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Package className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Embalagem</p>
              <p>
                Grupo de solado nasce <strong>sem caixa</strong>. Configure os três modos
                (Tradicional, Amarrado e Colméia) em <strong>Embalagens → Configuração por Solado</strong> —
                enquanto não configurar, o pedido entra mas nenhuma caixa é debitada.
              </p>
            </div>
          </div>}

          {!isFamilyCreation && <div className="rounded-md border border-dashed bg-muted/20 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Truck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Fornecedores</p>
              <p>
                Depois de criar, abra o grupo e use a aba <strong>Fornecedores</strong>
                (também resumida em Geral → Compras e abastecimento). Cada grupo aceita
                múltiplos fornecedores com preço, prazo e condição de pagamento próprios.
              </p>
            </div>
          </div>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              className="gap-2"
              disabled={
                addGroup.isPending
                || creatingWithColors
                || !form.sector
                || (requiresAreaGeometry && Boolean(validateAreaGeometryFields({
                  width: form.dimensions_width,
                  length: form.dimensions_length,
                  dimensionsUnit: form.dimensions_unit,
                }, true)))
                || (!requiresAreaGeometry && requiresWidth && !(Number(form.dimensions_width) > 0))
                || Boolean(colorBlocker)
              }
            >
              {creatingWithColors && <Loader2 className="h-4 w-4 animate-spin" />}
              {isFamilyCreation
                ? 'Criar Família'
                : colorsActive && colors.length > 0
                  ? `Criar grupo com ${colors.length} ${colors.length === 1 ? 'cor' : 'cores'}`
                  : 'Criar Grupo'}
            </Button>
          </DialogFooter>
          {colorBlocker && form.sector && (
            <p className="text-right text-xs text-muted-foreground">{colorBlocker}</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
