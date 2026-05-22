import { describe, it, expect } from 'vitest';
import { generateBatchId } from '../batchId';

describe('generateBatchId', () => {
  const DATE = new Date('2026-05-22T15:30:00');

  it('produces a deterministic ID for the same input', () => {
    const id1 = generateBatchId('Aviamento', ['OP-001', 'OP-002', 'OP-003'], DATE);
    const id2 = generateBatchId('Aviamento', ['OP-001', 'OP-002', 'OP-003'], DATE);
    expect(id1).toBe(id2);
  });

  it('is order-insensitive and dedups OP numbers', () => {
    const id1 = generateBatchId('Aviamento', ['OP-003', 'OP-001', 'OP-002'], DATE);
    const id2 = generateBatchId('Aviamento', ['OP-001', 'OP-002', 'OP-003', 'OP-001'], DATE);
    expect(id1).toBe(id2);
  });

  it('differs when OP set differs', () => {
    const a = generateBatchId('Aviamento', ['OP-001', 'OP-002'], DATE);
    const b = generateBatchId('Aviamento', ['OP-001', 'OP-003'], DATE);
    expect(a).not.toBe(b);
  });

  it('differs by sector', () => {
    const a = generateBatchId('Aviamento', ['OP-001'], DATE);
    const b = generateBatchId('Costura', ['OP-001'], DATE);
    expect(a).not.toBe(b);
    expect(a.startsWith('AVI-')).toBe(true);
    expect(b.startsWith('COS-')).toBe(true);
  });

  it('differs by date', () => {
    const a = generateBatchId('Aviamento', ['OP-001'], new Date('2026-05-22'));
    const b = generateBatchId('Aviamento', ['OP-001'], new Date('2026-05-23'));
    expect(a).not.toBe(b);
    expect(a).toContain('260522');
    expect(b).toContain('260523');
  });

  it('handles empty OP list with stable fallback', () => {
    const a = generateBatchId('Solagem', [], DATE);
    const b = generateBatchId('Solagem', [], DATE);
    expect(a).toBe(b);
    expect(a).toMatch(/^SOL-\d{6}-[0-9A-F]{4}$/);
  });

  it('ignores null/undefined OP entries', () => {
    const a = generateBatchId('Silk', ['OP-001', null, undefined, 'OP-002'], DATE);
    const b = generateBatchId('Silk', ['OP-001', 'OP-002'], DATE);
    expect(a).toBe(b);
  });

  it('matches expected format SECTOR-YYMMDD-HASH4', () => {
    const id = generateBatchId('Corte Forração', ['OP-100'], DATE);
    expect(id).toMatch(/^CFO-260522-[0-9A-F]{4}$/);
  });

  it('falls back to truncated upper-case for unknown sector', () => {
    const id = generateBatchId('Setor Inexistente', ['OP-100'], DATE);
    expect(id.startsWith('SET-')).toBe(true);
  });
});
