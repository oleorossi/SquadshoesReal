import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { CircleNotch as Loader2, Barcode, FileArrowUp as FileUp, Stack as Layers, DotsThree as MoreHorizontal } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import GroupOrganizationPanel from '@/components/groups/GroupOrganizationPanel';
import { QuickFamilyDialog } from '@/components/inventory/QuickFamilyDialog';
import XmlImportDialog from '@/components/suppliers/XmlImportDialog';
import AddToStockDialog from '@/components/suppliers/AddToStockDialog';
import { useSuppliers, useAddSupplier } from '@/hooks/useSuppliers';
import type { InvoiceItem } from '@/hooks/useSuppliers';
import { useCreateAccountPayable } from '@/hooks/useFinance';
import type { ParsedNFeDuplicata } from '@/lib/nfeParser';
import { useProducts } from '@/hooks/useProducts';
import { useCan } from '@/hooks/useAccessControl';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * Aba Materiais do Estoque (/estoque) — agora é a ÁRVORE Setor → Família → Grupo
 * (GroupOrganizationPanel): abrir um grupo-folha mostra os itens dele; editar um
 * item abre o editor canônico /estoque/:id. Esta casca mantém os fluxos que só
 * existiam aqui — Importar XML (NF-e), escanear código de barras e cadastro
 * rápido com cores — passados como ações extras da barra do painel.
 * Ver specs/grupos-estoque.md.
 */
export function MaterialsTab(_props?: { defaultGroupName?: string; title?: string }) {
  const navigate = useNavigate();
  const perm = useCan('/estoque');
  const { data: allProducts = [] } = useProducts();
  const { data: suppliers = [] } = useSuppliers();
  const addSupplier = useAddSupplier();
  const createPayable = useCreateAccountPayable();

  const [xmlDialogOpen, setXmlDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [stockDialogItems, setStockDialogItems] = useState<InvoiceItem[]>([]);
  const [quickFamilyOpen, setQuickFamilyOpen] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const handleSupplierAutoCreate = async (data: any) => addSupplier.mutateAsync(data);

  const handlePayablesCreate = (
    supplierId: string | null, invoiceId: string, duplicatas: ParsedNFeDuplicata[],
    _supplierName: string, invoiceNumber: string, paymentMethod: string,
  ) => {
    duplicatas.forEach((dup, i) => {
      createPayable.mutate({
        description: `NF ${invoiceNumber} - Parcela ${dup.number || i + 1}`,
        supplier_id: supplierId, invoice_id: invoiceId, category: 'material',
        due_date: dup.dueDate, amount: dup.value, amount_paid: 0, status: 'pending',
        boleto_number: dup.number, payment_method: paymentMethod,
        installment_number: i + 1, total_installments: duplicatas.length,
        payment_date: null, bank_name: '', barcode: '', notes: '',
      });
    });
  };

  const handleImportComplete = async (invoiceId: string) => {
    const { data: items, error } = await supabase
      .from('invoice_items').select('*').eq('invoice_id', invoiceId).order('product_name', { ascending: true });
    if (error) { toast.error('A NF foi importada, mas houve falha ao carregar os itens para conferência.'); return; }
    const invoiceItems = (items || []) as InvoiceItem[];
    const pending = invoiceItems.filter(item => !item.added_to_stock);
    if (pending.length > 0) {
      setStockDialogItems(invoiceItems);
      setStockDialogOpen(true);
      toast.warning(`${pending.length} item(ns) ainda precisam ser vinculados ao estoque.`);
    }
  };

  const extraActions = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2">
          <MoreHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Mais ações</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Operações</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => barcodeInputRef.current?.focus()}>
          <Barcode className="h-4 w-4 mr-2" /> Escanear código de barras
        </DropdownMenuItem>
        {perm.canCreate && (
          <DropdownMenuItem onClick={() => setXmlDialogOpen(true)}>
            <FileUp className="h-4 w-4 mr-2" /> Importar XML (NF-e)
          </DropdownMenuItem>
        )}
        {perm.canCreate && <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Organização</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setQuickFamilyOpen(true)}>
            <Layers className="h-4 w-4 mr-2" /> Cadastro rápido com cores (família)
          </DropdownMenuItem>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="mt-4">
      <GroupOrganizationPanel permPath="/estoque" extraActions={extraActions} />

      {/* Fluxos preservados do Estoque */}
      <XmlImportDialog
        open={xmlDialogOpen}
        onOpenChange={setXmlDialogOpen}
        suppliers={suppliers}
        onSupplierAutoCreate={handleSupplierAutoCreate}
        onPayablesCreate={handlePayablesCreate}
        onImportComplete={handleImportComplete}
      />
      <AddToStockDialog
        open={stockDialogOpen}
        onOpenChange={(open) => { setStockDialogOpen(open); if (!open) setStockDialogItems([]); }}
        items={stockDialogItems}
      />
      <QuickFamilyDialog open={quickFamilyOpen} onOpenChange={setQuickFamilyOpen} defaultGroupId="all" />

      {/* Input oculto para leitor de código de barras */}
      <div className="opacity-0 absolute pointer-events-none">
        <Input
          ref={barcodeInputRef}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const sku = e.currentTarget.value.trim();
              if (sku) {
                const found = (allProducts as any[]).find(p => p.sku === sku);
                if (found) { navigate(`/estoque/${found.id}`); toast.info(`Material encontrado: ${found.name}`); }
                else toast.error(`SKU "${sku}" não encontrado no estoque`);
              }
              e.currentTarget.value = '';
            }
          }}
        />
      </div>
    </div>
  );
}
