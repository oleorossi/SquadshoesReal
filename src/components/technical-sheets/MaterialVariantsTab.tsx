 import { useState, useMemo } from 'react';
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
   DialogFooter,
 } from '@/components/ui/dialog';
 import {
   useReferenceMaterialVariants,
   useAddReferenceMaterialVariant,
   useUpdateReferenceMaterialVariant,
   useDeleteReferenceMaterialVariant,
   useReorderReferenceMaterialVariants,
   useDuplicateReferenceMaterialVariant,
   ReferenceMaterialVariant
 } from '@/hooks/useReferenceMaterialVariants';
 import { useProducts } from '@/hooks/useProducts';
 import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
 
  interface MaterialVariantsTabProps {
    sheetId: string;
    sheetCode?: string;
  }

  export function MaterialVariantsTab({ sheetId, sheetCode }: MaterialVariantsTabProps) {
   const { data: variants = [], isLoading } = useReferenceMaterialVariants(sheetId);
   const { data: products = [] } = useProducts();
   
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
      upper_material_product_id: null,
      upper_consumption_override: null,
      lining_material_product_id: null,
      lining_consumption_override: null,
      insole_material_product_id: null,
      insole_consumption_override: null,
      sole_material_product_id: null,
      sole_consumption_override: null,
    });

    const [materialSearchOpen, setMaterialSearchOpen] = useState(false);
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
          upper_material_product_id: null,
          display_order: variants.length
        });
      }
     setIsDialogOpen(true);
   };

   const handleOpenDuplicateDialog = (source: ReferenceMaterialVariant) => {
     setEditingVariant(null);
     setDuplicatingFromId(source.id);
     setFormData({
       material_name: `${source.material_name} (cópia)`,
       sku: generateNextSku(),
       barcode: '',
       ncm: source.ncm,
       description_override: source.description_override,
       unit_price_override: source.unit_price_override,
       active: source.active,
       upper_material_product_id: source.upper_material_product_id,
       display_order: variants.length,
     });
     setIsDialogOpen(true);
   };

   const handleSave = async () => {
     if (!formData.material_name?.trim()) {
       toast.error('O nome do material é obrigatório');
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
       if (editingVariant?.id) {
         await updateVariant.mutateAsync({
           id: editingVariant.id,
           data: formData
         });
       } else if (duplicatingFromId) {
         const { material_name, sku, barcode, ncm, description_override,
                 unit_price_override, active, upper_material_product_id,
                 upper_consumption_override, lining_material_product_id, lining_consumption_override,
                 insole_material_product_id, insole_consumption_override,
                 sole_material_product_id, sole_consumption_override } = formData;
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
             upper_material_product_id,
             upper_consumption_override,
             lining_material_product_id,
             lining_consumption_override,
             insole_material_product_id,
             insole_consumption_override,
             sole_material_product_id,
             sole_consumption_override,
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
       setIsDialogOpen(false);
       setDuplicatingFromId(null);
     } catch (err) {
       // Error handled by mutation
     }
   };
 
   const handleToggleActive = async (variant: ReferenceMaterialVariant) => {
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
           Cadastre aqui as variações de material principal desta referência (ex.: <strong>Napa</strong>,
           <strong> Santorini</strong>, <strong>Metálica</strong>). No PV, aparece <strong>uma única
           entrada</strong> da referência com dropdown pra selecionar a variante. Desde a migration
           20260525140000, cada variante pode ter linhas de BOM próprias em <code>sheet_materials</code>
           (use <code>material_variant_id</code>) — quando NULL, a linha vale pra todas as variantes.
         </p>
       </div>
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
                     {v.unit_price_override != null && v.unit_price_override !== '' ? (
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
                       <Button
                         variant="ghost"
                         size="icon"
                         className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                         onClick={async () => {
                           if (window.confirm('Excluir esta variante?')) {
                             await deleteVariant.mutateAsync(v.id);
                           }
                         }}
                         title="Excluir variante"
                       >
                         <Trash2 className="h-3.5 w-3.5" />
                       </Button>
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
           </DialogHeader>

           {duplicatingFromId && (
             <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
               Os itens de BOM específicos da variante de origem serão copiados para a nova.
               Itens compartilhados (sem variante atrelada) continuam valendo automaticamente.
               Ajuste o <strong>nome do material</strong>, <strong>SKU</strong> e <strong>EAN/GTIN</strong> antes de salvar.
             </div>
           )}

            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="material_name" className="text-right text-xs">Material</Label>
                <div className="col-span-3">
                  <Popover open={materialSearchOpen} onOpenChange={setMaterialSearchOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={materialSearchOpen}
                        className="w-full justify-between font-normal text-xs h-9"
                      >
                        {formData.material_name || "Selecionar material de cabedal..."}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[350px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Buscar material..." className="h-9" />
                        <CommandList>
                          <CommandEmpty>Nenhum material encontrado.</CommandEmpty>
                          <CommandGroup>
                            {products
                              .filter(p => p.active && (p.category || '').toLowerCase() === 'cabedal')
                              .map((product) => (
                                <CommandItem
                                  key={product.id}
                                  value={product.name}
                                  onSelect={(currentValue) => {
                                    setFormData(prev => ({
                                      ...prev,
                                      material_name: currentValue,
                                      upper_material_product_id: product.id,
                                      unit_price_override: prev.unit_price_override || product.unit_price
                                    }));
                                    setMaterialSearchOpen(false);
                                  }}
                                  className="text-xs py-2"
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      formData.material_name === product.name ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex flex-col">
                                    <span className="font-medium">{product.name}</span>
                                    <span className="text-xs text-muted-foreground font-mono">
                                      SKU: {product.sku} | Estoque: {product.quantity} {product.unit}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
             <div className="grid grid-cols-4 items-center gap-4">
               <Label htmlFor="sku" className="text-right">SKU</Label>
               <Input 
                 id="sku" 
                 className="col-span-3 font-mono text-sm" 
                 value={formData.sku || ''} 
                 onChange={e => setFormData(prev => ({ ...prev, sku: e.target.value }))}
                 placeholder="Código interno"
               />
             </div>
 
             <div className="grid grid-cols-4 items-center gap-4">
               <Label htmlFor="barcode" className="text-right">EAN/GTIN</Label>
               <Input 
                 id="barcode" 
                 className="col-span-3 font-mono text-sm" 
                 value={formData.barcode || ''} 
                 onChange={e => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                 placeholder="Código de barras"
               />
             </div>
 
             <div className="grid grid-cols-4 items-center gap-4">
               <Label htmlFor="ncm" className="text-right">NCM</Label>
              <div className="col-span-3 flex items-center gap-2">
                <Input 
                  id="ncm" 
                  className="flex-1 font-mono text-sm" 
                  value={formData.ncm || ''} 
                  onChange={e => setFormData(prev => ({ ...prev, ncm: e.target.value }))}
                  placeholder="Classificação fiscal"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSuggestNcm}
                  disabled={suggestingNcm}
                  title="Sugerir NCM via IA"
                >
                  {suggestingNcm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
              </div>
             </div>
 
             <div className="grid grid-cols-4 items-center gap-4">
               <Label htmlFor="price" className="text-right">Preço Ov.</Label>
               <div className="col-span-3 flex items-center gap-2">
                 <Input 
                   id="price" 
                   type="number" 
                   step="0.01"
                   className="flex-1"
                   value={formData.unit_price_override || ''} 
                   onChange={e => setFormData(prev => ({ ...prev, unit_price_override: e.target.value ? parseFloat(e.target.value) : null }))}
                   placeholder="Opcional: preço específico"
                 />
                 <div title="Se preenchido, este preço será usado em vez do custo calculado da ficha técnica.">
                   <Info className="h-4 w-4 text-muted-foreground" />
                 </div>
               </div>
             </div>
 
             <div className="grid grid-cols-4 items-start gap-4">
               <Label htmlFor="description" className="text-right mt-2">Descrição</Label>
               <textarea 
                 id="description" 
                 className="col-span-3 min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                 value={formData.description_override || ''} 
                 onChange={e => setFormData(prev => ({ ...prev, description_override: e.target.value }))}
                 placeholder="Descrição específica para esta variante"
               />
             </div>
 
             <div className="grid grid-cols-4 items-center gap-4">
               <Label htmlFor="active" className="text-right">Ativo</Label>
               <div className="col-span-3 flex items-center gap-2">
                 <Switch 
                   id="active" 
                   checked={formData.active} 
                   onCheckedChange={checked => setFormData(prev => ({ ...prev, active: checked }))} 
                 />
                 <span className="text-xs text-muted-foreground">{formData.active ? 'Variante disponível para pedidos' : 'Variante oculta'}</span>
               </div>
             </div>

             {/* Overrides de consumo por componente — opcional.
                 Vazio (NULL) = herda da ficha técnica. Preenchido = sobrescreve
                 no cálculo de consumo de OPs desta variante. Ex.: cabedal em
                 Sintético consome 5% menos que Couro. */}
             <details className="mt-2 rounded-md border border-border/60 bg-muted/20">
               <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30">
                 Overrides de consumo por componente (avançado)
               </summary>
               <div className="p-3 space-y-3 text-xs">
                 <p className="text-muted-foreground leading-relaxed">
                   Use estes campos pra sobrescrever consumo (dm²/par) ou produto de um componente específico
                   <strong> apenas</strong> nesta variante. Deixe vazio pra usar o que está na ficha técnica.
                 </p>

                 {/* Cabedal — consumo (produto já tem na seção acima) */}
                 <div className="grid grid-cols-4 items-center gap-2">
                   <Label className="text-right text-xs">Cabedal dm²/par</Label>
                   <Input
                     type="number"
                     step="0.01"
                     min="0"
                     placeholder="usa ficha"
                     value={formData.upper_consumption_override ?? ''}
                     onChange={e => setFormData(prev => ({ ...prev, upper_consumption_override: e.target.value === '' ? null : Number(e.target.value) }))}
                     className="col-span-3 h-8 text-xs"
                   />
                 </div>

                 {/* Forro — produto + consumo */}
                 <div className="grid grid-cols-4 items-center gap-2">
                   <Label className="text-right text-xs">Forro · produto</Label>
                   <select
                     className="col-span-3 h-8 text-xs rounded-md border border-input bg-background px-2"
                     value={formData.lining_material_product_id ?? ''}
                     onChange={e => setFormData(prev => ({ ...prev, lining_material_product_id: e.target.value || null }))}
                   >
                     <option value="">— Usar ficha técnica —</option>
                     {products.filter(p => p.active && /forr|forra/i.test(p.category || '')).map(p => (
                       <option key={p.id} value={p.id}>{p.name} {p.sku ? `· ${p.sku}` : ''}</option>
                     ))}
                   </select>
                 </div>
                 <div className="grid grid-cols-4 items-center gap-2">
                   <Label className="text-right text-xs">Forro dm²/par</Label>
                   <Input
                     type="number"
                     step="0.01"
                     min="0"
                     placeholder="usa ficha"
                     value={formData.lining_consumption_override ?? ''}
                     onChange={e => setFormData(prev => ({ ...prev, lining_consumption_override: e.target.value === '' ? null : Number(e.target.value) }))}
                     className="col-span-3 h-8 text-xs"
                   />
                 </div>

                 {/* Palmilha — produto + consumo */}
                 <div className="grid grid-cols-4 items-center gap-2">
                   <Label className="text-right text-xs">Palmilha · produto</Label>
                   <select
                     className="col-span-3 h-8 text-xs rounded-md border border-input bg-background px-2"
                     value={formData.insole_material_product_id ?? ''}
                     onChange={e => setFormData(prev => ({ ...prev, insole_material_product_id: e.target.value || null }))}
                   >
                     <option value="">— Usar ficha técnica —</option>
                     {products.filter(p => p.active && /palmilha/i.test(p.category || '')).map(p => (
                       <option key={p.id} value={p.id}>{p.name} {p.sku ? `· ${p.sku}` : ''}</option>
                     ))}
                   </select>
                 </div>
                 <div className="grid grid-cols-4 items-center gap-2">
                   <Label className="text-right text-xs">Palmilha dm²/par</Label>
                   <Input
                     type="number"
                     step="0.01"
                     min="0"
                     placeholder="usa ficha"
                     value={formData.insole_consumption_override ?? ''}
                     onChange={e => setFormData(prev => ({ ...prev, insole_consumption_override: e.target.value === '' ? null : Number(e.target.value) }))}
                     className="col-span-3 h-8 text-xs"
                   />
                 </div>

                 {/* Solado — produto override */}
                 <div className="grid grid-cols-4 items-center gap-2">
                   <Label className="text-right text-xs">Solado · produto</Label>
                   <select
                     className="col-span-3 h-8 text-xs rounded-md border border-input bg-background px-2"
                     value={formData.sole_material_product_id ?? ''}
                     onChange={e => setFormData(prev => ({ ...prev, sole_material_product_id: e.target.value || null }))}
                   >
                     <option value="">— Usar primary_sole da ficha —</option>
                     {products.filter(p => p.active && /solado|sola/i.test(p.category || '')).map(p => (
                       <option key={p.id} value={p.id}>{p.name} {p.sku ? `· ${p.sku}` : ''}</option>
                     ))}
                   </select>
                 </div>
               </div>
             </details>
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