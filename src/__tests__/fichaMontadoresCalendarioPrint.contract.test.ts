import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(
  resolve(__dirname, '../pages/FichaMontadoresPage.tsx'),
  'utf8',
);

describe('contrato — calendário impresso da Ficha de Montadores', () => {
  it('imprime em semanas legíveis (nunca faixa de 30+ dias numa linha)', () => {
    expect(PAGE).toContain('week-label');
    expect(PAGE).toContain('semanasDoPeriodo');
    expect(PAGE).toContain('Grade em <b>semanas (seg–dom)</b>');
    // Legado "código de barras": classes de densidade por nº de dias.
    expect(PAGE).not.toContain('cal-lg');
    expect(PAGE).not.toContain('cal-md');
    expect(PAGE).not.toContain('borda esquerda = início da semana');
  });

  it('diferencia dia sem lançamento de célula quebrada', () => {
    // Traço visível + legenda explícita — color:transparent escondia o vazio.
    expect(PAGE).toContain('<span class="z">—</span>');
    expect(PAGE).toContain('sem lançamento</b> naquele dia');
    expect(PAGE).toContain('.cal td.c.empty{color:#bbb;background:#fafaf8}');
    expect(PAGE).not.toMatch(/\.cal td\.c\.empty\{color:transparent/);
  });

  it('normaliza dia pra YYYY-MM-DD ao carregar e ao montar o calendário', () => {
    expect(PAGE).toContain('dia: String(f.dia ?? "").slice(0, 10)');
    expect(PAGE).toContain('const dia = String(f.dia ?? "").slice(0, 10)');
  });
});
