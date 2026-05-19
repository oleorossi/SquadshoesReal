// ESTOQUE · Histórico de movimentações + MRP (planejamento)

// ─── Histórico de Movimentações ──────────────────────
function EstoqueHistorico() {
  const movs = [
    { ts: '08/05 14:32', tipo: 'ENT',  doc: 'OC-2026-0214', item: 'Couro Caramelo 2.0',     sku: 'MP-CRO-CRM', qtd: '+180 m²',  saldo: '228 m²',  op: 'Recebimento Curtume Vale', user: 'marcio.l' },
    { ts: '08/05 13:48', tipo: 'SAÍ',  doc: 'OP-2851',      item: 'Couro Caramelo 2.0',     sku: 'MP-CRO-CRM', qtd: '−42 m²',   saldo: '48 m²',   op: 'Consumo OP-2851 corte',     user: 'cleber.b' },
    { ts: '08/05 11:14', tipo: 'SAÍ',  doc: 'OP-2851',      item: 'Couro Cru 2.0',          sku: 'MP-CRO-CRU', qtd: '−12 m²',   saldo: '92 m²',   op: 'Consumo OP-2851 tiras',     user: 'cleber.b' },
    { ts: '08/05 10:42', tipo: 'AJU',  doc: 'AJ-0028',      item: 'Cola PU Branca',         sku: 'MP-COL-PU',  qtd: '−2 kg',    saldo: '14 kg',   op: 'Inventário · perda evapor.', user: 'henrique.c' },
    { ts: '08/05 09:18', tipo: 'ENT',  doc: 'OC-2026-0212', item: 'Verniz Adocicado',       sku: 'MP-VRN-4280',qtd: '+400 dm²', saldo: '184 dm²', op: 'Recebimento Sintex SP',     user: 'marcio.l' },
    { ts: '07/05 16:42', tipo: 'SAÍ',  doc: 'OP-2847',      item: 'Couro Caramelo 2.0',     sku: 'MP-CRO-CRM', qtd: '−38 m²',   saldo: '90 m²',   op: 'Consumo OP-2847 cabedal',   user: 'cleber.b' },
    { ts: '07/05 14:08', tipo: 'TRANS',doc: 'TR-0042',      item: 'Sola TR-04',             sku: 'MP-SOLA-TR', qtd: '−80 pç',   saldo: '1.760 pç', op: 'Transf A1 → B2',            user: 'daniela.r' },
    { ts: '07/05 11:30', tipo: 'ENT',  doc: 'OC-2026-0210', item: 'Fivela Zamac Dourado',   sku: 'MP-FIV-ZD',  qtd: '+500 un',  saldo: '420 un',  op: 'Recebimento Metálica SP',    user: 'marcio.l' },
    { ts: '06/05 17:22', tipo: 'SAÍ',  doc: 'OP-2847',      item: 'Linha 40 Preto',         sku: 'MP-LN-40N',  qtd: '−1.596 m', saldo: '538 cones', op: 'Consumo OP-2847 costura',  user: 'marcia.l' },
    { ts: '06/05 09:48', tipo: 'DEV',  doc: 'DEV-0012',     item: 'Pelica Creme',           sku: 'MP-FOR-CRM', qtd: '+6 m',     saldo: '92 m',    op: 'Devolução refugo retalho',   user: 'sandra.m' },
  ];
  const tipoColor = { ENT: 'var(--p-ok)', SAÍ: 'var(--p-red)', AJU: 'var(--p-warn)', TRANS: 'var(--p-info)', DEV: 'var(--p-ok)' };

  return (
    <LightShell active="hist" breadcrumb="ESTOQUE · HISTÓRICO" title="HISTÓRICO DE MOVIMENTAÇÕES" actions={<>
      <button className="btn-l">Exportar CSV</button>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Filtros</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Entradas 7d',  v: '34',     col: 'var(--p-ok)' },
          { l: 'Saídas 7d',    v: '128',    col: 'var(--p-red)' },
          { l: 'Ajustes 7d',   v: '6',      col: 'var(--p-warn)' },
          { l: 'Transferências',v: '12',    col: 'var(--p-ink)' },
          { l: 'Devoluções',   v: '4',      col: 'var(--p-ok)' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.col }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['Todos', 'Entradas', 'Saídas', 'Ajustes', 'Transferências', 'Devoluções'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Timestamp</th><th>Tipo</th><th>Documento</th><th>Material</th><th>SKU</th>
            <th className="num">Movimento</th><th className="num">Saldo</th><th>Origem</th><th>Usuário</th>
          </tr></thead>
          <tbody>
            {movs.map((m, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{m.ts}</td>
                <td>
                  <span style={{
                    display: 'inline-block', background: tipoColor[m.tipo], color: '#fff',
                    padding: '2px 7px', fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  }}>{m.tipo}</span>
                </td>
                <td className="p-mono" style={{ fontSize: 10.5, fontWeight: 700 }}>{m.doc}</td>
                <td style={{ fontWeight: 600, fontSize: 11.5 }}>{m.item}</td>
                <td className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>{m.sku}</td>
                <td className="num" style={{ fontWeight: 700, color: m.qtd.startsWith('+') ? 'var(--p-ok)' : 'var(--p-red)' }}>{m.qtd}</td>
                <td className="num"><span className="p-mono">{m.saldo}</span></td>
                <td style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{m.op}</td>
                <td className="p-mono" style={{ fontSize: 10 }}>{m.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.EstoqueHistorico = EstoqueHistorico;

// ─── MRP — Planejamento de Necessidades de Materiais ─
function EstoqueMRP() {
  const needs = [
    { mat: 'Couro Caramelo 2.0',  sku: 'MP-CRO-CRM',  estoque: 48,  un: 'm²',    nec7d: 86,  nec14d: 142, def: 38,  status: 'urg', ops: ['OP-2851', 'OP-2867'] },
    { mat: 'Cola PU Branca',      sku: 'MP-COL-PU',   estoque: 14,  un: 'kg',    nec7d: 22,  nec14d: 38,  def: 8,   status: 'urg', ops: ['OP-2851', 'OP-2855', '+3'] },
    { mat: 'Verniz Adocicado',    sku: 'MP-VRN-4280', estoque: 184, un: 'dm²',   nec7d: 240, nec14d: 380, def: 56,  status: 'attn', ops: ['OP-2847', 'OP-2861'] },
    { mat: 'Pelica Creme',        sku: 'MP-FOR-CRM',  estoque: 92,  un: 'm',     nec7d: 64,  nec14d: 118, def: 0,   status: 'ok',  ops: ['OP-2843', 'OP-2855'] },
    { mat: 'Sola TR-04',          sku: 'MP-SOLA-TR',  estoque: 1760, un: 'pç',   nec7d: 1200, nec14d: 2840, def: 0,  status: 'ok',  ops: ['todas'] },
    { mat: 'Couro Cru 2.0',       sku: 'MP-CRO-CRU',  estoque: 92,  un: 'm²',    nec7d: 28,  nec14d: 56,  def: 0,   status: 'ok',  ops: ['OP-2851'] },
    { mat: 'Fivela Zamac Dourado',sku: 'MP-FIV-ZD',   estoque: 420, un: 'un',    nec7d: 540, nec14d: 980, def: 120, status: 'attn', ops: ['OP-2851', 'OP-2867'] },
  ];
  const st = {
    urg:  { l: 'URGENTE',   cls: 'p-pill-red' },
    attn: { l: 'ATENÇÃO',   cls: 'p-pill-warn' },
    ok:   { l: 'OK',        cls: 'p-pill-ok' },
  };
  return (
    <LightShell active="mrp" breadcrumb="ESTOQUE · MRP" title="MRP · NECESSIDADES DE MATERIAIS" actions={<>
      <button className="btn-l">Recalcular</button>
      <button className="btn-l-red btn-l">Gerar OCs sugeridas</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Materiais críticos', v: '2', s: 'ruptura iminente', red: true },
          { l: 'Em atenção',         v: '2', s: 'cobertura < 7d' },
          { l: 'OK',                 v: '38', s: 'em estoque' },
          { l: 'OCs sugeridas',      v: '4', s: 'R$ 28k' },
          { l: 'Horizonte',          v: '14d', s: 'fila + carteira' },
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
            <th>Material</th><th>SKU</th>
            <th className="num">Estoque</th>
            <th className="num">Necess. 7d</th>
            <th className="num">Necess. 14d</th>
            <th className="num">Déficit</th>
            <th>OPs que consomem</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            {needs.map((n, i) => (
              <tr key={i} style={n.status === 'urg' ? { background: 'var(--p-red-soft)' } : {}}>
                <td style={{ fontWeight: 600 }}>{n.mat}</td>
                <td className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{n.sku}</td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 700, color: n.status === 'urg' ? 'var(--p-red)' : 'var(--p-ink)' }}>{n.estoque}</span> <span className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)' }}>{n.un}</span></td>
                <td className="num"><span className="p-mono">{n.nec7d}</span></td>
                <td className="num"><span className="p-mono">{n.nec14d}</span></td>
                <td className="num"><span className="p-mono" style={{ fontWeight: n.def > 0 ? 700 : 400, color: n.def > 0 ? 'var(--p-red)' : 'var(--p-mute)' }}>{n.def > 0 ? '−' + n.def : '—'}</span></td>
                <td style={{ fontSize: 10 }}>
                  {n.ops.map((o, oi) => (
                    <span key={oi} className="p-mono" style={{ marginRight: 4, padding: '1px 5px', background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 9 }}>{o}</span>
                  ))}
                </td>
                <td><span className={`p-pill ${st[n.status].cls}`}>{st[n.status].l}</span></td>
                <td>
                  {n.def > 0 && <button className="btn-l-red btn-l" style={{ height: 24, fontSize: 10, padding: '0 8px' }}>Gerar OC</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.EstoqueMRP = EstoqueMRP;
