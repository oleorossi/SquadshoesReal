// PRODUÇÃO · TIMELINE — Gantt simplificado de OPs nas linhas
function ProducaoTimeline() {
  const dias = ['SEG 05', 'TER 06', 'QUA 07', 'QUI 08', 'SEX 09', 'SEG 12', 'TER 13', 'QUA 14', 'QUI 15'];
  // posições: start (% do total), dur (% do total)
  const linhas = [
    { id: 'A1', ops: [
      { op: 'OP-2847', m: MODELOS['I901'], start: 0,  dur: 38, st: 'urgent' },
      { op: 'OP-2858', m: MODELOS['I901'], start: 40, dur: 30, st: 'queue' },
      { op: 'OP-2863', m: MODELOS['I918'], start: 72, dur: 24, st: 'queue' },
    ]},
    { id: 'A2', ops: [
      { op: 'OP-2849', m: MODELOS['I918'], start: 18, dur: 32, st: 'ok' },
      { op: 'OP-2861', m: MODELOS['I901'], start: 52, dur: 28, st: 'queue' },
    ]},
    { id: 'B1', ops: [
      { op: 'OP-2851', m: MODELOS['I905'], start: 0,  dur: 56, st: 'late' },
      { op: 'OP-2867', m: MODELOS['I905'], start: 60, dur: 32, st: 'queue' },
    ]},
    { id: 'B2', ops: [
      { op: 'OP-2843', m: MODELOS['I918'], start: 0,  dur: 32, st: 'ok' },
      { op: 'OP-2865', m: MODELOS['I901'], start: 36, dur: 26, st: 'queue' },
      { op: 'OP-2869', m: MODELOS['I905'], start: 64, dur: 30, st: 'queue' },
    ]},
    { id: 'C1', ops: [
      { op: 'OP-2855', m: MODELOS['I901'], start: 0,  dur: 24, st: 'ok' },
      { op: 'OP-2871', m: MODELOS['I918'], start: 28, dur: 36, st: 'queue' },
    ]},
    { id: 'C2', ops: [], parada: true },
  ];
  const stColor = { urgent: 'var(--p-red)', late: 'var(--p-red)', ok: 'var(--p-ink)', queue: 'var(--p-line-2)' };
  const stLabel = { urgent: 'URGENTE', late: 'ATRASO', ok: 'EM PRODUÇÃO', queue: 'FILA' };

  return (
    <LightShell active="tline" breadcrumb="PRODUÇÃO · TIMELINE" title="LINHA DO TEMPO · 2 SEMANAS" actions={<>
      <button className="btn-l">7 dias</button>
      <button className="btn-l" style={{ background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' }}>2 sem</button>
      <button className="btn-l">Mês</button>
    </>}>
      <div className="light-card" style={{ padding: 22 }}>
        {/* Header dias */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 12, marginBottom: 6 }}>
          <div></div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${dias.length}, 1fr)`, gap: 1 }}>
            {dias.map((d, i) => (
              <div key={i} className="p-eyebrow" style={{ fontSize: 8.5, textAlign: 'center', padding: '4px 0', borderBottom: '1px solid var(--p-line-2)' }}>{d}</div>
            ))}
          </div>
        </div>

        {/* Linhas */}
        {linhas.map((l, li) => (
          <div key={li} style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 12, marginBottom: 4, alignItems: 'stretch' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'Anton', fontSize: 20,
              background: l.parada ? 'var(--p-line-2)' : 'var(--p-ink)', color: '#fff',
            }}>{l.id}</div>
            <div style={{ position: 'relative', height: 48, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
              {/* dividers */}
              {dias.map((_, i) => i > 0 && (
                <div key={i} style={{ position: 'absolute', left: ((i / dias.length) * 100) + '%', top: 0, bottom: 0, width: 1, background: 'var(--p-line-2)', opacity: 0.5 }}/>
              ))}
              {/* hoje marker (QUI 08 = index 3) */}
              <div style={{ position: 'absolute', left: (3.5 / dias.length * 100) + '%', top: -3, bottom: -3, width: 1.5, background: 'var(--p-red)', zIndex: 2 }}/>
              {l.parada && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.2em', color: 'var(--p-mute)' }}>LINHA PARADA · MANUTENÇÃO</div>
              )}
              {(l.ops || []).map((o, oi) => (
                <div key={oi} style={{
                  position: 'absolute', top: 4, bottom: 4,
                  left: o.start + '%', width: o.dur + '%',
                  background: stColor[o.st], color: '#fff',
                  padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
                  border: o.st === 'queue' ? '1px dashed var(--p-mute)' : 'none',
                  fontSize: 10, overflow: 'hidden',
                }}>
                  <span className="p-mono" style={{ fontWeight: 700, color: o.st === 'queue' ? 'var(--p-mute)' : '#fff' }}>{o.op}</span>
                  <span style={{ fontWeight: 600, color: o.st === 'queue' ? 'var(--p-mute)' : 'rgba(255,255,255,0.85)', fontSize: 10 }}>{o.m.name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* legenda */}
        <div style={{ display: 'flex', gap: 18, marginTop: 18, padding: '12px 16px', background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
          {Object.entries(stLabel).map(([k, l]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 16, height: 12, background: stColor[k], border: k === 'queue' ? '1px dashed var(--p-mute)' : 'none' }}/>
              <span className="p-mono" style={{ fontSize: 9.5, letterSpacing: '0.12em' }}>{l}</span>
            </div>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 1.5, height: 16, background: 'var(--p-red)' }}/>
            <span className="p-mono" style={{ fontSize: 9.5, letterSpacing: '0.12em', color: 'var(--p-red)', fontWeight: 700 }}>HOJE · 08/05</span>
          </div>
        </div>
      </div>
    </LightShell>
  );
}
window.ProducaoTimeline = ProducaoTimeline;
