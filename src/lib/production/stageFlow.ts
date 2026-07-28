/**
 * Fluxo canônico dos setores de produção — ESPELHO do lado servidor.
 *
 * Fonte da verdade: fn_guard_manual_stage_transition (migration
 * 20260902120000). Se o DAG mudar lá, mudar aqui junto — a UI usa isto pra
 * bloquear/liberar "Iniciar" sem esperar o roundtrip do erro do banco.
 */

/** Grafia legada → canônica (rows antigas e caminhos de escrita antigos). */
const STAGE_ALIASES: Record<string, string> = {
  Mesa: 'Aviamento',
  // A 'Costura' única virou dois setores (migration 20261001120000). O legado
  // resolve pra PALMILHA — era o que a etapa única representava em toda ficha.
  Costura: 'Costura Palmilha',
};

const CUTTING_STAGES = new Set(['Corte Palmilha', 'Corte Forração']);

export function canonicalStageName(name: string): string {
  const trimmed = (name || '').trim();
  return STAGE_ALIASES[trimmed] ?? trimmed;
}

/** Compara nomes de setor tolerando grafia legada (Mesa ⇄ Aviamento). */
export function sameStage(a: string, b: string): boolean {
  const canonicalA = canonicalStageName(a);
  const canonicalB = canonicalStageName(b);
  return canonicalA === canonicalB ||
    (canonicalA === 'Corte' && CUTTING_STAGES.has(canonicalB)) ||
    (canonicalB === 'Corte' && CUTTING_STAGES.has(canonicalA));
}

/**
 * Pré-requisitos por setor (DAG). Setores sem pré-requisito são paralelos
 * (array vazio); setor desconhecido (legacy não mapeado) = sem bloqueio,
 * igual ao guard.
 *
 * ⚠ A ordem "cortes primeiro, depois costura ‖ aviamento" (dono, 2026-10-01)
 * vive no PLANEJAMENTO (sector_settings.parallel_group + cascata de datas),
 * NÃO como bloqueio aqui: o chão de fábrica sempre pôde apontar costura sem
 * o corte fechado, e quem avisa sobre isso é o aviso confirmável
 * `limite_setor_anterior`. Endurecer viraria mudança de comportamento.
 * As duas costuras são independentes entre si — nenhuma bloqueia a outra.
 */
export const STAGE_DAG: Record<string, string[]> = {
  'Corte Palmilha': [],
  'Corte Forração': [],
  'Costura Palmilha': [],
  'Costura Cabedal': [],
  'Aviamento': [],
  'Silk': [],
  'Colagem': ['Corte Palmilha', 'Costura Palmilha', 'Costura Cabedal'],
  'Montagem': ['Colagem'],
  'Solagem': ['Montagem'],
  'Acabamento': ['Solagem'],
  'Expedição': ['Acabamento'],
};

type StageLike = {
  stage_name: string;
  status: string;
  quantity_processed: number;
  quantity_total: number;
};

/**
 * Retorna o setor pré-requisito que impede este de INICIAR, ou null.
 * Regra do guard (fluxo parcial): pré-requisito satisfeito se concluído
 * OU se já apontou produção (>0 pares).
 */
export function findBlockingStage<T extends StageLike>(stageName: string, allStages: T[]): T | null {
  const required = STAGE_DAG[canonicalStageName(stageName)];
  if (!required || required.length === 0) return null;
  return (
    allStages.find(
      (s) =>
        required.some((r) => sameStage(r, s.stage_name)) &&
        s.status !== 'concluido' &&
        (s.quantity_processed ?? 0) === 0
    ) ?? null
  );
}

/**
 * Pares disponíveis vindos dos setores pré-requisito (fluxo parcial):
 * min(quantity_processed) entre eles. null = setor sem pré-requisito
 * (prep) ou pré-requisito não encontrado na OP.
 */
export function inboundAvailability(stageName: string, allStages: StageLike[]): number | null {
  const required = STAGE_DAG[canonicalStageName(stageName)];
  if (!required || required.length === 0) return null;
  const preds = required
    .map((r) => allStages.find((s) => sameStage(r, s.stage_name)))
    .filter((s): s is StageLike => !!s);
  if (preds.length === 0) return null;
  return Math.min(
    ...preds.map((s) => (s.status === 'concluido' ? s.quantity_total : s.quantity_processed ?? 0))
  );
}
