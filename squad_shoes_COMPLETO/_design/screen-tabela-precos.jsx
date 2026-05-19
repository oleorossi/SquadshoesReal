// COMERCIAL · TABELAS DE PREÇO — preço por modelo+cor por região/curva
function TabelasPreco() {
  const linhas = [
    { ref: 'I901', m: MODELOS['I901'], custo: 21.13, base: 36.95, A: 36.95, B: 38.80, C: 40.50, mkp: 75 },
    { ref: 'I905', m: MODELOS['I905'], custo: 22.42, base: 38.40, A: 38.40, B: 40.30, C: 42.20, mkp: 71 },
    { ref: 'I918', m: MODELOS['I918'], custo: 24.80, base: 42.20, A: 42.20, B: 44.50, C: 46.40, mkp: 70 },
  ];
  return (
    <LightShell active="tabprc" breadcrumb="COMERCIAL · TABELAS DE PREÇO" title="TABELA · VERÃO 2026" actions={<>
      <button className="btn-l">Exportar PDF</button>
      <button className="btn-l-red btn-l">+ Nova tabela</button>
    </>}>
      <div className="light-card" style={{ padding: 22, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          {[
            { l: 'Tabela ativa', v: 'V26' },
            { l: 'Vigência', v: '01/05 → 31/08' },
            { l: 'Modelos cobertos', v: '24' },
            { l: 'Última atualização', v: '02/05/2026 · Tatiana A.' },
          ].map((k, i) => (
            <div key={i}>
              <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{k.l}</div>
              <div style={{ fontFamily: 'Anton', fontSize: 18, marginTop: 4, letterSpacing: '0.01em' }}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl">
          <thead><tr>
            <th>Modelo · REF</th><th>Cor</th><th className="num">Custo</th>
            <th className="num">Preço base</th><th className="num">Curva A</th>
            <th className="num">Curva B</th><th className="num">Curva C</th>
            <th className="num">Markup</th>
          </tr></thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--p-line)' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShoePhoto w={48} h={36} label=""/>
                    <div>
                      <div style={{ fontWeight: 600 }}>{l.m.name}</div>
                      <RefChip code={l.ref} size="sm"/>
                    </div>
                  </div>
                </td>
                <td>
                  <ColorChips swatches={l.m.swatches} size="xs" showLabels={false} showNames={false}/>
                  <div style={{ fontSize: 10, marginTop: 3, color: 'var(--p-mute)' }}>{l.m.cor}</div>
                </td>
                <td className="num"><span className="p-mono" style={{ color: 'var(--p-mute)' }}>R$ {l.custo.toFixed(2)}</span></td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 600 }}>R$ {l.base.toFixed(2)}</span></td>
                <td className="num" style={{ background: 'var(--p-soft)' }}>
                  <span className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)' }}>R$ {l.A.toFixed(2)}</span>
                </td>
                <td className="num" style={{ background: 'var(--p-soft)' }}>
                  <span className="p-mono" style={{ fontWeight: 700 }}>R$ {l.B.toFixed(2)}</span>
                </td>
                <td className="num" style={{ background: 'var(--p-soft)' }}>
                  <span className="p-mono" style={{ fontWeight: 700 }}>R$ {l.C.toFixed(2)}</span>
                </td>
                <td className="num">
                  <span style={{ fontFamily: 'Anton', fontSize: 18 }}>{l.mkp}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 18, padding: 14, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 11 }}>
          <div className="p-eyebrow" style={{ fontSize: 8.5 }}>Definição das curvas</div>
          <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div><strong>A · Atacado top:</strong> +12 pedidos/ano · volume {'>'} R$ 80k/ano</div>
            <div><strong>B · Atacado padrão:</strong> 4-12 pedidos/ano · volume R$ 20-80k</div>
            <div><strong>C · Atacado spot:</strong> {'<'} 4 pedidos/ano · volume {'<'} R$ 20k</div>
          </div>
        </div>
      </div>
    </LightShell>
  );
}
window.TabelasPreco = TabelasPreco;
