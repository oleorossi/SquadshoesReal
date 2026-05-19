// ENGENHARIA · RECEITAS — fórmulas/BOM de modelo (lista de materiais com qtd e custo)
function EngReceitas() {
  const m = MODELOS['I905']; // Sandália Leila (multi-tiras é mais rica)
  const materiais = [
    { n: '01', comp: 'Cabedal · base',     mat: 'Couro caramelo 2.0',  cor: { h: '#8E5326', name: 'Caramelo' }, qtd: '3,2',  un: 'dm²',  custo: 0.92, total: 2.94, sup: 'Curtume Vale' },
    { n: '02', comp: 'Tira lateral 1',     mat: 'Couro caramelo 2.0',  cor: { h: '#8E5326', name: 'Caramelo' }, qtd: '0,8',  un: 'dm²',  custo: 0.92, total: 0.74, sup: 'Curtume Vale' },
    { n: '03', comp: 'Tira lateral 2',     mat: 'Couro cru 2.0',       cor: { h: '#E8DCC8', name: 'Cru' },      qtd: '0,8',  un: 'dm²',  custo: 0.94, total: 0.75, sup: 'Curtume Vale' },
    { n: '04', comp: 'Tira frontal',       mat: 'Couro caramelo 2.0',  cor: { h: '#8E5326', name: 'Caramelo' }, qtd: '1,1',  un: 'dm²',  custo: 0.92, total: 1.01, sup: 'Curtume Vale' },
    { n: '05', comp: 'Forro palmilha',     mat: 'Pelica creme',        cor: { h: '#F2E6D3', name: 'Creme' },    qtd: '2,4',  un: 'dm²',  custo: 0.45, total: 1.08, sup: 'Pelicas RS' },
    { n: '06', comp: 'Solado',             mat: 'TR injetado',         cor: { h: '#1A1A1A', name: 'Preto' },    qtd: '1',    un: 'par',  custo: 6.80, total: 6.80, sup: 'Soltec' },
    { n: '07', comp: 'Palmilha interna',   mat: 'EVA 3mm',             cor: { h: '#1A1A1A', name: 'Preto' },    qtd: '1',    un: 'par',  custo: 0.90, total: 0.90, sup: 'EVA Pack' },
    { n: '08', comp: 'Cola PU branca',     mat: 'Adesivo PU',          cor: null,                                qtd: '12',   un: 'g',    custo: 0.044, total: 0.53, sup: 'Adhesivos PR' },
    { n: '09', comp: 'Linha costura',      mat: 'Poliéster 40',        cor: { h: '#1A1A1A', name: 'Preto' },    qtd: '3,8',  un: 'm',    custo: 0.05, total: 0.19, sup: 'Coats' },
    { n: '10', comp: 'Fivela metal',       mat: 'Zamac dourado',       cor: { h: '#C9A35A', name: 'Dourado' },  qtd: '1',    un: 'un',   custo: 1.40, total: 1.40, sup: 'Metálica SP' },
  ];
  const totalMat = materiais.reduce((a, m) => a + m.total, 0);

  return (
    <LightShell active="rect" breadcrumb="ENGENHARIA · RECEITAS" title="RECEITA DE MATERIAIS · BOM" actions={<>
      <button className="btn-l">Comparar versão</button>
      <button className="btn-l">Duplicar receita</button>
      <button className="btn-l-red btn-l">Salvar revisão</button>
    </>}>
      {/* HERO modelo + ref */}
      <div className="light-card" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 18, alignItems: 'center' }}>
          <ShoePhoto w={120} h={92} label={`REF ${m.ref}`}/>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="p-eyebrow">Receita BOM</div>
              <RefChip code={m.ref} size="md"/>
              <span className="p-pill p-pill-ok">Rev. 04</span>
              <span className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>aprovada 09/05/2026</span>
            </div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 4 }}>{m.name} · {m.cor}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
              <ColorChips swatches={m.swatches} size="sm" showLabels showNames/>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="p-eyebrow" style={{ fontSize: 9 }}>Custo MP / par</div>
            <div className="p-display" style={{ fontSize: 36, color: 'var(--p-red)', marginTop: 4 }}>R$ {totalMat.toFixed(2)}</div>
            <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>10 materiais</div>
          </div>
        </div>
      </div>

      {/* Lista de materiais */}
      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div className="p-eyebrow">Composição</div>
            <div className="p-display" style={{ fontSize: 20, marginTop: 4 }}>10 MATERIAIS</div>
          </div>
          <button className="btn-l">+ Adicionar material</button>
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th style={{ width: 28 }}>#</th>
            <th>Componente</th>
            <th>Material</th>
            <th>Cor</th>
            <th className="num">Qtd/par</th>
            <th className="num">Custo unit.</th>
            <th className="num">Total/par</th>
            <th>Fornecedor</th>
          </tr></thead>
          <tbody>
            {materiais.map((r, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ color: 'var(--p-mute)' }}>{r.n}</td>
                <td style={{ fontWeight: 600 }}>{r.comp}</td>
                <td>{r.mat}</td>
                <td>
                  {r.cor ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 12, height: 12, background: r.cor.h, border: '1px solid var(--p-ink)' }}/>
                      <span style={{ fontSize: 10.5 }}>{r.cor.name}</span>
                    </div>
                  ) : <span style={{ color: 'var(--p-mute)' }}>—</span>}
                </td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 600 }}>{r.qtd}</span><span className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginLeft: 3 }}>{r.un}</span></td>
                <td className="num"><span className="p-mono">R$ {r.custo.toFixed(2)}</span></td>
                <td className="num" style={{ fontWeight: 700, color: 'var(--p-red)' }}>R$ {r.total.toFixed(2)}</td>
                <td style={{ fontSize: 11, color: 'var(--p-mute)' }}>{r.sup}</td>
              </tr>
            ))}
            <tr>
              <td colSpan="6" style={{ background: 'var(--p-ink)', color: '#fff', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>CUSTO TOTAL MATERIAIS / PAR</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: '#fff', fontWeight: 700 }}>R$ {totalMat.toFixed(2)}</td>
              <td style={{ background: 'var(--p-ink)', color: '#fff' }}></td>
            </tr>
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.EngReceitas = EngReceitas;
