import type { TimeRecord } from '@/hooks/useTimesheet';

export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  type: 'sequence' | 'timing' | 'duplicate' | 'business_rule';
  severity: 'low' | 'medium' | 'high' | 'critical';
  active: boolean;
  check: (records: TimeRecord[]) => ValidationResult[];
}

export interface ValidationResult {
  rule_id: string;
  record_id: string;
  employee_name: string;
  record_date: string;
  passed: boolean;
  message: string;
  severity: string;
  suggested_fix?: string;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export const validationRules: ValidationRule[] = [
  {
    id: 'odd_punches',
    name: 'Marcações Ímpares',
    description: 'Verifica se há número ímpar de marcações (entrada sem saída ou vice-versa)',
    type: 'sequence',
    severity: 'high',
    active: true,
    check: (records) => {
      const results: ValidationResult[] = [];
      records.forEach((rec) => {
        const punches = rec.punches as string[];
        if (punches.length > 0 && punches.length % 2 !== 0) {
          results.push({
            rule_id: 'odd_punches',
            record_id: rec.id,
            employee_name: rec.employee_name,
            record_date: rec.record_date,
            passed: false,
            message: `${punches.length} marcação(ões) – número ímpar indica falta de entrada ou saída`,
            severity: 'high',
            suggested_fix: 'Verificar se há registro de entrada/saída perdido ou adicionar manualmente',
          });
        }
      });
      return results;
    },
  },
  {
    id: 'duplicate_punches',
    name: 'Marcações Duplicadas',
    description: 'Identifica horários idênticos no mesmo dia para o mesmo funcionário',
    type: 'duplicate',
    severity: 'medium',
    active: true,
    check: (records) => {
      const results: ValidationResult[] = [];
      records.forEach((rec) => {
        const punches = rec.punches as string[];
        const unique = new Set(punches);
        if (unique.size < punches.length) {
          const dupes = punches.filter((p, i) => punches.indexOf(p) !== i);
          results.push({
            rule_id: 'duplicate_punches',
            record_id: rec.id,
            employee_name: rec.employee_name,
            record_date: rec.record_date,
            passed: false,
            message: `Marcação duplicada: ${[...new Set(dupes)].join(', ')}`,
            severity: 'medium',
            suggested_fix: 'Remover marcação duplicada ou corrigir horário',
          });
        }
      });
      return results;
    },
  },
  {
    id: 'excessive_work_hours',
    name: 'Jornada Excessiva',
    description: 'Detecta jornadas de trabalho superiores a 16 horas',
    type: 'business_rule',
    severity: 'high',
    active: true,
    check: (records) => {
      const results: ValidationResult[] = [];
      records.forEach((rec) => {
        const punches = rec.punches as string[];
        if (punches.length < 2) return;
        const sorted = [...punches].sort();
        const firstMin = timeToMinutes(sorted[0]);
        const lastMin = timeToMinutes(sorted[sorted.length - 1]);
        const totalHours = (lastMin - firstMin) / 60;
        if (totalHours > 16) {
          results.push({
            rule_id: 'excessive_work_hours',
            record_id: rec.id,
            employee_name: rec.employee_name,
            record_date: rec.record_date,
            passed: false,
            message: `Jornada de ${totalHours.toFixed(1)}h excede limite de 16h`,
            severity: 'high',
            suggested_fix: 'Verificar se há erro nos registros ou situação excepcional autorizada',
          });
        }
      });
      return results;
    },
  },
  {
    id: 'short_interval',
    name: 'Intervalo Muito Curto',
    description: 'Detecta marcações com menos de 2 minutos de diferença',
    type: 'timing',
    severity: 'low',
    active: true,
    check: (records) => {
      const results: ValidationResult[] = [];
      records.forEach((rec) => {
        const punches = rec.punches as string[];
        if (punches.length < 2) return;
        const sorted = [...punches].sort();
        for (let i = 1; i < sorted.length; i++) {
          const diff = timeToMinutes(sorted[i]) - timeToMinutes(sorted[i - 1]);
          if (diff >= 0 && diff < 2) {
            results.push({
              rule_id: 'short_interval',
              record_id: rec.id,
              employee_name: rec.employee_name,
              record_date: rec.record_date,
              passed: false,
              message: `Intervalo de ${diff}min entre ${sorted[i - 1]} e ${sorted[i]}`,
              severity: 'low',
              suggested_fix: 'Verificar se é marcação acidental ou dupla batida',
            });
            break; // one alert per record
          }
        }
      });
      return results;
    },
  },
  {
    id: 'no_break',
    name: 'Sem Intervalo de Almoço',
    description: 'Detecta jornadas > 6h sem intervalo mínimo de 30 minutos',
    type: 'business_rule',
    severity: 'medium',
    active: true,
    check: (records) => {
      const results: ValidationResult[] = [];
      records.forEach((rec) => {
        const punches = rec.punches as string[];
        if (punches.length !== 2) return; // only 2 punches = no break recorded
        const sorted = [...punches].sort();
        const totalMinutes = timeToMinutes(sorted[1]) - timeToMinutes(sorted[0]);
        if (totalMinutes > 360) { // > 6h without break
          results.push({
            rule_id: 'no_break',
            record_id: rec.id,
            employee_name: rec.employee_name,
            record_date: rec.record_date,
            passed: false,
            message: `Jornada de ${(totalMinutes / 60).toFixed(1)}h sem intervalo registrado (CLT exige mínimo 1h para >6h)`,
            severity: 'medium',
            suggested_fix: 'Verificar se o intervalo não foi registrado ou se a jornada é contínua autorizada',
          });
        }
      });
      return results;
    },
  },
];

/** Run all active validation rules against a set of records */
export function runValidation(records: TimeRecord[]): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const rule of validationRules) {
    if (!rule.active) continue;
    results.push(...rule.check(records));
  }
  return results;
}
