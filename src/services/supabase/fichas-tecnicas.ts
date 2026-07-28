import { supabase } from '@/integrations/supabase/client';

/**
 * Serviço de fichas técnicas — mapeia para `technical_sheets` + `sheet_materials`.
 */
export interface FichaTecnicaComMateriais {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  cost_price: number | null;
  sale_price: number | null;
  status: string | null;
  status_ficha: string | null;
  created_at: string;
  materiais_necessarios: {
    id: string;
    sheet_id: string;
    product_id: string;
    quantity_per_unit: number;
    color: string | null;
    notes: string | null;
    products: {
      id: string;
      name: string;
      sku: string | null;
      quantity: number;
      min_stock: number;
      unit: string | null;
      unit_price: number;
      color: string | null;
    } | null;
  }[];
  [key: string]: any;
}

export const fichaTecnicaService = {
  async obterCompleta(fichaId: string): Promise<FichaTecnicaComMateriais | null> {
    const { data, error } = await supabase
      .from('technical_sheets')
      .select(`
        *,
        materiais_necessarios:sheet_materials(
          *,
          products(id, name, sku, quantity, min_stock, unit, unit_price, color)
        )
      `)
      .eq('id', fichaId)
      .maybeSingle();

    if (error) {
      console.error('Erro ao obter ficha técnica:', error);
      return null;
    }
    return data as unknown as FichaTecnicaComMateriais;
  },

  async obterPorCodigo(codigo: string): Promise<FichaTecnicaComMateriais | null> {
    const { data, error } = await supabase
      .from('technical_sheets')
      .select(`
        *,
        materiais_necessarios:sheet_materials(
          *,
          products(id, name, sku, quantity, min_stock, unit, unit_price, color)
        )
      `)
      .eq('code', codigo)
      .maybeSingle();

    if (error) {
      console.error('Erro ao obter ficha técnica por código:', error);
      throw error;
    }
    return data as unknown as FichaTecnicaComMateriais;
  },

  async listarAtivas() {
    const { data, error } = await supabase
      .from('technical_sheets')
      .select('*')
      .eq('status', 'Ativo')
      .order('name', { ascending: true });
    if (error) {
      console.error('Erro ao listar fichas técnicas ativas:', error);
      throw error;
    }
    return data || [];
  },

  async buscar(termo: string) {
    // A expressão .or() é uma gramática PostgREST, não um parâmetro SQL. Limita
    // o termo a texto, números, espaço e hífen antes de interpolá-lo para que
    // vírgulas, parênteses, curingas e operadores não alterem o filtro.
    const termoSeguro = termo.trim().replace(/[^\p{L}\p{N}\s-]/gu, '');
    if (!termoSeguro) return [];

    const { data, error } = await supabase
      .from('technical_sheets')
      .select('*')
      .or(`code.ilike.%${termoSeguro}%,name.ilike.%${termoSeguro}%`)
      .eq('status', 'Ativo');
    if (error) {
      console.error('Erro ao buscar fichas técnicas:', error);
      throw error;
    }
    return data || [];
  },
};
