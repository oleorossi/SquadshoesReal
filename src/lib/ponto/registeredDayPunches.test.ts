import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adjacentBusinessDates,
  buildRegisteredDayLines,
  dayCellPunchTooltip,
  dayPunchContext,
  describeRegisteredPunches,
  formatExpectedJourney,
  formatNeighborDayLine,
  holidayNameOn,
  missingSlotKeys,
  prefillDaySlots,
  resolveManualPunchTokens,
  slotAlertKeys,
  slotsToPunchPayload,
  type JourneySchedule,
} from './registeredDayPunches';

const WEEKDAY: JourneySchedule = {
  entry_time: '08:00:00',
  lunch_start: '12:00:00',
  lunch_end: '13:00:00',
  exit_time: '17:48:00',
  saturday_entry: '08:00',
  saturday_exit: '12:00',
  works_sunday: false,
  works_monday: true,
  works_tuesday: true,
  works_wednesday: true,
  works_thursday: true,
  works_friday: true,
  works_saturday: true,
};

const monday = dayPunchContext(WEEKDAY, '2026-11-02', null);
const mondayHoliday = dayPunchContext(WEEKDAY, '2026-11-02', 'Finados');

describe('batidas registradas no dia', () => {
  it('dia sem marcação diz que não há batida e não inventa par em feriado', () => {
    expect(buildRegisteredDayLines([], mondayHoliday)).toEqual([]);
    expect(missingSlotKeys([], mondayHoliday)).toEqual([]);
    expect(formatExpectedJourney(WEEKDAY, '2026-11-02', 'Finados')).toBe(
      'Feriado (Finados) — sem jornada',
    );
    expect(dayCellPunchTooltip([], mondayHoliday)).toBe('Nenhuma batida registrada');
  });

  it('dia útil vazio lista o par inteiro como faltando', () => {
    expect(missingSlotKeys([], monday)).toEqual([
      'entrada',
      'saidaAlmoco',
      'voltaAlmoco',
      'saida',
    ]);
    expect(formatExpectedJourney(WEEKDAY, '2026-11-03', null)).toBe(
      '08:00–12:00 · 13:00–17:48',
    );
    expect(dayCellPunchTooltip([], monday)).toContain('Nenhuma batida registrada');
    expect(dayCellPunchTooltip([], monday)).toContain('faltando: Entrada, Saída almoço, Volta almoço, Saída');
  });

  it('3 batidas deixam só a Volta almoço vazia e mostram a origem do relógio', () => {
    const punches = ['08:01', '12:00', '18:05'];
    const lines = buildRegisteredDayLines(punches, monday);
    expect(lines.map(line => line.type === 'gap' ? line.label : line.punch.hhmm)).toEqual([
      '08:01',
      '12:00',
      'faltando: Volta almoço',
      '18:05',
    ]);
    expect(lines.filter(line => line.type === 'punch').every(line => line.type === 'punch' && line.punch.originLabel === 'Relógio/TXT')).toBe(true);
    const prefill = prefillDaySlots(punches);
    expect(prefill.slots).toEqual({
      entrada: '08:01',
      saidaAlmoco: '12:00',
      voltaAlmoco: '',
      saida: '18:05',
    });
    expect(prefill.slotManual.entrada).toBe(false);
    expect(slotAlertKeys(prefill.slots, monday, punches, false)).toEqual(['voltaAlmoco']);
  });

  it('pré-preenche na ordem e manda a 5ª em diante para extra', () => {
    const prefill = prefillDaySlots(['08:00', '12:01', '13:02', '17:48', '19:10*']);
    expect(prefill.slots).toEqual({
      entrada: '08:00',
      saidaAlmoco: '12:01',
      voltaAlmoco: '13:02',
      saida: '17:48',
    });
    expect(prefill.extras).toEqual(['19:10*']);
    expect(prefill.slotManual.saida).toBe(false);
    expect(missingSlotKeys(['08:00', '12:01', '13:02', '17:48', '19:10*'], monday)).toEqual([]);
  });

  it('turno parcial não pede almoço; jornada cheia de 2 batidas pede', () => {
    expect(missingSlotKeys(['13:06', '18:06'], monday)).toEqual([]);
    expect(slotAlertKeys(
      { entrada: '13:06', saidaAlmoco: '', voltaAlmoco: '', saida: '18:06' },
      monday,
      ['13:06', '18:06'],
      false,
    )).toEqual([]);
    const full = buildRegisteredDayLines(['08:14', '18:02'], monday);
    expect(full.map(line => line.type === 'gap' ? line.label : line.punch.hhmm)).toEqual([
      '08:14',
      'faltando: Saída almoço',
      'faltando: Volta almoço',
      '18:02',
    ]);
  });

  it('manual e ajuste trazem quem e quando; relógio preservado não ganha autor', () => {
    const punches = ['08:00', '12:00', '13:00*', '18:00'];
    const described = describeRegisteredPunches(punches, [
      {
        action: 'replace',
        created_at: '2026-11-03T17:32:00.000Z',
        created_by: 'user-1',
        punches_before: ['08:00', '12:00', '18:00'],
        punches_after: ['08:00', '12:00', '13:00*', '18:00'],
      },
    ], { 'user-1': 'Marina Gestor' });
    const volta = described.find(item => item.hhmm === '13:00');
    expect(volta).toMatchObject({
      origin: 'adjustment',
      originLabel: 'Ajuste',
      authorName: 'Marina Gestor',
    });
    expect(volta?.whenLabel).toContain('03/11');
    expect(described.find(item => item.hhmm === '08:00')).toMatchObject({
      origin: 'clock',
      originLabel: 'Relógio/TXT',
      authorName: null,
    });
  });

  it('batida acrescentada sem replace é manual', () => {
    const [punch] = describeRegisteredPunches(['18:00*'], [
      {
        action: 'add',
        created_at: '2026-11-03T18:00:00.000Z',
        created_by: 'user-2',
        added_punch: '18:00:00',
        punches_before: [],
        punches_after: ['18:00*'],
      },
    ], {});
    expect(punch.origin).toBe('manual');
    expect(punch.originLabel).toBe('Manual');
    expect(punch.authorName).toBeNull();
    expect(punch.whenLabel).toBeTruthy();
  });
});

