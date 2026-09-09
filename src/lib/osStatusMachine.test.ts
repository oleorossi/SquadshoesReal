import { describe, it, expect } from 'vitest';
import {
  OS_STATUS,
  normalizeOsStatus,
  osStatusLabel,
  osStatusBadgeVariant,
  isOsDone,
  isOsCancelled,
  isOsActive,
  isValidOsTransition,
  getValidNextOsStatuses,
  osStageIndex,
} from './osStatusMachine';

describe('normalizeOsStatus', () => {
  it('mapeia grafias do form e do fluxo de gargalos pro canônico', () => {
    expect(normalizeOsStatus('Concluído')).toBe(OS_STATUS.CONCLUIDO);
    expect(normalizeOsStatus('concluido')).toBe(OS_STATUS.CONCLUIDO);
    expect(normalizeOsStatus('received')).toBe(OS_STATUS.CONCLUIDO);
    expect(normalizeOsStatus('finalizado')).toBe(OS_STATUS.CONCLUIDO);
    expect(normalizeOsStatus('cancelled')).toBe(OS_STATUS.CANCELADO);
    expect(normalizeOsStatus('estornado')).toBe(OS_STATUS.CANCELADO);
    expect(normalizeOsStatus('Em Andamento')).toBe(OS_STATUS.EM_ANDAMENTO);
    expect(normalizeOsStatus('em processamento')).toBe(OS_STATUS.EM_ANDAMENTO);
    expect(normalizeOsStatus('pending_quote')).toBe(OS_STATUS.PENDENTE);
    expect(normalizeOsStatus('quoted')).toBe(OS_STATUS.PENDENTE);
  });

  it('default Pendente pra null/vazio/desconhecido', () => {
    expect(normalizeOsStatus(null)).toBe(OS_STATUS.PENDENTE);
    expect(normalizeOsStatus(undefined)).toBe(OS_STATUS.PENDENTE);
    expect(normalizeOsStatus('')).toBe(OS_STATUS.PENDENTE);
    expect(normalizeOsStatus('xpto')).toBe(OS_STATUS.PENDENTE);
  });
});

describe('predicados de status', () => {
  it('done/cancelled/active', () => {
    expect(isOsDone('received')).toBe(true);
    expect(isOsDone('Pendente')).toBe(false);
    expect(isOsCancelled('cancelled')).toBe(true);
    expect(isOsActive('Pendente')).toBe(true);
    expect(isOsActive('Em Andamento')).toBe(true);
    expect(isOsActive('Concluído')).toBe(false);
    expect(isOsActive('Cancelado')).toBe(false);
  });
});

describe('labels (vocabulário do dono)', () => {
  it('traduz pro vocabulário do dono', () => {
    expect(osStatusLabel('Em Andamento')).toBe('Enviada');
    expect(osStatusLabel('Concluído')).toBe('Recebida');
    expect(osStatusLabel('received')).toBe('Recebida');
    expect(osStatusLabel('Cancelado')).toBe('Cancelada');
    expect(osStatusLabel('Pendente')).toBe('Pendente');
  });
  it('preserva os labels de cotação do fluxo de gargalos', () => {
    expect(osStatusLabel('pending_quote')).toBe('Aguardando prazo');
    expect(osStatusLabel('quoted_unconfirmed')).toBe('Aguardando prazo');
    expect(osStatusLabel('quoted')).toBe('Prazo confirmado');
  });
});

describe('badge variant', () => {
  it('mapeia status → variante', () => {
    expect(osStatusBadgeVariant('Concluído')).toBe('default');
    expect(osStatusBadgeVariant('Em Andamento')).toBe('secondary');
    expect(osStatusBadgeVariant('Cancelado')).toBe('destructive');
    expect(osStatusBadgeVariant('Pendente')).toBe('outline');
    expect(osStatusBadgeVariant('pending_quote')).toBe('outline');
  });
});

describe('transições', () => {
  it('permite o fluxo normal', () => {
    expect(isValidOsTransition('Pendente', 'Em Andamento')).toBe(true);
    expect(isValidOsTransition('Em Andamento', 'Concluído')).toBe(true);
    expect(isValidOsTransition('Pendente', 'Cancelado')).toBe(true);
  });
  it('mantém Concluído como terminal imutável', () => {
    expect(isValidOsTransition('Concluído', 'Em Andamento')).toBe(false);
    expect(isValidOsTransition('Concluído', 'Pendente')).toBe(false);
    expect(isValidOsTransition('Concluído', 'Cancelado')).toBe(false);
  });
  it('mantém Cancelado como terminal no fluxo genérico', () => {
    expect(isValidOsTransition('Cancelado', 'Pendente')).toBe(false);
    expect(isValidOsTransition('Cancelado', 'Concluído')).toBe(false);
  });
  it('idempotente (mesmo status) é válido mesmo em terminal', () => {
    expect(isValidOsTransition('Concluído', 'received')).toBe(true); // mesma classe canônica
  });
  it('getValidNextOsStatuses', () => {
    expect(getValidNextOsStatuses('Pendente')).toContain(OS_STATUS.EM_ANDAMENTO);
    expect(getValidNextOsStatuses('Concluído')).toEqual([]);
    expect(getValidNextOsStatuses('Cancelado')).toEqual([]);
  });
});

describe('etapas (timeline)', () => {
  it('índice da etapa na régua', () => {
    expect(osStageIndex('Pendente')).toBe(0);
    expect(osStageIndex('Em Andamento')).toBe(1);
    expect(osStageIndex('Concluído')).toBe(2);
    expect(osStageIndex('Cancelado')).toBe(-1);
  });
});
