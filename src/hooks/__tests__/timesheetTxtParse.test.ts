import { describe, it, expect } from 'vitest';
import { parseTimesheetTxtContent, detectTxtEncodings } from '../useTimesheet';

// Leitura do AGL_001.TXT (relógio ZKTeco): UTF-16LE + TAB, 1 linha/batida,
// EnNo (3ª col) = matrícula, DateTime = "YYYY-MM-DD  HH:MM:SS".
describe('detectTxtEncodings', () => {
  it('detecta UTF-16LE pelo BOM (FF FE)', () => {
    expect(detectTxtEncodings(new Uint8Array([0xFF, 0xFE, 0x4E, 0x00]).buffer)).toEqual(['utf-16le']);
  });
  it('detecta UTF-16BE pelo BOM (FE FF)', () => {
    expect(detectTxtEncodings(new Uint8Array([0xFE, 0xFF, 0x00, 0x4E]).buffer)).toEqual(['utf-16be']);
  });
  it('detecta UTF-8 pelo BOM (EF BB BF)', () => {
    expect(detectTxtEncodings(new Uint8Array([0xEF, 0xBB, 0xBF, 0x41]).buffer)).toEqual(['utf-8']);
  });
  it('sem BOM e com muitos bytes nulos em posição ímpar → UTF-16LE', () => {
    // "No" em UTF-16LE sem BOM: 4E 00 6F 00 (nulos em índices ímpares)
    const bytes: number[] = [];
    for (const ch of 'No data 2025') { bytes.push(ch.charCodeAt(0), 0x00); }
    expect(detectTxtEncodings(new Uint8Array(bytes).buffer)[0]).toBe('utf-16le');
  });
  it('texto comum sem nulos → utf-8/iso', () => {
    const t = new TextEncoder().encode('101,2025-10-01,08:00:00\n102,2025-10-01,09:00:00');
    expect(detectTxtEncodings(t.buffer)).toEqual(['utf-8', 'iso-8859-1']);
  });
});

describe('parseTimesheetTxtContent — TSV ZKTeco (AGL)', () => {
  const header = 'No\tTMNo\tEnNo\tName\t\tGMNo\tMode\tIN/OUT\tAntipass\tDaiGong\tDateTime\tTR';
  const row = (no: number, en: string, name: string, dt: string) =>
    `${no}\t1\t${en}\t${name}\t\t1\t1\tF\t0\t0\t${dt}\tJob Out`;

  it('agrupa por matrícula (EnNo) e data, ignorando o nome curto', () => {
    const text = [
      header,
      row(1, '13', 'erick', '2025-10-21  08:00:00'),
      row(2, '13', 'erick', '2025-10-21  12:00:00'),
      row(3, '17', 'gisele', '2025-10-21  18:05:30'),
    ].join('\r\n');
    const r = parseTimesheetTxtContent(text);
    const erick = r.employees.find(e => e.externalId === '13');
    expect(erick).toBeTruthy();
    expect(erick!.records[0].punches).toEqual(['08:00', '12:00']);
    const gisele = r.employees.find(e => e.externalId === '17');
    expect(gisele!.records[0].punches).toEqual(['18:05']);
    expect(r.startDate).toBe('2025-10-21');
    expect(r.endDate).toBe('2025-10-21');
  });

  it('lida com os 2 espaços entre data e hora do DateTime', () => {
    const r = parseTimesheetTxtContent([header, row(1, '5', 'leo', '2025-11-01  07:59:10')].join('\n'));
    expect(r.employees[0].externalId).toBe('5');
    expect(r.employees[0].records[0].punches).toEqual(['07:59']);
  });

  it('matrícula sem nome ainda é registrada pela matrícula', () => {
    const r = parseTimesheetTxtContent([header, row(17, '1', '', '2025-11-01  08:00:00')].join('\n'));
    expect(r.employees[0].externalId).toBe('1');
  });
});
