import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Users } from "@phosphor-icons/react";
import { supabase } from "@/integrations/supabase/client";
import { paresDiffOfRow, isChamadaRow, type FichaMontadorRow } from "@/lib/montadorProduction";

interface ChamadaHojeChipProps {
  /** Chave canônica: montagem | solagem */
  setor: string;
}

function todayISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * Chip no apontamento: pares e pessoas da Chamada do dia no setor.
 * Link pra Ficha de Montadores (home Relatórios).
 */
export function ChamadaHojeChip({ setor }: ChamadaHojeChipProps) {
  const dia = todayISO();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["chamada-hoje-chip", setor, dia],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("ficha_montadores")
        .select("montador_id, total, detalhe, origem, numeracoes")
        .eq("setor", setor)
        .eq("dia", dia);
      if (error) throw error;
      let pares = 0;
      const pessoas = new Set<string>();
      for (const raw of (rows || []) as FichaMontadorRow[]) {
        if (!isChamadaRow(raw)) continue;
        const { medio, dificil } = paresDiffOfRow(raw);
        const t = medio + dificil;
        if (t <= 0) continue;
        pares += t;
        if (raw.montador_id) pessoas.add(raw.montador_id);
      }
      return { pares, pessoas: pessoas.size };
    },
    staleTime: 30_000,
  });

  if (isError) return null;

  const pares = data?.pares ?? 0;
  const pessoas = data?.pessoas ?? 0;
  const label = isLoading
    ? "Chamada hoje…"
    : `Chamada hoje: ${pares.toLocaleString("pt-BR")} pares · ${pessoas} pessoa${pessoas === 1 ? "" : "s"}`;

  return (
    <Link
      to="/fichas-montadores"
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted/40"
      title="Abrir Ficha de Montadores (Relatórios)"
    >
      <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
      <span className="font-mono tabular-nums">{label}</span>
    </Link>
  );
}
