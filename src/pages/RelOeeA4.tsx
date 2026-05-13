/**
 * Relatório de OEE Semanal — A4 landscape.
 * 6 KPIs no topo, tabela "OEE por linha" com sparkline + lista de causas
 * de perda e bloco "foco da semana".
 *
 * Layout do handoff: `screen-relatorios.jsx → RelOEE`
 */
import { format, startOfWeek, getISOWeek } from 'date-fns';
import { useMemo } from 'react';
import { PaperShell, A4Head, A4Foot, Sigs, PrintBar } from '@/components/reports/A4Layout';

export default function RelOeeA4() {
  const today = format(new Date(), 'dd/MM/yyyy');
  const weekNum = getISOWeek(new Date());
  const docNum = useMemo(() => `REL-OEE-W${weekNum}`, [weekNum]);

  const kpis = [
    { l: 'OEE Geral',       v: '87,2%' },
    { l: 'Disponibilidade', v: '94,1%' },
    { l: 'Performance',     v: '91,8%' },
    { l: 'Qualidade',       v: '98,2%' },
    { l: 'Pares totais',    v: '6.420' },
    { l: 'Horas operadas',  v: '241h' },
  ];

  const linhas: Array<{ id: string; disp: number; perf: number; qual: number; oee: number; pares: number; trend: number[]; alert?: boolean }> = [
    { id: 'A1', disp: 96, perf: 94, qual: 99, oee: 90, pares: 1340, trend: [80, 82, 85, 87, 88, 90] },
    { id: 'A2', disp: 97, perf: 96, qual: 99, oee: 92, pares: 1420, trend: [88, 89, 90, 91, 92, 92] },
    { id: 'B1', disp: 84, perf: 82, qual: 97, oee: 67, pares: 980,  trend: [78, 75, 72, 70, 68, 67], alert: true },
    { id: 'B2', disp: 95, perf: 91, qual: 98, oee: 85, pares: 1080, trend: [82, 83, 84, 85, 85, 85] },
    { id: 'C1', disp: 98, perf: 96, qual: 99, oee: 93, pares: 1480, trend: [88, 90, 91, 92, 93, 93] },
    { id: 'C2', disp: 0,  perf: 0,  qual: 0,  oee: 0,  pares: 0,    trend: [60, 55, 40, 20, 10, 0],  alert: true },
  ];

  const causas = [
    { l: 'Falta de material',     v: 28, h: 'h', red: true },
    { l: 'Set-up / troca',        v: 18, h: 'h' },
    { l: 'Manutenção',            v: 12, h: 'h' },
    { l: 'Refugo / re-trabalho',  v: 9,  h: 'h' },
    { l: 'Ajuste de cola',        v: 6,  h: 'h' },
    { l: 'Outros',                v: 4,  h: 'h' },
  ];

  function renderSparkline(data: number[], red?: boolean) {
    const max = 100;
    const pts = data
      .map((v, j) => `${(j / (data.length - 1)) * 80},${20 - (v / max) * 18}`)
      .join(' ');
    return (
      <svg width="80" height="20">
        <polyline points={pts} fill="none" stroke={red ? '#B7141F' : '#14110E'} strokeWidth="1.2" />
      </svg>
    );
  }

  return (
    <>
      <PrintBar title={`${docNum} · OEE Semanal`} />
      <PaperShell landscape>
        <A4Head
          title="Eficiência (OEE)"
          num={`${docNum} · Semana ${weekNum}`}
          sub="Produção · OEE Semanal"
          emittedAt={`Emitido ${today}`}
        />

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
          {kpis.map((k, i) => (
            <div key={i} className="p-kpi">
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 22 }}>
          {/* Tabela OEE por linha */}
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · OEE por linha · semana {weekNum}</div>
            <table className="p-tbl p-tbl-zebra">
              <thead>
                <tr>
                  <th>Linha</th>
                  <th className="num">Disp.</th>
                  <th className="num">Perf.</th>
                  <th className="num">Qual.</th>
                  <th className="num">OEE</th>
                  <th className="num">Pares</th>
                  <th>Tendência</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((r, i) => (
                  <tr key={i} style={r.alert ? { background: 'var(--p-red-soft)' } : {}}>
                    <td className="p-mono" style={{ fontWeight: 700 }}>{r.id}</td>
                    <td className="num">{r.disp}%</td>
                    <td className="num">{r.perf}%</td>
                    <td className="num">{r.qual}%</td>
                    <td className="num" style={{ fontWeight: 700, color: r.oee < 75 ? 'var(--p-red)' : 'inherit' }}>{r.oee}%</td>
                    <td className="num">{r.pares.toLocaleString('pt-BR')}</td>
                    <td>{renderSparkline(r.trend, r.alert)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Causas de perda */}
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Causas de perda</div>
            {causas.map((b, i) => (
              <div key={i} className="bar-row">
                <div className="lab">{b.l}</div>
                <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: (b.v / 30) * 100 + '%' }} /></div>
                <div className="val">{b.v}{b.h}</div>
              </div>
            ))}

            <div style={{ marginTop: 16, padding: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 10.5 }}>
              <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Foco da semana</div>
              <div style={{ marginTop: 4 }}>
                Reduzir paradas por <strong>falta de material</strong> revisando ponto de pedido de verniz adocicado e cola PU.
              </div>
            </div>
          </div>
        </div>

        <Sigs labels={['Supervisor', 'PCP', 'Gerência']} />
        <A4Foot doc={docNum} landscape page="1 de 1" generatedAt={today} />
      </PaperShell>
    </>
  );
}
