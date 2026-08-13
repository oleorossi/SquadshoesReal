import { describe, expect, it } from 'vitest';
import { findBlockingStage } from '@/lib/production/stageFlow';

const stage = (stage_name: string, quantity_processed = 0, status = 'pendente') => ({
  stage_name,
  quantity_processed,
  quantity_total: 10,
  status,
});

describe('stageFlow · bloqueios rígidos de corte', () => {
  it('não inicia Costura Palmilha antes de Corte Fibra entregar pares', () => {
    const stages = [stage('Corte Fibra'), stage('Costura Palmilha')];
    expect(findBlockingStage('Costura Palmilha', stages)?.stage_name).toBe('Corte Fibra');
  });

  it('libera Costura Palmilha quando Corte Fibra apontou produção parcial', () => {
    const stages = [stage('Corte Fibra', 1, 'em_andamento'), stage('Costura Palmilha')];
    expect(findBlockingStage('Costura Palmilha', stages)).toBeNull();
  });

  it('não inicia Costura Cabedal antes de Corte Cabedal entregar pares', () => {
    const stages = [stage('Corte Cabedal'), stage('Costura Cabedal')];
    expect(findBlockingStage('Costura Cabedal', stages)?.stage_name).toBe('Corte Cabedal');
  });
});
