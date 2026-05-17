import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type Color = {
  id: string;
  cor_id: string;
  nome: string;
  referencia_hex: string;
  referencia_pantone: string;
  imagem_swatch: string;
  acabamento_disponivel: string[];
  materiais_compativeis: string[];
  estoque_por_material: Record<string, number>;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ColorFormData = {
  nome: string;
  referencia_hex: string;
  referencia_pantone: string;
  imagem_swatch: string;
  acabamento_disponivel: string[];
  materiais_compativeis: string[];
  status: string;
};

export const emptyColorForm: ColorFormData = {
  nome: '',
  referencia_hex: '',
  referencia_pantone: '',
  imagem_swatch: '',
  acabamento_disponivel: [],
  materiais_compativeis: [],
  status: 'ativo',
};

export function useColors() {
  return useQuery({
    queryKey: ['colors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('colors')
        .select('*')
        .eq('status', 'ativo')
        .order('nome');
      if (error) throw error;
      return data as unknown as Color[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useAllColors() {
  return useQuery({
    queryKey: ['colors_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('colors')
        .select('*')
        .order('nome');
      if (error) throw error;
      return data as unknown as Color[];
    },
    staleTime: 5 * 60_000,
  });
}

function generateCorId(nome: string): string {
  const clean = nome.replace(/[^a-zA-Z]/g, '').toUpperCase();
  const prefix = clean.substring(0, 3) || 'COR';
  const rand = Math.floor(Math.random() * 900) + 100;
  return `C-${String(rand)}-${prefix}`;
}

export function useAddColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: ColorFormData) => {
      const { data, error } = await supabase
        .from('colors')
        .insert({
          cor_id: generateCorId(form.nome),
          nome: form.nome,
          referencia_hex: form.referencia_hex,
          referencia_pantone: form.referencia_pantone,
          imagem_swatch: form.imagem_swatch,
          acabamento_disponivel: form.acabamento_disponivel,
          materiais_compativeis: form.materiais_compativeis,
          status: form.status,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['colors'] });
      qc.invalidateQueries({ queryKey: ['colors_all'] });
      toast.success('Cor adicionada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ColorFormData> }) => {
      const { error } = await supabase
        .from('colors')
        .update(data as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['colors'] });
      qc.invalidateQueries({ queryKey: ['colors_all'] });
      toast.success('Cor atualizada!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // cor_palmilha_id e cor_tiras_id foram dropadas em 2026-05 (dead fields).
      const colorCols = ['cor_predominante_id', 'cor_solado_id'] as const;
      for (const col of colorCols) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { count, error: chkErr } = await (supabase.from('technical_sheets') as any)
          .select('id', { count: 'exact', head: true })
          .eq(col, id);
        if (chkErr) throw chkErr;
        if ((count ?? 0) > 0) {
          throw new Error(`Cor está vinculada a ${count} ${count === 1 ? 'ficha técnica' : 'fichas técnicas'} (campo ${col}). Desvincule antes de excluir.`);
        }
      }
      const { error } = await supabase
        .from('colors')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['colors'] });
      qc.invalidateQueries({ queryKey: ['colors_all'] });
      toast.success('Cor removida!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

/** Get stock availability for a specific color across all materials/products */
export function useColorStock(colorId: string | null) {
  return useQuery({
    queryKey: ['color_stock', colorId],
    enabled: !!colorId,
    queryFn: async () => {
      if (!colorId) return null;
      const { data: color, error: colorErr } = await supabase
        .from('colors')
        .select('nome, referencia_hex, referencia_pantone')
        .eq('id', colorId)
        .single();
      if (colorErr) throw colorErr;
      if (!color) return null;

      const colorName = (color as any).nome;

      // Find products matching this color name by exact color field match
      const { data: products, error: prodErr } = await supabase
        .from('products')
        .select('id, name, color, quantity, group_id, category, unit_price')
        .eq('active', true)
        .eq('color', colorName);
      if (prodErr) throw prodErr;

      // Also try ILIKE match for fuzzy matching.
      // Escape PostgREST/SQL pattern wildcards so a color name containing %, _ or \
      // doesn't match unrelated products and skew totals (e.g. "100%" returning all rows).
      const escapedColorName = String(colorName || '').replace(/[%_\\]/g, c => `\\${c}`);
      const { data: fuzzyProducts, error: fuzzyErr } = await supabase
        .from('products')
        .select('id, name, color, quantity, group_id, category, unit_price')
        .eq('active', true)
        .ilike('name', `%${escapedColorName}%`);
      if (fuzzyErr) throw fuzzyErr;

      // Merge and deduplicate
      const allProducts = [...(products || [])];
      const existingIds = new Set(allProducts.map((p: any) => p.id));
      (fuzzyProducts || []).forEach((p: any) => {
        if (!existingIds.has(p.id)) allProducts.push(p);
      });

      const totalStock = allProducts.reduce((sum: number, p: any) => sum + Number(p.quantity || 0), 0);
      const byCategory: Record<string, number> = {};
      const byGroup: Record<string, { stock: number; price: number }> = {};

      allProducts.forEach((p: any) => {
        const cat = p.category || 'Outros';
        byCategory[cat] = (byCategory[cat] || 0) + Number(p.quantity || 0);

        const groupKey = p.group_id || 'sem-grupo';
        if (!byGroup[groupKey]) byGroup[groupKey] = { stock: 0, price: 0 };
        byGroup[groupKey].stock += Number(p.quantity || 0);
        byGroup[groupKey].price = p.unit_price || byGroup[groupKey].price;
      });

      // Get supplier info for this color
      const { data: supplierMats, error: supplierErr } = await supabase
        .from('group_supplier_materials')
        .select('material_code, unit_price, supplier_id')
        .eq('color', colorName);
      if (supplierErr) throw supplierErr;

      return {
        colorName,
        hexCode: (color as any).referencia_hex || '',
        pantoneCode: (color as any).referencia_pantone || '',
        totalStock,
        byCategory,
        byGroup,
        products: allProducts,
        supplierMaterials: supplierMats || [],
      };
    },
    staleTime: 5 * 60_000,
  });
}
