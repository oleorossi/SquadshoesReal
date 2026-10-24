import { describe, expect, it } from 'vitest';
import {
  UNICOLOR_SOLE_CLASSIFICATION,
  isCarameloSoleColor,
  isPalmilhaProntaClassification,
  isUnicolorCoveredKitDescription,
  isUnicolorPadronizadoClassification,
} from '@/lib/soleClassification';

describe('soleClassification — Palmilha Pronta Unicolor Padronizado', () => {
  it('trata unicolor como palmilha pronta (pronta clássica também)', () => {
    expect(isPalmilhaProntaClassification('palmilha_pronta')).toBe(true);
    expect(isPalmilhaProntaClassification(UNICOLOR_SOLE_CLASSIFICATION)).toBe(true);
    expect(isPalmilhaProntaClassification('tradicional')).toBe(false);
    expect(isPalmilhaProntaClassification('conjugado')).toBe(false);
  });

  it('identifica só o tipo unicolor', () => {
    expect(isUnicolorPadronizadoClassification(UNICOLOR_SOLE_CLASSIFICATION)).toBe(true);
    expect(isUnicolorPadronizadoClassification('palmilha_pronta')).toBe(false);
  });

  it('reconhece CARAMELO com/sem acento e caixa', () => {
    expect(isCarameloSoleColor('CARAMELO')).toBe(true);
    expect(isCarameloSoleColor('caramelo')).toBe(true);
    expect(isCarameloSoleColor('Caramelo')).toBe(true);
    expect(isCarameloSoleColor('PRETO')).toBe(false);
  });

  it('marca linhas do kit cobertas pelo kit físico', () => {
    expect(isUnicolorCoveredKitDescription('Placa fibra')).toBe(true);
    expect(isUnicolorCoveredKitDescription('Solado')).toBe(true);
    expect(isUnicolorCoveredKitDescription('Forração')).toBe(true);
    expect(isUnicolorCoveredKitDescription('Forracao')).toBe(true);
    expect(isUnicolorCoveredKitDescription('Cola forte')).toBe(false);
    expect(isUnicolorCoveredKitDescription('Novo material')).toBe(false);
    expect(isUnicolorCoveredKitDescription('EVA')).toBe(false);
  });
});
