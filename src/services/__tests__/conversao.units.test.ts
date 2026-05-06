import { describe, it, expect } from 'vitest';
import { conversaoService, ConversaoUnidadeError } from '@/services/conversao';
import { UnidadeMedida } from '@/types/unidades';

// Fixtures: pares (origem, destino, valor entrada, valor esperado)
// Refletem os fatores definidos em src/types/unidades.ts (CONVERSOES) e
// servem como contrato entre frontend (UI/forms) e backend (RPCs SQL).
const lengthFixtures: Array<[number, UnidadeMedida, UnidadeMedida, number]> = [
  // cm ↔ m (tiras: backend opera em cm/par, frontend exibe em m no estoque)
  [100, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO, 1],
  [250, UnidadeMedida.CENTIMETRO, UnidadeMedida.METRO, 2.5],
  [1, UnidadeMedida.METRO, UnidadeMedida.CENTIMETRO, 100],
  [0.85, UnidadeMedida.METRO, UnidadeMedida.CENTIMETRO, 85],
  // metro linear é sinônimo de metro
  [3, UnidadeMedida.METRO_LINEAR, UnidadeMedida.METRO, 3],
  [3, UnidadeMedida.METRO_LINEAR, UnidadeMedida.CENTIMETRO, 300],
  // mm
  [1500, UnidadeMedida.MILIMETRO, UnidadeMedida.METRO, 1.5],
  [1.4, UnidadeMedida.METRO, UnidadeMedida.MILIMETRO, 1400],
];

const areaFixtures: Array<[number, UnidadeMedida, UnidadeMedida, number]> = [
  // dm² ↔ m² (cabedais, forros, palmilhas — backend e ficha técnica em dm²/par)
  [100, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO_QUADRADO, 1],
  [12.5, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO_QUADRADO, 0.125],
  [1, UnidadeMedida.METRO_QUADRADO, UnidadeMedida.DECIMETRO_QUADRADO, 100],
  [0.5, UnidadeMedida.METRO_QUADRADO, UnidadeMedida.DECIMETRO_QUADRADO, 50],
  // dm² ↔ cm²
  [1, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.CENTIMETRO_QUADRADO, 100],
  [500, UnidadeMedida.CENTIMETRO_QUADRADO, UnidadeMedida.DECIMETRO_QUADRADO, 5],
];

const weightFixtures: Array<[number, UnidadeMedida, UnidadeMedida, number]> = [
  // kg ↔ g (cola, químicos, linha)
  [1, UnidadeMedida.QUILOGRAMA, UnidadeMedida.GRAMA, 1000],
  [0.025, UnidadeMedida.QUILOGRAMA, UnidadeMedida.GRAMA, 25],
  [500, UnidadeMedida.GRAMA, UnidadeMedida.QUILOGRAMA, 0.5],
  [1, UnidadeMedida.QUILOGRAMA, UnidadeMedida.MILIGRAMA, 1_000_000],
];

const volumeFixtures: Array<[number, UnidadeMedida, UnidadeMedida, number]> = [
  [1, UnidadeMedida.LITRO, UnidadeMedida.MILILITRO, 1000],
  [250, UnidadeMedida.MILILITRO, UnidadeMedida.LITRO, 0.25],
  [1, UnidadeMedida.METRO_CUBICO, UnidadeMedida.LITRO, 1000],
];

describe('conversaoService — comprimento (cm ↔ m ↔ mm)', () => {
  it.each(lengthFixtures)(
    'converte %f %s → %s = %f',
    (valor, de, para, esperado) => {
      expect(conversaoService.converter(valor, de, para)).toBeCloseTo(esperado, 4);
    }
  );

  it('mantém valor ao converter para a mesma unidade', () => {
    expect(conversaoService.converter(42, UnidadeMedida.CENTIMETRO, UnidadeMedida.CENTIMETRO)).toBe(42);
  });
});

describe('conversaoService — área (dm² ↔ m² ↔ cm²)', () => {
  it.each(areaFixtures)(
    'converte %f %s → %s = %f',
    (valor, de, para, esperado) => {
      expect(conversaoService.converter(valor, de, para)).toBeCloseTo(esperado, 4);
    }
  );

  it('roundtrip dm² → m² → dm² preserva valor', () => {
    const original = 18.75;
    const m2 = conversaoService.converter(original, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO_QUADRADO);
    const back = conversaoService.converter(m2, UnidadeMedida.METRO_QUADRADO, UnidadeMedida.DECIMETRO_QUADRADO);
    expect(back).toBeCloseTo(original, 2);
  });
});

describe('conversaoService — peso (kg ↔ g ↔ mg)', () => {
  it.each(weightFixtures)(
    'converte %f %s → %s = %f',
    (valor, de, para, esperado) => {
      expect(conversaoService.converter(valor, de, para)).toBeCloseTo(esperado, 4);
    }
  );
});

describe('conversaoService — volume (l ↔ ml ↔ m³)', () => {
  it.each(volumeFixtures)(
    'converte %f %s → %s = %f',
    (valor, de, para, esperado) => {
      expect(conversaoService.converter(valor, de, para)).toBeCloseTo(esperado, 4);
    }
  );
});

describe('conversaoService — incompatibilidades', () => {
  it('rejeita conversão entre grupos diferentes (kg → m)', () => {
    expect(() =>
      conversaoService.converter(1, UnidadeMedida.QUILOGRAMA, UnidadeMedida.METRO)
    ).toThrow(ConversaoUnidadeError);
  });

  it('rejeita conversão entre área e comprimento (dm² → m)', () => {
    expect(() =>
      conversaoService.converter(1, UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO)
    ).toThrow(ConversaoUnidadeError);
  });

  it('saoCompativeis identifica corretamente os grupos', () => {
    expect(conversaoService.saoCompativeis(UnidadeMedida.METRO, UnidadeMedida.CENTIMETRO)).toBe(true);
    expect(conversaoService.saoCompativeis(UnidadeMedida.DECIMETRO_QUADRADO, UnidadeMedida.METRO_QUADRADO)).toBe(true);
    expect(conversaoService.saoCompativeis(UnidadeMedida.QUILOGRAMA, UnidadeMedida.GRAMA)).toBe(true);
    expect(conversaoService.saoCompativeis(UnidadeMedida.METRO, UnidadeMedida.QUILOGRAMA)).toBe(false);
    expect(conversaoService.saoCompativeis(UnidadeMedida.METRO, UnidadeMedida.METRO_QUADRADO)).toBe(false);
  });
});
