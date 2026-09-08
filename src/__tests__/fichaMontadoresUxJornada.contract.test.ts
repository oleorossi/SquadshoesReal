import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(
  resolve(__dirname, '../pages/FichaMontadoresPage.tsx'),
  'utf8',
);

describe('contrato UX / jornada da Ficha de Montadores (admin)', () => {
  it('mantém atalhos de bancada sem self-service do montador', () => {
    expect(PAGE).toContain('Copiar de ontem');
    expect(PAGE).toContain('Salvar e conferir');
    expect(PAGE).toContain('placeholder="7f"');
    expect(PAGE).toContain('Adicionar 5 fichas');
    expect(PAGE).not.toContain('/minha-producao');
    expect(PAGE).not.toContain('is_montador');
  });

  it('expõe a jornada Lançar → Conferir → Relatórios e Semana mobile', () => {
    expect(PAGE).toContain('Jornada da ficha');
    expect(PAGE).toContain('1 · Lançar');
    expect(PAGE).toContain('2 · Conferir / pagar');
    expect(PAGE).toContain('3 · Relatórios');
    expect(PAGE).toContain('semanaDiaFoco');
    expect(PAGE).toContain('sticky top-0 z-sticky');
  });
});
