import { Fragment, useState } from 'react';
import { FileArrowUp as FileUp, FileText, Trash as Trash2, CaretDown as ChevronDown, CaretUp as ChevronUp, Package as PackagePlus, CheckCircle as CheckCircle2 } from '@phosphor-icons/react';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useInvoices, useDeleteInvoice, useInvoiceItems, type Invoice, type InvoiceItem } from '@/hooks/useSuppliers';
import XmlImportDialog from '@/components/suppliers/XmlImportDialog';
import AddToStockDialog from '@/components/suppliers/AddToStockDialog';
import { useSuppliers, useAddSupplier } from '@/hooks/useSuppliers';
import { useCreateAccountPayable } from '@/hooks/useFinance';
import type { ParsedNFeDuplicata } from '@/lib/nfeParser';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function InvoiceItemsRow({ invoiceId, onLaunchStock }: { invoiceId: string; onLaunchStock: (items: InvoiceItem[]) => void }) {
  const { data: items = [] } = useInvoiceItems(invoiceId);
  const pendingItems = items.filter(i => !i.added_to_stock);
  const allAdded = items.length > 0 && pendingItems.length === 0;

  if (items.length === 0) return <p className="text-xs text-muted-foreground py-2">Nenhum item</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {allAdded 
            ? <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Todos os itens lançados no estoque</span>
            : `${pendingItems.length} de ${items.length} item(ns) pendente(s) de lançamento`
          }
        </p>
        {pendingItems.length > 0 && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onLaunchStock(items)}>
            <PackagePlus className="h-3.5 w-3.5" /> Lançar no Estoque ({pendingItems.length})
          </Button>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/20 hover:bg-muted/20">
            <TableHead className="text-xs">Código</TableHead>
            <TableHead className="text-xs">Produto</TableHead>
            <TableHead className="text-xs">Un</TableHead>
            <TableHead className="text-xs text-right">Qtd</TableHead>
            <TableHead className="text-xs text-right">Vl. Unit.</TableHead>
            <TableHead className="text-xs text-right">Total</TableHead>
            <TableHead className="text-xs text-center">Estoque</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map(item => (
            <TableRow key={item.id}>
              <TableCell className="text-xs font-mono">{item.product_code}</TableCell>
              <TableCell className="text-xs">{item.product_name}</TableCell>
              <TableCell className="text-xs">{item.unit}</TableCell>
              <TableCell className="text-xs text-right">{item.quantity}</TableCell>
              <TableCell className="text-xs text-right font-mono">{fmt(item.unit_price)}</TableCell>
              <TableCell className="text-xs text-right font-mono">{fmt(item.total_price)}</TableCell>
              <TableCell className="text-xs text-center">
                {item.added_to_stock ? (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                    <CheckCircle2 className="h-3 w-3 mr-0.5" /> Lançado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs">
                    Pendente
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function InvoicesEntradaTab() {
  const { data: invoices = [] } = useInvoices();
  const { data: suppliers = [] } = useSuppliers();
  const deleteInvoice = useDeleteInvoice();
  const addSupplier = useAddSupplier();
  const createPayable = useCreateAccountPayable();
  const [xmlDialog, setXmlDialog] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stockDialogItems, setStockDialogItems] = useState<InvoiceItem[]>([]);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);

  const handleSupplierAutoCreate = async (data: any) => {
    return await addSupplier.mutateAsync(data);
  };

  const handlePayablesCreate = (
    supplierId: string | null,
    invoiceId: string,
    duplicatas: ParsedNFeDuplicata[],
    supplierName: string,
    invoiceNumber: string,
    paymentMethod: string
  ) => {
    duplicatas.forEach((dup, i) => {
      createPayable.mutate({
        description: `NF ${invoiceNumber} - Parcela ${dup.number || i + 1}`,
        supplier_id: supplierId,
        invoice_id: invoiceId,
        category: 'material',
        due_date: dup.dueDate,
        amount: dup.value,
        amount_paid: 0,
        status: 'pending',
        boleto_number: dup.number,
        payment_method: paymentMethod,
        installment_number: i + 1,
        total_installments: duplicatas.length,
        payment_date: null,
        bank_name: '',
        barcode: '',
        notes: '',
      });
    });
  };

  const handleLaunchStock = (items: InvoiceItem[]) => {
    setStockDialogItems(items);
    setStockDialogOpen(true);
  };

  const handleImportComplete = (invoiceId: string) => {
    // Auto-expand the imported invoice to show items and stock status
    setExpandedId(invoiceId);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Notas Fiscais de Entrada
        </CardTitle>
        <Button size="sm" onClick={() => setXmlDialog(true)}>
          <FileUp className="h-4 w-4 mr-1" /> Importar XML
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Nº NF</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Emissão</TableHead>
              <TableHead className="text-right">Valor Total</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Nenhuma nota fiscal importada. Clique em "Importar XML" para começar.
                </TableCell>
              </TableRow>
            ) : invoices.map(inv => {
              const isExpanded = expandedId === inv.id;
              const supplierName = suppliers.find(s => s.id === inv.supplier_id)?.name || '—';
              return (
                <Fragment key={inv.id}>
                  <TableRow className="cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : inv.id)}>
                    <TableCell>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-mono font-medium">{inv.invoice_number}{inv.invoice_series ? `-${inv.invoice_series}` : ''}</TableCell>
                    <TableCell>{supplierName}</TableCell>
                    <TableCell>{inv.issue_date ? format(parseISO(inv.issue_date), 'dd/MM/yyyy') : '—'}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(inv.total_value)}</TableCell>
                    <TableCell>
                      <Badge variant={inv.status === 'imported' ? 'default' : 'secondary'}>
                        {inv.status === 'imported' ? 'Importada' : inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir nota fiscal?</AlertDialogTitle>
                            <AlertDialogDescription>A nota e seus itens serão removidos permanentemente.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => deleteInvoice.mutate(inv.id)}>Excluir</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/20 p-4">
                        <InvoiceItemsRow invoiceId={inv.id} onLaunchStock={handleLaunchStock} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <XmlImportDialog
        open={xmlDialog}
        onOpenChange={setXmlDialog}
        suppliers={suppliers}
        onSupplierAutoCreate={handleSupplierAutoCreate}
        onPayablesCreate={handlePayablesCreate}
        onImportComplete={handleImportComplete}
      />

      <AddToStockDialog
        open={stockDialogOpen}
        onOpenChange={setStockDialogOpen}
        items={stockDialogItems}
      />
    </Card>
  );
}
