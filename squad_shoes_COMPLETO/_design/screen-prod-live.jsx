// PRODUÇÃO · LIVE — chão de fábrica em tempo real
function ProducaoLive() {
  const linhas = [
    { id: 'A1', m: MODELOS['I901'], op: 'OP-2847', etapa: 'COSTURA',    op_l: 'Marcia L.',   prog: 62, paresHora: 38, meta: 40, st: 'ok'   },
    { id: 'A2', m: MODELOS['I918'], op: 'OP-2849', etapa: 'CORTE',      op_l: 'Cleber B.',   prog: 28, paresHora: 42, meta: 40, st: 'ok'   },
    { id: 'B1', m: MODELOS['I905'], op: 'OP-2851', etapa: 'MONTAGEM',   op_l: 'Daniela R.',  prog: 78, paresHora: 28, meta: 40, st: 'red'  },
    { id: 'B2', m: MODELOS['I918'], op: 'OP-2843', etapa: 'ACABAMENTO', op_l: 'Sandra M.',   prog: 91, paresHora: 36, meta: 40, st: 'ok'   },
    { id: 'C1', m: MODELOS['I901'], op: 'OP-2855', etapa: 'EMBALAGEM',  op_l: 'Roseli P.',   prog: 96, paresHora: 48, meta: 40, st: 'ok'   },
    { id: 'C2', m: null,           op: '—',       etapa: 'PARADA',     op_l: '—',           prog: 0,  paresHora: 0,  meta: 40, st: 'idle' },
  ];
  return (
    <LightShell active="live" breadcrumb="PRODUÇÃO · LIVE" title="CHÃO DE FÁBRICA · AGORA" actions={<>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--p-mute)' }}>
        <span style={{ width: 8, height: 8, background: 'var(--p-ok)', borderRadius: '50%' }}/>
        ATUALIZADO 14:42:08
      </span>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {linhas.map((l, i) => {
          const idle = l.st === 'idle';
          const slow = l.st === 'red';
          const cardBg = idle ? '#fff' : slow ? 'var(--p-red-soft)' : 'var(--p-soft)';
          const border = idle ? '2px dashed var(--p-line-2)' : slow ? '2px solid var(--p-red)' : '1px solid var(--p-line)';
          return (
            <div key={i} className="light-card" style={{ padding: 0, background: cardBg, border, borderRadius: 0 }}>
              {/* HEADER linha */}
              <div style={{ padding: '14px 18px', borderBottom: '1px solid ' + (slow ? 'var(--p-red)' : 'var(--p-line)'), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 48, height: 48, background: idle ? 'var(--p-line-2)' : slow ? 'var(--p-red)' : 'var(--p-ink)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: 'Anton', fontSize: 28, letterSpacing: '0.02em',
                  }}>{l.id}</div>
                  <div>
                    <div className="p-eyebrow" style={{ fontSize: 8 }}>{idle ? 'PARADA · sem OP' : l.etapa}</div>
                    {l.m ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <div style={{ fontFamily: 'Anton', fontSize: 18, letterSpacing: '0.01em' }}>{l.m.name}</div>
                        <RefChip code={l.m.ref} size="sm"/>
                      </div>
                    ) : <div style={{ fontFamily: 'Anton', fontSize: 18, color: 'var(--p-mute)' }}>—</div>}
                    {l.m && <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{l.op} · {l.op_l}</div>}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="p-eyebrow" style={{ fontSize: 8 }}>Pares/hora</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontFamily: 'Anton', fontSize: 32, color: idle ? 'var(--p-mute)' : slow ? 'var(--p-red)' : l.paresHora >= l.meta ? 'var(--p-ok)' : 'var(--p-ink)' }}>{l.paresHora}</span>
                    <span className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)' }}>/ {l.meta}</span>
                  </div>
                </div>
              </div>

              {l.m && (
                <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--p-line)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ColorChips swatches={l.m.swatches} size="xs" showLabels={false} showNames={false}/>
                    <span style={{ fontSize: 10, color: 'var(--p-mute)' }}>{l.m.cor}</span>
                  </div>
                </div>
              )}

              {/* Progresso */}
              <div style={{ padding: '14px 18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="p-eyebrow" style={{ fontSize: 8 }}>Progresso da OP</span>
                  <span className="p-mono" style={{ fontSize: 10, fontWeight: 700 }}>{l.prog}%</span>
                </div>
                <div style={{ height: 10, background: '#fff', border: '1px solid var(--p-line-2)' }}>
                  <div style={{ height: '100%', width: l.prog + '%', background: idle ? 'transparent' : slow ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                </div>
              </div>

              {/* Mini hourly bars */}
              <div style={{ padding: '8px 18px 14px' }}>
                <div className="p-eyebrow" style={{ fontSize: 7.5, marginBottom: 4 }}>Última hora · 6 leituras</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 28 }}>
                  {[36, 38, 40, idle ? 0 : 32, idle ? 0 : 34, l.paresHora].map((v, j) => (
                    <div key={j} style={{ flex: 1, height: (v / 50) * 100 + '%', background: v < l.meta ? 'var(--p-red)' : 'var(--p-ink)', minHeight: 1, opacity: idle ? 0.2 : 1 }}/>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </LightShell>
  );
}
window.ProducaoLive = ProducaoLive;
