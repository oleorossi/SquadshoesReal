import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { edgeFunctionError } from '@/lib/edgeFunctionError';

export type ColorVariant = {
  id: string;
  reference_id: string;
  color: string;
  sku: string;
  barcode: string;
  image_url: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  // Enriched fields from colors table + products
  hex_code: string;
  pantone_code: string;
  supplier_code: string;
  stock: number;
  price: number;
};

export function useColorVariants(referenceId?: string) {
  return useQuery({
    queryKey: ['color_variants', referenceId],
    enabled: !!referenceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reference_color_variants')
        .select('*')
        .eq('reference_id', referenceId!)
        .order('color');
      if (error) throw error;

      const variants = data as any[];

      // Fetch all active colors for hex/pantone lookup
      const { data: colors } = await supabase
        .from('colors')
        .select('nome, referencia_hex, referencia_pantone')
        .eq('status', 'ativo');

      const colorMap = new Map<string, { hex: string; pantone: string }>();
      (colors || []).forEach((c: any) => {
        colorMap.set(c.nome?.toLowerCase().trim(), {
          hex: c.referencia_hex || '',
          pantone: c.referencia_pantone || '',
        });
      });

      // Get supplier materials for supplier_code lookup
      const { data: supplierMats } = await supabase
        .from('group_supplier_materials')
        .select('color, material_code, unit_price');

      const supplierMap = new Map<string, { code: string; price: number }>();
      (supplierMats || []).forEach((m: any) => {
        if (m.color) {
          supplierMap.set(m.color.toLowerCase().trim(), {
            code: m.material_code || '',
            price: m.unit_price || 0,
          });
        }
      });

      // Get products for stock lookup (match by color name)
      const { data: products } = await supabase
        .from('products')
        .select('color, quantity, unit_price')
        .eq('active', true);

      const stockMap = new Map<string, { stock: number; price: number }>();
      (products || []).forEach((p: any) => {
        if (p.color) {
          const key = p.color.toLowerCase().trim();
          const existing = stockMap.get(key);
          stockMap.set(key, {
            stock: (existing?.stock || 0) + Number(p.quantity || 0),
            price: p.unit_price || existing?.price || 0,
          });
        }
      });

      return variants.map((v): ColorVariant => {
        const colorKey = (v.color || '').toLowerCase().trim();
        const colorInfo = colorMap.get(colorKey);
        const supplierInfo = supplierMap.get(colorKey);
        const stockInfo = stockMap.get(colorKey);

        return {
          ...v,
          hex_code: colorInfo?.hex || '',
          pantone_code: colorInfo?.pantone || '',
          supplier_code: supplierInfo?.code || '',
          stock: stockInfo?.stock || 0,
          price: supplierInfo?.price || stockInfo?.price || 0,
        };
      });
    },
  });
}

export function useAddColorVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { reference_id: string; color: string; sku?: string; barcode?: string }) => {
      const { data: result, error } = await supabase
        .from('reference_color_variants')
        .insert({
          reference_id: data.reference_id,
          color: data.color,
          sku: data.sku,
          barcode: data.barcode
        })
        .select()
        .single();
      if (error) throw error;
      return result as any as ColorVariant;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['color_variants', vars.reference_id] });
      toast.success('Variante de cor adicionada');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useUpdateColorVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ColorVariant> }) => {
      const { error } = await supabase
        .from('reference_color_variants')
        .update(data as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['color_variants'] });
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteColorVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('reference_color_variants')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['color_variants'] });
      toast.success('Variante removida');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export async function recolorImage(imageUrl: string, targetColor: string, referenceCode: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('recolor-image', {
    body: { imageUrl, targetColor, referenceCode },
  });
  // Sem desembrulhar o corpo, um 429 chegaria como "non-2xx status code" e a
  // mensagem de cota do Gemini (ADR 0002) morreria aqui.
  if (error) throw await edgeFunctionError(error, 'Falha ao recolorir a imagem');
  if (data?.error) throw new Error(data.error);
  return data.url;
}
