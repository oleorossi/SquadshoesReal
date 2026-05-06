import { Badge } from "@/components/ui/badge";
import { useStageQuality } from "@/hooks/useStageQuality";

export function StageQualityBadge({
  waveId,
  stage,
}: {
  waveId: string;
  stage: "corte_palmilha" | "corte_forracao" | "mesa" | "silk" | "colagem" | "montagem" | "solagem" | "acabamento" | "expedicao"
        | "corte" | "costura" | "palmilha"; // legacy values
}) {
  const { data = [] } = useStageQuality(waveId);
  const row = data.find((d) => d.stage === stage);
  if (!row || row.total_defects === 0)
    return <Badge variant="secondary">0 def.</Badge>;
  const pct = Math.round(row.defect_rate * 1000) / 10;
  return (
    <Badge variant="destructive">
      {row.total_defects} def. ({pct}%)
    </Badge>
  );
}
