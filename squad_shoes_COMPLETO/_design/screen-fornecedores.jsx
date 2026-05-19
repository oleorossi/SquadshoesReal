// COMPRAS · FORNECEDORES — cadastro com performance, lead time, qualidade
function Fornecedores() {
  const forns = [
    { cod: 'F-018', nome: 'Curtume Vale',     cat: 'Couro',     uf: 'RS', cnpj: '04.118.428/0001-22', avg: 8.4, ot: 96, qc: 99, vol: 'R$ 184k', ult: '03/05', cont: 'Roberto V.',  st: 'A' },
    { cod: 'F-024', nome: 'Soltec',           cat: 'Solados',   uf: 'SP', cnpj: '12.882.022/0001-44', avg: 7.2, ot: 98, qc: 97, vol: 'R$ 142k', ult: '03/05', cont: 'Andrea S.',   st: 'A' },
    { cod: 'F-031', nome: 'Pelicas RS',       cat: 'Forros',    uf: 'RS', cnpj: '18.114.882/0001-05', avg: 10,  ot: 92, qc: 98, vol: 'R$ 88k',  ult: '01/05', cont: 'Marcio L.',   st: 'A' },
    { cod: 'F-052', nome: 'Sintex SP',        cat: 'Couro sint.', uf: 'SP', cnpj: '04.001.288/0001-77', avg: 6.0, ot: 88, qc: 94, vol: 'R$ 64k',  ult: '28/04', cont: 'Patricia A.', st: 'B' },
    { cod: 'F-064', nome: 'Adhesivos PR',     cat: 'Químicos',  uf: 'PR', cnpj: '11.999.412/0001-30', avg: 5.2, ot: 84, qc: 92, vol: 'R$ 32k',  ult: '02/05', cont: 'Wilson G.',   st: 'B' },
    { cod: 'F-072', nome: 'Coats',            cat: 'Linhas',    uf: 'SP', cnpj: '24.628.412/0001-90', avg: 4.8, ot: 99, qc: 99, vol: 'R$ 28k',  ult: '30/04', cont: 'Helena C.',   st: 'A' },
    { cod: 'F-088', nome: 'EVA Pack',         cat: 'Palmilhas', uf: 'SP', cnpj: '14.118.412/0001-04', avg: 9.5, ot: 90, qc: 96, vol: 'R$ 24k',  ult: '29/04', cont: 'Pedro M.',    st: 'B' },
    { cod: 'F-094', nome: 'Metálica SP',      cat: 'Aviamentos', uf: 'SP', cnpj: '08.412.220/0001-18', avg: 6.5, ot: 95, qc: 98, vol: 'R$ 18k',  ult: '24/04', cont: 'Letícia O.',  st: 'B' },
    { cod: 'F-112', nome: 'PolySole',         cat: 'Solados',   uf: 'RS', cnpj: '02.118.428/0001-77', avg: 11,  ot: 78, qc: 88, vol: 'R$ 12k',  ult: '15/04', cont: 'Marcelo P.',  st: 'C', red: true },
  ];
  return (
    <LightShell active="forn" breadcrumb="COMPRAS · FORNECEDORES" title="FORNECEDORES" actions={<>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Categoria</button>
      <button className="btn-l-red btn-l">+ Novo fornecedor</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Cadastrados', v: '42',     s: '8 categorias' },
          { l: 'Curva A',     v: '12',     s: '78% do volume' },
          { l: 'Em alerta',   v: '3',      s: 'OT < 85% ou QC < 90%', red: true },
          { l: 'OT médio',    v: '92%',    s: 'meta 95%' },
          { l: 'QC médio',    v: '96%',    s: 'aprovação' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Código</th><th>Fornecedor</th><th>Categoria</th><th>UF</th>
            <th className="num">Lead</th><th>On-time</th><th>Qualidade</th>
            <th className="num">Volume 90d</th><th>Última OC</th><th>Curva</th>
          </tr></thead>
          <tbody>
            {forns.map((f, i) => (
              <tr key={i} style={f.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{f.cod}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{f.nome}</div>
                  <div style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>contato: {f.cont}</div>
                </td>
                <td><span className="p-pill" style={{ fontSize: 8.5 }}>{f.cat}</span></td>
                <td className="p-mono" style={{ fontSize: 10.5, fontWeight: 600 }}>{f.uf}</td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 600 }}>{f.avg}d</span></td>
                <td style={{ width: 100 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: f.ot + '%', background: f.ot < 85 ? 'var(--p-red)' : f.ot < 95 ? 'var(--p-warn)' : 'var(--p-ink)' }}/>
                    </div>
                    <span className="p-mono" style={{ fontSize: 10, fontWeight: 600, color: f.ot < 85 ? 'var(--p-red)' : 'inherit' }}>{f.ot}%</span>
                  </div>
                </td>
                <td style={{ width: 100 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: f.qc + '%', background: f.qc < 90 ? 'var(--p-red)' : f.qc < 96 ? 'var(--p-warn)' : 'var(--p-ink)' }}/>
                    </div>
                    <span className="p-mono" style={{ fontSize: 10, fontWeight: 600, color: f.qc < 90 ? 'var(--p-red)' : 'inherit' }}>{f.qc}%</span>
                  </div>
                </td>
                <td className="num" style={{ fontWeight: 600 }}>{f.vol}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{f.ult}</td>
                <td>
                  <span style={{
                    display: 'inline-block', width: 20, height: 20, lineHeight: '20px', textAlign: 'center',
                    background: f.st === 'A' ? 'var(--p-ink)' : f.st === 'C' ? 'var(--p-red)' : 'var(--p-line-2)',
                    color: f.st === 'B' ? 'var(--p-ink)' : '#fff',
                    fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700,
                  }}>{f.st}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.Fornecedores = Fornecedores;
