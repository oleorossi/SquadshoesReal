/**
 * Relatório Diário de Produção — A4 portrait.
 *
 * Layout fiel ao handoff Novidade (`screen-relatorios.jsx → RelDiario`).
 * Estrutura:
 *   1. Header A4 (brand + título + ID + emitido por)
 *   2. KPIs do dia (4 cards)
 *   3. Tabela "Produção por linha" com totais
 *   4. Bar chart "% da meta por linha"
 *   5. Tabela "Ocorrências do turno"
 *   6. Assinaturas (Líder · Supervisor · Gerência)
 *   7. Footer A4 (ID · versão · paginação)
 *
 * **Como usar com dados reais:**
 *   - Hoje usa mock (mostra o template). Substitua os arrays `linhas`/`barras`/`ocorrencias`
 *     por dados de `useProductionDailyStats()` ou similar.
 *   - O header e footer já consomem props — basta passar `numeroDoc`, `dataEmissao`, `responsavel`.
 */
import { PaperShell, A4Head, A4Foot, Sigs, PrintBar } from '@/components/reports/A4Layout';
import { useMemo } from 'react';
import { format } from 'date-fns';

export default function RelDiarioA4() {
  // Dados mock (substituir por hook real) ─────────────────
  const today = new Date();
  const dataStr = format(today, 'dd/MM/yyyy');
  const numeroDoc = useMemo(() => `RD-${format(today, 'yyyy-MM-dd')}-T1`, [today]);

  const kpis = [
    { l: 'Pares produzidos', v: '1.284', s: '+8.4% vs. média', red: false },
    { l: 'OEE médio',        v: '87,2%', s: 'meta 85%',        red: false },
    { l: 'Refugo',           v: '1,8%',  s: 'meta < 2%',       red: false },
    { l: 'OPs encerradas',   v: '3',     s: '5 em curso',      red: true  },
  ];

  const linhas = [
    { id: 'A1', op: 'OP-2847', modelo: 'Mocassim Verona', meta: 320, real: 304, pct: 95,  oee: 91, refugo: '1,2%' },
    { id: 'A2', op: 'OP-2849', modelo: 'Scarpin Bianca',  meta: 280, real: 288, pct: 103, oee: 94, refugo: '0,8%' },
    { id: 'B1', op: 'OP-2851', modelo: 'Sandália Leila',  meta: 280, real: 198, pct: 71,  oee: 64, refugo: '3,4%', alert: true },
    { id: 'B2', op: 'OP-2843', modelo: 'Bota Aurora',     meta: 180, real: 186, pct: 103, oee: 88, refugo: '1,6%' },
    { id: 'C1', op: 'OP-2855', modelo: 'Tênis Nova',      meta: 300, real: 308, pct: 103, oee: 96, refugo: '1,0%' },
  ];

  const totals = linhas.reduce(
    (acc, l) => ({
      meta: acc.meta + l.meta,
      real: acc.real + l.real,
    }),
    { meta: 0, real: 0 }
  );
  const totalsPctMeta = Math.round((totals.real / totals.meta) * 100);

  const barras = linhas.map((l) => ({ l: `Linha ${l.id}`, v: l.pct, red: l.alert }));

  const ocorrencias = [
    { hora: '10:14', linha: 'B1', tipo: 'warn',   tipoLabel: 'Pausa',  desc: 'Cola fora da temperatura · ajuste de máquina',     dur: '12 min' },
    { hora: '11:42', linha: 'A1', tipo: 'red',    tipoLabel: 'Refugo', desc: '4 pares com defeito de costura · re-trabalho',     dur: '—'      },
    { hora: '14:08', linha: 'C1', tipo: 'ok',     tipoLabel: 'Set-up', desc: 'Troca de modelo · OP-2855 → OP-2858',              dur: '8 min'  },
  ];

  return (
    <>
      <PrintBar title={`${numeroDoc} · Relatório Diário de Produção`} />
      <div className="mx-auto mb-4 max-w-4xl rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground print:hidden">
        <strong>Modelo em homologação.</strong> Este relatório contém dados de exemplo e não deve ser usado como documento da fábrica.
      </div>
      <PaperShell>
        {/* O aviso precisa estar na folha: o PDF circula sem a interface. */}
        <div style={{ marginBottom: 12, padding: '8px 10px', background: '#FFF3CD', border: '1px solid #8A5A00', color: '#3D2700', fontSize: 10, fontWeight: 700, lineHeight: 1.35 }}>
          MODELO EM HOMOLOGAÇÃO — contém dados de exemplo. Não usar como documento oficial, para decisão, assinatura ou circulação.
        </div>
        <A4Head
          title="Relatório Diário"
          num={`${numeroDoc} · Turno 1`}
          sub="Produção · Diário"
          emittedAt={`Emitido ${dataStr}`}
        />

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {kpis.map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
              <div className="sub">{k.s}</div>
            </div>
          ))}
        </div>

        {/* Produção por linha */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Produção por linha</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead>
            <tr>
              <th>Linha</th>
              <th>OP</th>
              <th>Modelo</th>
              <th className="num">Meta</th>
              <th className="num">Realizado</th>
              <th className="num">% Meta</th>
              <th className="num">OEE</th>
              <th className="num">Refugo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((r, i) => (
              <tr key={i} style={r.alert ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700 }}>{r.id}</td>
                <td className="p-mono">{r.op}</td>
                <td style={{ fontWeight: 600 }}>{r.modelo}</td>
                <td className="num">{r.meta}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r.real}</td>
                <td className="num" style={{ color: r.pct < 90 ? 'var(--p-red)' : 'inherit', fontWeight: 600 }}>{r.pct}%</td>
                <td className="num">{r.oee}%</td>
                <td className="num">{r.refugo}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={3} style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>TOTAIS</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>{totals.meta.toLocaleString('pt-BR')}</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>{totals.real.toLocaleString('pt-BR')}</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>{totalsPctMeta}%</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>87%</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>1,8%</td>
            </tr>
          </tbody>
        </table>

        {/* Bar chart visual */}
        <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · % da meta por linha</div>
        {barras.map((b, i) => (
          <div key={i} className="bar-row">
            <div className="lab">{b.l}</div>
            <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: Math.min(100, b.v) + '%' }} /></div>
            <div className="val" style={{ color: b.red ? 'var(--p-red)' : 'inherit' }}>{b.v}%</div>
          </div>
        ))}

        {/* Ocorrências */}
        <div style={{ marginTop: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Ocorrências do turno</div>
          <table className="p-tbl">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Linha</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th className="num">Duração</th>
              </tr>
            </thead>
            <tbody>
              {ocorrencias.map((o, i) => (
                <tr key={i}>
                  <td className="p-mono">{o.hora}</td>
                  <td className="p-mono">{o.linha}</td>
                  <td>
                    <span className={`p-pill ${o.tipo === 'red' ? 'p-pill-red' : o.tipo === 'warn' ? 'p-pill-warn' : 'p-pill-ok'}`}>
                      {o.tipoLabel}
                    </span>
                  </td>
                  <td>{o.desc}</td>
                  <td className="num">{o.dur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Sigs />
        <A4Foot doc={`${numeroDoc} · Diário de Produção`} page="1 de 1" generatedAt={dataStr} />
      </PaperShell>
    </>
  );
}
