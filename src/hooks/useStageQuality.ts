import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  registerDefect,
  listStageQuality,
  type StageQuality,
} from "@/services/qualityWaveService";
import { toast } from "sonner";

export function useStageQuality(waveId: string | undefined) {
  return useQuery<StageQuality[]>({
    queryKey: ["stage-quality", waveId],
    queryFn: () => listStageQuality(waveId!),
    enabled: !!waveId,
    refetchInterval: 15_000,
  });
}

export function useRegisterDefect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerDefect,
    onSuccess: (_res, vars) => {
      toast.success("Defeito registrado e retrabalho aberto");
      qc.invalidateQueries({ queryKey: ["stage-quality"] });
      qc.invalidateQueries({ queryKey: ["waves"] });
      qc.invalidateQueries({ queryKey: ["wave-detail", vars.waveStageId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
