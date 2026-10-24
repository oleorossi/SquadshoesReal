import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyDayCell,
  punchesNeedFix,
  rowHasNeedsFix,
  rowIsAllSettled,
} from '@/lib/ponto/dayCellStatus';
import {
  manualReasonStorageKey,
  readStickyManualReason,
  writeStickyManualReason,
} from '@/lib/ponto/manualReasonSticky';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

const PAGE = read('src/pages/Timesheet.tsx');
const WORKSPACE = read('src/components/timesheet/AdjustmentWorkspace.tsx');
const DIALOG = read('src/components/timesheet/DayAdjustDialog.tsx');
const ESPELHO = read('src/pages/EspelhoPontoPage.tsx');
const MIGRATION = read('supabase/migrations/20270101044600_ponto-reimport-protected.sql');

describe('workspace único de correção do ponto', () => {
  it('fluxo Importar → Corrigir, sem dualidade Pendências/Ajustar', () => {
    expect(PAGE).toContain("values: ['records', 'corrigir', 'arquivos', 'config']");
    expect(PAGE).toContain("label: 'Corrigir'");
    expect(PAGE).toContain('Importar → Corrigir');
    expect(PAGE).toContain('<TabsContent value="corrigir"><AdjustmentWorkspace /></TabsContent>');
    expect(PAGE).toContain("pendencias: 'corrigir'");
    expect(PAGE).toContain("manual: 'corrigir'");
    expect(PAGE).toContain("ausencias: 'corrigir'");
    expect(PAGE).not.toContain('<PendingPunchesWorkspace');
    expect(PAGE).not.toContain("label: 'Pendências'");
    expect(PAGE).not.toContain("label: 'Ajustar'");
    expect(PAGE).not.toContain('param: \'correction\'');
    expect(PAGE).not.toMatch(/Central de correção/);
    expect(PAGE).not.toMatch(/OvernightCarryPanel/);
    expect(PAGE).not.toMatch(/ExceptionsTab/);
    expect(PAGE).not.toMatch(/<ManualEntryTab/);
  });

  it('workspace monta grade com filtro Só pendências (default) | Todos', () => {
    expect(WORKSPACE).toContain('Corrigir o período');
    expect(WORKSPACE).toContain("useState<DayCellFilter>('needs_fix')");
    expect(WORKSPACE).toContain("label: 'Só pendências'");
    expect(WORKSPACE).toContain("label: 'Todos'");
    expect(WORKSPACE).toContain('DayAdjustDialog');
    expect(WORKSPACE).toContain('reimport_protected');
  });

  it('dialog edita batidas XOR ausência, sticky de motivo, unlock de reimport', () => {
    expect(DIALOG).toContain('Saída na madrugada seguinte');
    expect(DIALOG).toContain("DayAdjustMode = 'punches' | 'absence'");
    expect(DIALOG).toContain('Virada à noite');
    expect(DIALOG).toContain('ABSENCE_KIND_OPTIONS');
    expect(DIALOG).toContain('writeStickyManualReason');
    expect(DIALOG).toContain('readStickyManualReason');
    expect(DIALOG).toContain('set_time_record_reimport_protection');
    expect(DIALOG).toContain('Permitir reimport deste dia');
    expect(DIALOG).toContain('OverrideHistoryButton');
  });

  it('espelho esconde batidas brutas na impressão', () => {
    expect(ESPELHO).toContain('print:hidden">Batidas brutas</th>');
    expect(ESPELHO).toMatch(/print:hidden[\s\S]*punchesRaw|punchesRaw[\s\S]*print:hidden/);
  });

  it('migration define coluna, skip no import e RPC de unlock', () => {
    expect(MIGRATION).toContain('reimport_protected boolean NOT NULL DEFAULT false');
    expect(MIGRATION).toContain('skipped_protected');
    expect(MIGRATION).toContain('set_time_record_reimport_protection');
    expect(MIGRATION).toContain('reimport_protected = true');
  });
});

describe('manualReasonSticky', () => {
  it('grava e lê por employeeId na sessionStorage', () => {
    const id = 'emp-sticky-test';
    sessionStorage.removeItem(manualReasonStorageKey(id));
    expect(readStickyManualReason(id)).toBe('');
    writeStickyManualReason(id, 'ab'); // curto demais
    expect(readStickyManualReason(id)).toBe('');
    writeStickyManualReason(id, 'confirmado em filmagem');
    expect(readStickyManualReason(id)).toBe('confirmado em filmagem');
    sessionStorage.removeItem(manualReasonStorageKey(id));
  });
});

describe('dayCellStatus', () => {
  it('classifica ímpar / ausência / ok / vazio em dia útil', () => {
    expect(punchesNeedFix(['08:00'])).toBe(true);
    expect(punchesNeedFix(['08:00', '18:00'])).toBe(true); // n=2 jornada cheia → pendência
    expect(punchesNeedFix(['13:06', '18:06'])).toBe(false); // turno só tarde → ok
    expect(punchesNeedFix(['08:00', '12:00'])).toBe(false); // turno só manhã → ok
    expect(punchesNeedFix(['08:00', '12:00', '13:00', '18:00'])).toBe(false);

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
    ).toBe('needs_fix'); // n=2 jornada cheia → pendência

    expect(
      classifyDayCell({
        punches: ['13:06', '18:06'],
        hasAbsence: false,
        overnightPending: false,
        expectsWork: true,
        withinEmployment: true,
        isFuture: false,
      }),
    ).toBe('ok'); // turno só tarde

    expect(
      classifyDayCell({
        punches: ['08:00', '12:00', '13:00', '18:00'],
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
