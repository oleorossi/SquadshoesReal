// FICHA TÉCNICA — A4 portrait · destaque MODELO + REF + CORES (com sequência de tiras)
function FichaTecnica() {
  const m = MODELOS['I905']; // Sandália Leila — demonstra tiras
  // Materiais com cor associada (idx do swatch ou cor custom)
  const colorByLabel = Object.fromEntries(m.swatches.map((s) => [s.label, s]));
  const materiais = [
  { n: '01', comp: 'Cabedal · base', mat: 'Couro caramelo 2.0', c: colorByLabel.T1, dm: '3,2 dm²', cost: 'R$ 4,80' },
  { n: '02', comp: 'Tira lateral 1', mat: 'Couro caramelo 2.0', c: colorByLabel.T1, dm: '0,8 dm²', cost: 'R$ 1,20' },
  { n: '03', comp: 'Tira lateral 2', mat: 'Couro cru 2.0', c: colorByLabel.T2, dm: '0,8 dm²', cost: 'R$ 1,20' },
  { n: '04', comp: 'Tira frontal', mat: 'Couro caramelo 2.0', c: colorByLabel.T3, dm: '1,1 dm²', cost: 'R$ 1,65' },
  { n: '05', comp: 'Forro palmilha', mat: 'Pelica creme', c: { h: '#F2E6D3', name: 'Creme', material: 'Pelica' }, dm: '2,4 dm²', cost: 'R$ 2,40' },
  { n: '06', comp: 'Solado', mat: 'TR injetado', c: colorByLabel.SL, dm: '1 par', cost: 'R$ 6,80' },
  { n: '07', comp: 'Palmilha interna', mat: 'EVA 3mm', c: { h: '#1A1A1A', name: 'Preto', material: 'EVA' }, dm: '1 par', cost: 'R$ 0,90' },
  { n: '08', comp: 'Cola PU', mat: 'Branca', c: null, dm: '12 g', cost: 'R$ 0,60' },
  { n: '09', comp: 'Linha costura 40', mat: 'Poliéster', c: { h: '#1A1A1A', name: 'Preto', material: 'Poliéster' }, dm: '3,8 m', cost: 'R$ 0,18' },
  { n: '10', comp: 'Fivela metal', mat: 'Zamac dourado', c: { h: '#C9A35A', name: 'Dourado', material: 'Zamac' }, dm: '1 un', cost: 'R$ 1,40' }];


  return (
    <div className="paper">
      <div className="sheet">
        {/* HEAD */}
        <div className="a4-head">
          <div className="brand" style={{ fontSize: "50px" }}>
            <div className="brand-mark"><PIcon.Logo size={26} /></div>
            <div>
              <div className="brand-name">SQUAD SHOES</div>
              <div className="brand-sub">Ficha Técnica · Engenharia</div>
            </div>
          </div>
          <div className="doc-meta">
            <div className="doc-title">Ficha Técnica</div>
            <div className="doc-num">FT-2026-{m.ref}-LL · Rev. 03</div>
            <div className="doc-emit">Emitida 09/05/2026 · Tatiana A.</div>
          </div>
        </div>

        {/* HERO — modelo + REF + foto + cores */}
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, marginBottom: 14, alignItems: 'flex-start' }}>
          <ShoePhoto w={160} h={140} label={`REF ${m.ref}`} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="p-eyebrow">Modelo</div>
              <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '2px 9px', fontFamily: 'JetBrains Mono', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.1em' }}>REF {m.ref}</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.1em', color: 'var(--p-red)', fontWeight: 700 }}>{m.sku}</div>
            </div>
            <div className="p-display" style={{ fontSize: 32, marginTop: 4 }}>{m.name}</div>
            <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 3 }}>{m.categoria} · Salto bloco 6cm · Coleção Verão 2026</div>

            {/* Cores em sequência */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, padding: '8px 12px', background: 'var(--p-soft)', border: '1px solid var(--p-line-2)' }}>
              <div className="p-eyebrow" style={{ fontSize: 8 }}>Cores</div>
              <ColorChips swatches={m.swatches} size="sm" showLabels showNames />
            </div>
          </div>
        </div>

        {/* Meta 4-col compacto */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, marginBottom: 18, border: '1px solid var(--p-line)' }}>
          {[
          ['Categoria', m.categoria],
          ['Construção', 'Strobel'],
          ['Forma', 'F-208'],
          ['Solado', 'TR-PR'],
          ['Salto', 'Bloco 6cm'],
          ['Numeração', `${m.numeracao[0]}–${m.numeracao[m.numeracao.length - 1]}`],
          ['Curva base', '12 pares/cx'],
          ['Desenvolvedor', 'Tatiana A.']].
          map((r, i) =>
          <div key={i} style={{
            padding: '7px 10px', fontSize: 10.5,
            borderRight: i % 4 < 3 ? '1px solid var(--p-line)' : 'none',
            borderBottom: i < 4 ? '1px solid var(--p-line)' : 'none',
            background: i < 4 ? 'var(--p-soft)' : 'white'
          }}>
              <div className="p-eyebrow" style={{ fontSize: 8 }}>{r[0]}</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{r[1]}</div>
            </div>
          )}
        </div>

        {/* Materiais */}
        <div style={{ marginBottom: 20 }}>
          <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Materiais</div>
          <table className="p-tbl p-tbl-zebra">
            <thead><tr>
              <th style={{ width: 26 }}>#</th>
              <th>Componente</th>
              <th>Material</th>
              <th style={{ width: 70 }}>Cor</th>
              <th className="num">Consumo/par</th>
              <th className="num">Custo/par</th>
            </tr></thead>
            <tbody>
              {materiais.map((r, i) =>
              <tr key={i}>
                  <td className="p-mono" style={{ color: 'var(--p-mute)' }}>{r.n}</td>
                  <td style={{ fontWeight: 600 }}>{r.comp}</td>
                  <td>{r.mat}</td>
                  <td>
                    {r.c ?
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 14, height: 14, background: r.c.h, border: '1px solid var(--p-ink)', flexShrink: 0 }} />
                        <span style={{ fontSize: 10 }}>{r.c.name}</span>
                      </div> :
                  <span style={{ color: 'var(--p-mute)' }}>—</span>}
                  </td>
                  <td className="num">{r.dm}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{r.cost}</td>
                </tr>
              )}
              <tr>
                <td colSpan="5" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>CUSTO TOTAL DE MATERIAL POR PAR</td>
                <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>R$ 21,13</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Roteiro */}
        <div style={{ marginBottom: 20 }}>
          <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Roteiro de produção</div>
          <div className="flow-stages">
            {[
            { l: '01', n: 'CORTE', t: '4 min/par' },
            { l: '02', n: 'COSTURA', t: '12 min/par' },
            { l: '03', n: 'MONTAGEM', t: '8 min/par' },
            { l: '04', n: 'ACABAMENTO', t: '5 min/par' },
            { l: '05', n: 'EMBALAGEM', t: '2 min/par' }].
            map((s, i) =>
            <div key={i} className="flow-stage">
                <div className="lbl">Etapa {s.l}</div>
                <div className="nm">{s.n}</div>
                <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 4 }}>{s.t}</div>
              </div>
            )}
          </div>
          <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 8, textAlign: 'right' }}>Tempo total: 31 min/par · Custo MO/par: R$ 4,65</div>
        </div>

        {/* Grade + Custo */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18, marginBottom: 18 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Grade base</div>
            <div className="grade-display" style={{ gridTemplateColumns: `repeat(${m.numeracao.length + 1}, 1fr)` }}>
              {m.numeracao.map((n, i) => <div key={i} className="head">{n}</div>)}
              <div className="head" style={{ background: 'var(--p-ink)', color: 'white' }}>TOTAL</div>
              {[2, 3, 3, 2, 2].map((v, i) => <div key={i} className={`qty ${i < 3 ? 'has' : ''}`}>{v}</div>)}
              <div className="qty" style={{ background: 'var(--p-ink)', color: 'white' }}>12</div>
            </div>
            <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 6 }}>Curva pré-aprovada · 1 caixa = 12 pares</div>
          </div>

          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>04 · Custo & Preço</div>
            <table className="p-tbl">
              <tbody>
                <tr><td>Material</td><td className="num" style={{ fontWeight: 600 }}>R$ 21,13</td></tr>
                <tr><td>Mão de obra</td><td className="num" style={{ fontWeight: 600 }}>R$ 4,65</td></tr>
                <tr><td>Indireto (12%)</td><td className="num" style={{ fontWeight: 600 }}>R$ 3,09</td></tr>
                <tr style={{ background: 'var(--p-soft)' }}><td style={{ fontWeight: 700 }}>Custo total</td><td className="num" style={{ fontWeight: 700 }}>R$ 28,87</td></tr>
                <tr><td>Margem (28%)</td><td className="num">R$ 8,08</td></tr>
                <tr style={{ background: 'var(--p-ink)', color: 'white' }}><td style={{ fontWeight: 700, letterSpacing: '0.04em' }}>PREÇO ATACADO</td><td className="num" style={{ fontWeight: 700 }}>R$ 36,95</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24, marginTop: 24 }}>
          {['Engenharia', 'PCP', 'Qualidade'].map((l, i) =>
          <div key={i} className="sig">
              <div className="sig-line" />
              <div className="sig-cap">{l}</div>
            </div>
          )}
        </div>

        <div className="a4-foot">
          <span>FT-2026-{m.ref}-LL · Rev. 03</span>
          <span>09/05/2026 · Tatiana A.</span>
          <span>Página 1 de 1</span>
        </div>
      </div>
    </div>);

}
window.FichaTecnica = FichaTecnica;