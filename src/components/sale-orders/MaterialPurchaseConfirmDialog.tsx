import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Calendar, Truck, Warning as AlertTriangle, ShoppingCart, CircleNotch as Loader2, FloppyDisk as Save } from '@phosphor-icons/react';
import { MaterialAvailabilityResult } from '@/lib/materialAvailability';
import { SubmitFlowStepper } from './SubmitFlowStepper';
 import { useUpsertOpenPurchaseOrder } from '@/hooks/usePurchaseOrders';
 import { useUpsertOpenServiceOrder, useContractors } from '@/hooks/useContractors';
 import { useArtisanalRecipes, calcArtisanalRequirement } from '@/hooks/useArtisanalRecipes';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: MaterialAvailabilityResult | null;
  /** ID do PV que está sendo criado/editado — vinculado nas OCs/OSs geradas. */
  saleOrderId?: string | null;
  /** Called when user confirms with the action chosen. */
  onConfirm: (action: 'with_po' | 'without_po' | 'draft') => void;
}

export function MaterialPurchaseConfirmDialog({ open, onOpenChange, result, saleOrderId, onConfirm }: Props) {
   const upsertPO = useUpsertOpenPurchaseOrder();
   const upsertSO = useUpsertOpenServiceOrder();
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
      const count = 0;
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
         // O3: usa suggested_purchase_qty + purchase_unit (já convertidos pra
         // unidade do fornecedor: m → rolo, kg → saco). Sem conversão, vira
         // OC em unidade interna e o comprador refaz manualmente.
         // Auditoria 2026-09-25: o preço tem que vir na MESMA unidade da
         // quantidade — usar `unit_price` (R$/unidade de estoque) junto de
         // `suggested_purchase_qty` (unidade de compra) subfaturava a OC pelo
         // conversion_rate. `purchase_unit_price` já é R$/unidade de compra.
         await upsertPO.mutateAsync({
           supplier_id: supplier.supplier_id,
           supplier_name: supplier.supplier_name,
           sale_order_id: saleOrderId || null,
           notes: `Itens adicionados automaticamente pelo PV.`,
           items: group.map(g => ({
             product_id: g.product_id,
             quantity: g.suggested_purchase_qty ?? g.suggested_qty,
             unit_price: g.purchase_unit_price ?? g.unit_price,
             unit: g.purchase_unit ?? g.unit,
             current_stock: g.available,
             min_stock: g.min_stock,
             // Antes: 0 hardcoded — toda OC gerada por PV nascia sem teto de
             // estoque. Agora vem do cadastro do produto.
             max_stock: g.max_stock ?? 0,
             // Solados saem com cor + grade preenchidos pra fornecedor entregar
             // a matriz de tamanhos correta. Materiais sem variação por cor
             // (forros/tiras/etc.) vêm com color=null/grade=null do
             // enrichMaterialShortages que colapsa cores nesses casos.
             color: g.color ?? null,
             grade: g.grade ?? null,
           })),
         });
         ocCount++;
       }
 
       // Generate OS for artisanal — calcula material BASE necessário + sobra pra estoque
       for (const art of artisanalShortages) {
         const groupName = (art.product_name || '').split(':')[0].trim();
         const colorName = (art.product_name || '').split(':')[1]?.trim() || '';
         // O7: match priorizado — preferir EXACT match (artisanal_product_name = groupName)
         // sobre includes (que confundia "Tira Overlock 5mm" com "Tira Overlock 5mm Reforçada").
         // Em empate, prefere receita ativa com default_contractor_id setado.
         const exactRecipes = recipes.filter(r =>
           r.artisanal_product_name?.trim().toLowerCase() === groupName.toLowerCase()
         );
         const looseRecipes = exactRecipes.length > 0
           ? exactRecipes
           : recipes.filter(r => r.artisanal_product_name?.toLowerCase().includes(groupName.toLowerCase()));
         const recipe = looseRecipes
           .sort((a, b) => Number(!!b.default_contractor_id) - Number(!!a.default_contractor_id))[0];
         if (!recipe) {
           toast.warning(`Produto artesanal "${art.product_name}" sem receita cadastrada.`);
           continue;
         }
         // O8: filtra contractors ativos antes de fallback. Sem isso, pegava
         // alphabetic[0] mesmo se inativo. Também alerta antes de criar.
         const activeContractors = contractors.filter((c: any) => c.active !== false);
         const contractorId = recipe.default_contractor_id || activeContractors[0]?.id;
         if (!contractorId) {
           toast.warning(`Produto "${art.product_name}" sem terceirizado ativo definido para OS.`);
           continue;
         }
         if (!recipe.default_contractor_id) {
           const fallbackName = activeContractors[0]?.name || '?';
           toast.info(`OS de "${art.product_name}" usando contractor fallback: ${fallbackName}. Defina default na receita.`, { duration: 6000 });
         }

         // forOrder = shortage (o que falta pro pedido); forStock = repor min_stock
         const forOrder = Math.max(0, art.required - art.available);
         const calc = calcArtisanalRequirement(recipe, forOrder, art.available, art.min_stock);

         // Upsert: agrega numa OS ABERTA pro mesmo contractor+recipe+color
         await upsertSO.mutateAsync({
           contractor_id: contractorId,
           artisanal_recipe_id: recipe.id,
           output_name: groupName,
           output_color: colorName,
           base_color: colorName,
           for_order_meters: calc.forOrderMeters,
           for_stock_meters: calc.forStockMeters,
           total_meters: calc.totalToProduce,
           base_product_name: recipe.base_product_name,
           base_meters_send: calc.baseMetersSend,
           sale_order_id: saleOrderId || null,
           unit_price: recipe.labor_cost_per_meter,
         });
         osCount++;
       }
 
       if (ocCount > 0) toast.success(`${ocCount} ${ocCount === 1 ? 'ordem de compra gerada' : 'ordens de compra geradas'}!`);
       if (osCount > 0) toast.success(`${osCount} ${osCount === 1 ? 'ordem de serviço gerada' : 'ordens de serviço geradas'}!`);
      onConfirm('with_po');
    } catch (err: any) {
      toast.error(`Erro ao gerar OCs: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <SubmitFlowStepper current="material" />
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
                        {s.product_sku && <Badge variant="outline" className="font-mono text-xs">{s.product_sku}</Badge>}
                        {s.reference_labels.slice(0, 2).map((label, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">{label}</Badge>
                        ))}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex items-center gap-1">
                      <Truck className="h-3 w-3 text-muted-foreground" />
                      {s.supplier_name}
                    </div>
                    {s.moq > 0 && <span className="text-xs text-muted-foreground">MOQ: {s.moq}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">{s.required.toFixed(2)} <span className="text-xs text-muted-foreground">{s.unit}</span></TableCell>
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
