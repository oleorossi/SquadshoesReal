/**
 * Guard de harmonização TS↔SQL do MOTOR DE TIMELINE DE ONDAS (lado SQL).
 *
 * Cumpre a promessa do comentário em src/lib/__tests__/forwardSchedule.test.ts
 * ("a paridade TS×SQL completa exige rodar compute_wave_timeline no banco —
 *  coberta por integração com RUN_DB_INTEGRATION"). Até a auditoria 2026-06-29
 * essa integração NÃO existia — qualquer divergência SQL↔frontend (a dívida
 * histórica D2/D3) reabriria sem rede de proteção.
 *
 * Por padrão é SKIP (não roda no CI sem env). Para executar localmente:
 *   RUN_DB_INTEGRATION=1 PGHOST=... bunx vitest run \
 *     src/services/__tests__/waveTimeline.parity.test.ts
 *
 * Trava os INVARIANTES estruturais do motor paralelo (espelham
 * computeParallelWindows no lado TS):
 *   - todos os 4 setores prep (Corte Palmilha ‖ Corte Forração ‖ Aviamento ‖
 *     Costura) começam EM OU ANTES do início da cadeia sequencial (silk_start) —
 *     ou seja, Costura é prep paralela, não sequencial;
 *   - a cadeia sequencial é monotônica: silk ≤ colagem ≤ montagem ≤ solagem ≤
 *     acabamento ≤ acabamento_end (= deadline);
 *   - material_ready_date ≤ início de prep mais cedo (recuo do buffer);
 *   - purchase_deadline ≤ material_ready_date (recuo do lead de fornecedor).
 *
 * Uma regressão que re-serialize a Costura, inverta a agregação MAX↔soma ou
 * quebre a janela de compra faz um destes asserts falhar.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const ENABLED = process.env.RUN_DB_INTEGRATION === '1';

function q(sql: string): string[][] {
  const out = execSync(`psql -t -A -F '|' -c "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean).map((l) => l.split('|'));
}

(ENABLED ? describe : describe.skip)('wave timeline — paridade estrutural SQL', () => {
  it('compute_wave_timeline respeita a topologia prep-paralelo + sequencial', () => {
    // Pega um PV real com deadline (qualquer um serve — o motor é determinístico).
    const ids = q(`SELECT id FROM sale_orders WHERE delivery_deadline IS NOT NULL ORDER BY created_at DESC LIMIT 1;`);
    expect(ids.length, 'nenhum sale_order com delivery_deadline pra exercitar o motor').toBeGreaterThan(0);
    const id = ids[0][0];

    const rows = q(
      `SELECT corte_palmilha_start_date, corte_forracao_start_date, costura_start_date, ` +
      `mesa_start_date, silk_start_date, colagem_start_date, montagem_start_date, ` +
      `solagem_start_date, acabamento_start_date, acabamento_end_date, ` +
      `material_ready_date, purchase_deadline ` +
      `FROM compute_wave_timeline(ARRAY['${id}']::uuid[]);`,
    );
    expect(rows.length).toBe(1);
    const [palm, forr, cost, mesa, silk, cola, mont, sola, acab, acabEnd, matReady, purchase] =
      rows[0].map((v) => (v ? new Date(v) : null));

    const t = (d: Date | null) => (d ? d.getTime() : NaN);
    // Prep paralelo: todos os 4 prep ≤ silk_start (início do sequencial).
    for (const p of [palm, forr, cost, mesa]) {
      if (p && silk) expect(t(p)).toBeLessThanOrEqual(t(silk));
    }
    // Cadeia sequencial monotônica até o deadline.
    const seq = [silk, cola, mont, sola, acab, acabEnd].filter(Boolean) as Date[];
    for (let i = 1; i < seq.length; i++) expect(t(seq[i])).toBeGreaterThanOrEqual(t(seq[i - 1]));
    // Janela de compra: purchase ≤ material_ready ≤ prep mais cedo.
    const earliestPrep = Math.min(...[palm, forr, cost, mesa].filter(Boolean).map((d) => t(d as Date)));
    if (matReady) expect(t(matReady)).toBeLessThanOrEqual(earliestPrep);
    if (matReady && purchase) expect(t(purchase)).toBeLessThanOrEqual(t(matReady));
  });
});
