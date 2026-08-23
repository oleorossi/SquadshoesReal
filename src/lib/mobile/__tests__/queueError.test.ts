import { describe, expect, it } from 'vitest';
import { classifyQueueError } from '@/lib/mobile/queueError';

describe('classifyQueueError', () => {
  it('limite de tentativas vence a mensagem', () => {
    expect(classifyQueueError('failed to fetch', 5)).toBe('limite');
  });
  it('rede', () => {
    expect(classifyQueueError('Failed to fetch', 1)).toBe('rede');
  });
  it('ficha', () => {
    expect(classifyQueueError('Corrija a ficha técnica no desktop', 1)).toBe('ficha');
  });
  it('reserva', () => {
    expect(classifyQueueError('estoque insuficiente para a reserva', 2)).toBe('reserva');
  });
});
