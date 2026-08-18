import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const technicalSheets = readFileSync(
  resolve(__dirname, '../pages/TechnicalSheets.tsx'),
  'utf8',
);

describe('Range Aviamento — napas da referência', () => {
  it('exibe os grupos possíveis quando a tira segue a napa da referência', () => {
    expect(technicalSheets).toContain("strapIdentityBasis(strap) === 'reference_base'");
    expect(technicalSheets).toContain('Napas possíveis da referência');
    expect(technicalSheets).toContain('possibleReferenceNapaGroups.map');
  });

  it('mantém a escolha da napa sob responsabilidade da variante do pedido', () => {
    expect(technicalSheets).toContain(
      'O pedido seleciona automaticamente a napa correta conforme a variante de material.',
    );
  });
});
