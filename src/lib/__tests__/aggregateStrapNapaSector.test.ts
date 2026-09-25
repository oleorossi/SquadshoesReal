import { describe, expect, it } from 'vitest';
import {
  aggregateStrapNapaSector,
  artisanalStrapTypeKey,
  type ArtisanalStrapCutRow,
} from '../strapRollCut';

const cutStub = {
  largura_mm: 20,
  metros_uteis_por_banda: 40,
  n_bandas: 1,
  cm_a_cortar: 2,
  rolos: 0.01,
  n_rolos_completos: 0,
  cm_no_ultimo_rolo: 2,
  valid: true,
  widthMissing: false,
};

function row(partial: Partial<ArtisanalStrapCutRow> & Pick<ArtisanalStrapCutRow, 'groupName' | 'metros_necessarios'>): ArtisanalStrapCutRow {
  return {
    key: partial.key || partial.groupName,
    color: partial.color || 'PRETO',
    largura_mm: partial.largura_mm ?? 20,
    cut: partial.cut || cutStub,
    baseName: partial.baseName,
    canonical: partial.canonical,
    ...partial,
  };
}

describe('aggregateStrapNapaSector', () => {
  it('agrupa por tipo: tira m + napa m; rodapé = total de napa', () => {
    const sector = aggregateStrapNapaSector([
      row({
        groupName: 'TIRA OVERLOCK 5MM · PRETO',
        color: 'PRETO',
        metros_necessarios: 4,
        baseName: 'NAPA SOFT',
        canonical: {
          recipeId: 'r1',
          baseRequiredM: 0.08,
          confirmedYieldMPerM: 50,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 55,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }),
      row({
        groupName: 'TIRA CHATA 8MM · PRETO',
        color: 'PRETO',
        metros_necessarios: 6,
        baseName: 'NAPA SOFT',
        canonical: {
          recipeId: 'r2',
          baseRequiredM: 5,
          confirmedYieldMPerM: 1.2,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 1.3,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }),
      row({
        groupName: 'TIRA CHATA 8MM · OFF WHITE',
        color: 'OFF WHITE',
        metros_necessarios: 4,
        baseName: 'NAPA SOFT',
        canonical: {
          recipeId: 'r2',
          baseRequiredM: 5,
          confirmedYieldMPerM: 0.8,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 1.3,
          transformationCostPerM: null,
          blockingReasons: [],
        },
      }),
    ]);

    expect(sector.types.map((t) => t.typeName)).toEqual([
      'TIRA CHATA 8MM',
      'TIRA OVERLOCK 5MM',
    ]);
    const chata = sector.types.find((t) => t.typeName === 'TIRA CHATA 8MM')!;
    expect(chata.strapM).toBeCloseTo(10, 6);
    expect(chata.napaM).toBeCloseTo(10, 6);
    expect(chata.colorCount).toBe(2);

    const overlock = sector.types.find((t) => t.typeName === 'TIRA OVERLOCK 5MM')!;
    expect(overlock.strapM).toBeCloseTo(4, 6);
    expect(overlock.napaM).toBeCloseTo(0.08, 6);

    expect(sector.totalStrapM).toBeCloseTo(14, 6);
    expect(sector.totalNapaM).toBeCloseTo(10.08, 6);
  });

  it('artisanalStrapTypeKey remove o sufixo de cor', () => {
    expect(artisanalStrapTypeKey(row({
      groupName: 'TIRA CHATA 8 mm · NAPA MADRID · OFF WHITE',
      color: 'OFF WHITE',
      metros_necessarios: 1,
    }))).toBe('TIRA CHATA 8 mm · NAPA MADRID');
  });

  it('aviso soft de 1ª demanda com rendimento NÃO zera napa nem marca incompleto', () => {
    const sector = aggregateStrapNapaSector([
      row({
        groupName: 'TIRA OVERLOCK 5 mm · GLOW METALIC · CHAMPAGNE',
        color: 'CHAMPAGNE',
        metros_necessarios: 296.84,
        baseName: 'GLOW METALIC',
        canonical: {
          recipeId: 'r-overlock-glow',
          baseRequiredM: 4.240571,
          confirmedYieldMPerM: 70,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 70,
          transformationCostPerM: null,
          blockingReasons: [],
          snapshotWarning:
            'A versao, o rendimento e a necessidade de base serao congelados na primeira demanda; antes disso, apenas os IDs e o consumo tecnico do item estao preservados.',
        },
      }),
      row({
        groupName: 'TIRA OVERLOCK 5 mm · GLOW METALIC · OURO',
        color: 'OURO',
        metros_necessarios: 5.28,
        baseName: 'GLOW METALIC',
        canonical: {
          recipeId: 'r-overlock-glow',
          baseRequiredM: 0.07542857,
          confirmedYieldMPerM: 70,
          usableBaseWidthMm: 1370,
          theoreticalYieldMPerM: 70,
          transformationCostPerM: null,
          blockingReasons: [],
          // Contágio: uma linha soft não pode zerar a napa do tipo.
          snapshotWarning: 'A transformação física será congelada na primeira demanda.',
        },
      }),
    ]);

    expect(sector.types).toHaveLength(1);
    const overlock = sector.types[0];
    expect(overlock.blocked).toBe(false);
    expect(overlock.napaM).toBeCloseTo(4.240571 + 0.07542857, 5);
    expect(sector.totalNapaM).toBeCloseTo(overlock.napaM, 5);
  });

  it('sem rendimento continua cadastro incompleto mesmo com aviso soft', () => {
    const sector = aggregateStrapNapaSector([
      row({
        groupName: 'TIRA OVERLOCK 5MM · PRETO',
        color: 'PRETO',
        metros_necessarios: 36,
        canonical: {
          recipeId: null,
          baseRequiredM: 0,
          confirmedYieldMPerM: 0,
          usableBaseWidthMm: 0,
          theoreticalYieldMPerM: 0,
          transformationCostPerM: null,
          blockingReasons: [],
          snapshotWarning: 'A transformação física será congelada na primeira demanda.',
        },
      }),
    ]);
    expect(sector.types[0].blocked).toBe(true);
    expect(sector.types[0].napaM).toBe(0);
  });
});
