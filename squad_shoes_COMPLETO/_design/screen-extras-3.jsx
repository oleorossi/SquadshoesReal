// COMPRAS (RFQ + Custos) + FINANCEIRO (Markup, Conciliação) + SISTEMA (Segurança)

// ─── RFQ ─────────────────────────────────────────────
function ComprasRFQ() {
  const rfqs = [
    { id: 'RFQ-026-014', item: 'Couro Caramelo 2.0mm', qtd: '200 m²', forn: 3, melhor: 'Curtume Vale', valor: 'R$ 92/m²', prazo: '12 dias', emit: '02/05', st: 'analise' },
    { id: 'RFQ-026-013', item: 'Cola PU Branca',       qtd: '80 kg',  forn: 4, melhor: 'Adhesivos PR',  valor: 'R$ 42/kg', prazo: '6 dias',  emit: '01/05', st: 'analise' },
    { id: 'RFQ-026-012', item: 'Sola TR · 34-40',      qtd: '2.000 par', forn: 2, melhor: 'Soltec',     valor: 'R$ 6,40/par', prazo: '8 dias', emit: '28/04', st: 'aprovado' },
    { id: 'RFQ-026-011', item: 'Pelica Creme',         qtd: '180 m',  forn: 3, melhor: 'Pelicas RS',    valor: 'R$ 16/m', prazo: '10 dias', emit: '26/04', st: 'aprovado' },
    { id: 'RFQ-026-010', item: 'Linha 40 sortida',     qtd: '300 cones', forn: 2, melhor: 'Coats',      valor: 'R$ 7,80/cone', prazo: '4 dias', emit: '25/04', st: 'rejeit' },
    { id: 'RFQ-026-009', item: 'EVA palmilha 3mm',     qtd: '3.000 par', forn: 2, melhor: 'EVA Pack',   valor: 'R$ 0,82/par', prazo: '14 dias', emit: '20/04', st: 'aprovado' },
  ];
  const st = {
    analise: { l: 'Em análise', cls: 'p-pill-warn' },
    aprovado: { l: 'Aprovado', cls: 'p-pill-ok' },
    rejeit:  { l: 'Rejeitado', cls: 'p-pill-red' },
  };
  return (
    <LightShell active="rfq" breadcrumb="COMPRAS · RFQ" title="COTAÇÕES (RFQ)" actions={<>
      <button className="btn-l-red btn-l">+ Nova cotação</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Abertas', v: '8',  s: 'aguardando resposta' },
          { l: 'Em análise', v: '4', s: 'comparando' },
          { l: 'Aprovadas mês', v: '18', s: 'R$ 142k economizado' },
          { l: 'Economia média', v: '12%', s: 'vs 1ª proposta' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 26, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>RFQ</th><th>Item</th><th>Qtd</th>
            <th className="num">Fornec.</th><th>Melhor proposta</th><th className="num">Preço</th>
            <th>Prazo</th><th>Emit.</th><th>Status</th>
          </tr></thead>
          <tbody>
            {rfqs.map((r, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{r.id}</td>
                <td style={{ fontWeight: 600 }}>{r.item}</td>
                <td className="p-mono" style={{ fontSize: 11 }}>{r.qtd}</td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 600 }}>{r.forn}</span></td>
                <td style={{ fontWeight: 600 }}>{r.melhor}</td>
                <td className="num" style={{ fontWeight: 700 }}>{r.valor}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{r.prazo}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{r.emit}</td>
                <td><span className={`p-pill ${st[r.st].cls}`}>{st[r.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.ComprasRFQ = ComprasRFQ;

// ─── Markup (Financeiro) ─────────────────────────────
function FinMarkup() {
  const m = [
    { ref: 'I901', mod: MODELOS['I901'], custo: 21.13, preco: 36.95, mkp: 75, marg: 42.8 },
    { ref: 'I905', mod: MODELOS['I905'], custo: 22.42, preco: 38.40, mkp: 71, marg: 41.6 },
    { ref: 'I918', mod: MODELOS['I918'], custo: 24.80, preco: 42.20, mkp: 70, marg: 41.2 },
    { ref: 'I312', mod: { name: 'Tênis Nova',  ref: 'I312', cor: 'Branco',  sku: 'TN-BR',  swatches: [{ h: '#F4F0E5', label: 'CAB', name: 'Branco' }, { h: '#0E0E0E', label: 'DT', name: 'Detalhe' }] }, custo: 28.40, preco: 49.80, mkp: 75, marg: 43.0 },
    { ref: 'I422', mod: { name: 'Bota Aurora', ref: 'I422', cor: 'Castor',  sku: 'BA-CST', swatches: [{ h: '#7A5A3E', label: 'CAB', name: 'Castor' }, { h: '#1A1A1A', label: 'SL', name: 'Preto' }] }, custo: 38.20, preco: 68.40, mkp: 79, marg: 44.2 },
  ];
  return (
    <LightShell active="mkp" breadcrumb="FINANCEIRO · MARKUP" title="MARKUP · POR MODELO" actions={<>
      <button className="btn-l">Exportar</button>
      <button className="btn-l">Simular meta</button>
    </>}>
      <div className="light-card" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18 }}>
          {[
            { l: 'Markup médio',    v: '74%' },
            { l: 'Margem média',    v: '42,5%' },
            { l: 'Custo médio/par', v: 'R$ 27,00' },
            { l: 'Preço médio',     v: 'R$ 47,15' },
          ].map((k, i) => (
            <div key={i}>
              <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{k.l}</div>
              <div className="p-display" style={{ fontSize: 24, marginTop: 4 }}>{k.v}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl">
          <thead><tr>
            <th>Modelo · REF</th><th>Cor</th>
            <th className="num">Custo</th><th className="num">Preço</th>
            <th>Markup (preço − custo)</th><th className="num">%</th><th className="num">Margem</th>
          </tr></thead>
          <tbody>
            {m.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--p-line)' }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ShoePhoto w={48} h={36} label=""/>
                    <div>
                      <div style={{ fontWeight: 600 }}>{r.mod.name}</div>
                      <RefChip code={r.ref} size="sm"/>
                    </div>
                  </div>
                </td>
                <td><ColorChips swatches={r.mod.swatches} size="xs" showLabels={false} showNames={false}/></td>
                <td className="num"><span className="p-mono" style={{ color: 'var(--p-mute)' }}>R$ {r.custo.toFixed(2)}</span></td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 700 }}>R$ {r.preco.toFixed(2)}</span></td>
                <td>
                  <div style={{ position: 'relative', height: 16, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (r.custo / r.preco) * 100 + '%', background: 'var(--p-line-2)' }}/>
                    <div style={{ position: 'absolute', left: (r.custo / r.preco) * 100 + '%', top: 0, bottom: 0, right: 0, background: 'var(--p-red)' }}/>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px', fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: 700 }}>
                      <span style={{ color: 'var(--p-ink)' }}>R$ {r.custo.toFixed(2)}</span>
                      <span style={{ color: '#fff' }}>+ R$ {(r.preco - r.custo).toFixed(2)}</span>
                    </div>
                  </div>
                </td>
                <td className="num"><span style={{ fontFamily: 'Anton', fontSize: 18 }}>{r.mkp}%</span></td>
                <td className="num" style={{ fontWeight: 700, color: 'var(--p-ok)' }}>{r.marg}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.FinMarkup = FinMarkup;

// ─── Conciliação bancária ────────────────────────────
function FinConciliacao() {
  const mov = [
    { dt: '08/05', desc: 'Pagto · Curtume Vale',         valor: -14400, banco: 'Itaú · 9214', sis: 'OC-2026-0214', st: 'conc' },
    { dt: '08/05', desc: 'Receb · VIP Shoes Araruama',   valor: 28840,  banco: 'Itaú · 9214', sis: 'NF 189.412',   st: 'conc' },
    { dt: '07/05', desc: 'Pagto · Soltec',               valor: -4080,  banco: 'BB · 4424',   sis: 'OC-2026-0213', st: 'conc' },
    { dt: '07/05', desc: 'Receb · Brioni Calçados',      valor: 18420,  banco: 'Itaú · 9214', sis: 'NF 189.411',   st: 'conc' },
    { dt: '07/05', desc: 'Pagto · Energia Elétrica',     valor: -8420,  banco: 'BB · 4424',   sis: '—',            st: 'sem' },
    { dt: '06/05', desc: 'Tarifa bancária',              valor: -38,    banco: 'Itaú · 9214', sis: '—',            st: 'sem' },
    { dt: '06/05', desc: 'Receb · Pampas Calçados',      valor: 19840,  banco: 'BB · 4424',   sis: 'NF 189.408',   st: 'conc' },
    { dt: '05/05', desc: 'TED não identificada',         valor: 4200,   banco: 'Itaú · 9214', sis: '?',            st: 'divg', red: true },
  ];
  const st = {
    conc: { l: 'Conciliado',     cls: 'p-pill-ok' },
    sem:  { l: 'Sem doc',        cls: 'p-pill-warn' },
    divg: { l: 'Divergência',    cls: 'p-pill-red' },
  };
  return (
    <LightShell active="conc" breadcrumb="FINANCEIRO · CONCILIAÇÃO" title="CONCILIAÇÃO BANCÁRIA" actions={<>
      <button className="btn-l">Importar OFX</button>
      <button className="btn-l-red btn-l">Conciliar automático</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Movimentos 30d', v: '184',     s: 'em 2 bancos' },
          { l: 'Conciliados',    v: '94%',     s: '172 / 184' },
          { l: 'Pendentes',      v: '8',       s: 'sem doc', red: true },
          { l: 'Divergências',   v: '4',       s: 'requer revisão', red: true },
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
            <th>Data</th><th>Descrição</th><th className="num">Valor</th>
            <th>Conta</th><th>Sistema</th><th>Status</th>
          </tr></thead>
          <tbody>
            {mov.map((m, i) => (
              <tr key={i} style={m.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontSize: 11, fontWeight: 600 }}>{m.dt}</td>
                <td style={{ fontWeight: 500 }}>{m.desc}</td>
                <td className="num" style={{ fontWeight: 700, color: m.valor > 0 ? 'var(--p-ok)' : 'var(--p-red)' }}>{m.valor > 0 ? '+' : ''}R$ {Math.abs(m.valor).toLocaleString('pt-BR')}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{m.banco}</td>
                <td className="p-mono" style={{ fontSize: 10.5, fontWeight: m.sis === '?' ? 700 : 400, color: m.sis === '?' || m.sis === '—' ? 'var(--p-mute)' : 'var(--p-ink)' }}>{m.sis}</td>
                <td><span className={`p-pill ${st[m.st].cls}`}>{st[m.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.FinConciliacao = FinConciliacao;

// ─── Segurança (Sistema) — usuários + permissões ─────
function SisSeguranca() {
  const users = [
    { id: 'renata.m',  nome: 'Renata Mota',     papel: 'Admin',      setor: 'PCP',         mfa: true,  ultLogin: '08/05 08:30', perm: ['*'] },
    { id: 'tatiana.a', nome: 'Tatiana Almeida', papel: 'Engenharia', setor: 'Eng.',        mfa: true,  ultLogin: '08/05 14:32', perm: ['FT', 'Solados', 'Silks'] },
    { id: 'marcia.l',  nome: 'Marcia Lopes',    papel: 'Operador',   setor: 'Costura',     mfa: false, ultLogin: '08/05 07:02', perm: ['Apontar', 'Ver OP'] },
    { id: 'marcio.l',  nome: 'Márcio Lima',     papel: 'Suprim.',    setor: 'Compras',     mfa: true,  ultLogin: '08/05 13:55', perm: ['OC', 'RFQ', 'Forn.'] },
    { id: 'helena.c',  nome: 'Helena Costa',    papel: 'Financeiro', setor: 'Financeiro',  mfa: true,  ultLogin: '08/05 11:42', perm: ['NF-e', 'AR', 'AP'] },
    { id: 'admin',     nome: 'Administrador',   papel: 'Root',       setor: 'TI',          mfa: true,  ultLogin: '07/05 23:14', perm: ['*'] },
    { id: 'wilson.g',  nome: 'Wilson Gomes',    papel: 'Operador',   setor: 'Corte',       mfa: false, ultLogin: 'BLOQUEADO',   perm: ['Apontar'], red: true },
  ];
  return (
    <LightShell active="seg" breadcrumb="SISTEMA · SEGURANÇA" title="USUÁRIOS & PERMISSÕES" actions={<>
      <button className="btn-l">Política de senha</button>
      <button className="btn-l-red btn-l">+ Novo usuário</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Usuários ativos', v: '38',  s: 'de 64 colab.' },
          { l: 'Admin',           v: '2',   s: 'acesso total' },
          { l: 'MFA habilitado',  v: '78%', s: '30 de 38' },
          { l: 'Bloqueados',      v: '1',   s: 'última hora', red: true },
          { l: 'Tentativas falhas',v: '4',  s: 'hoje', red: true },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 26, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Login</th><th>Nome</th><th>Papel</th><th>Setor</th>
            <th>MFA</th><th>Último login</th><th>Permissões</th>
          </tr></thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={i} style={u.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{u.id}</td>
                <td style={{ fontWeight: 600 }}>{u.nome}</td>
                <td>
                  <span style={{
                    display: 'inline-block',
                    background: u.papel === 'Root' ? 'var(--p-red)' : u.papel === 'Admin' ? 'var(--p-ink)' : 'var(--p-line-2)',
                    color: u.papel === 'Operador' ? 'var(--p-ink)' : '#fff',
                    padding: '2px 7px',
                    fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  }}>{u.papel}</span>
                </td>
                <td style={{ fontSize: 11 }}>{u.setor}</td>
                <td>
                  {u.mfa ? <span className="p-pill p-pill-ok">ON</span> : <span className="p-pill p-pill-warn">OFF</span>}
                </td>
                <td className="p-mono" style={{ fontSize: 10.5, color: u.red ? 'var(--p-red)' : 'inherit', fontWeight: u.red ? 700 : 400 }}>{u.ultLogin}</td>
                <td style={{ fontSize: 10 }}>
                  {u.perm.map((p, pi) => (
                    <span key={pi} className="p-mono" style={{ marginRight: 4, padding: '1px 5px', background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>{p}</span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.SisSeguranca = SisSeguranca;
