import { useQuery, useMutation } from '@tanstack/react-query';

/**
 * Feature de "Numerações Conjugadas" REMOVIDA em 2026-05-31 por decisão
 * do usuário. Tabela sole_size_conjugations dropada; estoque com chaves
 * X/Y migrado pra individuais (split 50/50).
 *
 * Mantemos exports como no-ops pra não quebrar imports remanescentes nos
 * arquivos que ainda referenciam (callers viram dead code, retornam vazio).
 */

export interface SoleConjugation {
  id: string;
  sole_group_id: string;
  size_key: string;
  sizes: number[];
  display_order: number;
}

export function useSoleConjugations(_soleGroupId: string | null) {
  return useQuery({
    queryKey: ['sole_size_conjugations_deprecated'],
    queryFn: async () => [] as SoleConjugation[],
    staleTime: Infinity,
  });
}

export function useUpsertSoleConjugation() {
  return useMutation({
    mutationFn: async (_row: Omit<SoleConjugation, 'id'> & { id?: string }) => {
      throw new Error('Feature removida em 2026-05-31');
    },
  });
}

export function useDeleteSoleConjugation() {
  return useMutation({
    mutationFn: async (_args: { id: string; soleGroupId: string }) => {
      throw new Error('Feature removida em 2026-05-31');
    },
  });
}
