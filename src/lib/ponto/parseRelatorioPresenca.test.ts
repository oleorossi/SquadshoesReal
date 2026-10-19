import { describe, expect, it } from 'vitest';
import {
  excelFractionToHHMM,
  extractPresencePeriod,
  looksLikeRelatorioPresenca,
  parseCartaoDayLabel,
  parseRelatorioPresencaSheets,
} from './parseRelatorioPresenca';

function hhmmToExcel(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60 + m) / (24 * 60);
}

/** Fixture fiel ao Cartão de ponto do RelatórioPresença.xls (dados sintéticos). */
function cartaoSheet(opts: {
  name: string;
  period: string;
  blocks: Array<{ id: string; name: string; dep?: string; days: Record<string, string[]> }>;
}) {
  const rows: unknown[][] = [];
  rows[0] = Array(45).fill('');
  rows[0][11] = 'Tabela de presença de funcionários';
  rows[1] = Array(45).fill('');
  rows[1][33] = `Data de presença:${opts.period}`;
  rows[3] = Array(45).fill('');
  rows[4] = Array(45).fill('');
  const offsets = [0, 15, 30];
  opts.blocks.forEach((block, i) => {
    const offset = offsets[i];
    rows[3][offset] = 'Dep.';
    rows[3][offset + 1] = block.dep || 'DEP1';
    rows[3][offset + 8] = 'Nome';
    rows[3][offset + 9] = block.name;
    rows[4][offset] = 'Data';
    rows[4][offset + 1] = opts.period.replace(/~/g, '~');
    rows[4][offset + 8] = 'ID';
    rows[4][offset + 9] = block.id;
  });
  rows[9] = Array(45).fill('');
  rows[9][0] = 'Cartão de ponto';
  rows[9][15] = 'Cartão de ponto';
  rows[9][30] = 'Cartão de ponto';
  rows[10] = Array(45).fill('');
  rows[10][0] = 'Data';
  rows[11] = Array(45).fill('');
  for (const offset of offsets) {
    rows[11][offset + 1] = 'Entrada';
    rows[11][offset + 3] = 'Saída';
    rows[11][offset + 6] = 'Entrada';
    rows[11][offset + 8] = 'Saída';
    rows[11][offset + 10] = 'Entrada';
    rows[11][offset + 12] = 'Saída';
  }

  const weekdays = ['5ª', '6ª', 'Sá', 'Do', '2ª', '3ª', '4ª', '5ª', '6ª', 'Sá', 'Do', '2ª', '3ª', '4ª', '5ª'];
  for (let day = 1; day <= 15; day++) {
    const r = 11 + day;
    rows[r] = Array(45).fill('');
    opts.blocks.forEach((block, i) => {
      const offset = offsets[i];
      const label = `${String(day).padStart(2, '0')} ${weekdays[day - 1]}`;
      rows[r][offset] = label;
      const punches = block.days[String(day)] || [];
      const relCols = [1, 3, 6, 8, 10, 12];
      punches.forEach((punch, pIdx) => {
        if (pIdx < relCols.length) {
          rows[r][offset + relCols[pIdx]] = hhmmToExcel(punch);
        }
      });
    });
  }

  return { name: opts.name, rows };
}

describe('parseRelatorioPresenca', () => {
  it('converte fração Excel e rótulo de dia do cartão', () => {
    expect(excelFractionToHHMM(0.3340272903442383)).toBe('08:01');
    expect(excelFractionToHHMM(0.2965269088745117)).toBe('07:07');
    expect(excelFractionToHHMM(1)).toBeNull();
    expect(excelFractionToHHMM('08:05')).toBe('08:05');
    expect(parseCartaoDayLabel('01 5ª')).toBe(1);
    expect(parseCartaoDayLabel('15 5ª')).toBe(15);
    expect(extractPresencePeriod('Data de presença:01/10/2026~15/10/2026')).toEqual({
      startDate: '2026-10-01',
      endDate: '2026-10-15',
    });
  });

  it('detecta RelatórioPresença pela aba de turno ou cartão', () => {
    expect(looksLikeRelatorioPresenca([
      { name: 'Tabela de turno de funcionários', rows: [['Tabela de turno de funcionários (Para inspeção)']] },
      { name: '1,2,3', rows: [['Cartão de ponto']] },
    ])).toBe(true);
    expect(looksLikeRelatorioPresenca([
      { name: 'Sheet1', rows: [['IDUsuário', '2', 'Nome', 'ana'], ['1', '2', '3']] },
    ])).toBe(false);
  });

  it('lê cartões multi-aba, inclui HE e registra quem não bateu', () => {
    const turno = {
      name: 'Tabela de turno de funcionários',
      rows: [
        ['', 'Tabela de turno de funcionários (Para inspeção)'],
        ['Data:01/10/2026~15/10/2026'],
        ['IDUsuário', 'Nome', 'Dep.', '1', '2', '3'],
        ['1', 'camila', 'DEP1', '1', '1', '1'],
      ],
    };
    const sheetA = cartaoSheet({
      name: '1,2,3',
      period: '01/10/2026~15/10/2026',
      blocks: [
        { id: '1', name: 'valdilene', days: {} },
        {
          id: '2',
          name: 'talia',
          days: {
            '1': ['07:07'],
          },
        },
        {
          id: '3',
          name: 'camila',
          days: {
            '2': ['08:01', '12:04', '13:09', '18:26'],
            '7': ['08:14', '12:04', '13:05', '21:24'],
          },
        },
      ],
    });

    const result = parseRelatorioPresencaSheets([turno, sheetA]);
    expect(result.startDate).toBe('2026-10-01');
    expect(result.endDate).toBe('2026-10-15');
    expect(result.employees).toHaveLength(3);

    const valdilene = result.employees.find(e => e.externalId === '1')!;
    expect(valdilene.name).toBe('valdilene');
    expect(valdilene.records).toEqual([]);

    const camila = result.employees.find(e => e.externalId === '3')!;
    expect(camila.records).toEqual([
      { day: 2, dateStr: '2026-10-02', punches: ['08:01', '12:04', '13:09', '18:26'] },
      { day: 7, dateStr: '2026-10-07', punches: ['08:14', '12:04', '13:05', '21:24'] },
    ]);
  });

  it('ignora dia do cartão fora do período sem abortar', () => {
    const sheet = cartaoSheet({
      name: '1,2,3',
      period: '01/10/2026~05/10/2026',
      blocks: [
        {
          id: '9',
          name: 'ana',
          days: {
            '2': ['08:00', '12:00', '13:00', '18:00'],
            '10': ['08:00', '12:00', '13:00', '18:00'], // fora do período
          },
        },
      ],
    });
    // Força rótulo dia 10 mesmo com período 01–05
    const day10 = sheet.rows[11 + 10];
    day10[0] = '10 6ª';
    day10[1] = hhmmToExcel('08:00');

    const result = parseRelatorioPresencaSheets([sheet]);
    expect(result.employees[0].records.map(r => r.dateStr)).toEqual(['2026-10-02']);
  });

  it('recusa turno sem cartão com mensagem acionável', () => {
    expect(() => parseRelatorioPresencaSheets([
      {
        name: 'Tabela de turno de funcionários',
        rows: [
          ['Tabela de turno de funcionários (Para inspeção)'],
          ['Data:01/10/2026~15/10/2026'],
        ],
      },
    ])).toThrow(/Cartão de ponto/);
  });
});
