/** Abas do menu Motor de produção (/motor?tab=…) e aliases de links antigos. */

export const MOTOR_TABS = ['plano', 'sequencia', 'compras', 'atelie', 'prazos', 'capacidade', 'config'] as const;
export type MotorTab = (typeof MOTOR_TABS)[number];

export const MOTOR_TAB_ALIAS: Record<string, MotorTab> = {
  agenda: 'plano',
  fila: 'sequencia',
  liberacao: 'sequencia',
  ocs: 'compras',
  oc: 'compras',
  reservas: 'atelie',
  prestador: 'atelie',
  equipe: 'capacidade',
  setores: 'capacidade',
  configuracoes: 'config',
};

export function resolveMotorTab(raw: string | null): MotorTab {
  const value = (raw ?? '').toLowerCase();
  const mapped = MOTOR_TAB_ALIAS[value] ?? value;
  return (MOTOR_TABS as readonly string[]).includes(mapped) ? (mapped as MotorTab) : 'plano';
}
