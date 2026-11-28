import { describe, expect, it } from 'vitest';
import { releasePreproductionMessage } from '@/hooks/useReleasePreproduction';

describe('mensagem do botão Gerar ordens e fichas', () => {
  it('diz quantas ordens e que o pedido continua Aguardando Cabedal', () => {
    expect(releasePreproductionMessage({ created_ops: 3 })).toBe(
      '3 ordens geradas. O pedido continua Aguardando Cabedal.',
    );
    expect(releasePreproductionMessage({ created_ops: 1 })).toContain('1 ordem gerada');
  });

  it('segunda chamada não cria nada e avisa', () => {
    expect(releasePreproductionMessage({ created_ops: 0, reused_ops: 3 })).toContain('já tinham ordem');
    expect(releasePreproductionMessage(null)).toContain('já tinham ordem');
  });
});
