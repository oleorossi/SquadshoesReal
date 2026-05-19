// COMERCIAL · PRONTA-ENTREGA — produtos prontos disponíveis para venda imediata
function ComercialProntaEntrega() {
  const lotes = [
    { ref: 'I901', m: MODELOS['I901'], lote: 'L26-0180', pares: 84,  end: 'PE-01-12', preco: 36.95, dispo: '6 dias' },
    { ref: 'I901', m: MODELOS['I901'], lote: 'L26-0181', pares: 60,  end: 'PE-01-13', preco: 36.95, dispo: '4 dias' },
    { ref: 'I918', m: MODELOS['I918'], lote: 'L26-0162', pares: 120, end: 'PE-02-04', preco: 42.20, dispo: '12 dias' },
    { ref: 'I905', m: MODELOS['I905'], lote: 'L26-0192', pares: 36,  end: 'PE-03-08', preco: 38.40, dispo: '2 dias' },
  ];
  return (
    <LightShell active="pronta" breadcrumb="COMERCIAL · PRONTA-ENTREGA" title="PRONTA-ENTREGA" actions={<>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> REF</button>
      <button className="btn-l-red btn-l">+ Reservar para PV</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Pares disponíveis', v: '6.840',  s: '24 referências' },
          { l: 'Em reserva',        v: '320',    s: '4 PVs aguardando' },
          { l: 'Cobertura',         v: '12d',    s: 'venda média' },
          { l: 'Velocidade',        v: '+R$ 84k', s: 'previsto 7d' },
          { l: 'Sem giro 30d',      v: '8',      s: 'considerar promo', red: true },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 18 }}>
          {lotes.map((l, i) => {
            const giroBg = parseInt(l.dispo) < 5 ? 'var(--p-red-soft)' : 'var(--p-soft)';
            return (
              <div key={i} style={{ border: '1px solid var(--p-line)', background: giroBg, padding: 16, display: 'flex', gap: 16 }}>
                <ShoePhoto w={110} h={88} label={`REF ${l.ref}`}/>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'Anton', fontSize: 20, letterSpacing: '0.01em' }}>{l.m.name}</div>
                    <RefChip code={l.ref} size="sm"/>
                    <span className="p-pill p-pill-ok">Pronto</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                    <ColorChips swatches={l.m.swatches} size="sm" showLabels={false} showNames={false}/>
                    <div style={{ fontSize: 11 }}>{l.m.cor}</div>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 11 }}>
                    <tbody>
                      <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Lote</td><td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{l.lote}</td></tr>
                      <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Endereço</td><td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontWeight: 700 }}>{l.end}</td></tr>
                      <tr><td style={{ color: 'var(--p-mute)', padding: '2px 0' }}>Disponível há</td><td style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontWeight: 700, color: parseInt(l.dispo) < 5 ? 'var(--p-red)' : 'var(--p-ink)' }}>{l.dispo}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div style={{ borderLeft: '1px solid var(--p-line)', paddingLeft: 16, textAlign: 'right', minWidth: 130 }}>
                  <div className="p-eyebrow" style={{ fontSize: 8 }}>Disponível</div>
                  <div className="p-display" style={{ fontSize: 38, color: 'var(--p-red)', lineHeight: 0.9, marginTop: 4 }}>{l.pares}</div>
                  <div className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>pares</div>
                  <div style={{ marginTop: 12 }}>
                    <div className="p-eyebrow" style={{ fontSize: 8 }}>Preço atacado</div>
                    <div style={{ fontFamily: 'Anton', fontSize: 18, marginTop: 2 }}>R$ {l.preco.toFixed(2).replace('.', ',')}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </LightShell>
  );
}
window.ComercialProntaEntrega = ComercialProntaEntrega;
