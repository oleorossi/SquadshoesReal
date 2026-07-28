/**
 * Feriados — helper ÚNICO pra montar o Set de datas usado por Folha, Relatórios
 * (Atrasos/Faltas), absenteísmo e Espelho (M28, auditoria 2026-07-28).
 *
 * Antes cada tela montava o próprio Set com a data CRUA (`holiday_date`), então
 * feriado cadastrado como `recurring` (quick-add nacional grava ano fixo +
 * recurring=true) só valia no ano do cadastro: no ano seguinte o Ponto ainda
 * mostrava feriado (as abas de Ponto expandem por MM-DD), mas a Folha descontava
 * FALTA e o absenteísmo contava dia útil a mais. O Espelho tinha uma 3ª
 * semântica (não expandia recorrente NEM filtrava `optional`).
 *
 * Regra canônica (a MESMA da Folha):
 *  - só feriado OBRIGATÓRIO conta (`optional !== true`);
 *  - feriado `recurring` vale TODO ano: expande o MM-DD pra cada ano tocado
 *    pelo intervalo consultado [from, to];
 *  - feriado não-recorrente vale só na data exata.
 */

export interface HolidayLike {
  holiday_date: string;   // YYYY-MM-DD
  recurring?: boolean;
  optional?: boolean;
}

/**
 * Set de datas concretas (YYYY-MM-DD) dos feriados OBRIGATÓRIOS válidos no
 * intervalo [from, to], com recorrência expandida por ano. Consumidores fazem
 * `.has(date)` — datas expandidas fora do intervalo não atrapalham.
 */
export function buildHolidaySet(
  holidays: HolidayLike[],
  from: string,
  to: string,
): Set<string> {
  const out = new Set<string>();
  const yFrom = Number(String(from || '').slice(0, 4));
  const yTo = Number(String(to || '').slice(0, 4));
  const hasRange = Number.isFinite(yFrom) && Number.isFinite(yTo) && yFrom > 0 && yTo >= yFrom;
  for (const h of holidays || []) {
    if (!h?.holiday_date || h.optional === true) continue;
    if (h.recurring && hasRange) {
      const mmdd = h.holiday_date.slice(5);
      // Expande também no ano do cadastro (pode estar fora do range — inofensivo).
      out.add(h.holiday_date);
      for (let y = yFrom; y <= yTo; y++) out.add(`${y}-${mmdd}`);
    } else {
      out.add(h.holiday_date);
    }
  }
  return out;
}
