// PAINEL — Dashboard geral / home do sistema
function PainelGeral() {
  return (
    <LightShell active="painel" breadcrumb="PAINEL" title="HOJE · 08/05/2026 · QUI" actions={<>
      <button className="btn-l">7 dias</button>
      <button className="btn-l">Mês</button>
    </>}>
      {/* KPIs hero */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Pares hoje',  v: '1.284', s: '+8% vs média', col: 'var(--p-ink)' },
          { l: 'OEE',         v: '87%',   s: 'meta 85%',     col: 'var(--p-ok)' },
          { l: 'FPY',         v: '96,4%', s: 'sem 19',       col: 'var(--p-ok)' },
          { l: 'Refugo',      v: '1,8%',  s: 'meta < 2%',    col: 'var(--p-ink)' },
          { l: 'OPs ativas',  v: '19',    s: '2 atrasadas',  col: 'var(--p-red)' },
          { l: 'Faturado',    v: 'R$ 184k', s: 'hoje',        col: 'var(--p-ink)' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 16 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 36, marginTop: 6, color: k.col }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
        {/* Produção dia a dia */}
        <div className="light-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <div>
              <div className="p-eyebrow">Produção · 14 dias</div>
              <div className="p-display" style={{ fontSize: 22, marginTop: 4 }}>PARES POR DIA</div>
            </div>
            <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>meta diária: 1.300 pares</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, padding: '14px 0', borderBottom: '1px solid var(--p-line)', position: 'relative' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '13%', borderTop: '1px dashed var(--p-red)', opacity: 0.4 }}/>
            {[
              { d: '25/04', v: 1180 }, { d: '26/04', v: 1240 }, { d: '29/04', v: 1320 }, { d: '30/04', v: 1180 },
              { d: '02/05', v: 1240 }, { d: '03/05', v: 1320 }, { d: '04/05', v: 1380 }, { d: '05/05', v: 1280 },
              { d: '06/05', v: 1340 }, { d: '07/05', v: 1380 }, { d: '08/05', v: 1284, today: true },
            ].map((b, i) => (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div className="p-mono" style={{ fontSize: 9, fontWeight: 700 }}>{b.v}</div>
                <div style={{ width: '100%', height: (b.v / 1500) * 140, background: b.today ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                <div className="p-eyebrow" style={{ fontSize: 8 }}>{b.d.split('/')[0]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Status das linhas */}
        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Linhas · agora</div>
          {[
            { id: 'A1', m: 'Mocassim Verona', op: 'OP-2847', tx: 95, st: 'ok' },
            { id: 'A2', m: 'Scarpin Bianca',  op: 'OP-2849', tx: 103, st: 'ok' },
            { id: 'B1', m: 'Sandália Leila',  op: 'OP-2851', tx: 71, st: 'red' },
            { id: 'B2', m: 'Bota Aurora',     op: 'OP-2843', tx: 103, st: 'ok' },
            { id: 'C1', m: 'Tênis Nova',      op: 'OP-2855', tx: 103, st: 'ok' },
            { id: 'C2', m: '—',               op: '—',       tx: 0,   st: 'idle' },
          ].map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 5 ? '1px solid var(--p-line)' : 'none' }}>
              <div className="p-mono" style={{ fontSize: 13, fontWeight: 700, width: 28 }}>{l.id}</div>
              <div style={{ flex: 1, fontSize: 11.5 }}>
                <div style={{ fontWeight: 600 }}>{l.m}</div>
                <div className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>{l.op}</div>
              </div>
              <div style={{ width: 80, height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                <div style={{ height: '100%', width: Math.min(100, l.tx) + '%', background: l.st === 'red' ? 'var(--p-red)' : l.st === 'idle' ? 'transparent' : 'var(--p-ink)' }}/>
              </div>
              <span className="p-mono" style={{ fontSize: 11, fontWeight: 700, width: 38, textAlign: 'right', color: l.st === 'red' ? 'var(--p-red)' : l.st === 'idle' ? 'var(--p-mute)' : 'var(--p-ink)' }}>{l.tx}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas + próximos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18, marginTop: 18 }}>
        <div className="light-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ width: 8, height: 8, background: 'var(--p-red)', borderRadius: '50%' }}/>
            <div className="p-eyebrow">Alertas críticos · 4</div>
          </div>
          {[
            { t: 'Cola PU em ruptura · 2d cobertura', tag: 'ESTOQUE' },
            { t: 'OP-2851 atrasada · 4,5% refugo', tag: 'PRODUÇÃO' },
            { t: 'Cliente Tiana Icaraí · NF venc.', tag: 'FINANCEIRO' },
            { t: 'Prensa PR-3 · 7h paradas semana', tag: 'MANUTENÇÃO' },
          ].map((a, i) => (
            <div key={i} style={{ padding: '8px 10px', marginBottom: 5, background: 'var(--p-red-soft)', borderLeft: '3px solid var(--p-red)' }}>
              <div className="p-eyebrow" style={{ fontSize: 7.5, color: 'var(--p-red)' }}>{a.tag}</div>
              <div style={{ fontSize: 11, marginTop: 2, fontWeight: 500 }}>{a.t}</div>
            </div>
          ))}
        </div>

        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Próximas entregas · 3 dias</div>
          {[
            { d: '09/05', cli: 'VIP Shoes Araruama', pares: 420 },
            { d: '10/05', cli: 'Brioni Calçados',     pares: 280 },
            { d: '10/05', cli: 'Pampas Calçados',     pares: 320 },
            { d: '11/05', cli: 'Centauro Esportes',   pares: 540 },
          ].map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 3 ? '1px dotted var(--p-line-2)' : 'none' }}>
              <div className="p-mono" style={{ fontSize: 12, fontWeight: 700, width: 56, color: i === 0 ? 'var(--p-red)' : 'var(--p-ink)' }}>{e.d}</div>
              <div style={{ flex: 1, fontSize: 11.5, fontWeight: 600 }}>{e.cli}</div>
              <div className="p-mono" style={{ fontSize: 12, fontWeight: 700 }}>{e.pares}</div>
            </div>
          ))}
        </div>

        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Top modelos · semana</div>
          {[
            { m: 'Tênis Nova',      ref: 'I312', pares: 1480, pct: 80 },
            { m: 'Scarpin Bianca',  ref: 'I918', pares: 1420, pct: 76 },
            { m: 'Mocassim Verona', ref: 'I901', pares: 1340, pct: 72 },
            { m: 'Bota Aurora',     ref: 'I422', pares: 1080, pct: 58 },
            { m: 'Sandália Leila',  ref: 'I905', pares: 980,  pct: 53 },
          ].map((m, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600 }}>{m.m}</span>
                  <RefChip code={m.ref} size="sm"/>
                </div>
                <span className="p-mono" style={{ fontSize: 11, fontWeight: 700 }}>{m.pares}</span>
              </div>
              <div style={{ height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                <div style={{ height: '100%', width: m.pct + '%', background: 'var(--p-ink)' }}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </LightShell>
  );
}
window.PainelGeral = PainelGeral;
