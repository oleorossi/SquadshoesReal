import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Cartela de cores do CATÁLOGO (catalog_colors) — independente da tabela
 * `colors` das fichas técnicas (que não tem hex preenchido e tem nomes
 * duplicados). Decisão do dono em 2026-08-01. Seed inicial: 22 cores em 4
 * grupos (migration 20261031130000).
 */
export type CatalogColor = {
  id: string;
  nome: string;
  hex: string;
  grupo: string | null;
  ordem: number;
  ativo: boolean;
  created_at: string;
};

export type CatalogColorFormData = {
  nome: string;
  hex: string;
  grupo?: string;
};

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

export function useCatalogColors() {
  return useQuery({
    queryKey: ['catalog_colors'],
    queryFn: async () => {
      // Cast: tabela nova ainda não está em types.ts (gerado) — padrão aceito no projeto.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela nova fora do types.ts gerado
      const { data, error } = await (supabase as any)
        .from('catalog_colors')
        .select('*')
        .eq('ativo', true)
        .order('ordem')
        .order('nome');
      if (error) throw error;
      return (data || []) as CatalogColor[];
    },
    staleTime: 5 * 60_000,
  });
}

/**
 * Cadastra ou REATIVA a cor. Vai por RPC, não por `.insert()`, porque a remoção
 * é soft-delete (`ativo = false`) e o índice UNIQUE em `lower(trim(nome))` não
 * filtra por ativo: um insert direto de cor já removida estourava
 * `duplicate key…` cru no toast. A `upsert_catalog_color` ressuscita a linha
 * (migration 20261210120000).
 */
export function useAddCatalogColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (form: CatalogColorFormData) => {
      const nome = form.nome.trim().toUpperCase();
      if (!nome) throw new Error('Dê um nome pra cor.');
      if (!HEX_RE.test(form.hex)) throw new Error('Hex inválido (use #RRGGBB).');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nova fora do types.ts gerado
      const { data, error } = await (supabase as any).rpc('upsert_catalog_color', {
        p_nome: nome,
        p_hex: form.hex.toUpperCase(),
        p_grupo: form.grupo || 'Minhas cores',
      });
      if (error) throw error;
      return data as CatalogColor;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog_colors'] });
      toast.success('Cor adicionada à cartela!');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}

export function useDeleteCatalogColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabela nova fora do types.ts gerado
      const { error } = await (supabase as any)
        .from('catalog_colors')
        .update({ ativo: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog_colors'] });
      toast.success('Cor removida da cartela');
    },
    onError: (err: Error) => toast.error(`Erro: ${err.message}`),
  });
}
