/**
 * Relatório Consolidado Semanal — A4 landscape.
 * 6 KPIs, produção dia-a-dia (bar chart custom), top 5 modelos,
 * indicadores das últimas 6 semanas, bloco de destaque.
 *
 * Layout do handoff: `screen-relatorios.jsx → RelSemanal`
 */
import { useMemo } from 'react';
import { format, getISOWeek, startOfWeek, endOfWeek } from 'date-fns';
import { PaperShell, A4Head, A4Foot, Sigs, PrintBar } from '@/components/reports/A4Layout';

export default function RelSemanalA4() {
  const today = format(new Date(), 'dd/MM/yyyy');
  const weekNum = getISOWeek(new Date());
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'dd');
  const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'dd / MM');
  const docNum = useMemo(() => `SEM-W${weekNum}`, [weekNum]);

  const kpis = [
    { l: 'Pares',         v: '6.420',     s: '+4,2%' },
    { l: 'OEE',           v: '87,2%',     s: undefined },
    { l: 'FPY',           v: '96,4%',     s: undefined },
    { l: 'Refugo',        v: '1,8%',      s: undefined },
    { l: 'OPs fechadas',  v: '12',        s: undefined },
    { l: 'Receita',       v: 'R$ 184k',   s: undefined },
  ];

  const dias: Array<{ d: string; v: number; highlight?: boolean }> = [
    { d: 'SEG', v: 1240 },
    { d: 'TER', v: 1320 },
    { d: 'QUA', v: 1284 },
    { d: 'QUI', v: 1380, highlight: true },
    { d: 'SEX', v: 1196 },
  ];

  const modelos: Array<{ nome: string; pares: number; pct: string; refugo: string; status: 'ok' | 'red' }> = [
    { nome: 'Mocassim Verona', pares: 1340, pct: '20,9%', refugo: '1,3%', status: 'ok' },
    { nome: 'Tênis Nova',      pares: 1480, pct: '23,1%', refugo: '1,1%', status: 'ok' },
    { nome: 'Sandália Leila',  pares: 980,  pct: '15,3%', refugo: '4,5%', status: 'red' },
    { nome: 'Bota Aurora',     pares: 1080, pct: '16,8%', refugo: '1,3%', status: 'ok' },
    { nome: 'Scarpin Bianca',  pares: 1420, pct: '22,1%', refugo: '0,8%', status: 'red' },
  ];

  const semanas: Array<[string, number, string, string, string]> = [
    ['W14', 5980, '83%', '94,8%', '2,4%'],
    ['W15', 6120, '85%', '95,2%', '2,1%'],
    ['W16', 6240, '85%', '95,8%', '2,0%'],
    ['W17', 6180, '86%', '96,0%', '1,9%'],
    ['W18', 6160, '86%', '96,2%', '1,9%'],
    ['W19', 6420, '87%', '96,4%', '1,8%'],
  ];

  return (
    <>
      <PrintBar title={`${docNum} · Consolidado Semanal`} />
      <div className="mx-auto mb-4 max-w-4xl rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground print:hidden">
        <strong>Modelo em homologação.</strong> Este relatório contém dados de exemplo e não deve ser usado como documento da fábrica.
      </div>
      <PaperShell landscape>
        {/* O aviso precisa estar na folha: o PDF circula sem a interface. */}
        <div style={{ marginBottom: 12, padding: '8px 10px', background: '#FFF3CD', border: '1px solid #8A5A00', color: '#3D2700', fontSize: 10, fontWeight: 700, lineHeight: 1.35 }}>
          MODELO EM HOMOLOGAÇÃO — contém dados de exemplo. Não usar como documento oficial, para decisão, assinatura ou circulação.
        </div>
        <A4Head
          title="Consolidado Semanal"
          num={`${docNum} · ${weekStart}–${weekEnd}`}
          sub="Produção · Semanal"
          emittedAt={`Emitido ${today}`}
        />

        {/* 6 KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
          {kpis.map((k, i) => (
            <div key={i} className="p-kpi">
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
              {k.s && <div className="sub">{k.s}</div>}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 22 }}>
          {/* Coluna esquerda: produção diária + top modelos */}
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Produção dia a dia</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140, padding: '14px 0', borderBottom: '1px solid var(--p-line)' }}>
              {dias.map((b, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div className="p-mono" style={{ fontSize: 9.5, fontWeight: 700 }}>{b.v.toLocaleString('pt-BR')}</div>
                  <div style={{ width: '100%', height: (b.v / 1500) * 110, background: b.highlight ? 'var(--p-red)' : 'var(--p-ink)' }} />
                  <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{b.d}</div>
                </div>
              ))}
            </div>
            <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 8 }}>
              Meta diária: 1.300 pares · 4 dias acima da meta
            </div>

            <div style={{ marginTop: 22 }}>
              <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Top 5 modelos da semana</div>
              <table className="p-tbl p-tbl-zebra">
                <thead>
                  <tr>
                    <th>Modelo</th>
                    <th className="num">Pares</th>
                    <th className="num">% Total</th>
                    <th className="num">Refugo</th>
                    <th>Status OPs</th>
                  </tr>
                </thead>
                <tbody>
                  {modelos.map((m, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{m.nome}</td>
                      <td className="num">{m.pares.toLocaleString('pt-BR')}</td>
                      <td className="num">{m.pct}</td>
                      <td className="num" style={{
                        color: m.status === 'red' ? 'var(--p-red)' : 'inherit',
                        fontWeight: m.status === 'red' ? 700 : 400,
                      }}>{m.refugo}</td>
                      <td>
                        {i < 4
                          ? <span className="p-pill p-pill-ok">No prazo</span>
                          : <span className="p-pill p-pill-red">Atraso</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Coluna direita: indicadores 6 semanas + destaque */}
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Indicadores · 6 semanas</div>
            <table className="p-tbl p-tbl-zebra">
              <thead>
                <tr>
                  <th>Sem.</th>
                  <th className="num">Pares</th>
                  <th className="num">OEE</th>
                  <th className="num">FPY</th>
                  <th className="num">Refugo</th>
                </tr>
              </thead>
              <tbody>
                {semanas.map((r, i) => (
                  <tr key={i} style={i === semanas.length - 1 ? { background: 'var(--p-red-soft)', fontWeight: 600 } : {}}>
                    <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                    <td className="num">{r[1].toLocaleString('pt-BR')}</td>
                    <td className="num">{r[2]}</td>
                    <td className="num">{r[3]}</td>
                    <td className="num">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 16, padding: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 10.5 }}>
              <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Destaque</div>
              <div style={{ marginTop: 4 }}>
                6ª semana consecutiva de melhoria em OEE e FPY. Sandália Leila concentra
                38% do refugo — investigação em curso.
              </div>
            </div>
          </div>
        </div>

        <Sigs labels={['Supervisor', 'PCP', 'Gerência']} />
        <A4Foot doc={`${docNum} · Consolidado`} landscape page="1 de 1" generatedAt={today} />
      </PaperShell>
    </>
  );
}
