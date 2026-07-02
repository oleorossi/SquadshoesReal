 import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
 import { CircleNotch as Loader2, ShoppingCart, Package, Stack as Layers, Warning as AlertTriangle, CheckCircle as CheckCircle2, XCircle } from '@phosphor-icons/react';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useOrders } from '@/hooks/useOrders';
import { checkSoleAvailability } from '@/lib/soleAvailability';
import { rateGradeToTotal } from '@/lib/gradeDistribution';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCreatePurchaseOrder } from '@/hooks/usePurchaseOrders';
import { useState, useMemo } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSuppliers } from '@/hooks/useSuppliers';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export default function SolePurchaseTab() {
  const { data: orders = [], isLoading: isLoadingOrders } = useOrders();
  const { data: technicalSheets = [] } = useTechnicalSheets();
  const { data: suppliers = [] } = useSuppliers();
  const createPO = useCreatePurchaseOrder();
  const queryClient = useQueryClient();
  const [overriddenSuppliers, setOverriddenSuppliers] = useState<Record<string, string>>({});

  const handleSupplierChange = (soleProductId: string, supplierId: string) => {
    setOverriddenSuppliers(prev => ({ ...prev, [soleProductId]: supplierId }));
  };

  // Key estável com os IDs das OPs (length sozinho não invalida quando uma OP
  // é trocada por outra mantendo a mesma contagem).
  const ordersKey = useMemo(
    () => orders.map((o: any) => o.id).sort().join(','),
    [orders],
  );
  const { data: shortageResult, isLoading: isLoadingAvailability } = useQuery({
    queryKey: ['sole_shortages', ordersKey],
    enabled: orders.length > 0,
    queryFn: async () => {
      const items = orders.map((o: any) => ({
        reference_id: o.reference_id,
        color: o.color,
        totalPairs: o.quantity || 0,
        referenceLabel: o.order_number,
        grade: o.grade,
        orderNumber: o.sale_order_number || o.order_number,
      }));
      return await checkSoleAvailability(items);
    }
  });

  const processedShortages = useMemo(() => {
    if (!shortageResult?.shortages) return [];
    return shortageResult.shortages.map(s => {
      const overrideId = overriddenSuppliers[s.sole_product_id];
      const currentSupplierId = overrideId || s.supplier_id;
      const currentSupplier = suppliers.find(sup => sup.id === currentSupplierId);

      return {
        ...s,
        resolved_supplier_id: currentSupplierId,
        resolved_supplier_name: currentSupplier?.name || s.supplier_name || 'Sem Fornecedor',
        has_valid_supplier: !!currentSupplierId,
      };
    });
  }, [shortageResult, overriddenSuppliers, suppliers]);

  const canGenerateAny = processedShortages.some(s => s.has_valid_supplier);
  const allHaveSuppliers = processedShortages.every(s => s.has_valid_supplier);

   const handleGeneratePOs = async (force: boolean = false) => {
     if (processedShortages.length === 0) return;
 
     const missingSuppliers = processedShortages.filter(s => !s.has_valid_supplier);
 
     if (missingSuppliers.length > 0 && !force) {
       toast.error(
         <div className="flex flex-col gap-2">
           <div className="flex items-center gap-2 font-bold text-destructive">
             <XCircle className="h-4 w-4" />
             Itens sem fornecedor
           </div>
           <p className="text-xs">Não é possível gerar OCs enquanto houver itens bloqueados:</p>
           <ul className="text-xs list-disc pl-4 max-h-32 overflow-y-auto">
             {missingSuppliers.map(s => (
               <li key={s.sole_product_id}>{s.sole_name} ({s.sole_color})</li>
             ))}
           </ul>
           <p className="text-xs italic">Associe um fornecedor em cada linha para continuar.</p>
         </div>,
         { duration: 5000 }
       );
       return;
     }
 
     const validItems = processedShortages.filter(s => s.has_valid_supplier && s.resolved_supplier_id);
     if (validItems.length === 0) {
       toast.error("Associe fornecedores aos itens antes de gerar as OCs.");
       return;
     }

     try {
      const bySupplier = validItems.reduce<Record<string, typeof validItems>>((acc, s) => {
        const key = s.resolved_supplier_id as string;
        (acc[key] = acc[key] || []).push(s);
        return acc;
      }, {});

      let count = 0;
      for (const [supplierId, group] of Object.entries(bySupplier)) {
        const supplierName = group[0].resolved_supplier_name;

        await createPO.mutateAsync({
          supplier_id: supplierId,
          supplier_name: supplierName,
          notes: 'OC gerada via módulo de Compras de Solados (Associação Manual/Automática).',
          items: group.map((s) => ({
            product_id: s.sole_product_id,
            quantity: s.suggested_purchase_qty,
            unit_price: s.unit_price,
            unit: 'par',
            current_stock: s.available,
            min_stock: 0,
            max_stock: 0,
            // Rateia a grade (size_breakdown = demanda TOTAL do PV) pro que de fato
            // será comprado (suggested_purchase_qty = falta líquida/MOQ) — senão
            // soma(grade) ≠ quantity e o recebimento trava (mergeReceivedGrade).
            grade: rateGradeToTotal(s.size_breakdown, s.suggested_purchase_qty),
            color: s.sole_color ?? null,
          })),
        });
        count++;
      }
      toast.success(`${count} OC(s) gerada(s) com sucesso!`);
      // Recalcula as faltas — as OCs recém-criadas entram como "em trânsito" e
      // a lista não deve continuar sugerindo a mesma compra.
      queryClient.invalidateQueries({ queryKey: ['sole_shortages'] });
    } catch (e: any) {
      toast.error(`Erro ao gerar OCs: ${e.message}`);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4" />
            Compra de Solados
          </CardTitle>
           {processedShortages.length > 0 && !allHaveSuppliers && (
             <p className="text-xs text-destructive flex items-center gap-1 font-medium">
               <XCircle className="h-3 w-3" />
               Existem itens bloqueados (sem fornecedor).
             </p>
           )}
        </div>
        {processedShortages.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground">Status dos itens</p>
              <p className="text-sm font-medium">
                {processedShortages.filter(s => s.has_valid_supplier).length} de {processedShortages.length} prontos
              </p>
            </div>
             <Button 
               onClick={() => handleGeneratePOs(false)} 
               disabled={!canGenerateAny || createPO.isPending}
               variant={allHaveSuppliers ? "default" : "secondary"}
               className="gap-2"
             >
              {createPO.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShoppingCart className="h-4 w-4" />
              )}
              Gerar OCs
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoadingOrders || isLoadingAvailability ? (
          <div className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
        ) : processedShortages.length === 0 ? (
          <p className="text-center text-muted-foreground py-10">Nenhuma necessidade de compra de solados.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]"></TableHead>
                <TableHead>Solado</TableHead>
                <TableHead>Silk Prioridade</TableHead>
                <TableHead className="min-w-[200px]">Fornecedor</TableHead>
                <TableHead className="text-right">Faltam</TableHead>
                <TableHead className="text-right">Sugerido Compra</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {processedShortages.map(s => (
                <TableRow key={s.sole_product_id} className={!s.has_valid_supplier ? "bg-amber-500/5" : ""}>
                  <TableCell>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            {s.has_valid_supplier ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-amber-500" />
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {s.has_valid_supplier ? "Pronto para gerar OC" : "Selecione um fornecedor para este item"}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{s.sole_name}</div>
                    <div className="text-xs text-muted-foreground">{s.sole_color}</div>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const sheet = technicalSheets.find(ts => ts.cor_solado_id === s.sole_product_id || ts.primary_sole_id === s.sole_product_id);
                      const silkUrl = (s as any).silk_url || (sheet as any)?.default_silk_url;
                      return silkUrl ? (
                        <Badge variant="outline" className="gap-1 text-xs border-blue-500/20 bg-blue-500/10 text-blue-600">
                          <Layers className="h-3 w-3" /> Possui Silk
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Sem silk</span>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Select 
                        value={s.resolved_supplier_id || "none"} 
                        onValueChange={(val) => handleSupplierChange(s.sole_product_id, val)}
                      >
                        <SelectTrigger className={`h-8 text-xs ${!s.has_valid_supplier ? "border-amber-500/40 bg-amber-500/10" : ""}`}>
                          <SelectValue placeholder="Selecionar fornecedor..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none" disabled>Selecionar fornecedor...</SelectItem>
                          {suppliers.map(sup => (
                            <SelectItem key={sup.id} value={sup.id} className="text-xs">
                              {sup.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {s.supplier_id && s.resolved_supplier_id !== s.supplier_id && (
                        <span className="text-xs text-muted-foreground">Fornecedor alterado manualmente</span>
                      )}
                      {!s.supplier_id && s.has_valid_supplier && (
                        <span className="text-xs text-blue-600 font-medium">Associação manual</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-destructive font-bold">{s.shortage}</TableCell>
                  <TableCell className="text-right font-bold">{s.suggested_purchase_qty}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
