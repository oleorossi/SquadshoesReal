import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyDayCell,
  punchesNeedFix,
  rowHasNeedsFix,
  rowIsAllSettled,
} from '@/lib/ponto/dayCellStatus';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const PAGE = read('src/pages/Timesheet.tsx');
const WORKSPACE = read('src/components/timesheet/AdjustmentWorkspace.tsx');
const DIALOG = read('src/components/timesheet/DayAdjustDialog.tsx');

describe('workspace único de ajuste do ponto', () => {
  it('fluxo só Importar → Ajustar, sem Central/correction modes', () => {
    expect(PAGE).toContain("values: ['records', 'manual', 'arquivos', 'config']");
    expect(PAGE).toContain("label: 'Ajustar'");
    expect(PAGE).toContain('Importar → Ajustar');
    expect(PAGE).toContain('<TabsContent value="manual"><AdjustmentWorkspace /></TabsContent>');
    expect(PAGE).not.toContain('param: \'correction\'');
    expect(PAGE).not.toMatch(/Central de correção/);
    expect(PAGE).not.toMatch(/PendingTimeRecordsPanel/);
    expect(PAGE).not.toMatch(/OvernightCarryPanel/);
    expect(PAGE).not.toMatch(/ExceptionsTab/);
    expect(PAGE).not.toMatch(/<ManualEntryTab/);
    expect(PAGE).not.toContain("values: ['queue', 'overnight', 'calendar', 'exceptions']");
  });

  it('alias ausencias cai em Ajustar', () => {
    expect(PAGE).toContain('ausencias: \'manual\'');
  });

  it('workspace monta grade mês × pessoa com filtro', () => {
    expect(WORKSPACE).toContain('Ajustar o período');
    expect(WORKSPACE).toContain("value: 'needs_fix'");
    expect(WORKSPACE).toContain('Precisam ajuste');
    expect(WORKSPACE).toContain('DayAdjustDialog');
  });

  it('dialog oferece batidas XOR ausência e atalho de virada', () => {
    expect(DIALOG).toContain('Saída na madrugada seguinte');
    expect(DIALOG).toContain("DayAdjustMode = 'punches' | 'absence'");
    expect(DIALOG).toContain('Virada à noite');
    expect(DIALOG).toContain('ABSENCE_KIND_OPTIONS');
  });
});

describe('dayCellStatus', () => {
  it('classifica ímpar / ausência / ok / vazio em dia útil', () => {
    expect(punchesNeedFix(['08:00'])).toBe(true);
    expect(punchesNeedFix(['08:00', '18:00'])).toBe(false);

    expect(
      classifyDayCell({
        punches: ['08:00'],
        hasAbsence: false,
        overnightPending: false,
        expectsWork: true,
        withinEmployment: true,
        isFuture: false,
      }),
    ).toBe('needs_fix');

    expect(
      classifyDayCell({
        punches: [],
        hasAbsence: true,
        overnightPending: false,
        expectsWork: true,
        withinEmployment: true,
        isFuture: false,
      }),
    ).toBe('justified');

    expect(
      classifyDayCell({
        punches: ['08:00', '18:00'],
        hasAbsence: false,
        overnightPending: false,
        expectsWork: true,
        withinEmployment: true,
        isFuture: false,
      }),
    ).toBe('ok');

    expect(
      classifyDayCell({
        punches: [],
        hasAbsence: false,
        overnightPending: false,
        expectsWork: true,
        withinEmployment: true,
        isFuture: false,
      }),
    ).toBe('needs_fix');

    expect(
      classifyDayCell({
        punches: [],
        hasAbsence: false,
        overnightPending: false,
        expectsWork: false,
        withinEmployment: true,
        isFuture: false,
      }),
    ).toBe('empty');
  });

  it('filtra linhas por pendência', () => {
    expect(rowHasNeedsFix(['ok', 'needs_fix', 'empty'])).toBe(true);
    expect(rowIsAllSettled(['ok', 'justified', 'empty'])).toBe(true);
    expect(rowIsAllSettled(['ok', 'needs_fix'])).toBe(false);
  });
});
