import { useQuery } from '@tanstack/react-query';
import { getSectorBoard } from '@/services/productionWavesService';

export function useSectorBoard() {
  return useQuery({
    queryKey: ['sector-board'],
    queryFn: getSectorBoard,
    refetchInterval: 10_000, // atualiza a cada 10s
  });
}
