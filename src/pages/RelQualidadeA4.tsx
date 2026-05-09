/**
 * Relatório de Qualidade / FPY — A4 portrait.
 * 4 KPIs, defeitos por categoria, Pareto top-5, ações corretivas.
 *
 * Layout do handoff: `screen-relatorios.jsx → RelQualidade`
 */
import { useMemo } from 'react';
import { format, getISOWeek } from 'date-fns';
import { PaperShell, A4Head, A4Foot, Sigs, PrintBar } from '@/components/reports/A4Layout';

export default function RelQualidadeA4() {
  const today = format(new Date(), 'dd/MM/yyyy');
  const weekNum = getISOWeek(new Date());
  const docNum = useMemo(() => `QC-W${weekNum}`, [weekNum]);

  const kpis = [
    { l: 'FPY semanal', v: '96,4%', red: false },
    { l: 'Inspeções',   v: '6.420', red: false },
    { l: 'Reprovados',  v: '231',   red: true  },
    { l: 'Re-trabalho', v: '187',   red: false },
  ];

  const defeitos: Array<[string, string, number, string, string]> = [
    ['Costura aberta',     'Costura',    78, '33,8%', '+8'],
    ['Cola má aplicação',  'Montagem',   44, '19,0%', '−2'],
    ['Risco no verniz',    'Acabamento', 38, '16,5%', '+4'],
    ['Furo descentrado',   'Corte',      31, '13,4%', '0'],
    ['Solado solto',       'Montagem',   22, '9,5%',  '−5'],
    ['Embalagem trocada',  'Embalagem',  12, '5,2%',  '+1'],
    ['Outros',             '—',           6, '2,6%',  '−1'],
  ];

  const pareto: Array<{ l: string; v: number; red?: boolean }> = [
    { l: 'Costura aberta',    v: 33.8, red: true },
    { l: 'Cola má aplicação', v: 19.0 },
    { l: 'Risco no verniz',   v: 16.5 },
    { l: 'Furo descentrado',  v: 13.4 },
    { l: 'Solado solto',      v: 9.5  },
  ];

  const acoes: Array<{ acao: string; resp: string; prazo: string; status: 'warn' | 'ok' | 'open' }> = [
    { acao: 'Treinar 4 costureiras turno B em ponto reforçado',  resp: 'Marcia L.',   prazo: '15/05', status: 'warn' },
    { acao: 'Calibrar máquina de cola linha B1',                 resp: 'Manutenção',  prazo: '12/05', status: 'ok'   },
    { acao: 'Revisar lote de verniz adocicado fornecedor X',     resp: 'Suprimentos', prazo: '14/05', status: 'open' },
  ];

  function statusPill(s: 'warn' | 'ok' | 'open') {
    if (s === 'ok')   return <span className="p-pill p-pill-ok">Concluído</span>;
    if (s === 'warn') return <span className="p-pill p-pill-warn">Em curso</span>;
    return <span className="p-pill">Aberta</span>;
  }

  return (
    <>
      <PrintBar title={`${docNum} · Qualidade · FPY`} />
      <PaperShell>
        <A4Head
          title="Qualidade · FPY"
          num={`${docNum} · Semana ${weekNum}`}
          sub="Qualidade · FPY"
          emittedAt={`Emitido ${today}`}
        />

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {kpis.map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        {/* Defeitos por categoria */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Defeitos por categoria</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead>
            <tr>
              <th>Defeito</th>
              <th>Etapa</th>
              <th className="num">Qtd</th>
              <th className="num">% total</th>
              <th className="num">Tendência S-1</th>
            </tr>
          </thead>
          <tbody>
            {defeitos.map((r, i) => {
              const t = r[4];
              const trendColor =
                t.startsWith('+') ? 'var(--p-red)' :
                t.startsWith('−') ? 'var(--p-ok)' :
                'var(--p-mute)';
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{r[0]}</td>
                  <td>{r[1]}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{r[2]}</td>
                  <td className="num">{r[3]}</td>
                  <td className="num" style={{ color: trendColor }}>{t}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pareto top-5 */}
        <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · Pareto · top 5 defeitos</div>
        {pareto.map((b, i) => (
          <div key={i} className="bar-row">
            <div className="lab">{b.l}</div>
            <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: (b.v / 35) * 100 + '%' }} /></div>
            <div className="val">{b.v}%</div>
          </div>
        ))}

        {/* Ações corretivas */}
        <div style={{ marginTop: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Ações corretivas em curso</div>
          <table className="p-tbl">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Responsável</th>
                <th>Prazo</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {acoes.map((a, i) => (
                <tr key={i}>
                  <td>{a.acao}</td>
                  <td>{a.resp}</td>
                  <td className="p-mono">{a.prazo}</td>
                  <td>{statusPill(a.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Sigs labels={['Líder QC', 'Supervisor', 'Gerência']} />
        <A4Foot doc={`${docNum} · Qualidade`} page="1 de 1" generatedAt={today} />
      </PaperShell>
    </>
  );
}
