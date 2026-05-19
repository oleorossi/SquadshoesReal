// ENGENHARIA · SILKS — estampas/silkscreen com REF, paleta de cores, posição na peça
function EngSilks() {
  const silks = [
    { ref: 'SK-FLR-01', nome: 'Floral Tropical',     tema: 'Floral',    cores: ['#B7141F', '#F2C94C', '#1F7A4D', '#F0EAE0'], pos: 'Cabedal frontal', tecnica: 'Silk 4 cores', custo: 1.40, uso: 3, atual: 'Coleção Verão 2026' },
    { ref: 'SK-GEO-02', nome: 'Geométrico Pampa',    tema: 'Geométrico',cores: ['#1A1A1A', '#F0EAE0'],                     pos: 'Tira lateral',    tecnica: 'Silk 2 cores', custo: 0.80, uso: 2, atual: 'Verão 2026' },
    { ref: 'SK-MNG-03', nome: 'Monograma SQ',        tema: 'Monograma', cores: ['#B7141F', '#14110E'],                     pos: 'Calcanhar',        tecnica: 'Silk 2 cores', custo: 0.60, uso: 8, atual: 'Linha permanente' },
    { ref: 'SK-ANI-04', nome: 'Onça Camuflada',      tema: 'Animal',    cores: ['#3A2A1A', '#8E5326', '#E8DCC8', '#0E0E0E'], pos: 'Cabedal inteiro',  tecnica: 'Silk 4 cores', custo: 2.20, uso: 4, atual: 'Inverno 2026' },
    { ref: 'SK-ABS-05', nome: 'Abstrato Suave',      tema: 'Abstrato',  cores: ['#D9C9A8', '#8E5326'],                     pos: 'Tira frontal',     tecnica: 'Silk 2 cores', custo: 0.90, uso: 1, atual: 'Verão 2026' },
    { ref: 'SK-TXT-06', nome: 'Lettering MADE',      tema: 'Tipografia',cores: ['#0E0E0E'],                                  pos: 'Solado lateral',    tecnica: 'Silk 1 cor',    custo: 0.40, uso: 6, atual: 'Linha permanente' },
    { ref: 'SK-FLR-07', nome: 'Floral Mini',         tema: 'Floral',    cores: ['#B7141F', '#1F8A5B', '#FFFFFF'],          pos: 'Calcanhar',        tecnica: 'Silk 3 cores', custo: 1.10, uso: 2, atual: 'Verão 2026' },
    { ref: 'SK-NEW-08', nome: 'Em desenvolvimento',  tema: '—',         cores: [],                                          pos: '—',                tecnica: '—',              custo: 0,    uso: 0, atual: 'Rascunho' },
  ];

  return (
    <LightShell active="silks" breadcrumb="ENGENHARIA · SILKS" title="BIBLIOTECA DE SILKS" actions={<>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Tema</button>
      <button className="btn-l-red btn-l">+ Nova arte</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Silks cadastrados', v: '42',     s: '7 temas' },
          { l: 'Em uso',            v: '18',     s: 'modelos ativos' },
          { l: 'Em rascunho',       v: '6',      s: 'pendente aprovação' },
          { l: 'Custo médio',       v: 'R$ 1,15', s: 'por par' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {silks.map((s, i) => {
            const empty = s.cores.length === 0;
            return (
              <div key={i} style={{ border: '1px solid var(--p-line)', background: empty ? '#fff' : 'var(--p-soft)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <RefChip code={s.ref} size="sm"/>
                  {empty
                    ? <span className="p-pill">Rascunho</span>
                    : <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, color: 'var(--p-mute)', letterSpacing: '0.12em' }}>{s.uso}× em uso</span>}
                </div>

                {/* Pattern preview */}
                <div style={{ height: 84, border: '1px solid var(--p-line-2)', position: 'relative', overflow: 'hidden', background: '#fff' }}>
                  {empty ? (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4, color: 'var(--p-mute)' }}>
                      <Icon.Plus style={{ width: 20, height: 20 }}/>
                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.14em' }}>SEM ARTE</span>
                    </div>
                  ) : (
                    /* fake repeat pattern */
                    <svg viewBox="0 0 120 84" style={{ width: '100%', height: '100%' }}>
                      {Array.from({ length: 6 }).map((_, ri) =>
                        Array.from({ length: 5 }).map((_, ci) => {
                          const cx = ci * 24 + (ri % 2 ? 12 : 0) + 6;
                          const cy = ri * 14 + 8;
                          const color = s.cores[(ri + ci) % s.cores.length];
                          return s.tema === 'Floral' ? (
                            <g key={`${ri}-${ci}`} transform={`translate(${cx} ${cy})`}>
                              <circle cx="0" cy="0" r="4" fill={color}/>
                              <circle cx="3" cy="2" r="3" fill={color} opacity="0.7"/>
                              <circle cx="-3" cy="2" r="3" fill={color} opacity="0.7"/>
                            </g>
                          ) : s.tema === 'Geométrico' ? (
                            <rect key={`${ri}-${ci}`} x={cx-5} y={cy-3} width="8" height="6" fill={color}/>
                          ) : s.tema === 'Animal' ? (
                            <ellipse key={`${ri}-${ci}`} cx={cx} cy={cy} rx="5" ry="3" fill={color} transform={`rotate(${(ri+ci)*15} ${cx} ${cy})`}/>
                          ) : s.tema === 'Tipografia' ? (
                            <text key={`${ri}-${ci}`} x={cx} y={cy} fontFamily="Anton" fontSize="9" fill={color}>SQ</text>
                          ) : s.tema === 'Monograma' ? (
                            <text key={`${ri}-${ci}`} x={cx} y={cy+2} fontFamily="Anton" fontSize="10" fill={color}>S</text>
                          ) : (
                            <path key={`${ri}-${ci}`} d={`M ${cx-5} ${cy} Q ${cx} ${cy-4} ${cx+5} ${cy} T ${cx+10} ${cy}`} fill="none" stroke={color} strokeWidth="1.5"/>
                          );
                        })
                      )}
                    </svg>
                  )}
                </div>

                <div style={{ fontWeight: 700, fontSize: 13, marginTop: 8 }}>{s.nome}</div>
                <div style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{s.tema}</div>

                {!empty && (
                  <>
                    {/* Paleta */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                      <span className="p-eyebrow" style={{ fontSize: 7.5 }}>Paleta</span>
                      <div style={{ display: 'flex', gap: 2, marginLeft: 4 }}>
                        {s.cores.map((c, ci) => (
                          <div key={ci} style={{ width: 14, height: 14, background: c, border: '1px solid #000' }}/>
                        ))}
                      </div>
                      <span className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginLeft: 'auto' }}>{s.cores.length} cor{s.cores.length > 1 ? 'es' : ''}</span>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: 10 }}>
                      <tbody>
                        <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Posição</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{s.pos}</td></tr>
                        <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Técnica</td><td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono' }}>{s.tecnica}</td></tr>
                        <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Custo/par</td><td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--p-red)' }}>R$ {s.custo.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </>
                )}

                <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px dotted var(--p-line-2)', fontFamily: 'JetBrains Mono', fontSize: 8.5, color: 'var(--p-mute)', letterSpacing: '0.1em' }}>{s.atual}</div>
              </div>
            );
          })}
        </div>
      </div>
    </LightShell>
  );
}
window.EngSilks = EngSilks;
