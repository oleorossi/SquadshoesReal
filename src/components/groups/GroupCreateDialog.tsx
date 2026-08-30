import { useMemo, useState } from "react";
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { MagnifyingGlass as Search, CircleNotch as Loader2, Check, FileText, Stack as Layers, Truck, Package } from '@phosphor-icons/react';
import { useAddGroup, useGroups, type ProductGroup } from "@/hooks/useGroups";
import { useProducts } from "@/hooks/useProducts";
import { useAddGroupSupplier } from "@/hooks/useGroupSuppliers";
import { useAddSupplier, useSuppliers, type Supplier } from "@/hooks/useSuppliers";
import { flattenGroupTree } from "@/lib/groupHierarchy";
import { SECTOR_OPTIONS, sectorOfGroup } from "@/lib/categoryFromGroup";
import { getFootwearSectorGuide } from "@/lib/footwearMaterialTaxonomy";
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
}

/** Setores cujo material é cortado de bobina/placa e tem consumo em dm²/par: sem
 *  largura o motor não converte dm²→metro e o consumo sai ~100× inflado. */
const AREA_SECTORS = new Set(['Cabedal', 'Forração da Palmilha', 'Palmilha']);

export default function GroupCreateDialog({ open, onOpenChange, initialSector, initialParentId, lockHierarchy, titleText }: GroupCreateDialogProps) {
  const isFamilyCreation = Boolean(lockHierarchy && initialSector && initialParentId == null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    sector: (initialSector ?? "") as string,
    auto_component_sheet: false,
    // Largura útil do material (mm). É o GRUPO que manda: o item herda ao ser
    // criado (ProductFormDialog já propaga dimensions_* do grupo) e só diverge
    // de propósito. Sem isso a mesma napa nascia em larguras diferentes, e
    // largura errada infla o consumo linear.
    dimensions_width: null as number | null,
    parent_group_id: (initialParentId ?? "") as string,
    is_artisanal_strap: false,
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

  const reset = () => {
    setForm({
      name: "",
      description: "",
      sector: initialSector ?? "",
      auto_component_sheet: false,
      is_artisanal_strap: false,
      dimensions_width: null,
      parent_group_id: initialParentId ?? "",
    });
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
    // Material de ÁREA cortado de bobina (napa/forro/palmilha) sem largura fica
    // com o consumo ~100× inflado: o dm²/par não tem como virar metro. Bloqueia
    // na criação em vez de deixar o erro aparecer lá na frente, no PV.
    if (requiresWidth && !(Number(form.dimensions_width) > 0)) {
      toast.error('Informe a largura da bobina (mm) — material de área sem largura infla o consumo ~100×.');
      return;
    }

    try {
      await addGroup.mutateAsync({
        name: form.name.trim().toUpperCase(),
        description: form.description,
        sector: form.sector,
        auto_component_sheet: form.is_artisanal_strap ? false : form.auto_component_sheet,
        is_artisanal_strap: form.is_artisanal_strap,
        dimensions_width: isFamilyCreation ? null : form.dimensions_width,
        dimensions_unit: !isFamilyCreation && form.dimensions_width ? 'mm' : null,
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
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
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
                onValueChange={(v) => setForm((f) => ({ ...f, sector: v }))}
              >
                <SelectTrigger id="group-sector" className="mt-1">
                  <SelectValue placeholder="Selecione o setor" />
                </SelectTrigger>
                <SelectContent>
                  {SECTOR_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {sectorGuide?.purpose ?? 'Define a aplicação principal dos produtos deste grupo.'}
              </p>
            </div>
            {requiresWidth && (
              <div>
                <Label htmlFor="group-width">Largura útil (mm) *</Label>
                <Input
                  id="group-width"
                  type="number"
                  min="1"
                  step="1"
                  className="mt-1"
                  value={form.dimensions_width ?? ''}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    dimensions_width: e.target.value ? Number(e.target.value) : null,
                  }))}
                  placeholder="Ex: 1370"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Cada item criado neste grupo herda esta largura. É ela que converte
                  dm²/par em metros — <strong>sem largura o consumo sai ~100× inflado</strong>.
                  Um item só diverge se aquele rolo for realmente de outra largura.
                </p>
                {!(Number(form.dimensions_width) > 0) && (
                  <p className="text-xs text-destructive mt-1">
                    Obrigatória para material de {SECTOR_OPTIONS.find(o => o.value === form.sector)?.label ?? form.sector}.
                  </p>
                )}
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
                Cadastre depois na página <strong>Grupos</strong> (botão "+ Fornecedor"
                em cada grupo). Cada grupo aceita múltiplos fornecedores com preço, prazo e
                condição de pagamento próprios.
              </p>
            </div>
          </div>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                addGroup.isPending
                || !form.sector
                || (requiresWidth && !(Number(form.dimensions_width) > 0))
              }
            >
              {isFamilyCreation ? 'Criar Família' : 'Criar Grupo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
