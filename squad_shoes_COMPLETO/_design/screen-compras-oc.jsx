// COMPRAS · ORDENS DE COMPRA — listagem + KPIs
function ComprasOC() {
  const ocs = [
    { id: 'OC-2026-0218', forn: 'Curtume Vale',    item: 'Couro caramelo 2.0mm', qtd: '180 m²',   valor: 14400,  emit: '03/05', prev: '12/05', st: 'producao' },
    { id: 'OC-2026-0217', forn: 'Soltec',          item: 'Sola TR-04 (34-40)',   qtd: '600 pares', valor: 4080,   emit: '03/05', prev: '10/05', st: 'aprovada' },
    { id: 'OC-2026-0216', forn: 'Adhesivos PR',    item: 'Cola PU branca',        qtd: '40 kg',    valor: 1760,   emit: '02/05', prev: '08/05', st: 'urgente', red: true },
    { id: 'OC-2026-0215', forn: 'Pelicas RS',      item: 'Pelica creme',           qtd: '60 m',    valor: 1080,   emit: '01/05', prev: '11/05', st: 'producao' },
    { id: 'OC-2026-0214', forn: 'Coats',           item: 'Linha 40 sortida',      qtd: '120 cones', valor: 984,    emit: '30/04', prev: '06/05', st: 'recebida' },
    { id: 'OC-2026-0213', forn: 'EVA Pack',        item: 'EVA palmilha 3mm',      qtd: '2000 pç',  valor: 1800,   emit: '29/04', prev: '08/05', st: 'transito' },
    { id: 'OC-2026-0212', forn: 'Sintex SP',       item: 'Verniz adocicado',     qtd: '400 dm²',  valor: 448,    emit: '28/04', prev: '04/05', st: 'recebida' },
    { id: 'OC-2026-0211', forn: 'Curtume Vale',    item: 'Couro preto 2.5mm',    qtd: '120 m²',  valor: 10560,   emit: '26/04', prev: '06/05', st: 'recebida' },
    { id: 'OC-2026-0210', forn: 'Metálica SP',     item: 'Fivela Zamac dourado', qtd: '500 un',  valor: 700,    emit: '24/04', prev: '02/05', st: 'recebida' },
  ];
  const st = {
    aprovada: { l: 'Aprovada', cls: 'p-pill-ok' },
    producao: { l: 'Em produção', cls: 'p-pill-warn' },
    transito: { l: 'Em trânsito', cls: 'p-pill' },
    recebida: { l: 'Recebida', cls: 'p-pill-ok' },
    urgente: { l: 'Urgente', cls: 'p-pill-red' },
  };
  return (
    <LightShell active="oc" breadcrumb="COMPRAS · ORDENS DE COMPRA" title="ORDENS DE COMPRA" actions={<>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Fornecedor</button>
      <button className="btn-l-red btn-l">+ Nova OC</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
        {[
          { l: 'OCs abertas',   v: '18',         s: 'aguardando' },
          { l: 'Em trânsito',   v: '7',          s: 'previstas 7d' },
          { l: 'Urgentes',      v: '3',          s: 'ruptura iminente', red: true },
          { l: 'Valor aberto',  v: 'R$ 38k',     s: 'a pagar 30d' },
          { l: 'Lead time méd.',v: '8d',         s: '12 fornecedores' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 10 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 24, marginTop: 4, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['Todas', 'Aprovadas', 'Em produção', 'Trânsito', 'Recebidas', 'Urgentes'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>OC</th><th>Fornecedor</th><th>Item</th><th>Qtd</th><th className="num">Valor</th>
            <th>Emit.</th><th>Prev.</th><th>Lead</th><th>Status</th>
          </tr></thead>
          <tbody>
            {ocs.map((o, i) => {
              const days = Math.floor((new Date('2026-05-' + o.prev.split('/')[0]) - new Date('2026-05-' + o.emit.split('/')[0])) / (1000*60*60*24));
              return (
                <tr key={i} style={o.red ? { background: 'var(--p-red-soft)' } : {}}>
                  <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{o.id}</td>
                  <td style={{ fontWeight: 600 }}>{o.forn}</td>
                  <td style={{ fontSize: 11.5 }}>{o.item}</td>
                  <td className="p-mono" style={{ fontSize: 11 }}>{o.qtd}</td>
                  <td className="num" style={{ fontWeight: 600 }}>R$ {o.valor.toLocaleString('pt-BR')}</td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{o.emit}</td>
                  <td className="p-mono" style={{ fontSize: 10.5, fontWeight: o.red ? 700 : 400, color: o.red ? 'var(--p-red)' : 'inherit' }}>{o.prev}</td>
                  <td className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{days}d</td>
                  <td><span className={`p-pill ${st[o.st].cls}`}>{st[o.st].l}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.ComprasOC = ComprasOC;
