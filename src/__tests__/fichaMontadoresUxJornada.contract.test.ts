import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(
  resolve(__dirname, '../pages/FichaMontadoresPage.tsx'),
  'utf8',
);
const JORNADA = readFileSync(
  resolve(__dirname, '../components/ficha-montadores/FichaJornadaTrail.tsx'),
  'utf8',
);
const HOME = readFileSync(
  resolve(__dirname, '../components/ficha-montadores/FichaRelatoriosHome.tsx'),
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
    expect(PAGE).toContain('FichaJornadaTrail');
    expect(JORNADA).toContain('Jornada da ficha');
    expect(JORNADA).toContain('1 · Lançar');
    expect(JORNADA).toContain('2 · Conferir / pagar');
    expect(JORNADA).toContain('3 · Relatórios');
    expect(PAGE).toContain('semanaDiaFoco');
    expect(PAGE).toContain('sticky top-0 z-sticky');
    // PCP no dia seguinte: Lançar abre em Semana (spec montagem-solagem-produtividade G6).
    expect(PAGE).toContain('useState<ChamadaView>("semana")');
    expect(PAGE).toContain('missingWeekdayIsos');
    expect(PAGE).toContain('pessoasComFalta');
  });

  it('abre na home Relatórios (dono) e carrega M+S juntos', () => {
    expect(PAGE).toContain('defaultValue: "producao"');
    expect(PAGE).toContain('FichaRelatoriosHome');
    expect(PAGE).toContain('compareMontagemSolagem');
    expect(PAGE).toContain('.in("setor", [SETOR_MONTAGEM, SETOR_SOLAGEM])');
    expect(HOME).toContain('data-ficha-modulo="relatorios"');
    expect(HOME).toContain('FichaMxSFaixa');
    expect(HOME).toContain('Total do período · M+S');
  });
});
