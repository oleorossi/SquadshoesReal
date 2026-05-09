/**
 * Relatório de Refugo & Re-trabalho — A4 portrait.
 * 4 KPIs, refugo por linha (com destaque vermelho > 2%), refugo por etapa
 * (bar chart), custo R$ por categoria (tabela com total invertido).
 *
 * Layout do handoff: `screen-relatorios.jsx → RelRefugo`
 */
import { useMemo } from 'react';
import { format, getISOWeek } from 'date-fns';
import { PaperShell, A4Head, A4Foot, Sigs, PrintBar } from '@/components/reports/A4Layout';

export default function RelRefugoA4() {
  const today = format(new Date(), 'dd/MM/yyyy');
  const weekNum = getISOWeek(new Date());
  const docNum = useMemo(() => `REF-W${weekNum}`, [weekNum]);

  const kpis = [
    { l: 'Refugo total',   v: '1,8%',     s: 'meta < 2%', red: false },
    { l: 'Pares perdidos', v: '116',      s: undefined,   red: true  },
    { l: 'Custo refugo',   v: 'R$ 4.290', s: undefined,   red: true  },
    { l: 'Re-trabalho',    v: 'R$ 1.870', s: undefined,   red: false },
  ];

  const linhas: Array<{ id: string; op: string; pairs: number; refugo: number; pct: string; custo: string; causa: string; alert?: boolean }> = [
    { id: 'A1', op: 'OP-2847', pairs: 1340, refugo: 18, pct: '1,3%', custo: 'R$ 510',   causa: 'Costura aberta' },
    { id: 'A2', op: 'OP-2849', pairs: 1420, refugo: 12, pct: '0,8%', custo: 'R$ 332',   causa: 'Furo descentrado' },
    { id: 'B1', op: 'OP-2851', pairs: 980,  refugo: 44, pct: '4,5%', custo: 'R$ 1.628', causa: 'Cola má aplicação', alert: true },
    { id: 'B2', op: 'OP-2843', pairs: 1080, refugo: 14, pct: '1,3%', custo: 'R$ 392',   causa: 'Risco no verniz' },
    { id: 'C1', op: 'OP-2855', pairs: 1480, refugo: 16, pct: '1,1%', custo: 'R$ 480',   causa: 'Embalagem trocada' },
    { id: '—',  op: '—',       pairs: 120,  refugo: 12, pct: '10%',  custo: 'R$ 948',   causa: 'Set-up / curva',   alert: true },
  ];

  const refugoEtapa: Array<{ l: string; v: number; red?: boolean }> = [
    { l: 'Corte',      v: 0.6 },
    { l: 'Costura',    v: 1.4, red: true },
    { l: 'Montagem',   v: 1.0 },
    { l: 'Acabamento', v: 0.8 },
    { l: 'Embalagem',  v: 0.2 },
  ];

  const custos: Array<[string, string]> = [
    ['Material perdido',  'R$ 1.890'],
    ['Mão de obra perdida', 'R$ 1.420'],
    ['Re-trabalho',       'R$ 1.870'],
  ];

  return (
    <>
      <PrintBar title={`${docNum} · Refugo & Re-trabalho`} />
      <PaperShell>
        <A4Head
          title="Refugo & Re-trabalho"
          num={`${docNum} · Semana ${weekNum}`}
          sub="Qualidade · Refugo"
          emittedAt={`Emitido ${today}`}
        />

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {kpis.map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
              {k.s && <div className="sub">{k.s}</div>}
            </div>
          ))}
        </div>

        {/* Refugo por linha */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Refugo por linha · semana {weekNum}</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead>
            <tr>
              <th>Linha</th>
              <th>OP</th>
              <th className="num">Pares</th>
              <th className="num">Refugo</th>
              <th className="num">% Refugo</th>
              <th className="num">Custo</th>
              <th>Causa principal</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((r, i) => {
              const pctNum = parseFloat(r.pct.replace(',', '.'));
              const pctOver = pctNum > 2;
              return (
                <tr key={i} style={r.alert ? { background: 'var(--p-red-soft)' } : {}}>
                  <td className="p-mono" style={{ fontWeight: 700 }}>{r.id}</td>
                  <td className="p-mono">{r.op}</td>
                  <td className="num">{r.pairs.toLocaleString('pt-BR')}</td>
                  <td className="num" style={{ fontWeight: 600, color: r.alert ? 'var(--p-red)' : 'inherit' }}>{r.refugo}</td>
                  <td className="num" style={{ fontWeight: 600, color: pctOver ? 'var(--p-red)' : 'inherit' }}>{r.pct}</td>
                  <td className="num">{r.custo}</td>
                  <td>{r.causa}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Refugo por etapa + Custo R$ por categoria */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · Refugo por etapa (%)</div>
            {refugoEtapa.map((b, i) => (
              <div key={i} className="bar-row">
                <div className="lab">{b.l}</div>
                <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: (b.v / 1.5) * 100 + '%' }} /></div>
                <div className="val">{b.v}%</div>
              </div>
            ))}
          </div>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>03 · Custo R$ por categoria</div>
            <table className="p-tbl">
              <tbody>
                {custos.map((r, i) => (
                  <tr key={i}><td>{r[0]}</td><td className="num">{r[1]}</td></tr>
                ))}
                <tr style={{ background: 'var(--p-ink)', color: 'white' }}>
                  <td style={{ fontWeight: 700, letterSpacing: '0.04em' }}>TOTAL</td>
                  <td className="num" style={{ fontWeight: 700 }}>R$ 5.180</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <Sigs />
        <A4Foot doc={`${docNum} · Refugo & Re-trabalho`} page="1 de 1" generatedAt={today} />
      </PaperShell>
    </>
  );
}
