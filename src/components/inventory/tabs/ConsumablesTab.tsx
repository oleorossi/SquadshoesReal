import { useMemo, useState } from 'react';
import { useProducts, useUpdateProduct, useDeleteProduct, useAddProduct } from '@/hooks/useProducts';
import ConsumablesPanel from '@/components/inventory/ConsumablesPanel';
import { Product, ProductFormData } from '@/types/inventory';
import { ProductSchema } from '@/hooks/useProducts';
import { toast } from 'sonner';
import { z } from 'zod';
import { ProductFormDialog } from '@/components/inventory/ProductFormDialog';

const CONSUMABLE_CATEGORIES = ['Escritório', 'Limpeza', 'Manutenção', 'TI'];

export function ConsumablesTab() {
  // Solados gerenciados só na aba dedicada SolesHub. Filtramos aqui pra
  // limpar UI do estoque tradicional. Débitos do PV não dependem dessa UI.
  const { data: allProducts = [] } = useProducts();
  const products = (allProducts as any[]).filter(p => p.category !== 'Solado');
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const addProduct = useAddProduct();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const consumableProducts = useMemo(() =>
    products.filter(p => CONSUMABLE_CATEGORIES.includes(p.category)),
    [products]
  );

  const handleAdd = async (data: ProductFormData) => {
    const toastId = toast.loading('Adicionando consumível...');
    try {
      const validatedData = ProductSchema.parse(data);
      await addProduct.mutateAsync(validatedData as any);
      toast.dismiss(toastId);
      setDialogOpen(false);
    } catch (error) {
      toast.dismiss(toastId);
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => toast.error(err.message));
      } else {
        toast.error('Erro ao adicionar produto');
      }
    }
  };

  const handleEdit = async (data: ProductFormData) => {
    if (!editingProduct) return;
    const toastId = toast.loading('Atualizando consumível...');
    try {
      const validatedData = ProductSchema.parse(data);
      await updateProduct.mutateAsync({ id: editingProduct.id, data: validatedData as any });
      toast.dismiss(toastId);
      setDialogOpen(false);
      setEditingProduct(null);
    } catch (error) {
      toast.dismiss(toastId);
      if (error instanceof z.ZodError) {
        error.errors.forEach(err => toast.error(err.message));
      } else {
        toast.error('Erro ao atualizar produto');
      }
    }
  };

  const openEdit = (product: Product) => { setEditingProduct(product); setDialogOpen(true); };
  const openAdd = () => { setEditingProduct(null); setDialogOpen(true); };

  return (
    <div className="mt-4">
      <ConsumablesPanel 
        products={consumableProducts} 
        onEdit={openEdit} 
        onDelete={(id) => deleteProduct.mutate(id)}
        onAdd={openAdd}
      />

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={editingProduct ? handleEdit : handleAdd}
        product={editingProduct}
        onEditProduct={(p) => {
          setEditingProduct(p);
          setDialogOpen(true);
        }}
      />
    </div>
  );
}