describe('pré-preenchimento e gravação sem duplicar o relógio', () => {
  it('completa só a volta e o payload não duplica nem estrela o relógio', () => {
    const original = ['08:01', '12:00', '18:05'];
    const prefill = prefillDaySlots(original);
    const slots = { ...prefill.slots, voltaAlmoco: '13:00' };
    const manual = { ...prefill.slotManual, voltaAlmoco: true };
    const payload = slotsToPunchPayload(slots, manual, prefill.extras);
    expect(payload).toEqual(['08:01', '12:00', '13:00*', '18:05']);
    expect(resolveManualPunchTokens(original, payload)).toEqual([
      '08:01',
      '12:00',
      '13:00*',
      '18:05',
    ]);
  });

  it('a RPC viva reaproveita o token do relógio e liga a proteção contra o próximo TXT', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/20270101044600_ponto-reimport-protected.sql'),
      'utf8',
    );
    const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.upsert_manual_time_record'));
    expect(fn).toContain("requested.clean || '*'");
    expect(fn).toContain('left(regexp_replace(old.value');
    expect(fn).toContain('reimport_protected = true');
    expect(fn).toContain('A mesma batida não pode aparecer duas vezes.');
  });

  it('horário que o gestor redigita igual ao relógio continua no token original', () => {
    expect(resolveManualPunchTokens(
      ['08:07', '12:01*'],
      ['08:07*', '12:01', '13:00*', '17:48*'],
    )).toEqual(['08:07', '12:01*', '13:00*', '17:48*']);
  });

  it('limpar o pré-preenchimento pede o par do dia útil e não o do feriado', () => {
    const empty = { entrada: '', saidaAlmoco: '', voltaAlmoco: '', saida: '' };
    expect(slotAlertKeys(empty, monday, ['08:00', '18:00'], true)).toEqual([
      'entrada',
      'saidaAlmoco',
      'voltaAlmoco',
      'saida',
    ]);
    expect(slotAlertKeys(empty, mondayHoliday, [], true)).toEqual([]);
  });
});

describe('dia útil vizinho e feriado', () => {
  it('Finados na segunda pula o feriado e o domingo', () => {
    const holidays = new Set(['2026-11-02']);
    expect(adjacentBusinessDates('2026-11-02', WEEKDAY, holidays)).toEqual({
      previous: '2026-10-31',
      next: '2026-11-03',
    });
    expect(formatNeighborDayLine('2026-10-31', ['08:02', '12:00', '13:01', '12:00'])).toContain('sáb 31/10');
    expect(formatNeighborDayLine('2026-11-03', null)).toBe('ter 03/11 · sem registro');
    expect(formatNeighborDayLine('2026-11-03', [])).toBe('ter 03/11 · nenhuma batida');
  });

  it('sábado sem expediente não é dia útil quando a escala não trabalha sábado', () => {
    const office = { ...WEEKDAY, works_saturday: false };
    expect(adjacentBusinessDates('2026-11-02', office, new Set(['2026-11-02'])).previous).toBe('2026-10-30');
  });

  it('feriado recorrente entra; facultativo e sábado trabalhado não', () => {
    const holidays = [
      { holiday_date: '2020-11-02', name: 'Finados', recurring: true },
      { holiday_date: '2026-11-03', name: 'Facultativo', optional: true },
      { holiday_date: '2026-11-07', name: 'Sábado de fábrica', is_working_day: true },
    ];
    expect(holidayNameOn('2026-11-02', holidays)).toBe('Finados');
    expect(holidayNameOn('2026-11-03', holidays)).toBeNull();
    expect(holidayNameOn('2026-11-07', holidays)).toBeNull();
  });
});
