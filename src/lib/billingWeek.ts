/**
 * Conversão entre representação de faturamento (mês + semana) e data ISO.
 *
 * Por que duas representações?
 * - Mês + Semana ("2026-05" + "S4") é como o usuário/comercial raciocina:
 *   "vamos faturar esse pedido na 4ª semana de maio".
 * - delivery_deadline ISO ("2026-05-22") é o que triggers, queries e
 *   funções SQL consomem (cálculo de prazos, ordenação, filtros de data).
 *
 * A regra de conversão: a segunda-feira da semana N do mês. Se a segunda
 * cai no mês anterior, usa o primeiro dia do mês.
 *
 * Antes esta lógica vivia DUPLICADA em SaleOrderFormPanel + MinBillingDateSuggestionDialog,
 * com risco de drift. Centralizado aqui.
 */
export function monthWeekToISODate(monthValue: string, weekValue: string): string | null {
  if (!monthValue || !weekValue) return null;
  const [year, month] = monthValue.split('-').map(Number);
  const weekNum = parseInt(String(weekValue).replace(/\D/g, ''), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(weekNum)) return null;

  const firstDay = new Date(year, month - 1, 1);
  let weekStart = new Date(firstDay);
  const dayOfWeek = weekStart.getDay();
  // Alinha pra segunda-feira da semana 1
  if (dayOfWeek !== 1) {
    weekStart.setDate(weekStart.getDate() - ((dayOfWeek + 6) % 7));
  }
  // Avança N-1 semanas
  weekStart.setDate(weekStart.getDate() + (weekNum - 1) * 7);
  // Clampa: se a segunda cair no mês anterior, usa dia 1 do mês selecionado
  if (weekStart < firstDay) {
    return `${year}-${String(month).padStart(2, '0')}-${String(firstDay.getDate()).padStart(2, '0')}`;
  }
  return `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
}

/**
 * Converte uma data ISO (YYYY-MM-DD) para o par { month: "YYYY-MM", week: "Sn" }
 * que o formulário usa nos campos delivery_month / delivery_week. Inverso de
 * monthWeekToISODate. Necessário porque os handlers de confirmação/override
 * da semana mínima recebem só uma data ISO mas têm que recompor os 2 campos
 * pra não disparar o "selecione o mês de faturamento" no submit subsequente.
 */
export function isoToMonthWeek(iso: string): { month: string; week: string } | null {
  if (!iso) return null;
  const [yStr, mStr, dStr] = iso.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  const target = new Date(year, month - 1, day);
  const firstDay = new Date(year, month - 1, 1);
  // Segunda-feira da semana 1 (mesma regra do monthWeekToISODate).
  const week1 = new Date(firstDay);
  const dow = week1.getDay();
  if (dow !== 1) week1.setDate(week1.getDate() - ((dow + 6) % 7));

  const daysDelta = Math.floor((target.getTime() - week1.getTime()) / 86_400_000);
  const weekNum = Math.max(1, Math.floor(daysDelta / 7) + 1);
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    week: `S${weekNum}`,
  };
}
