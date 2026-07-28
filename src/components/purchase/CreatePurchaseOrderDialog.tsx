 import { useState } from 'react';
 import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import { SearchableSelect } from '@/components/ui/searchable-select';
 import { useSuppliers } from '@/hooks/useSuppliers';
 import { useProducts } from '@/hooks/useProducts';
 import { useCreatePurchaseOrder } from '@/hooks/usePurchaseOrders';
 import { Plus, Trash as Trash2, CircleNotch as Loader2, ArrowsLeftRight as ArrowRightLeft } from '@phosphor-icons/react';
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
 import { toast } from 'sonner';
 import { describeConversion, effectiveConversionFactorStrict } from '@/lib/purchaseConversion';

 type OrderItem = {
   product_id: string;
   product_name: string;
   quantity: number;
   unit_price: number;
   unit: string;
   purchase_unit: string;
   conversion_rate: number | null;
   dimensions_width: number | null;
   dimensions_unit: string | null;
   stock_unit: string;
   current_stock: number;
   min_stock: number;
   max_stock: number;
 };
 
 export default function CreatePurchaseOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
   const { data: suppliers = [] } = useSuppliers();
   const { data: products = [] } = useProducts();
   const createPO = useCreatePurchaseOrder();
   
   const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
   const [notes, setNotes] = useState('');
   const [items, setItems] = useState<OrderItem[]>([]);
   const [isSubmitting, setIsSubmitting] = useState(false);

   const handleAddItem = (productId: string) => {
     const product = products.find(p => p.id === productId);
     if (!product) return;
     
     if (items.some(i => i.product_id === productId)) {
       toast.warning('Produto já adicionado');
       return;
     }
 
     const purchaseUnit = (product as any).purchase_unit || (product as any).purchase_order_unit || product.unit || 'un';
     const stockUnit = product.unit || 'un';
     const convRate = (product as any).conversion_rate ?? null;
     const dimWidth = (product as any).dimensions_width ?? null;
     const dimUnit = (product as any).dimensions_unit ?? null;
     // Custo unitário em produtos é R$ por unidade de estoque. Convertendo pra
     // R$/purchase_unit pra mostrar o preço da NF (= unit_price * factor).
     const factor = effectiveConversionFactorStrict({
       unit: stockUnit,
       purchase_unit: purchaseUnit,
       conversion_rate: convRate,
       dimensions_width: dimWidth,
       dimensions_unit: dimUnit,
     });
     if (factor == null) {
       toast.error(`"${product.name}": conversão inválida. Informe uma taxa maior que zero e, para material de área, a largura com unidade.`);
       return;
     }
     const purchasePrice = (product.unit_price || 0) * factor;

     setItems(prev => [...prev, {
       product_id: product.id,
       product_name: product.name,
       quantity: 1,
       unit_price: purchasePrice,  // armazenado em R$/purchase_unit (o que vai na OC/NF)
       unit: purchaseUnit,          // unidade da OC = unidade de compra
       purchase_unit: purchaseUnit,
       conversion_rate: convRate,
       dimensions_width: dimWidth,
       dimensions_unit: dimUnit,
       stock_unit: stockUnit,
       current_stock: product.quantity || 0,
       min_stock: product.min_stock || 0,
       max_stock: product.max_stock || 0,
     }]);
   };
 
   const handleRemoveItem = (index: number) => {
     setItems(prev => prev.filter((_, i) => i !== index));
   };
 
   const handleUpdateItem = (index: number, field: keyof OrderItem, value: any) => {
     setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
   };
 
   const handleSubmit = async () => {
     if (!selectedSupplierId) {
       toast.error('Selecione um fornecedor');
       return;
     }
     if (items.length === 0) {
       toast.error('Adicione pelo menos um item');
       return;
     }
 
     const supplier = suppliers.find(s => s.id === selectedSupplierId);
     if (!supplier) return;
 
     setIsSubmitting(true);
     try {
       await createPO.mutateAsync({
         supplier_id: supplier.id,
         supplier_name: supplier.name,
         notes,
         items: items.map(i => ({
           product_id: i.product_id,
           quantity: i.quantity,
           unit_price: i.unit_price,
           unit: i.unit,
           current_stock: i.current_stock,
           min_stock: i.min_stock,
           max_stock: i.max_stock,
         })),
       });
       onOpenChange(false);
       setItems([]);
       setSelectedSupplierId('');
       setNotes('');
     } catch (err: any) {
       toast.error(err.message);
     } finally {
       setIsSubmitting(false);
     }
   };
 
   const totalValue = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
 
   return (
     <Dialog open={open} onOpenChange={onOpenChange}>
       <DialogContent className="w-[95vw] max-w-5xl max-h-[90vh] overflow-y-auto">
         <DialogHeader>
           <DialogTitle>Nova Ordem de Compra</DialogTitle>
           <DialogDescription>Selecione o fornecedor e os itens; a OC é salva na unidade de compra de cada produto.</DialogDescription>
         </DialogHeader>
 
         <div className="space-y-4 py-4">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-2">
               <Label>Fornecedor</Label>
               <SearchableSelect
                 value={selectedSupplierId}
                 onChange={setSelectedSupplierId}
                 options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                 placeholder="Selecione o fornecedor"
               />
             </div>
             <div className="space-y-2">
               <Label>Observações</Label>
               <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional..." />
             </div>
           </div>
 
           <div className="space-y-2">
             <Label>Adicionar Produto</Label>
             <SearchableSelect
               value=""
               onChange={handleAddItem}
               options={products.map(p => ({ value: p.id, label: p.name, description: p.sku || undefined, keywords: p.sku || undefined }))}
               placeholder="Selecione um produto para adicionar"
               emptyText="Nenhum produto encontrado"
             />
           </div>
 
           <div className="rounded-md border">
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Produto</TableHead>
                   <TableHead className="w-32">Qtd na NF</TableHead>
                   <TableHead className="w-32">Preço Unit.</TableHead>
                   <TableHead className="w-32 text-right">Subtotal</TableHead>
                   <TableHead className="w-10"></TableHead>
                 </TableRow>
               </TableHeader>
               <TableBody>
                 {items.length === 0 ? (
                   <TableRow>
                     <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                       Nenhum item adicionado
                     </TableCell>
                   </TableRow>
                 ) : (
                   items.map((item, index) => {
                     const factor = effectiveConversionFactorStrict({
                       unit: item.stock_unit,
                       purchase_unit: item.purchase_unit,
                       conversion_rate: item.conversion_rate,
                       dimensions_width: item.dimensions_width,
                       dimensions_unit: item.dimensions_unit,
                     });
                     const hasConversion = factor != null && factor !== 1;
                     const inStockUnit = factor == null ? 0 : item.quantity * factor;
                     return (
                       <TableRow key={index}>
                         <TableCell className="font-medium">
                           <div>{item.product_name}</div>
                           {hasConversion && (
                             <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                               <ArrowRightLeft className="h-2.5 w-2.5" />
                               {describeConversion({
                                 unit: item.stock_unit,
                                 purchase_unit: item.purchase_unit,
                                 conversion_rate: item.conversion_rate,
                                 dimensions_width: item.dimensions_width,
                                 dimensions_unit: item.dimensions_unit,
                               })}
                             </div>
                           )}
                         </TableCell>
                         <TableCell>
                           <div className="flex items-center gap-1.5">
                             <Input
                               type="number"
                               value={item.quantity}
                               onChange={e => handleUpdateItem(index, 'quantity', Number(e.target.value))}
                               min={0.01}
                               step={0.01}
                               className="h-8 w-20"
                             />
                             <span className="text-xs text-muted-foreground font-mono shrink-0">
                               {item.purchase_unit}
                             </span>
                           </div>
                           {hasConversion && (
                             <div className="text-xs text-primary mt-0.5 font-mono">
                               = {inStockUnit.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {item.stock_unit}
                             </div>
                           )}
                         </TableCell>
                         <TableCell>
                           <div className="flex items-center gap-1.5">
                             <Input
                               type="number"
                               value={item.unit_price}
                               onChange={e => handleUpdateItem(index, 'unit_price', Number(e.target.value))}
                               min={0}
                               step={0.01}
                               className="h-8 w-24"
                             />
                             <span className="text-xs text-muted-foreground shrink-0">
                               R$/{item.purchase_unit}
                             </span>
                           </div>
                         </TableCell>
                         <TableCell className="text-right font-mono">
                           {(item.quantity * item.unit_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                         </TableCell>
                         <TableCell>
                           <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleRemoveItem(index)}>
                             <Trash2 className="h-4 w-4" />
                           </Button>
                         </TableCell>
                       </TableRow>
                     );
                   })
                 )}
               </TableBody>
             </Table>
           </div>

           {items.some(i => i.unit !== i.stock_unit) && (
             <div className="text-xs text-muted-foreground flex items-start gap-1.5 px-2">
               <ArrowRightLeft className="h-3 w-3 mt-0.5 shrink-0" />
               <span>
                 Itens com conversão configurada são salvos na OC em <strong>unidade de compra</strong>
                 (o que aparece na NF). Quando a OC for recebida, o sistema converte automaticamente
                 pra unidade de estoque/consumo (dm², g etc.).
               </span>
             </div>
           )}
 
           <div className="flex justify-end pr-4 py-2">
             <div className="text-right">
               <p className="text-sm text-muted-foreground uppercase tracking-wider font-bold">Total do Pedido</p>
               <p className="text-2xl font-black text-primary">
                 {totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
               </p>
             </div>
           </div>
         </div>
 
         <DialogFooter>
           <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
           <Button onClick={handleSubmit} disabled={isSubmitting}>
             {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
             Criar Ordem de Compra
           </Button>
         </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
