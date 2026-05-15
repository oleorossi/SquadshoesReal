import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
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
import { useAddGroupSupplier } from "@/hooks/useGroupSuppliers";
import { useAddSupplier, useSuppliers, type Supplier } from "@/hooks/useSuppliers";
import { cn } from "@/lib/utils";

interface GroupCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function GroupCreateDialog({ open, onOpenChange }: GroupCreateDialogProps) {
  const [form, setForm] = useState({
    name: "",
    description: "",
    auto_component_sheet: false,
    parent_group_id: "" as string,
  });

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

  const reset = () =>
    setForm({
      name: "",
      description: "",
      auto_component_sheet: false,
      parent_group_id: "",
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (duplicateMatch && !duplicateConfirmed) {
      return;
    }

    try {
      await addGroup.mutateAsync({
        name: form.name,
        description: form.description,
        auto_component_sheet: form.auto_component_sheet,
        parent_group_id: form.parent_group_id || null,
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
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-3">
            <div>
              <Label htmlFor="group-name">Nome do Grupo *</Label>
              <Input
                id="group-name"
                 value={form.name}
                 onChange={(e) => {
                   setForm((f) => ({ ...f, name: e.target.value }));
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
                       className="text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
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
              <p className="text-[10px] text-muted-foreground mt-1">
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
            <Button type="submit" disabled={addGroup.isPending}>Criar Grupo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
