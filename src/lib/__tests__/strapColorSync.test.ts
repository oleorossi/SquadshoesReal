import { describe, it, expect } from 'vitest';
import { shouldSyncStrapColorsToMain } from '../strapColorSync';

const straps = (...colors: (string | null)[]) => colors.map((color) => ({ color }));

describe('shouldSyncStrapColorsToMain', () => {
  it('não sincroniza sem cor principal ou sem tiras', () => {
    expect(shouldSyncStrapColorsToMain(null, '', straps('AZUL'))).toBe(false);
    expect(shouldSyncStrapColorsToMain('AZUL', 'AZUL', [])).toBe(false);
  });

  it('preenche tiras em branco (item novo)', () => {
    expect(shouldSyncStrapColorsToMain('', 'PRETO', straps(null, null))).toBe(true);
    expect(shouldSyncStrapColorsToMain(null, 'PRETO', straps('', ''))).toBe(true);
  });

  // REGRESSÃO 2026-07-22: "a seleção de tiras some ao reabrir o PV".
  // Na 1ª observação (prevMain === null), NUNCA sobrescrever cor de tira já
  // escolhida — nem no caso de tira única (que caía trivialmente no ramo antigo),
  // nem quando todas as tiras compartilham uma cor deliberada ≠ da principal.
  it('preserva a cor da tira ao reabrir (tira única ≠ principal)', () => {
    // NL02 PRETO com tira "PRETO COM FUNDO PRETO"
    expect(
      shouldSyncStrapColorsToMain(null, 'PRETO', straps('PRETO COM FUNDO PRETO')),
    ).toBe(false);
    // NL02 CAPUCCINO com tira strass "ROSADO COM FUNDO ROSADO"
    expect(
      shouldSyncStrapColorsToMain(null, 'CAPUCCINO', straps('ROSADO COM FUNDO ROSADO')),
    ).toBe(false);
  });

  it('preserva tira uniforme deliberada (≠ principal) ao reabrir', () => {
    expect(
      shouldSyncStrapColorsToMain(null, 'CAPUCCINO', straps('ROSADO', 'ROSADO', 'ROSADO')),
    ).toBe(false);
  });

  it('preserva tiras variadas ao reabrir', () => {
    expect(
      shouldSyncStrapColorsToMain(null, 'CAPUCCINO', straps('ROSADO', 'CAPUCCINO', 'ROSADO')),
    ).toBe(false);
  });

  // "Seguir a principal": só quando a principal REALMENTE mudou de um valor
  // anterior não-vazio E todas as tiras estavam iguais a esse valor antigo.
  it('acompanha a principal quando ela muda e as tiras seguiam a antiga', () => {
    expect(
      shouldSyncStrapColorsToMain('PRETO', 'AZUL', straps('PRETO', 'PRETO')),
    ).toBe(true);
  });

  it('NÃO acompanha se as tiras não estavam iguais à principal antiga', () => {
    // usuário fixou uma cor de tira própria; mudar a principal não deve arrastá-la
    expect(
      shouldSyncStrapColorsToMain('PRETO', 'AZUL', straps('VERMELHO', 'VERMELHO')),
    ).toBe(false);
    // tiras variadas: override manual preservado
    expect(
      shouldSyncStrapColorsToMain('PRETO', 'AZUL', straps('PRETO', 'BRANCO')),
    ).toBe(false);
  });

  it('não faz nada quando a principal não mudou', () => {
    expect(
      shouldSyncStrapColorsToMain('AZUL', 'AZUL', straps('AZUL', 'AZUL')),
    ).toBe(false);
  });
});
