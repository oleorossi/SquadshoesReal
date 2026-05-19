// PRODUÇÃO · PCP — fila + capacidade por linha + carga semanal
function ProducaoPCP() {
  const fila = [
    { op: 'OP-2847', m: MODELOS['I901'], pares: 420, linha: 'A1', etapa: 'COSTURA',    prog: 62, due: '08/05', st: 'urgent' },
    { op: 'OP-2849', m: MODELOS['I918'], pares: 280, linha: 'A2', etapa: 'CORTE',      prog: 28, due: '10/05', st: 'ok' },
    { op: 'OP-2851', m: MODELOS['I905'], pares: 540, linha: 'B1', etapa: 'MONTAGEM',   prog: 78, due: '12/05', st: 'ok' },
    { op: 'OP-2855', m: MODELOS['I901'], pares: 320, linha: 'C1', etapa: 'EMBALAGEM',  prog: 96, due: '07/05', st: 'ok' },
    { op: 'OP-2858', m: MODELOS['I905'], pares: 240, linha: '—',  etapa: 'FILA',       prog: 0,  due: '14/05', st: 'queue' },
    { op: 'OP-2861', m: MODELOS['I918'], pares: 180, linha: '—',  etapa: 'FILA',       prog: 0,  due: '15/05', st: 'queue' },
  ];
  const linhas = [
    { id: 'A1', cap: 320, plan: 304, util: 95, op: 'OP-2847' },
    { id: 'A2', cap: 280, plan: 288, util: 103, op: 'OP-2849' },
    { id: 'B1', cap: 280, plan: 198, util: 71, op: 'OP-2851', red: true },
    { id: 'B2', cap: 180, plan: 186, util: 103, op: 'OP-2843' },
    { id: 'C1', cap: 300, plan: 308, util: 103, op: 'OP-2855' },
    { id: 'C2', cap: 200, plan: 0,   util: 0,   op: '—', red: true },
  ];
  return (
    <LightShell active="pcp" breadcrumb="PRODUÇÃO · PCP" title="PCP · PLANEJAMENTO" actions={<>
      <button className="btn-l">Importar</button>
      <button className="btn-l-red btn-l">+ Sequenciar OPs</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { l: 'OPs ativas',   v: '19',  s: '6 linhas' },
          { l: 'Em fila',      v: '7',   s: 'pares: 1.840' },
          { l: 'Atrasadas',    v: '2',   s: 'recuperar', red: true },
          { l: 'Carga vs cap', v: '94%', s: 'meta 90%' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
        <div className="light-card" style={{ padding: 20 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>01 · Fila de produção · 6 próximas</div>
          <table className="p-tbl p-tbl-zebra">
            <thead><tr>
              <th>OP</th><th>Modelo · REF</th><th>Cor</th><th className="num">Pares</th><th>Linha</th><th>Etapa</th><th>Prog.</th><th>Prazo</th>
            </tr></thead>
            <tbody>
              {fila.map((f, i) => (
                <tr key={i} style={f.st === 'urgent' ? { background: 'var(--p-red-soft)' } : f.st === 'queue' ? { color: 'var(--p-mute)' } : {}}>
                  <td className="p-mono" style={{ fontWeight: 700, color: f.st === 'queue' ? 'var(--p-mute)' : 'var(--p-red)' }}>{f.op}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{f.m.name}</span>
                      <RefChip code={f.m.ref} size="sm"/>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ColorChips swatches={f.m.swatches} size="xs" showLabels={false} showNames={false}/>
                    </div>
                  </td>
                  <td className="num" style={{ fontWeight: 600 }}>{f.pares}</td>
                  <td className="p-mono">{f.linha}</td>
                  <td><span className="p-mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em' }}>{f.etapa}</span></td>
                  <td style={{ width: 100 }}>
                    <div style={{ height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: f.prog + '%', background: f.st === 'urgent' ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                    </div>
                    <div className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginTop: 1 }}>{f.prog}%</div>
                  </td>
                  <td className="p-mono" style={{ fontSize: 10.5, color: f.st === 'urgent' ? 'var(--p-red)' : 'inherit', fontWeight: f.st === 'urgent' ? 700 : 400 }}>{f.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="light-card" style={{ padding: 20 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>02 · Capacidade por linha · hoje</div>
          {linhas.map((l, i) => (
            <div key={i} style={{ marginBottom: 12, padding: '8px 10px', background: l.red ? 'var(--p-red-soft)' : 'var(--p-soft)', border: '1px solid ' + (l.red ? 'var(--p-red)' : 'var(--p-line)') }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="p-mono" style={{ fontWeight: 700, fontSize: 12 }}>{l.id}</span>
                <span className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{l.op}</span>
              </div>
              <div style={{ height: 8, background: '#fff', border: '1px solid var(--p-line-2)', position: 'relative' }}>
                <div style={{ position: 'absolute', left: '100%', top: -3, bottom: -3, width: 1, background: 'var(--p-ink)' }}/>
                <div style={{ height: '100%', width: Math.min(100, l.util) + '%', background: l.util === 0 ? 'transparent' : l.util > 100 ? 'var(--p-red)' : 'var(--p-ink)' }}/>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 10 }}>
                <span className="p-mono" style={{ color: 'var(--p-mute)' }}>{l.plan} / {l.cap} pares</span>
                <span className="p-mono" style={{ fontWeight: 700, color: l.util === 0 ? 'var(--p-red)' : l.util > 100 ? 'var(--p-red)' : 'var(--p-ink)' }}>{l.util}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="light-card" style={{ padding: 20, marginTop: 18 }}>
        <div className="p-eyebrow" style={{ marginBottom: 10 }}>03 · Carga semanal · próximas 4 semanas</div>
        <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(5, 1fr)', gap: 4 }}>
          <div></div>
          {['SEG', 'TER', 'QUA', 'QUI', 'SEX'].map(d => <div key={d} className="p-eyebrow" style={{ fontSize: 8, textAlign: 'center' }}>{d}</div>)}
          {[
            { sem: 'W19', vals: [1240, 1320, 1284, 1380, 1196] },
            { sem: 'W20', vals: [1380, 1420, 1340, 1380, 1280] },
            { sem: 'W21', vals: [1200, 1280, 1320, 1380, 1240] },
            { sem: 'W22', vals: [820, 1180, 1240, 1180, 980], partial: true },
          ].map(w => (
            <React.Fragment key={w.sem}>
              <div className="p-mono" style={{ fontWeight: 700, fontSize: 11, alignSelf: 'center' }}>{w.sem}</div>
              {w.vals.map((v, i) => {
                const pct = (v / 1500) * 100;
                return (
                  <div key={i} style={{ position: 'relative', height: 32, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: pct + '%', background: w.partial ? 'var(--p-line-2)' : v > 1350 ? 'var(--p-red)' : 'var(--p-ink)', opacity: w.partial ? 0.5 : 1 }}/>
                    <span className="p-mono" style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, color: '#fff', mixBlendMode: 'difference' }}>{v}</span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
        <div className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)', marginTop: 8 }}>Meta diária: 1.300 pares · vermelho = acima da capacidade · W22 parcialmente sequenciada</div>
      </div>
    </LightShell>
  );
}
window.ProducaoPCP = ProducaoPCP;
