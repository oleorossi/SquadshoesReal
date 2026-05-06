 import { useState, useMemo } from 'react';
 import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
 import { Button } from '@/components/ui/button';
 import { Input } from '@/components/ui/input';
 import { Label } from '@/components/ui/label';
 import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
 import { useSuppliers } from '@/hooks/useSuppliers';
 import { useProducts } from '@/hooks/useProducts';
 import { useCreatePurchaseOrder } from '@/hooks/usePurchaseOrders';
 import { Plus, Trash2, Search, Loader2 } from 'lucide-react';
 import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
 import { toast } from 'sonner';
 
 type OrderItem = {
   product_id: string;
   product_name: string;
   quantity: number;
   unit_price: number;
   unit: string;
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
 
     setItems(prev => [...prev, {
       product_id: product.id,
       product_name: product.name,
       quantity: 1,
       unit_price: product.unit_price || 0,
       unit: product.unit || 'un',
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
       <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
         <DialogHeader>
           <DialogTitle>Nova Ordem de Compra</DialogTitle>
         </DialogHeader>
 
         <div className="space-y-4 py-4">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             <div className="space-y-2">
               <Label>Fornecedor</Label>
               <Select value={selectedSupplierId} onValueChange={setSelectedSupplierId}>
                 <SelectTrigger>
                   <SelectValue placeholder="Selecione o fornecedor" />
                 </SelectTrigger>
                 <SelectContent>
                   {suppliers.map(s => (
                     <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
             <div className="space-y-2">
               <Label>Observações</Label>
               <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opcional..." />
             </div>
           </div>
 
           <div className="space-y-2">
             <Label>Adicionar Produto</Label>
             <Select onValueChange={handleAddItem}>
               <SelectTrigger>
                 <SelectValue placeholder="Selecione um produto para adicionar" />
               </SelectTrigger>
               <SelectContent>
                 <div className="relative">
                   <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                   <Input className="pl-8 border-0 ring-0 focus-visible:ring-0" placeholder="Filtrar..." />
                 </div>
                 {products.map(p => (
                   <SelectItem key={p.id} value={p.id}>{p.name} ({p.sku})</SelectItem>
                 ))}
               </SelectContent>
             </Select>
           </div>
 
           <div className="rounded-md border">
             <Table>
               <TableHeader>
                 <TableRow>
                   <TableHead>Produto</TableHead>
                   <TableHead className="w-24">Qtd</TableHead>
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
                   items.map((item, index) => (
                     <TableRow key={index}>
                       <TableCell className="font-medium">{item.product_name}</TableCell>
                       <TableCell>
                         <Input 
                           type="number" 
                           value={item.quantity} 
                           onChange={e => handleUpdateItem(index, 'quantity', Number(e.target.value))} 
                           min={0.01}
                           step={0.01}
                           className="h-8"
                         />
                       </TableCell>
                       <TableCell>
                         <Input 
                           type="number" 
                           value={item.unit_price} 
                           onChange={e => handleUpdateItem(index, 'unit_price', Number(e.target.value))} 
                           min={0}
                           step={0.01}
                           className="h-8"
                         />
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
                   ))
                 )}
               </TableBody>
             </Table>
           </div>
 
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