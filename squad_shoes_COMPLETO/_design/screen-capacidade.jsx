// PRODUÇÃO · CAPACIDADE — análise de carga vs disponibilidade por linha/etapa/turno
function ProducaoCapacidade() {
  const matriz = [
    { etapa: 'CORTE',      cap: 2400, plan: 1980, util: 82 },
    { etapa: 'COSTURA',    cap: 1920, plan: 2120, util: 110 },
    { etapa: 'MONTAGEM',   cap: 1680, plan: 1640, util: 98 },
    { etapa: 'ACABAMENTO', cap: 1440, plan: 1280, util: 89 },
    { etapa: 'EMBALAGEM',  cap: 1800, plan: 1620, util: 90 },
  ];
  return (
    <LightShell active="cap" breadcrumb="PRODUÇÃO · CAPACIDADE" title="ANÁLISE DE CAPACIDADE · SEM 19">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Capacidade semanal', v: '9.240', s: 'pares teóricos' },
          { l: 'Planejado',          v: '8.640', s: '94% de uso' },
          { l: 'Gargalo',            v: 'COSTURA', s: '110% sobrecarga', red: true },
          { l: 'Ociosidade',         v: 'CORTE',  s: '18% livre' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 26, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 12 }}>01 · Carga por etapa</div>
          {matriz.map((m, i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em' }}>{m.etapa}</span>
                <span className="p-mono" style={{ fontSize: 10.5, fontWeight: 700, color: m.util > 100 ? 'var(--p-red)' : m.util > 95 ? 'var(--p-warn)' : 'var(--p-ink)' }}>{m.util}%</span>
              </div>
              <div style={{ position: 'relative', height: 18, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                <div style={{ position: 'absolute', left: '100%', top: -3, bottom: -3, width: 1.5, background: 'var(--p-ink)' }}/>
                <div style={{ height: '100%', width: Math.min(120, m.util) + '%', background: m.util > 100 ? 'var(--p-red)' : 'var(--p-ink)' }}/>
              </div>
              <div className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)', marginTop: 3, display: 'flex', justifyContent: 'space-between' }}>
                <span>Planejado: {m.plan} pares</span>
                <span>Capacidade: {m.cap}</span>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 18, padding: 12, background: 'var(--p-red-soft)', border: '1px solid var(--p-red)', fontSize: 11 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Plano de balanceamento</div>
            <div style={{ marginTop: 4 }}>Costura está 110% sobrecarregada. Sugestão: alocar 2 costureiras do turno B em hora extra OU mover OP-2867 para semana 20.</div>
          </div>
        </div>

        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 12 }}>02 · Carga por linha · turno</div>
          <table className="p-tbl">
            <thead><tr>
              <th>Linha</th><th>Etapa</th><th className="num">T1</th><th className="num">T2</th><th className="num">Total</th><th>Util</th>
            </tr></thead>
            <tbody>
              {[
                ['A1', 'COSTURA',    480, 360, 840, 95],
                ['A2', 'COSTURA',    420, 420, 840, 103],
                ['B1', 'MONTAGEM',   320, 240, 560, 71, true],
                ['B2', 'ACABAMENTO', 360, 280, 640, 92],
                ['C1', 'EMBALAGEM',  420, 320, 740, 97],
                ['C2', '—',          0,   0,   0,   0, true],
              ].map((r, i) => (
                <tr key={i} style={r[6] ? { background: 'var(--p-red-soft)' } : {}}>
                  <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                  <td><span className="p-mono" style={{ fontSize: 9.5, letterSpacing: '0.06em' }}>{r[1]}</span></td>
                  <td className="num"><span className="p-mono">{r[2]}</span></td>
                  <td className="num"><span className="p-mono">{r[3]}</span></td>
                  <td className="num" style={{ fontWeight: 700 }}>{r[4]}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <div style={{ flex: 1, height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                        <div style={{ height: '100%', width: Math.min(100, r[5]) + '%', background: r[5] > 100 ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                      </div>
                      <span className="p-mono" style={{ fontSize: 9.5, width: 28, textAlign: 'right', fontWeight: 700, color: r[5] === 0 ? 'var(--p-red)' : r[5] > 100 ? 'var(--p-red)' : 'inherit' }}>{r[5]}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </LightShell>
  );
}
window.ProducaoCapacidade = ProducaoCapacidade;
