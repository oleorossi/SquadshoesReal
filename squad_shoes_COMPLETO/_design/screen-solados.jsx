// ENGENHARIA · SOLADOS — biblioteca de solados com REF, cor, dimensões, fornecedor
function EngSolados() {
  const solados = [
    { ref: 'SL-TR-04',  nome: 'TR Bloco 6cm',       tipo: 'TR injetado',  cor: 'Preto',      corHex: '#1A1A1A', alturaSalto: '6cm',     materia: 'TR-1100',  fornec: 'Soltec',     custo: 6.80, num: '34–42', uso: 4, modUso: ['Mocassim Verona', 'Scarpin Bianca'] },
    { ref: 'SL-TR-12',  nome: 'TR Plataforma 8cm',  tipo: 'TR injetado',  cor: 'Preto',      corHex: '#1A1A1A', alturaSalto: '8cm',     materia: 'TR-1100',  fornec: 'Soltec',     custo: 8.40, num: '34–40', uso: 2, modUso: ['Anabela Sole'] },
    { ref: 'SL-EVA-22', nome: 'EVA Casual',         tipo: 'EVA moldada',  cor: 'Caramelo',   corHex: '#8E5326', alturaSalto: '2cm',     materia: 'EVA-9',    fornec: 'EVA Pack',   custo: 4.20, num: '34–42', uso: 6, modUso: ['Tênis Nova', 'Sapatilha Lua'] },
    { ref: 'SL-COURO-A',nome: 'Solado de couro 4mm',      tipo: 'Couro vegetal', cor: 'Natural',   corHex: '#B8946B', alturaSalto: 'plano',   materia: 'CR-4',     fornec: 'Curtume Vale', custo: 14.50, num: '34–42', uso: 1, modUso: ['Loafer Atena'] },
    { ref: 'SL-TR-21',  nome: 'TR Anabela 9cm',     tipo: 'TR injetado',  cor: 'Caramelo',   corHex: '#8E5326', alturaSalto: '9cm',     materia: 'TR-1100',  fornec: 'Soltec',     custo: 9.20, num: '34–40', uso: 3, modUso: ['Sandália Leila', 'Anabela Sole'] },
    { ref: 'SL-PU-08',  nome: 'PU Tênis Esporte',   tipo: 'PU injetado',  cor: 'Branco',     corHex: '#F4F0E5', alturaSalto: '3,5cm',   materia: 'PU-EX',    fornec: 'PolySole',   custo: 11.80, num: '34–44', uso: 5, modUso: ['Tênis Nova', 'Tênis Aurora'] },
    { ref: 'SL-TR-09',  nome: 'TR Scarpin 7cm',     tipo: 'TR injetado',  cor: 'Preto',      corHex: '#1A1A1A', alturaSalto: '7cm',     materia: 'TR-1100',  fornec: 'Soltec',     custo: 7.40, num: '33–40', uso: 4, modUso: ['Scarpin Bianca', 'Scarpin Vera'] },
    { ref: 'SL-TR-14',  nome: 'TR Sandália 4cm',    tipo: 'TR injetado',  cor: 'Preto',      corHex: '#1A1A1A', alturaSalto: '4cm',     materia: 'TR-1100',  fornec: 'Soltec',     custo: 5.80, num: '34–40', uso: 7, modUso: ['Sandália Leila', 'Mule Capri', 'Sandália Vênus'] },
  ];

  return (
    <LightShell active="solados" breadcrumb="ENGENHARIA · SOLADOS" title="BIBLIOTECA DE SOLADOS" actions={<>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Tipo</button>
      <button className="btn-l-red btn-l">+ Novo solado</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Solados cadastrados', v: '124', s: '6 tipos' },
          { l: 'Em uso ativo',         v: '38',  s: 'OPs em curso' },
          { l: 'Custo médio',          v: 'R$ 7,80', s: 'por par' },
          { l: 'Fornecedores',         v: '8',   s: '6 ativos' },
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
          {solados.map((s, i) => (
            <div key={i} style={{ border: '1px solid var(--p-line)', background: 'var(--p-soft)', padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <RefChip code={s.ref} size="sm"/>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, color: 'var(--p-mute)', letterSpacing: '0.12em' }}>{s.uso}× em uso</span>
              </div>

              {/* Cross-section schematic */}
              <div style={{ height: 60, background: '#fff', border: '1px solid var(--p-line-2)', marginBottom: 8, position: 'relative', overflow: 'hidden' }}>
                <svg viewBox="0 0 120 60" style={{ width: '100%', height: '100%' }}>
                  <path d="M 10 48 Q 12 38 20 38 L 100 38 Q 112 38 112 46 L 112 50 Q 112 52 110 52 L 12 52 Q 10 52 10 50 Z" fill={s.corHex} stroke="#000" strokeWidth="0.6"/>
                  {s.alturaSalto !== 'plano' && (
                    <path d={`M 76 38 L 100 38 Q 108 38 108 ${52 - parseFloat(s.alturaSalto) * 1.4} L 108 52 L 78 52 Z`} fill={s.corHex} stroke="#000" strokeWidth="0.6"/>
                  )}
                </svg>
                <div style={{ position: 'absolute', bottom: 2, right: 4, fontFamily: 'JetBrains Mono', fontSize: 8, color: 'var(--p-mute)' }}>{s.alturaSalto}</div>
              </div>

              <div style={{ fontWeight: 700, fontSize: 13 }}>{s.nome}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div style={{ width: 12, height: 12, background: s.corHex, border: '1px solid #000' }}/>
                <span style={{ fontSize: 10.5 }}>{s.cor}</span>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 10 }}>
                <tbody>
                  <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Tipo</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{s.tipo}</td></tr>
                  <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Numeração</td><td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontWeight: 600 }}>{s.num}</td></tr>
                  <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Matéria-prima</td><td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono' }}>{s.materia}</td></tr>
                  <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Fornecedor</td><td style={{ textAlign: 'right' }}>{s.fornec}</td></tr>
                  <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Custo/par</td><td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--p-red)' }}>R$ {s.custo.toFixed(2)}</td></tr>
                </tbody>
              </table>

              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dotted var(--p-line-2)' }}>
                <div className="p-eyebrow" style={{ fontSize: 7.5, marginBottom: 4 }}>Usado em</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {s.modUso.map((m, mi) => (
                    <span key={mi} style={{ fontSize: 9, padding: '1px 6px', background: '#fff', border: '1px solid var(--p-line-2)' }}>{m}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </LightShell>
  );
}
window.EngSolados = EngSolados;
