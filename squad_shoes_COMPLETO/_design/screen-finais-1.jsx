// LOTE FINAL 1: Custos Insumos, Planejamento Compras, Financeiro geral, CNAB

// ─── Custos de Insumos ──────────────────────────────
function ComprasCustos() {
  const itens = [
    { mat: 'Couro Caramelo 2.0',  un: 'm²',  preco30d: [88,88,90,92,92,92], var: '+4,5%', forn: 'Curtume Vale',     ult: '03/05' },
    { mat: 'Cola PU Branca',       un: 'kg',  preco30d: [38,40,42,42,44,44], var: '+15,8%', forn: 'Adhesivos PR',     ult: '02/05', red: true },
    { mat: 'Sola TR-04',           un: 'par', preco30d: [6.5,6.6,6.8,6.8,6.8,6.8], var: '+4,6%', forn: 'Soltec',     ult: '03/05' },
    { mat: 'Verniz Adocicado',     un: 'dm²', preco30d: [1.10,1.10,1.12,1.12,1.12,1.12], var: '+1,8%', forn: 'Sintex SP', ult: '28/04' },
    { mat: 'Pelica Creme',         un: 'm',   preco30d: [18,18,18,18,18,18],   var: '0%',    forn: 'Pelicas RS',       ult: '01/05' },
    { mat: 'Linha 40 sortida',     un: 'cone', preco30d: [8.2,8.2,8.2,8.2,8.0,8.0], var: '−2,4%', forn: 'Coats',    ult: '30/04' },
  ];
  return (
    <LightShell active="cins" breadcrumb="COMPRAS · CUSTOS DE INSUMOS" title="EVOLUÇÃO DE CUSTOS · 30 DIAS">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Índice geral',  v: '+4,2%', s: 'vs mês ant.' },
          { l: 'Maior alta',    v: '+15,8%', s: 'Cola PU', red: true },
          { l: 'Em queda',      v: '2',     s: 'Linha 40, Couro Preto' },
          { l: 'Estável',       v: '8',     s: 'sem variação' },
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
            <th>Material</th><th>Unid.</th><th>Variação 30d</th>
            <th className="num">Atual</th><th className="num">Δ 30d</th><th>Fornecedor</th><th>Última OC</th>
          </tr></thead>
          <tbody>
            {itens.map((m, i) => {
              const max = Math.max(...m.preco30d);
              const min = Math.min(...m.preco30d);
              const atual = m.preco30d[m.preco30d.length - 1];
              return (
                <tr key={i} style={m.red ? { background: 'var(--p-red-soft)' } : {}}>
                  <td style={{ fontWeight: 600 }}>{m.mat}</td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{m.un}</td>
                  <td style={{ width: 180 }}>
                    {/* sparkline */}
                    <svg viewBox="0 0 100 24" style={{ width: '100%', height: 24 }} preserveAspectRatio="none">
                      <polyline points={m.preco30d.map((v, j) => `${(j / (m.preco30d.length - 1)) * 100},${22 - ((v - min) / Math.max(0.01, max - min)) * 20}`).join(' ')}
                        fill="none" stroke={m.red ? 'var(--p-red)' : 'var(--p-ink)'} strokeWidth="1.5"/>
                    </svg>
                  </td>
                  <td className="num"><span className="p-mono" style={{ fontWeight: 700 }}>R$ {atual.toFixed(2)}</span></td>
                  <td className="num"><span className="p-mono" style={{ fontWeight: 700, color: m.var.startsWith('+') ? (m.red ? 'var(--p-red)' : 'var(--p-warn)') : m.var.startsWith('−') ? 'var(--p-ok)' : 'var(--p-mute)' }}>{m.var}</span></td>
                  <td style={{ fontSize: 11 }}>{m.forn}</td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{m.ult}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.ComprasCustos = ComprasCustos;

// ─── Planejamento de Compras ────────────────────────
function ComprasPlan() {
  const plan = [
    { sem: 'W19', cor: 'Couro Caramelo', valor: 14400, ocs: 1 },
    { sem: 'W19', cor: 'Cola PU',         valor: 3520, ocs: 2 },
    { sem: 'W20', cor: 'Couro Preto',     valor: 22000, ocs: 1 },
    { sem: 'W20', cor: 'Pelica Creme',    valor: 1080, ocs: 1 },
    { sem: 'W21', cor: 'Sola TR',         valor: 12800, ocs: 1 },
    { sem: 'W22', cor: 'EVA',             valor: 1800, ocs: 1 },
  ];
  return (
    <LightShell active="plan" breadcrumb="COMPRAS · PLANEJAMENTO" title="PLANEJAMENTO · PRÓXIMAS 4 SEMANAS">
      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {['W19', 'W20', 'W21', 'W22'].map(sem => {
            const itens = plan.filter(p => p.sem === sem);
            const tot = itens.reduce((a, p) => a + p.valor, 0);
            return (
              <div key={sem} style={{ border: '1px solid var(--p-line)', padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontFamily: 'Anton', fontSize: 22 }}>{sem}</span>
                  <span className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{itens.length} OCs</span>
                </div>
                <div style={{ fontFamily: 'Anton', fontSize: 24, color: 'var(--p-red)', marginTop: 6 }}>R$ {(tot/1000).toFixed(1)}k</div>
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--p-line)' }}>
                  {itens.map((it, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, padding: '2px 0' }}>
                      <span>{it.cor}</span>
                      <span className="p-mono" style={{ fontWeight: 700 }}>R$ {(it.valor/1000).toFixed(1)}k</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </LightShell>
  );
}
window.ComprasPlan = ComprasPlan;

// ─── Financeiro Geral ────────────────────────────────
function FinPainel() {
  return (
    <LightShell active="fin" breadcrumb="FINANCEIRO · PAINEL" title="VISÃO FINANCEIRA · MAIO/2026">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Receita mês',    v: 'R$ 1,24M', s: '+18% vs abr', col: 'var(--p-ok)' },
          { l: 'Custo mês',      v: 'R$ 720k',  s: 'MP + MO + indireto' },
          { l: 'Margem bruta',   v: '42%',      s: 'meta 40%', col: 'var(--p-ok)' },
          { l: 'Fluxo caixa 30d',v: '+R$ 184k', s: 'previsto', col: 'var(--p-ok)' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.col || 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Fluxo de caixa · 30 dias</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 140, padding: '14px 0', borderBottom: '1px solid var(--p-line)' }}>
            {[1240, 1180, 1380, 1280, 1320, 1380, 1240, 1180, 1140, 1280, 1320, 1380, 1420, 1480, 1280, 1240, 1180, 1340, 1380, 1320, 1280, 1240, 1180, 1140, 1100, 1080, 1120, 1180, 1240, 1280].map((v, i) => {
              const day = i + 1;
              const isToday = day === 8;
              return (
                <div key={i} style={{ flex: 1, height: (v / 1500) * 100 + '%', background: isToday ? 'var(--p-red)' : v > 1300 ? 'var(--p-ok)' : 'var(--p-ink)', minHeight: 2 }}/>
              );
            })}
          </div>
          <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 8 }}>Maio/2026 · entrada líquida diária (R$ × 100)</div>
        </div>
        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Composição mês</div>
          {[
            { l: 'NF-e emitidas',   v: 'R$ 1,24M', col: 'var(--p-ok)' },
            { l: 'OC pagas',        v: '−R$ 240k', col: 'var(--p-red)' },
            { l: 'Folha + encargos',v: '−R$ 184k', col: 'var(--p-red)' },
            { l: 'Tributos',        v: '−R$ 92k',  col: 'var(--p-red)' },
            { l: 'Demais despesas', v: '−R$ 48k',  col: 'var(--p-red)' },
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 4 ? '1px solid var(--p-line)' : 'none' }}>
              <span style={{ fontSize: 12 }}>{r.l}</span>
              <span className="p-mono" style={{ fontWeight: 700, color: r.col }}>{r.v}</span>
            </div>
          ))}
          <div style={{ marginTop: 14, padding: 12, background: 'var(--p-ink)', color: '#fff' }}>
            <div className="p-eyebrow" style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)' }}>RESULTADO LÍQUIDO</div>
            <div style={{ fontFamily: 'Anton', fontSize: 26, marginTop: 4 }}>R$ 676k</div>
          </div>
        </div>
      </div>
    </LightShell>
  );
}
window.FinPainel = FinPainel;

// ─── CNAB / Boletos ────────────────────────────────
function FinCNAB() {
  const remessas = [
    { id: 'REM-2026-128', banco: 'Itaú · 9214', titulos: 42, valor: 184800, dt: '08/05 10:30', st: 'aprov',  retorno: 'pendente' },
    { id: 'REM-2026-127', banco: 'BB · 4424',   titulos: 28, valor: 92400,  dt: '07/05 16:00', st: 'aprov',  retorno: '24 baixas · 4 erros' },
    { id: 'REM-2026-126', banco: 'Itaú · 9214', titulos: 18, valor: 64200,  dt: '06/05 14:00', st: 'liq',    retorno: '18 baixas OK' },
    { id: 'REM-2026-125', banco: 'BB · 4424',   titulos: 12, valor: 32800,  dt: '05/05 11:00', st: 'liq',    retorno: '12 baixas OK' },
  ];
  const st = {
    aprov: { l: 'Em banco',     cls: 'p-pill-warn' },
    liq:   { l: 'Liquidado',    cls: 'p-pill-ok' },
  };
  return (
    <LightShell active="cnab" breadcrumb="FINANCEIRO · CNAB / BOLETOS" title="CNAB · REMESSAS E RETORNOS" actions={<>
      <button className="btn-l">Importar retorno</button>
      <button className="btn-l-red btn-l">+ Gerar remessa</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Remessas mês',    v: '14',  s: '184 títulos' },
          { l: 'Em banco',        v: '2',   s: 'aguardando retorno', red: true },
          { l: 'Boletos pagos',   v: '142', s: '74% do mês', col: 'var(--p-ok)' },
          { l: 'Erros retorno',   v: '4',   s: 'requer ação', red: true },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : k.col || 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Remessa</th><th>Banco</th><th className="num">Títulos</th>
            <th className="num">Valor</th><th>Enviada em</th><th>Status</th><th>Retorno</th>
          </tr></thead>
          <tbody>
            {remessas.map((r, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{r.id}</td>
                <td className="p-mono" style={{ fontWeight: 600, fontSize: 11 }}>{r.banco}</td>
                <td className="num">{r.titulos}</td>
                <td className="num" style={{ fontWeight: 700 }}>R$ {r.valor.toLocaleString('pt-BR')}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{r.dt}</td>
                <td><span className={`p-pill ${st[r.st].cls}`}>{st[r.st].l}</span></td>
                <td style={{ fontSize: 11, color: r.retorno.includes('erros') ? 'var(--p-red)' : 'var(--p-mute)', fontWeight: r.retorno.includes('erros') ? 600 : 400 }}>{r.retorno}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.FinCNAB = FinCNAB;
