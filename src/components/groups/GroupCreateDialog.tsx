import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { MagnifyingGlass as Search, CircleNotch as Loader2, Check, FileText } from '@phosphor-icons/react';
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
    supplierName: "",
    supplierCnpj: "",
    supplierContact: "",
    supplierPhone: "",
    supplierEmail: "",
    supplierAddress: "",
    paymentTerms: "",
    leadTimeDays: 0,
  });

   const [searchOpen, setSearchOpen] = useState(false);
   const [duplicateMatch, setDuplicateMatch] = useState<any>(null);
   const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
   const { data: allGroups = [] } = useGroups();
   const { data: suppliers = [], isLoading: loadingSuppliers } = useSuppliers();
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
  const addGroupSupplier = useAddGroupSupplier();
  const addSupplier = useAddSupplier();

  const reset = () =>
    setForm({
      name: "",
      description: "",
      auto_component_sheet: false,
      supplierName: "",
      supplierCnpj: "",
      supplierContact: "",
      supplierPhone: "",
      supplierEmail: "",
      supplierAddress: "",
      paymentTerms: "",
      leadTimeDays: 0,
    });

  const handleSelectSupplier = (supplier: Supplier) => {
    setForm((f) => ({
      ...f,
      supplierName: supplier.name || supplier.trade_name || "",
      supplierCnpj: supplier.cnpj || "",
      supplierContact: supplier.contact_name || "",
      supplierPhone: supplier.phone || "",
      supplierEmail: supplier.email || "",
      supplierAddress: [supplier.address, supplier.city, supplier.state].filter(Boolean).join(", "),
      paymentTerms: supplier.payment_terms || "",
      leadTimeDays: supplier.lead_time_days || 0,
    }));
    setSearchOpen(false);
  };

   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
 
     if (duplicateMatch && !duplicateConfirmed) {
       return;
     }
 
     try {
      // Create the group
      const group = await addGroup.mutateAsync({
        name: form.name,
        description: form.description,
        auto_component_sheet: form.auto_component_sheet,
      });

      // If supplier info provided, create group supplier and main supplier
      if (form.supplierName.trim()) {
        await addGroupSupplier.mutateAsync({
          group_id: group.id,
          supplier_name: form.supplierName,
          supplier_cnpj: form.supplierCnpj,
          supplier_contact: form.supplierContact,
          supplier_phone: form.supplierPhone,
          supplier_email: form.supplierEmail,
          supplier_address: form.supplierAddress,
          payment_terms: form.paymentTerms,
          lead_time_days: form.leadTimeDays || 0,
        });

        // Check if supplier already exists by CNPJ
        const existingByCnpj =
          form.supplierCnpj &&
          suppliers.some((s) => s.cnpj?.replace(/\D/g, "") === form.supplierCnpj.replace(/\D/g, ""));

        // Also register in main suppliers table for NF matching (if not exists)
        if (!existingByCnpj) {
          await addSupplier.mutateAsync({
            name: form.supplierName,
            cnpj: form.supplierCnpj,
            contact_name: form.supplierContact,
            phone: form.supplierPhone,
            email: form.supplierEmail,
            address: form.supplierAddress,
            payment_terms: form.paymentTerms,
            lead_time_days: form.leadTimeDays || 0,
          });
        }
      }

      reset();
      onOpenChange(false);
    } catch {
      // errors handled by mutations
    }
  };

  // Get active suppliers (prioritize those with invoices/NF)
  const activeSuppliers = suppliers.filter((s) => s.active);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
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

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold">Fornecedor (opcional)</h4>
              <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    title="Buscar fornecedor de NF importada"
                  >
                    {loadingSuppliers ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    Buscar de NF
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <Command>
                    <CommandInput placeholder="Buscar por nome ou CNPJ..." />
                    <CommandList>
                      <CommandEmpty>Nenhum fornecedor encontrado</CommandEmpty>
                      <CommandGroup heading="Fornecedores cadastrados via NF">
                        {activeSuppliers.map((supplier) => (
                          <CommandItem
                            key={supplier.id}
                            value={`${supplier.name} ${supplier.cnpj}`}
                            onSelect={() => handleSelectSupplier(supplier)}
                            className="flex flex-col items-start gap-0.5"
                          >
                            <div className="flex items-center gap-2 w-full">
                              <Check
                                className={cn(
                                  "h-4 w-4 shrink-0",
                                  form.supplierCnpj === supplier.cnpj ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <FileText className="h-3 w-3 text-muted-foreground" />
                                  <p className="font-medium truncate">{supplier.name}</p>
                                </div>
                                {supplier.cnpj && <p className="text-xs text-muted-foreground">{supplier.cnpj}</p>}
                              </div>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Razão Social / Nome</Label>
                <Input
                  value={form.supplierName}
                  onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
                  className="mt-1"
                  placeholder="Nome do fornecedor"
                />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input
                  value={form.supplierCnpj}
                  onChange={(e) => setForm((f) => ({ ...f, supplierCnpj: e.target.value }))}
                  className="mt-1"
                  placeholder="00.000.000/0000-00"
                />
              </div>
              <div>
                <Label>Contato</Label>
                <Input
                  value={form.supplierContact}
                  onChange={(e) => setForm((f) => ({ ...f, supplierContact: e.target.value }))}
                  className="mt-1"
                  placeholder="Nome do contato"
                />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input
                  value={form.supplierPhone}
                  onChange={(e) => setForm((f) => ({ ...f, supplierPhone: e.target.value }))}
                  className="mt-1"
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input
                  value={form.supplierEmail}
                  onChange={(e) => setForm((f) => ({ ...f, supplierEmail: e.target.value }))}
                  className="mt-1"
                  placeholder="email@fornecedor.com"
                />
              </div>
              <div className="col-span-2">
                <Label>Endereço</Label>
                <Input
                  value={form.supplierAddress}
                  onChange={(e) => setForm((f) => ({ ...f, supplierAddress: e.target.value }))}
                  className="mt-1"
                  placeholder="Endereço completo"
                />
              </div>
              <div>
                <Label>Condição de Pagamento</Label>
                <Input
                  value={form.paymentTerms}
                  onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}
                  className="mt-1"
                  placeholder="Ex: 30/60/90"
                />
              </div>
              <div>
                <Label>Data de Faturamento (dias)</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.leadTimeDays || ""}
                  onChange={(e) => setForm((f) => ({ ...f, leadTimeDays: +e.target.value }))}
                  className="mt-1"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={addGroup.isPending || addGroupSupplier.isPending}>Criar Grupo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
