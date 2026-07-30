/**
 * Rede de regressão do motor de ponto sobre batidas REAIS de produção.
 *
 * Auditoria de RH 30/07/2026 (`docs/AUDITORIA_RH_PONTO_2026-07-29.md`).
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * Os testes sintéticos de `hourlyPayroll.test.ts` passavam verdes enquanto o motor
 * pagava 21h32 num único dia, porque nenhum caso REAL estava travado. Aqui o corpus
 * é o dado de produção: se alguém mexer em `splitDayMinutes`, a falha diz QUAL padrão
 * de pareamento mudou e em QUANTOS MINUTOS — não só "quebrou".
 *
 * COMO ATUALIZAR quando a mudança for INTENCIONAL
 * Não ajuste os números no olho. Rode o motor sobre o corpus, confira bucket a bucket
 * se o delta é o que você queria, e só então atualize — registrando no comentário do
 * bucket qual decisão mudou e de que data. Minuto que muda aqui é minuto que muda no
 * contracheque de alguém.
 */
import { describe, it, expect } from 'vitest';
import { splitDayMinutes } from '../hourlyPayroll';
import { PUNCHES_REAIS, TODAS_AS_BATIDAS } from './fixtures/punchesReais';

const QUARTA = 3;
const SABADO = 6;

/** Baseline capturado em 30/07/2026, já com a decisão do dono de ímpar → pendência. */
const BASELINE = [
  { bucket: 'n1',       dias: 12, utilNormal: 0,    utilPremium: 0,    pendentes: 12 },
  { bucket: 'n3',       dias: 14, utilNormal: 0,    utilPremium: 0,    pendentes: 14 },
  { bucket: 'impar5',   dias: 11, utilNormal: 0,    utilPremium: 0,    pendentes: 11 },
  { bucket: 'n2_cruza', dias: 13, utilNormal: 8723, utilPremium: 3039, pendentes: 0 },
  { bucket: 'n2_seco',  dias: 12, utilNormal: 3914, utilPremium: 1527, pendentes: 0 },
  { bucket: 'par4',     dias: 12, utilNormal: 6801, utilPremium: 3157, pendentes: 0 },
  { bucket: 'par6',     dias: 14, utilNormal: 7104, utilPremium: 625,  pendentes: 0 },
] as const;

function medir(batidas: string[][], dow: number) {
  let normal = 0, premium = 0, pendentes = 0;
  for (const p of batidas) {
    const r = splitDayMinutes(p, dow, false);
    normal += r.normal; premium += r.premium;
    if (r.incomplete) pendentes++;
  }
  return { normal, premium, pendentes };
}

describe('splitDayMinutes — corpus real de produção', () => {
  it('o corpus cobre os 7 padrões de pareamento e não encolheu', () => {
    expect(PUNCHES_REAIS.map(b => b.bucket)).toEqual(BASELINE.map(b => b.bucket));
    expect(TODAS_AS_BATIDAS.length).toBe(88);
  });

  for (const esperado of BASELINE) {
    it(`bucket ${esperado.bucket}: minutos e pendências estáveis`, () => {
      const bucket = PUNCHES_REAIS.find(b => b.bucket === esperado.bucket)!;
      expect(bucket.batidas.length).toBe(esperado.dias);
      const r = medir(bucket.batidas, QUARTA);
      expect({ normal: r.normal, premium: r.premium, pendentes: r.pendentes }).toEqual({
        normal: esperado.utilNormal,
        premium: esperado.utilPremium,
        pendentes: esperado.pendentes,
      });
    });
  }

  it('todo dia com nº ÍMPAR de batidas é pendência e não paga nada', () => {
    // Trava a decisão do dono de 30/07/2026 (auditoria D1/P2) contra os dados reais:
    // antes, ímpar ≥5 pagava o intervalo da 1ª à última batida.
    const impares = TODAS_AS_BATIDAS.filter(p => p.length % 2 !== 0);
    expect(impares.length).toBe(37);
    for (const p of impares) {
      const r = splitDayMinutes(p, QUARTA, false);
      expect(r, `esperava pendência em ${JSON.stringify(p)}`).toEqual({
        normal: 0, premium: 0, incomplete: true,
      });
    }
  });

  it('o dia da semana muda só a classificação, nunca o total trabalhado', () => {
    // Sábado joga tudo pra premium; a SOMA tem que ser idêntica à da quarta.
    // Se um dia isso divergir, alguém introduziu pagamento dependente do calendário
    // dentro do split — que é onde mora a dupla contagem.
    for (const b of PUNCHES_REAIS) {
      const util = medir(b.batidas, QUARTA);
      const sab = medir(b.batidas, SABADO);
      expect(sab.normal, `sábado não pode ter minuto normal (${b.bucket})`).toBe(0);
      expect(sab.premium, `total de sábado ≠ total de quarta (${b.bucket})`)
        .toBe(util.normal + util.premium);
    }
  });

  it('nenhum dia real paga mais que o intervalo entre a 1ª e a última batida', () => {
    // Teto de plausibilidade: sem isto, um array com batida de madrugada paga a noite toda.
    const toMin = (t: string) => {
      const [h, m] = t.replace(/[^\d:]/g, '').split(':').map(Number);
      return h * 60 + m;
    };
    for (const p of TODAS_AS_BATIDAS) {
      const r = splitDayMinutes(p, QUARTA, false);
      if (r.incomplete) continue;
      const mins = p.map(toMin);
      const span = Math.max(...mins) - Math.min(...mins);
      expect(r.normal + r.premium, `${JSON.stringify(p)} pagou acima do intervalo`)
        .toBeLessThanOrEqual(span);
    }
  });
});
