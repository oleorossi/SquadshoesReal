import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listWaves, getWaveDetail, createWave, startWave, advanceWaveStage,
  getFinishingPackages, updatePackageStatus, updateMesaCapacity, getWaveSaleOrders,
  syncWaveFromKanban,
} from '@/services/productionWavesService';
import { STAGE_LABEL } from '@/types/production-waves';
import { toast as sonnerToast } from 'sonner';

export function useWaves() {
  return useQuery({ queryKey: ['waves'], queryFn: listWaves });
}

export function useWaveDetail(waveId: string | null) {
  return useQuery({
    queryKey: ['wave-detail', waveId],
    queryFn: () => getWaveDetail(waveId!),
    enabled: Boolean(waveId),
    staleTime: 5_000,
  });
}

export function useCreateWave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createWave,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waves'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      qc.invalidateQueries({ queryKey: ['order_stages'] });
      qc.invalidateQueries({ queryKey: ['sector-board'] });
      sonnerToast.success('Onda criada com sucesso');
    },
    onError: (err: Error) =>
      sonnerToast.error('Não foi possível criar a onda', {
        description: err.message,
        duration: 8000,
      }),
  });
}

export function useStartWave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: startWave,
    onSuccess: (_r, waveId) => {
      qc.invalidateQueries({ queryKey: ['waves'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['wave-detail', waveId] });
      qc.invalidateQueries({ queryKey: ['wave-sale-orders', waveId] });
      qc.invalidateQueries({ queryKey: ['sector-board'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['sale_orders'] });
      sonnerToast.success('Onda iniciada');
    },
    onError: (err: Error) =>
      sonnerToast.error('Erro ao iniciar onda', { description: err.message }),
  });
}

export function useAdvanceStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ waveId, stage }: { waveId: string; stage: import('@/types/production-waves').ProductionStage }) =>
      advanceWaveStage(waveId, stage),
    onSuccess: (nextStage, { waveId }) => {
      qc.invalidateQueries({ queryKey: ['waves'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['wave-detail', waveId] });
      qc.invalidateQueries({ queryKey: ['wave-sale-orders', waveId] });
      qc.invalidateQueries({ queryKey: ['sector-board'] });
      qc.invalidateQueries({ queryKey: ['finishing-packages', waveId] });
      sonnerToast.success(
        nextStage
          ? `Setor liberado: ${STAGE_LABEL[nextStage] ?? nextStage.toUpperCase()}`
          : 'Onda finalizada!'
      );
    },
    onError: (err: Error) =>
      sonnerToast.error('Bloqueado', { description: err.message }),
  });
}

export function useFinishingPackages(waveId: string | null) {
  return useQuery({
    queryKey: ['finishing-packages', waveId],
    queryFn: () => getFinishingPackages(waveId!),
    enabled: Boolean(waveId),
  });
}

export function useUpdatePackage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { packageId: string; status: 'pending' | 'packed' | 'shipped' }) =>
      updatePackageStatus(args.packageId, args.status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['finishing-packages'] }),
    onError: (err: Error) => sonnerToast.error(`Erro ao atualizar pacote: ${err.message}`),
  });
}

export function useUpdateMesaCapacity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ waveId, capacityPerDay }: { waveId: string; capacityPerDay: number }) =>
      updateMesaCapacity(waveId, capacityPerDay),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sector-board'] });
      sonnerToast.success('Capacidade da Mesa atualizada');
    },
    onError: (err: Error) => sonnerToast.error(`Erro ao atualizar capacidade: ${err.message}`),
  });
}

export function useSyncWaveFromKanban() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (waveId: string) => syncWaveFromKanban(waveId),
    onSuccess: (_stage, waveId) => {
      qc.invalidateQueries({ queryKey: ['waves'] });
      qc.invalidateQueries({ queryKey: ['production_waves'] });
      qc.invalidateQueries({ queryKey: ['wave-detail', waveId] });
      qc.invalidateQueries({ queryKey: ['wave-sale-orders', waveId] });
      qc.invalidateQueries({ queryKey: ['sector-board'] });
      sonnerToast.success('Onda sincronizada com o Kanban');
    },
    onError: (err: Error) =>
      sonnerToast.error('Erro ao sincronizar', { description: err.message }),
  });
}

export function useWaveSaleOrders(waveId: string | null) {
  return useQuery({
    queryKey: ['wave-sale-orders', waveId],
    queryFn: () => getWaveSaleOrders(waveId!),
    enabled: Boolean(waveId),
    staleTime: 30_000,
  });
}
