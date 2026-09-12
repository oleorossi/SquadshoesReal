import { useEffect, useMemo, useState } from 'react';
import { Product } from '@/types/inventory';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckCircle, XCircle, Trash, Download, Copy } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useUpdateProduct, useDeleteProduct, useDuplicateProduct } from '@/hooks/useProducts';
import { useForceDeleteProductFlow } from './ForceDeleteProductDialog';

/**
 * Barra contextual de ações em massa para produtos selecionados via marquee
 * ou checkbox. Aparece com slide-up no rodapé quando há seleção.
 *
 * variant `full` (aba Materiais): Ativar / Inativar / Exportar / Duplicar / Excluir
 * variant `simple` (árvore de Organização): Duplicar / Excluir
 */
export function ProductBulkActionsBar({
  selectedIds,
  onClear,
  allProducts,
  variant = 'full',
  pendingDuplicateIds,
  onPendingDuplicateConsumed,
}: {
  selectedIds: Set<string>;
  onClear: () => void;
  allProducts: Product[];
  variant?: 'full' | 'simple';
  pendingDuplicateIds?: string[] | null;
  onPendingDuplicateConsumed?: () => void;
}) {
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const duplicateProduct = useDuplicateProduct();
  const forceDeleteFlow = useForceDeleteProductFlow({ onSuccess: onClear });
  const [busy, setBusy] = useState(false);
  const [confirmBulkOpen, setConfirmBulkOpen] = useState(false);
  const [confirmDupOpen, setConfirmDupOpen] = useState(false);
  const [dupIds, setDupIds] = useState<string[]>([]);

  const selectedProducts = useMemo(
    () => allProducts.filter((p) => selectedIds.has(p.id)),
    [allProducts, selectedIds],
  );

  useEffect(() => {
    if (!pendingDuplicateIds?.length) return;
    setDupIds(pendingDuplicateIds);
    setConfirmDupOpen(true);
  }, [pendingDuplicateIds]);

  async function handleSetActive(active: boolean) {
    if (selectedIds.size === 0) return;
    setBusy(true);
    try {
      for (const id of selectedIds) {
        await updateProduct.mutateAsync({ id, data: { active } as any });
      }
      toast.success(`${selectedIds.size} ${selectedIds.size === 1 ? 'produto' : 'produtos'} ${active ? 'ativados' : 'inativados'}.`);
      onClear();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      forceDeleteFlow.tryDelete(id);
      return;
    }
    setConfirmBulkOpen(true);
  }

  async function doBulkDelete() {
    setBusy(true);
    let ok = 0;
    let blocked = 0;
    try {
      for (const id of selectedIds) {
        try {
          await deleteProduct.mutateAsync(id);
          ok++;
        } catch (err: any) {
          if (err?._canForce) blocked++;
          else throw err;
        }
      }
      if (blocked > 0) {
        toast.warning(`${ok} excluído(s); ${blocked} bloqueado(s) por vínculos. Selecione 1 a 1 pra forçar exclusão.`);
      } else {
        toast.success(`${ok} ${ok === 1 ? 'produto excluído' : 'produtos excluídos'}.`);
      }
      onClear();
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  function openDuplicate(ids: string[]) {
    if (ids.length === 0) return;
    setDupIds(ids);
    setConfirmDupOpen(true);
  }

  async function doDuplicate() {
    if (dupIds.length === 0) return;
    setBusy(true);
    try {
      await duplicateProduct.mutateAsync(dupIds);
      onClear();
      setConfirmDupOpen(false);
      onPendingDuplicateConsumed?.();
    } catch {
      // toast já sai do hook
    } finally {
      setBusy(false);
    }
  }

  function handleExportCsv() {
    if (selectedProducts.length === 0) return;
    const headers = ['SKU', 'Nome', 'Categoria', 'Cor', 'Estoque', 'Unidade', 'Preço Unitário', 'Localização'];
    const rows = selectedProducts.map((p) => [
      p.sku,
      p.name,
      p.category || '',
      p.color || '',
      String(p.quantity),
      p.unit,
      String(p.unit_price || 0),
      p.location || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `produtos-selecionados-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${selectedProducts.length} produto(s) exportados.`);
  }

  const duplicateAction = {
    label: 'Duplicar',
    icon: <Copy className="h-3.5 w-3.5" />,
    variant: 'outline' as const,
    disabled: busy,
    onClick: () => openDuplicate(Array.from(selectedIds)),
  };
  const deleteAction = {
    label: 'Excluir',
    icon: <Trash className="h-3.5 w-3.5" />,
    variant: 'destructive' as const,
    disabled: busy,
    onClick: handleDelete,
  };

  const actions = variant === 'simple'
    ? [duplicateAction, deleteAction]
    : [
        {
          label: 'Ativar',
          icon: <CheckCircle className="h-3.5 w-3.5" />,
          variant: 'outline' as const,
          disabled: busy,
          onClick: () => handleSetActive(true),
        },
        {
          label: 'Inativar',
          icon: <XCircle className="h-3.5 w-3.5" />,
          variant: 'outline' as const,
          disabled: busy,
          onClick: () => handleSetActive(false),
        },
        {
          label: 'Exportar CSV',
          icon: <Download className="h-3.5 w-3.5" />,
          variant: 'outline' as const,
          disabled: busy,
          onClick: handleExportCsv,
        },
        duplicateAction,
        deleteAction,
      ];

  const dupCount = dupIds.length;

  return (
    <>
      <BulkActionsBar
        selectedIds={selectedIds}
        onClear={onClear}
        itemLabel={selectedIds.size === 1 ? 'produto' : 'produtos'}
        actions={actions}
      />
      {forceDeleteFlow.dialog}

      <AlertDialog open={confirmBulkOpen} onOpenChange={setConfirmBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selectedIds.size} produtos?</AlertDialogTitle>
            <AlertDialogDescription>
              Itens com vínculos serão pulados — exclua um a um pra forçar. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setConfirmBulkOpen(false); void doBulkDelete(); }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDupOpen} onOpenChange={(open) => {
        setConfirmDupOpen(open);
        if (!open) onPendingDuplicateConsumed?.();
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dupCount === 1 ? 'Duplicar este material?' : `Duplicar ${dupCount} materiais?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              As cópias nascem com estoque zerado e SKU novo. Em linha com variantes a cor ganha o sufixo “CÓPIA” para não colidir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => { void doDuplicate(); }}>
              Duplicar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
