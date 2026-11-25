/**
 * Prazos do motor — leitura (get_motor_config) e gravação (update_motor_settings).
 * As chaves auto_motor_enabled / urgent_release_without_material NÃO são
 * gravadas por aqui: o banco recusa (decisão do Leonardo, fora desta tela).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { atelierKeys } from '@/hooks/useAtelier';
import { normalizeMotorConfig, type MotorConfig, type MotorSettingKey } from '@/lib/motorConfig';

export const motorConfigKeys = {
  all: ['motor-config'] as const,
};

export function useMotorConfig() {
  return useQuery({
    queryKey: motorConfigKeys.all,
    queryFn: async (): Promise<MotorConfig> => {
      const { data, error } = await supabase.rpc('get_motor_config' as never);
      if (error) throw error;
      return normalizeMotorConfig(data);
    },
    staleTime: 30_000,
  });
}

export function useUpdateMotorSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Record<MotorSettingKey | 'motor_cabedal_gate_sector', number | string | null>>) => {
      const { data, error } = await supabase.rpc('update_motor_settings' as never, { p_patch: patch } as never);
      if (error) throw error;
      return normalizeMotorConfig(data);
    },
    onSuccess: (config) => {
      qc.setQueryData(motorConfigKeys.all, config);
      void qc.invalidateQueries({ queryKey: atelierKeys.settings() });
      void qc.invalidateQueries({ queryKey: atelierKeys.all });
      toast.success('Prazos do motor salvos — valem no próximo recálculo da agenda');
    },
    onError: (e: Error) => toast.error(e.message || 'Não foi possível salvar os prazos do motor'),
  });
}
