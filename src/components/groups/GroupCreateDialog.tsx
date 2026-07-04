import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { MagnifyingGlass as Search, CircleNotch as Loader2, Check, FileText, Stack as Layers, Truck } from '@phosphor-icons/react';
 import { useAddGroup, useGroups } from "@/hooks/useGroups";
import { useIndividualPackaging } from "@/hooks/usePackaging";
import { useAddGroupSupplier } from "@/hooks/useGroupSuppliers";
import { useAddSupplier, useSuppliers, type Supplier } from "@/hooks/useSuppliers";
import { flattenGroupTree } from "@/lib/groupHierarchy";
import { SECTOR_OPTIONS, deriveCategoryFromGroup } from "@/lib/categoryFromGroup";
import { cn } from "@/lib/utils";

interface GroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const parseIntOrNull = (v: string): number | null => {
  if (v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export default function GroupCreateDialog({ open, onOpenChange }: GroupCreateDialogProps) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    sector: "" as string,
    auto_component_sheet: false,
    parent_group_id: "" as string,
    pairs_per_box_individual: null as number | null,
    pairs_per_box_master: null as number | null,
    pairs_per_box_colmeia: null as number | null,
    pairs_per_box_fitilho: null as number | null,
    box_type_id: "" as string,
    box_type_master_id: "" as string,
    box_type_colmeia_id: "" as string,
    box_type_fitilho_id: "" as string,
  });
  // Setor segue a sugestão automática pelo nome até o usuário escolher manualmente.
  const [sectorTouched, setSectorTouched] = useState(false);

   const [duplicateMatch, setDuplicateMatch] = useState<any>(null);
   const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
   const { data: allGroups = [] } = useGroups();
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
  const { data: boxOptions = [] } = useIndividualPackaging({ is_active: true });
  const NO_BOX = "__none__";

  const reset = () => {
    setForm({
      name: "",
      description: "",
      sector: "",
      auto_component_sheet: false,
      parent_group_id: "",
      pairs_per_box_individual: null,
      pairs_per_box_master: null,
      pairs_per_box_colmeia: null,
      pairs_per_box_fitilho: null,
      box_type_id: "",
      box_type_master_id: "",
      box_type_colmeia_id: "",
      box_type_fitilho_id: "",
    });
    setSectorTouched(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (duplicateMatch && !duplicateConfirmed) {
      return;
    }
    if (!form.sector) {
      return;
    }

    try {
      await addGroup.mutateAsync({
        name: form.name,
        description: form.description,
        sector: form.sector,
        auto_component_sheet: form.auto_component_sheet,
        parent_group_id: form.parent_group_id || null,
        pairs_per_box_individual: form.pairs_per_box_individual,
        pairs_per_box_master: form.pairs_per_box_master,
        pairs_per_box_colmeia: form.pairs_per_box_colmeia,
        pairs_per_box_fitilho: form.pairs_per_box_fitilho,
        box_type_id: form.box_type_id || null,
        box_type_master_id: form.box_type_master_id || null,
        box_type_colmeia_id: form.box_type_colmeia_id || null,
        box_type_fitilho_id: form.box_type_fitilho_id || null,
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
          <DialogTitle>Novo Grupo de Material</DialogTitle>
        <DialogDescription>O setor define a aba do Estoque onde o grupo aparece.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-3">
            <div>
              <Label htmlFor="group-name">Nome do Grupo *</Label>
              <Input
                id="group-name"
                 value={form.name}
                 onChange={(e) => {
                   const nextName = e.target.value;
                   setForm((f) => ({
                     ...f,
                     name: nextName,
                     sector: sectorTouched ? f.sector : deriveCategoryFromGroup(nextName),
                   }));
                   setDuplicateConfirmed(false);
                   setDuplicateMatch(null);
                 }}
                 onBlur={(e) => checkDuplicateName(e.target.value)}
                 required
                 className="mt-1"
                 placeholder="Ex: NAPA SOFT, SOLADO EVA"
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
                onValueChange={(v) => { setSectorTouched(true); setForm((f) => ({ ...f, sector: v })); }}
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
                Define a categoria dos produtos deste grupo. Sugerido pelo nome — confira antes de criar.
              </p>
            </div>
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
            <div>
              <Label htmlFor="group-parent" className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" /> Grupo Pai (hierarquia)
              </Label>
              <Select
                value={form.parent_group_id || "__root__"}
                onValueChange={(v) => setForm((f) => ({ ...f, parent_group_id: v === "__root__" ? "" : v }))}
              >
                <SelectTrigger id="group-parent" className="mt-1">
                  <SelectValue placeholder="Sem pai (grupo raiz)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Sem pai (grupo raiz)</SelectItem>
                  {flattenGroupTree(allGroups).map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {`${"  ".repeat(g.depth)}${g.depth > 0 ? "└ " : ""}${g.name}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Use pra agrupar variações do mesmo material (ex: "Componentes" → "Tira chata", "Tira Strass").
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <Switch
              id="auto-bom-create"
              checked={form.auto_component_sheet}
              onCheckedChange={(v) => setForm((f) => ({ ...f, auto_component_sheet: v }))}
            />
            <Label htmlFor="auto-bom-create" className="cursor-pointer text-sm">
              Ficha de Componente (BOM) — itens deste grupo entram automaticamente
            </Label>
          </div>

          <div className="rounded-lg border p-3 bg-muted/30 space-y-3">
            <div>
              <Label className="text-sm font-medium">Embalagem (opcional)</Label>
              <p className="text-xs text-muted-foreground">
                Vincule a caixa e os pares/caixa por tipo — o débito de embalagem lê isto do
                grupo do solado. Use só os tipos aplicáveis. Pode ajustar depois na edição.
              </p>
            </div>
            {([
              { key: 'individual', label: 'Individual', ph: '1', pairsField: 'pairs_per_box_individual', boxField: 'box_type_id' },
              { key: 'master', label: 'Master', ph: '12', pairsField: 'pairs_per_box_master', boxField: 'box_type_master_id' },
              { key: 'colmeia', label: 'Colmeia', ph: '24', pairsField: 'pairs_per_box_colmeia', boxField: 'box_type_colmeia_id' },
              { key: 'fitilho', label: 'Fitilho', ph: '2', pairsField: 'pairs_per_box_fitilho', boxField: 'box_type_fitilho_id' },
            ] as const).map((row) => (
              <div key={row.key} className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <Label className="text-xs">{row.label} — caixa</Label>
                  <Select
                    value={(form as any)[row.boxField] || NO_BOX}
                    onValueChange={(v) => setForm((f) => ({ ...f, [row.boxField]: v === NO_BOX ? "" : v }))}
                  >
                    <SelectTrigger className="mt-1 h-8"><SelectValue placeholder="Sem caixa" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_BOX}>Sem caixa</SelectItem>
                      {boxOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.product_name || b.internal_code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-20">
                  <Label className="text-xs">Pares/cx</Label>
                  <Input
                    type="number" min={1} step={1}
                    value={(form as any)[row.pairsField] ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [row.pairsField]: parseIntOrNull(e.target.value) }))}
                    className="mt-1 h-8" placeholder={row.ph}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-md border border-dashed bg-muted/20 p-3 flex items-start gap-2 text-xs text-muted-foreground">
            <Truck className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-foreground">Fornecedores</p>
              <p>
                Cadastre depois na página <strong>Grupos</strong> (botão "+ Fornecedor"
                em cada grupo). Cada grupo aceita múltiplos fornecedores com preço, prazo e
                condição de pagamento próprios.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={addGroup.isPending || !form.sector}>Criar Grupo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
