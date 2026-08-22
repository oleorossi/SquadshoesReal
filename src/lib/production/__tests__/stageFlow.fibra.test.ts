import { describe, expect, it } from 'vitest';
import { findBlockingStage, inboundAvailability, isStageSkipped } from '@/lib/production/stageFlow';

const stage = (stage_name: string, quantity_processed = 0, status = 'pendente', quantity_total = 10) => ({
  stage_name,
  quantity_processed,
  quantity_total,
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

describe('stageFlow · pulo não entrega o total da OP', () => {
  it('Colagem pulada (0 processados) não libera Montagem com o total', () => {
    const stages = [
      stage('Corte Fibra', 180, 'em_andamento', 288),
      stage('Costura Palmilha', 180, 'concluido', 288),
      stage('Costura Cabedal', 0, 'pendente', 288),
      stage('Colagem', 0, 'concluido', 288),
      stage('Montagem', 0, 'pendente', 288),
    ];
    expect(isStageSkipped(stages[3])).toBe(true);
    // min(Corte Fibra 180, Costura Palmilha 180, Costura Cabedal 0) = 0
    // porque cabedal ainda não entregou — e NÃO 288 do "concluído".
    expect(inboundAvailability('Montagem', stages)).toBe(0);
  });

  it('pulo de Colagem passa adiante o inbound real, não o total da OP', () => {
    const stages = [
      stage('Corte Fibra', 180, 'em_andamento', 288),
      stage('Costura Palmilha', 180, 'concluido', 288),
      stage('Costura Cabedal', 180, 'concluido', 288),
      stage('Colagem', 0, 'concluido', 288),
      stage('Montagem', 0, 'pendente', 288),
    ];
    expect(inboundAvailability('Montagem', stages)).toBe(180);
  });
});
