import { describe, it, expect } from 'vitest';
import {
  getDerivedProductColor,
  productColorAliases,
  productAnswersToColor,
  groupHasProductForColor,
  colorsFromProducts,
  normalizeColor,
} from '../productColorAliases';

/**
 * Dados REAIS de produção (05/08/2026), porque o bug do PV-00151 só aparece com a
 * assimetria de cadastro entre os dois grupos de strass.
 */
const G_6MM = 'c45ff936-5ac5-49b5-98c4-4aed5e10e82d';
const G_15MM = '6e43bbda-0f1f-412c-8d4a-ec009114530d';

/** TIRA STRASS 6MM — produtos TÊM `color`; o descritor mora no nome. */
const STRASS_6MM = [
  { group_id: G_6MM, name: 'Tira Strass 6mm Cristal com fundo branco', color: 'BRANCO', active: true },
  { group_id: G_6MM, name: 'TIRA STRASS 6MM', color: 'OFF WHITE', active: true },
  { group_id: G_6MM, name: 'Tira Strass 6mm Preto com fundo preto', color: 'PRETO', active: true },
  { group_id: G_6MM, name: 'Tira Strass 6mm Rosado com fundo rosado', color: 'ROSADO', active: true },
];

/** TIRA STRASS 15MM — produtos com `color` VAZIO; o nome É a cor. */
const STRASS_15MM = [
  { group_id: G_15MM, name: 'Cristal com fundo branco', color: '', active: true },
  { group_id: G_15MM, name: 'Preto com fundo preto', color: '', active: true },
  { group_id: G_15MM, name: 'Rosa com fundo rosado', color: '', active: true },
];

const ALL = [...STRASS_6MM, ...STRASS_15MM];

describe('getDerivedProductColor', () => {
  it('extrai o sufixo depois de ":"', () => {
    expect(getDerivedProductColor({ name: 'NAPA: PRETO', color: '' })).toBe('PRETO');
  });

  it('extrai o sufixo depois de " - "', () => {
    expect(getDerivedProductColor({ name: 'NAPA - PRETO', color: '' })).toBe('PRETO');
  });

  it('sem separador e SEM cor explícita: o nome inteiro é a cor', () => {
    expect(getDerivedProductColor({ name: 'Preto com fundo preto', color: '' }))
      .toBe('Preto com fundo preto');
  });

  it('sem separador mas COM cor explícita: o nome NÃO vira alias', () => {
    // Senão "Tira Strass 6mm Preto com fundo preto" concorreria com PRETO no
    // mesmo grupo e o dropdown ofereceria duas entradas pro mesmo produto.
    expect(getDerivedProductColor(STRASS_6MM[2])).toBe('');
  });
});

describe('productColorAliases', () => {
  it('produto com cor explícita atende só por ela', () => {
    expect(productColorAliases(STRASS_6MM[2])).toEqual(['PRETO']);
  });

  it('produto sem cor explícita atende pelo nome', () => {
    expect(productColorAliases(STRASS_15MM[1])).toEqual(['Preto com fundo preto']);
  });

  it('cor explícita + nome com separador geram DOIS aliases', () => {
    expect(productColorAliases({ name: 'NAPA - MARROM', color: 'MARROM ESCURO' }))
      .toEqual(['MARROM ESCURO', 'MARROM']);
  });
});

describe('colorsFromProducts', () => {
  it('6MM oferece as cores explícitas', () => {
    expect(colorsFromProducts(ALL, G_6MM)).toEqual(['BRANCO', 'OFF WHITE', 'PRETO', 'ROSADO']);
  });

  it('15MM oferece os NOMES, porque é onde a cor mora nesse grupo', () => {
    expect(colorsFromProducts(ALL, G_15MM)).toEqual([
      'CRISTAL COM FUNDO BRANCO',
      'PRETO COM FUNDO PRETO',
      'ROSA COM FUNDO ROSADO',
    ]);
  });

  it('ignora produto inativo', () => {
    const withInactive = [...ALL, { group_id: G_6MM, name: 'X', color: 'DESATIVADA', active: false }];
    expect(colorsFromProducts(withInactive, G_6MM)).not.toContain('DESATIVADA');
  });
});

/**
 * O CONTRATO que o bug violava: tudo que o dropdown OFERECE, a validação ACEITA.
 * Antes, `colorsFromProducts` aceitava alias derivado do nome e a validação só
 * olhava `products.color` — então o grupo 15MM oferecia 3 cores e reprovava as 3.
 */
describe('paridade dropdown × validação (o bug do PV-00151)', () => {
  for (const [label, groupId] of [['6MM', G_6MM], ['15MM', G_15MM]] as const) {
    it(`toda cor oferecida no ${label} passa na validação`, () => {
      const offered = colorsFromProducts(ALL, groupId);
      expect(offered.length).toBeGreaterThan(0);
      for (const color of offered) {
        expect(groupHasProductForColor(ALL, groupId, color)).toBe(true);
      }
    });
  }

  it('15MM: "PRETO COM FUNDO PRETO" é válida — era o falso "sem produto no estoque"', () => {
    expect(groupHasProductForColor(ALL, G_15MM, 'PRETO COM FUNDO PRETO')).toBe(true);
  });

  it('6MM: "PRETO COM FUNDO PRETO" continua INVÁLIDA — é a cor do 15MM', () => {
    // É exatamente o que o PV-00151 gravou. O conserto NÃO pode passar a aceitar
    // isso: o produto não existe nesse grupo, e aceitar mascararia o erro de dado.
    expect(groupHasProductForColor(ALL, G_6MM, 'PRETO COM FUNDO PRETO')).toBe(false);
  });

  it('6MM: "ROSADO COM FUNDO ROSADO" (PV-00151) segue inválida', () => {
    expect(groupHasProductForColor(ALL, G_6MM, 'ROSADO COM FUNDO ROSADO')).toBe(false);
  });
});

describe('normalização', () => {
  it('compara sem diferenciar caixa nem espaço nas pontas', () => {
    expect(productAnswersToColor(STRASS_6MM[2], '  preto ')).toBe(true);
  });

  it('cor vazia nunca casa', () => {
    expect(productAnswersToColor(STRASS_6MM[2], '')).toBe(false);
    expect(groupHasProductForColor(ALL, G_6MM, '   ')).toBe(false);
  });

  it('normalizeColor tolera null/undefined', () => {
    expect(normalizeColor(null)).toBe('');
    expect(normalizeColor(undefined)).toBe('');
  });

  it('grupo vazio nunca casa', () => {
    expect(groupHasProductForColor(ALL, '', 'PRETO')).toBe(false);
  });
});
