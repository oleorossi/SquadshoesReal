import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HOOK = readFileSync(resolve(__dirname, '../hooks/useTimePendings.ts'), 'utf8');
const PANEL = readFileSync(
  resolve(__dirname, '../components/timesheet/FillFourPunchesPanel.tsx'),
  'utf8',
);
const WORKSPACE = readFileSync(
  resolve(__dirname, '../components/timesheet/PendingPunchesWorkspace.tsx'),
  'utf8',
);

describe('Pendências — save não pode mentir com cache velho', () => {
  it('useCompletePunches remove o id da fila onlyProblems na hora (otimista)', () => {
    expect(HOOK).toContain("qc.setQueryData<TimePending[]>(['v_time_pendings', true], dropResolved)");
    expect(HOOK).toContain('filter((row) => row.id !== result.timeRecordId)');
    expect(HOOK).toContain("qc.setQueryData<TimePending[]>(['v_time_pendings', false], patchPunches)");
  });

  it('Salvar bloqueado explica o motivo (não return silencioso)', () => {
    expect(PANEL).toContain('Complete os 4 horários antes de salvar');
    expect(PANEL).toContain('justificativa com pelo menos 4 caracteres');
    expect(PANEL).toContain('Vincule a matrícula');
  });

  it('Usar escala só preenche slots vazios (complemento, não overwrite)', () => {
    expect(PANEL).toContain('prev.entrada || schedule[0]');
    expect(PANEL).toContain('prev.saidaAlmoco || schedule[1]');
    expect(PANEL).toContain('prev.voltaAlmoco || schedule[2]');
    expect(PANEL).toContain('prev.saida || schedule[3]');
  });

  it('workspace limpa o painel quando o registro sai da fila do mês', () => {
    expect(WORKSPACE).toContain('!monthPendings.some((row) => row.id === editing.id)');
    expect(WORKSPACE).toContain('setEditing(null)');
  });

  it('Salvar e próximo captura o próximo antes do mutate otimista', () => {
    expect(PANEL).toContain('const nextAfterSave = andNext ? nextAny : null');
    expect(PANEL).toContain('advance(nextAfterSave)');
  });
});
