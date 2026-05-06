import { supabase } from '@/integrations/supabase/client';

/**
 * Serviço de materiais — mapeia para a tabela `products` existente.
 * O campo `quantity` = estoque atual; `unit_price` = preço unitário.
 */
export const materiaisService = {
  async obterPorId(id: string) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      console.error('Erro ao obter material:', error);
      return null;
    }
    return data;
  },

  async listarAtivos() {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });
    if (error) {
      console.error('Erro ao listar materiais:', error);
      return [];
    }
    return data || [];
  },

  async buscarPorSKU(sku: string) {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('sku', sku)
      .maybeSingle();
    if (error) return null;
    return data;
  },

  async obterEstoque(materialId: string): Promise<number> {
    const { data, error } = await supabase
      .from('products')
      .select('quantity')
      .eq('id', materialId)
      .maybeSingle();
    if (error) return 0;
    return data?.quantity || 0;
  },

  async atualizarEstoque(materialId: string, novaQuantidade: number): Promise<boolean> {
    const { error } = await supabase
      .from('products')
      .update({ quantity: novaQuantidade })
      .eq('id', materialId);
    if (error) {
      console.error('Erro ao atualizar estoque:', error);
      return false;
    }
    return true;
  },
};
