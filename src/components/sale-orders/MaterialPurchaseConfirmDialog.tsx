import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Calendar, Truck, AlertTriangle, ShoppingCart, Loader2, Save } from 'lucide-react';
import { MaterialAvailabilityResult } from '@/lib/materialAvailability';
 import { useCreatePurchaseOrder } from '@/hooks/usePurchaseOrders';
 import { useCreateServiceOrder, useContractors } from '@/hooks/useContractors';
 import { useArtisanalRecipes } from '@/hooks/useArtisanalRecipes';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: MaterialAvailabilityResult | null;
  /** Called when user confirms with the action chosen. */
  onConfirm: (action: 'with_po' | 'without_po' | 'draft') => void;
}

export function MaterialPurchaseConfirmDialog({ open, onOpenChange, result, onConfirm }: Props) {
   const createPO = useCreatePurchaseOrder();
   const createSO = useCreateServiceOrder();
   const { data: recipes = [] } = useArtisanalRecipes({ onlyActive: true });
   const { data: contractors = [] } = useContractors();
  const [generating, setGenerating] = useState(false);

  if (!result) return null;
  const { shortages, maxLeadTimeDays, minPurchaseDateISO } = result;

  const formattedDate = minPurchaseDateISO
    ? new Date(minPurchaseDateISO + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';

  // Group shortages by supplier for grouped POs
  const bySupplier = shortages.reduce<Record<string, typeof shortages>>((acc, s) => {
    const key = s.supplier_id || 'unknown';
    (acc[key] = acc[key] || []).push(s);
    return acc;
  }, {});

  const handleGeneratePOs = async () => {
    setGenerating(true);
    try {
      let count = 0;
       let ocCount = 0;
       let osCount = 0;
 
       const regularShortages = shortages.filter(s => !s.is_artisanal);
       const artisanalShortages = shortages.filter(s => s.is_artisanal);
 
       // Group regular by supplier
       const byRegSupplier = regularShortages.reduce<Record<string, typeof shortages>>((acc, s) => {
         const key = s.supplier_id || 'unknown';
         (acc[key] = acc[key] || []).push(s);
         return acc;
       }, {});
 
       for (const [, group] of Object.entries(byRegSupplier)) {
         const supplier = group[0];
         if (!supplier.supplier_id) {
           toast.warning(`Material "${supplier.product_name}" sem fornecedor padrão — defina antes de gerar a OC.`);
           continue;
         }
         await createPO.mutateAsync({
           supplier_id: supplier.supplier_id,
           supplier_name: supplier.supplier_name,
           notes: `OC gerada automaticamente para atender pedido.`,
           items: group.map(g => ({
             product_id: g.product_id,
             quantity: g.suggested_qty,
             unit_price: g.unit_price,
             unit: g.unit,
             current_stock: g.available,
             min_stock: 0,
             max_stock: 0,
           })),
         });
         ocCount++;
       }
 
       // Generate OS for artisanal
       for (const art of artisanalShortages) {
         const groupName = (art.product_name || '').split(':')[0].trim();
         const colorName = (art.product_name || '').split(':')[1]?.trim() || '';
         const recipe = recipes.find(r => r.artisanal_product_name.includes(groupName));
         const contractorId = recipe?.default_contractor_id || contractors[0]?.id;
 
         if (!contractorId) {
           toast.warning(`Produto "${art.product_name}" sem terceirizado definido para OS.`);
           continue;
         }
 
         await createSO.mutateAsync({
           contractor_id: contractorId,
           description: `OS Automática - ${art.product_name}`,
           quantity: art.suggested_qty,
           unit_price: art.unit_price,
           total_value: art.suggested_qty * art.unit_price,
           status: 'Pendente',
           artisanal_recipe_id: recipe?.id,
           artisanal_output_name: groupName,
           artisanal_output_color: colorName,
           artisanal_output_meters: art.suggested_qty,
         });
         osCount++;
       }
 
       if (ocCount > 0) toast.success(`${ocCount} ordem(ns) de compra gerada(s)!`);
       if (osCount > 0) toast.success(`${osCount} ordem(ns) de serviço gerada(s)!`);
      onConfirm('with_po');
    } catch (err: any) {
      toast.error(`Erro ao gerar OCs: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Materiais insuficientes — gerar Ordem de Compra?
          </DialogTitle>
          <DialogDescription>
            Faltam materiais para atender este pedido. Você pode gerar a OC agora; a produção começa assim que os materiais chegarem.
          </DialogDescription>
        </DialogHeader>

        {/* Lead time callout */}
        <Alert className="border-primary/40 bg-primary/5">
          <Calendar className="h-4 w-4" />
          <AlertTitle className="text-base font-semibold">
            Maior lead time: {maxLeadTimeDays} dias (chegada estimada {formattedDate})
          </AlertTitle>
          <AlertDescription className="text-xs mt-1">
            Considere essa data ao definir o prazo de entrega. A produção interna inicia em paralelo conforme cada material chega.
          </AlertDescription>
        </Alert>

        {/* Shortage table */}
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-right">Necessário</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead className="text-right">Faltam</TableHead>
                <TableHead className="text-right">Comprar</TableHead>
                <TableHead className="text-right">Lead</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shortages.map(s => (
                <TableRow key={s.product_id}>
                  <TableCell className="font-medium">
                    <div className="flex flex-col gap-1">
                      <span>{s.product_name}</span>
                      <div className="flex flex-wrap gap-1">
                        {s.product_sku && <Badge variant="outline" className="font-mono text-[10px]">{s.product_sku}</Badge>}
                        {s.reference_labels.slice(0, 2).map((label, i) => (
                          <Badge key={i} variant="secondary" className="text-[10px]">{label}</Badge>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1">
                      <Truck className="h-3 w-3 text-muted-foreground" />
                      {s.supplier_name}
                    </div>
                    {s.moq > 0 && <span className="text-[10px] text-muted-foreground">MOQ: {s.moq}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{s.required.toFixed(2)} <span className="text-[10px] text-muted-foreground">{s.unit}</span></TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{s.available.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-destructive font-semibold">{s.shortage.toFixed(2)}</TableCell>
                   <TableCell className="text-right font-mono font-bold">{s.suggested_qty.toFixed(2)}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{s.lead_time_days}d</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

         <p className="text-xs text-muted-foreground">
           {shortages.some(s => s.suggested_qty > s.shortage) && '⚠ Quantidades arredondadas para atender o MOQ.'}
         </p>

        <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancelar
          </Button>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => onConfirm('draft')} disabled={generating} className="gap-1.5">
              <Save className="h-4 w-4" />
              Salvar Rascunho
            </Button>
            <Button variant="outline" onClick={() => onConfirm('without_po')} disabled={generating}>
              Salvar pedido sem OC
            </Button>
            <Button onClick={handleGeneratePOs} disabled={generating} className="gap-2">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
              {generating ? 'Gerando...' : 'Gerar OCs e salvar pedido'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
