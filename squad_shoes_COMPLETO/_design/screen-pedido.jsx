// PEDIDO DE VENDA — redesign claro, light tone, vermelho nos destaques
// 4 artboards: Lista (kanban), Novo, Detalhe, Conversão→OP
// Usa MODELOS, ColorChips, RefChip, hexFor, tiraSwatches (exportados de screen-etiquetas)

// ── Shared sample order ──
const SAMPLE_ITEMS = [
  { ref: 'I901', name: 'I901', color: 'ADOCICADO', material: 'Verniz preto', tiras: ['ADOCICADO','ADOCICADO','ADOCICADO'],
    grade: { 25:4, 26:4, 27:4, 28:4, 29:2, 30:2, 31:2, 32:2 }, price: 20.80 },
  { ref: 'I901', name: 'I901', color: 'CHAMPAGNE', material: 'Verniz creme', tiras: ['CHAMPAGNE','CHAMPAGNE','CHAMPAGNE'],
    grade: { 25:4, 26:4, 27:4, 28:4, 29:2, 30:2, 31:2, 32:2 }, price: 20.80 },
  { ref: 'I905', name: 'I905', color: 'CARAMELO · CRU · CARAMELO', material: 'Couro', tiras: ['CARAMELO','CRU','CARAMELO'],
    grade: { 25:4, 26:4, 27:4, 28:4, 29:2, 30:2, 31:2, 32:2 }, price: 22.40 },
  { ref: 'I110', name: 'I110', color: 'ADOCICADO', material: 'Verniz preto', tiras: ['ADOCICADO'],
    grade: { 25:4, 26:4, 27:4, 28:4, 29:2, 30:2, 31:2, 32:2 }, price: 20.80 },
];
const SIZES = [25, 26, 27, 28, 29, 30, 31, 32];

// ────────────────── 1. LISTA ──────────────────
function PedidosLista() {
  const orders = [
    { id: 'PV-2026-00097', cli: 'VIP Shoes Araruama', city: 'Araruama / RJ', tot: 2995.20, pares: 144, status: 'producao', due: '08/04', late: false, rep: 'MA13' },
    { id: 'PV-2026-00094', cli: 'VO Figueira',         city: 'Niterói / RJ', tot: 3755.16, pares: 108, status: 'rascunho', due: '05/04', late: true,  rep: '—' },
    { id: 'PV-2026-00093', cli: 'Tiana de Icaraí',     city: 'Niterói / RJ', tot: 3755.16, pares: 108, status: 'rascunho', due: '05/04', late: true,  rep: '—' },
    { id: 'PV-2026-00092', cli: 'Alcineu de Madureira', city: 'Madureira / RJ', tot: 3755.16, pares: 108, status: 'aprovado', due: '05/04', late: true, rep: '—' },
    { id: 'PV-2026-00083', cli: 'Lojão de Niterói',    city: 'Niterói / RJ', tot: 3755.16, pares: 108, status: 'aprovado', due: '05/04', late: true, rep: '—' },
    { id: 'PV-2026-00067', cli: 'VIP Kids Calçados',   city: 'Niterói / RJ', tot: 2995.20, pares: 144, status: 'producao', due: '08/04', late: true, rep: 'MA13' },
  ];
  const cols = [
    { k: 'rascunho',  l: 'Rascunho',     c: 'var(--p-mute)' },
    { k: 'aprovado',  l: 'Aprovado',     c: 'var(--p-info)' },
    { k: 'producao',  l: 'Em Produção',  c: 'var(--p-red)' },
    { k: 'pronto',    l: 'Pronto',       c: 'var(--p-warn)' },
    { k: 'faturado',  l: 'Faturado',     c: 'var(--p-ok)' },
  ];

  return (
    <div className="light-app" style={{ width: 1480, height: 920, display: 'flex', background: 'var(--p-bg)' }}>
      {/* Light Sidebar */}
      <aside style={{ width: 232, background: 'white', borderRight: '1px solid var(--p-line)', flexShrink: 0 }}>
        <div style={{ padding: '20px 18px', borderBottom: '1px solid var(--p-line)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <PIcon.Logo size={32}/>
          <div>
            <div style={{ fontFamily: 'Anton', fontSize: 16, letterSpacing: '0.04em' }}>SQUAD SHOES</div>
            <div className="p-eyebrow" style={{ fontSize: 8, color: 'var(--p-red)' }}>Gestão Industrial</div>
          </div>
        </div>
        <nav style={{ padding: '16px 10px' }}>
          {[
            { g: '', items: [{ id: 'painel', l: 'Painel', i: 'Dashboard' }] },
            { g: 'Comercial', items: [
              { id: 'pedidos', l: 'Pedidos de Venda', i: 'PCP', active: true },
              { id: 'pronta', l: 'Pronta-Entrega', i: 'Embalagem' },
              { id: 'clientes', l: 'Clientes', i: 'Equipe' },
            ]},
            { g: 'Produção', items: [
              { id: 'pcp', l: 'PCP', i: 'PCP' },
              { id: 'ops', l: 'Ordens (OPs)', i: 'Materiais' },
              { id: 'live', l: 'Live', i: 'Dashboard' },
              { id: 'qual', l: 'Qualidade', i: 'Qualidade' },
            ]},
            { g: 'Engenharia', items: [
              { id: 'fichas', l: 'Fichas Técnicas', i: 'Relatorios' },
            ]},
            { g: 'Estoque', items: [
              { id: 'pos', l: 'Posição', i: 'Materiais' },
            ]},
          ].map((g, gi) => (
            <div key={gi} style={{ marginBottom: 14 }}>
              {g.g && <div className="p-eyebrow" style={{ padding: '8px 10px 6px', fontSize: 8.5, color: 'var(--p-dim)' }}>{g.g}</div>}
              {g.items.map(it => {
                const Ic = Icon[it.i];
                const a = it.active;
                return (
                  <div key={it.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', borderRadius: 4, marginBottom: 1,
                    background: a ? 'var(--p-red-soft)' : 'transparent',
                    color: a ? 'var(--p-red)' : 'var(--p-ink-2)',
                    borderLeft: '2px solid ' + (a ? 'var(--p-red)' : 'transparent'),
                    fontSize: 12.5, fontWeight: a ? 600 : 500, cursor: 'pointer',
                  }}>
                    <Ic style={{ color: a ? 'var(--p-red)' : 'var(--p-mute)', width: 15, height: 15 }}/>
                    {it.l}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <header style={{ height: 64, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 14, background: 'white', borderBottom: '1px solid var(--p-line)' }}>
          <div className="p-eyebrow" style={{ fontSize: 9, color: 'var(--p-mute)' }}>COMERCIAL · PEDIDOS DE VENDA</div>
          <div style={{ flex: 1 }}/>
          <div style={{ position: 'relative', width: 280 }}>
            <Icon.Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--p-mute)', width: 14, height: 14 }}/>
            <input className="light-input" placeholder="Buscar PV, cliente, referência…" style={{ paddingLeft: 32, height: 34 }}/>
          </div>
          <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Filtrar</button>
          <button className="btn-l-red btn-l"><Icon.Plus style={{ width: 13, height: 13 }}/> Novo Pedido</button>
        </header>

        <main style={{ flex: 1, padding: '24px 28px', overflow: 'auto' }}>
          {/* Headline + KPIs */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
            <div>
              <div className="p-eyebrow">Comercial · Maio 2026</div>
              <div className="p-display" style={{ fontSize: 42, marginTop: 6, color: 'var(--p-ink)' }}>Pedidos de Venda</div>
              <div style={{ color: 'var(--p-mute)', fontSize: 12.5, marginTop: 6 }}>29 pedidos · 720 pares · <span className="p-mono" style={{ color: 'var(--p-ink)', fontWeight: 700 }}>R$ 21.011,04</span> em aberto</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Kanban', 'Tabela', 'Calendário'].map((t, i) => (
                <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-ink)', color: 'white', borderColor: 'var(--p-ink)' } : {}}>{t}</button>
              ))}
            </div>
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
            {[
              { l: 'Total ativos', v: 6, s: '720 pares', c: 'var(--p-ink)' },
              { l: 'Aguardando aprovação', v: 4, s: 'há > 24h: 2', c: 'var(--p-warn)' },
              { l: 'Convertidos em OP', v: 2, s: 'esta semana', c: 'var(--p-info)' },
              { l: 'Atrasados', v: 5, s: 'requerem ação', c: 'var(--p-red)' },
            ].map((k, i) => (
              <div key={i} className="light-card" style={{ padding: '16px 18px' }}>
                <div className="p-eyebrow" style={{ fontSize: 9 }}>{k.l}</div>
                <div className="p-display" style={{ fontSize: 36, marginTop: 8, color: k.c }}>{k.v}</div>
                <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 4 }}>{k.s}</div>
              </div>
            ))}
          </div>

          {/* KANBAN */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            {cols.map((col, ci) => {
              const colOrders = orders.filter(o => o.status === col.k);
              return (
                <div key={ci} style={{ background: 'var(--p-soft)', border: '1px solid var(--p-line)', borderRadius: 6, padding: 10, minHeight: 480 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--p-line)', marginBottom: 10 }}>
                    <div>
                      <div className="p-eyebrow" style={{ fontSize: 9, color: col.c }}>{col.l}</div>
                      <div className="p-display" style={{ fontSize: 22, marginTop: 2 }}>{colOrders.length}</div>
                    </div>
                    <div style={{ width: 6, height: 32, background: col.c }}/>
                  </div>
                  {colOrders.map((o, j) => (
                    <div key={j} style={{
                      background: 'white', border: '1px solid ' + (o.late ? 'var(--p-red)' : 'var(--p-line)'),
                      padding: 10, marginBottom: 8, borderRadius: 4, position: 'relative',
                    }}>
                      {o.late && <div style={{ position: 'absolute', top: -1, left: -1, right: -1, height: 2, background: 'var(--p-red)' }}/>}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="p-mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--p-ink)' }}>{o.id}</span>
                        {o.rep !== '—' && <span className="p-mono" style={{ fontSize: 9, padding: '1px 5px', border: '1px solid var(--p-line)', borderRadius: 3, color: 'var(--p-mute)' }}>{o.rep}</span>}
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 8, lineHeight: 1.25 }}>{o.cli}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>{o.city}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
                        <span className="p-display" style={{ fontSize: 18 }}>{o.pares}<span style={{ fontSize: 10, color: 'var(--p-mute)', marginLeft: 4 }}>pares</span></span>
                        <span className="p-mono" style={{ fontSize: 11, fontWeight: 700 }}>R$ {o.tot.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--p-line)' }}>
                        <span className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}><Icon.Calendar style={{ width: 11, height: 11, display: 'inline', marginRight: 4, verticalAlign: '-2px' }}/>{o.due}</span>
                        {o.late && <span className="p-pill p-pill-red">Atraso</span>}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </main>
      </div>
    </div>
  );
}

// ────────────────── 2. NOVO PEDIDO ──────────────────
function PedidoNovo() {
  return (
    <div className="light-app" style={{ width: 1480, height: 1100, background: 'var(--p-bg)' }}>
      <header style={{ height: 64, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16, background: 'white', borderBottom: '1px solid var(--p-line)' }}>
        <button className="btn-l-ghost btn-l" style={{ padding: 0 }}>← Voltar</button>
        <div>
          <div className="p-eyebrow" style={{ fontSize: 9, color: 'var(--p-mute)' }}>Comercial · Pedidos · Novo</div>
          <div style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: '0.02em' }}>NOVO PEDIDO DE VENDA</div>
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn-l">Salvar rascunho</button>
        <button className="btn-l-red btn-l">Aprovar pedido →</button>
      </header>

      <div style={{ padding: '24px 28px' }}>
        {/* Stepper */}
        <div className="light-card" style={{ padding: 22, marginBottom: 22 }}>
          <div className="stepper">
            {[
              { l: 'Cliente', s: 'done' },
              { l: 'Itens & Grade', s: 'active' },
              { l: 'Comercial', s: '' },
              { l: 'Logística', s: '' },
              { l: 'Revisão', s: '' },
            ].map((s, i, a) => (
              <React.Fragment key={i}>
                <div className={`step ${s.s}`}>
                  <div className="dot">{s.s === 'done' ? '✓' : (i+1)}</div>
                  <div className="lbl">{s.l}</div>
                </div>
                {i < a.length - 1 && <div className="conn"/>}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          {/* Left form */}
          <div className="light-card">
            {/* Cliente section */}
            <div className="light-section">
              <div className="light-section-h">
                <span className="num">01</span>
                <span className="ttl">Cliente</span>
                <span className="sub">— Quem está comprando</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 14, marginBottom: 14 }}>
                <div>
                  <label className="light-label">Cliente cadastrado</label>
                  <select className="light-input"><option>#L036 — VIP SHOES ARARUAMA COM. DE CALÇADOS LTDA.</option></select>
                </div>
                <div>
                  <label className="light-label">Representante</label>
                  <select className="light-input"><option>MA13 — Marcelo Almeida</option></select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 14 }}>
                <div>
                  <label className="light-label">Razão social</label>
                  <input className="light-input" defaultValue="VIP SHOES ARARUAMA COMERCIO DE CALCADOS E ACESSORIOS LTDA."/>
                </div>
                <div>
                  <label className="light-label">CNPJ</label>
                  <input className="light-input tabular" defaultValue="11.796.642/0001-65"/>
                </div>
                <div>
                  <label className="light-label">Cidade / UF</label>
                  <input className="light-input" defaultValue="Araruama / RJ"/>
                </div>
              </div>
            </div>

            {/* Itens & Grade — the BIG fix */}
            <div className="light-section">
              <div className="light-section-h">
                <span className="num">02</span>
                <span className="ttl">Itens & Grade</span>
                <span className="sub">— Modelo, cor e quantidades por numeração</span>
              </div>

              {/* item card */}
              {SAMPLE_ITEMS.slice(0, 2).map((it, idx) => {
                const total = SIZES.reduce((a, s) => a + (it.grade[s] || 0), 0);
                const subtotal = total * it.price;
                return (
                  <div key={idx} className="light-card" style={{ marginBottom: 14, background: 'var(--p-soft)' }}>
                    <div style={{ display: 'flex', gap: 14, padding: 14 }}>
                      {/* shoe photo placeholder */}
                      <ShoePhoto w={96} h={96} label={`REF ${it.ref}`}/>
                      {/* meta */}
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <div className="p-display" style={{ fontSize: 22, letterSpacing: '0.02em' }}>{it.name}</div>
                          <RefChip code={it.ref} size="md"/>
                          <span className="p-pill">{it.color}</span>
                          <span className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)' }}>{it.material}</span>
                          <button style={{ marginLeft: 'auto', background: 'transparent', border: 0, color: 'var(--p-mute)', cursor: 'pointer' }}><Icon.Dot3/></button>
                        </div>
                        {/* tiras com cor visual */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '6px 10px', background: 'white', border: '1px solid var(--p-line)' }}>
                          <span className="p-eyebrow" style={{ fontSize: 8.5 }}>Sequência tiras</span>
                          <ColorChips swatches={tiraSwatches(it)} size="sm" showLabels showNames/>
                          <button style={{ marginLeft: 'auto', background: 'transparent', border: '1px dashed var(--p-line-2)', color: 'var(--p-mute)', fontSize: 10, padding: '3px 8px', cursor: 'pointer' }}>+ tira</button>
                        </div>
                      </div>
                      {/* totals */}
                      <div style={{ textAlign: 'right', paddingLeft: 14, borderLeft: '1px solid var(--p-line)' }}>
                        <div className="p-eyebrow" style={{ fontSize: 9 }}>Subtotal</div>
                        <div className="p-display" style={{ fontSize: 26, marginTop: 4 }}>R${'\u00A0'}{subtotal.toFixed(2).replace('.', ',')}</div>
                        <div className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 2 }}>{total} pares × R$ {it.price.toFixed(2).replace('.', ',')}</div>
                      </div>
                    </div>
                    {/* CLEAN GRADE */}
                    <div style={{ padding: '0 14px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                        <div className="p-eyebrow" style={{ fontSize: 9 }}>Grade — pares por numeração</div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn-l" style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}>Curva pré-definida ▾</button>
                          <button className="btn-l" style={{ height: 24, fontSize: 10.5, padding: '0 8px' }}>Limpar</button>
                        </div>
                      </div>
                      <table className="grade">
                        <thead><tr>
                          <th style={{ width: 90, textAlign: 'left', paddingLeft: 8 }}>Tamanho</th>
                          {SIZES.map(s => <th key={s}>{s}</th>)}
                          <th style={{ width: 70 }} className="grade-total">TOTAL</th>
                        </tr></thead>
                        <tbody>
                          <tr>
                            <td style={{ textAlign: 'left', paddingLeft: 8, color: 'var(--p-mute)', fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.06em' }}>Pares</td>
                            {SIZES.map(s => (
                              <td key={s} className={it.grade[s] ? 'has' : ''}><input defaultValue={it.grade[s] || ''}/></td>
                            ))}
                            <td className="grade-total">{total}</td>
                          </tr>
                          <tr style={{ background: 'white' }}>
                            <td style={{ textAlign: 'left', paddingLeft: 8, color: 'var(--p-mute)', fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.06em' }}>Distribuição</td>
                            {SIZES.map(s => (
                              <td key={s} style={{ position: 'relative', padding: 0, height: 14 }}>
                                <div style={{ position: 'absolute', left: 2, right: 2, bottom: 2, top: 2, background: 'var(--p-soft)' }}>
                                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: ((it.grade[s] || 0) / 4) * 100 + '%', background: it.grade[s] ? 'var(--p-red)' : 'transparent' }}/>
                                </div>
                              </td>
                            ))}
                            <td className="grade-total" style={{ background: 'var(--p-soft)', color: 'var(--p-mute)' }}>—</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn-l-red btn-l"><Icon.Plus style={{ width: 13, height: 13 }}/> Adicionar item</button>
                <button className="btn-l">Importar planilha</button>
                <button className="btn-l">Duplicar último</button>
              </div>
            </div>
          </div>

          {/* Right summary */}
          <div className="light-card" style={{ alignSelf: 'flex-start', position: 'sticky', top: 0 }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--p-line)' }}>
              <div className="p-eyebrow" style={{ fontSize: 9 }}>Resumo do pedido</div>
              <div className="p-display" style={{ fontSize: 22, marginTop: 4 }}>PV-2026-00098</div>
            </div>
            <div style={{ padding: '18px 20px', display: 'grid', gap: 14 }}>
              {[
                { l: 'Itens', v: '2 referências' },
                { l: 'Total de pares', v: '48' },
                { l: 'Cliente', v: 'VIP Shoes Araruama' },
                { l: 'Representante', v: 'MA13' },
                { l: 'Pagamento', v: '30 dias' },
                { l: 'Entrega prevista', v: '08/04/2026' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                  <span style={{ color: 'var(--p-mute)' }}>{r.l}</span>
                  <span style={{ fontWeight: 600 }}>{r.v}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '18px 20px', background: 'var(--p-soft)', borderTop: '1px solid var(--p-line)' }}>
              <div className="p-eyebrow" style={{ fontSize: 9 }}>Subtotal mercadoria</div>
              <div className="p-display" style={{ fontSize: 32, marginTop: 4, color: 'var(--p-red)' }}>R${'\u00A0'}998,40</div>
              <div className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 4 }}>+ Frete estimado: R$ 72,00</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────── 3. DETALHE / RESUMO ──────────────────
function PedidoDetalhe() {
  return (
    <div className="light-app" style={{ width: 1480, height: 1100, background: 'var(--p-bg)' }}>
      <header style={{ height: 64, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16, background: 'white', borderBottom: '1px solid var(--p-line)' }}>
        <button className="btn-l-ghost btn-l" style={{ padding: 0 }}>← Pedidos</button>
        <div>
          <div className="p-eyebrow" style={{ fontSize: 9, color: 'var(--p-mute)' }}>PV-2026-00097 · Detalhe</div>
          <div style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: '0.02em' }}>VIP SHOES ARARUAMA</div>
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn-l">Consumo</button>
        <button className="btn-l">Margem</button>
        <button className="btn-l">Etiquetas</button>
        <button className="btn-l">Gerar PDF</button>
        <button className="btn-l-red btn-l">Gerar OPs (4) →</button>
      </header>

      <main style={{ padding: '24px 28px' }}>
        {/* Stepper status */}
        <div className="light-card" style={{ padding: '18px 22px', marginBottom: 20 }}>
          <div className="stepper">
            {[
              { l: 'Pendente', s: 'done' },
              { l: 'Aprovado', s: 'done' },
              { l: 'Em Produção', s: 'active' },
              { l: 'Pronto', s: '' },
              { l: 'Faturado', s: '' },
            ].map((s, i, a) => (
              <React.Fragment key={i}>
                <div className={`step ${s.s}`}>
                  <div className="dot">{s.s === 'done' ? '✓' : (i+1)}</div>
                  <div className="lbl">{s.l}</div>
                </div>
                {i < a.length - 1 && <div className="conn"/>}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
          <div className="light-card">
            {/* Header summary band */}
            <div style={{ padding: 24, borderBottom: '1px solid var(--p-line)', background: 'var(--p-soft)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 22 }}>
                {[
                  { l: 'Cliente', v: 'VIP Shoes Araruama', s: '11.796.642/0001-65' },
                  { l: 'Representante', v: 'MA13 · Marcelo A.', s: 'Comissão 4%' },
                  { l: 'Pagamento', v: '30 dias', s: 'Boleto · à vista 4%' },
                  { l: 'Entrega', v: '08/04/2026', s: 'Sem 2 · 04–08 mai' },
                ].map((b, i) => (
                  <div key={i} style={{ borderLeft: i ? '1px solid var(--p-line)' : 'none', paddingLeft: i ? 22 : 0 }}>
                    <div className="p-eyebrow" style={{ fontSize: 9 }}>{b.l}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>{b.v}</div>
                    <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 2 }}>{b.s}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Items list — clean */}
            <div style={{ padding: 24 }}>
              <div className="light-section-h">
                <span className="num">01</span>
                <span className="ttl">Itens do pedido</span>
                <span className="sub">{SAMPLE_ITEMS.length} referências · 144 pares</span>
              </div>

              {SAMPLE_ITEMS.map((it, idx) => {
                const total = SIZES.reduce((a, s) => a + (it.grade[s] || 0), 0);
                return (
                  <div key={idx} style={{ padding: '16px 0', borderBottom: idx < SAMPLE_ITEMS.length - 1 ? '1px solid var(--p-line)' : 'none', display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: 18, alignItems: 'center' }}>
                    <ShoePhoto w={72} h={64} label={`REF ${it.ref}`}/>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)' }}>#{idx+1}</span>
                        <span style={{ fontFamily: 'Anton', fontSize: 18, letterSpacing: '0.02em' }}>{it.name}</span>
                        <RefChip code={it.ref} size="sm"/>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{it.color}</span>
                      </div>
                      {/* compact grade strip */}
                      <div style={{ display: 'flex', gap: 1, marginTop: 8, background: 'var(--p-line-2)', padding: 1, width: 'fit-content' }}>
                        {SIZES.map(s => (
                          <div key={s} style={{ background: 'white', padding: '3px 6px', minWidth: 30, textAlign: 'center' }}>
                            <div className="p-mono" style={{ fontSize: 8.5, color: 'var(--p-mute)', letterSpacing: '0.04em' }}>{s}</div>
                            <div className="p-mono" style={{ fontSize: 11, fontWeight: 700, color: it.grade[s] ? 'var(--p-red)' : 'var(--p-dim)' }}>{it.grade[s] || '—'}</div>
                          </div>
                        ))}
                        <div style={{ background: 'var(--p-ink)', color: 'white', padding: '3px 8px', minWidth: 40, textAlign: 'center' }}>
                          <div className="p-mono" style={{ fontSize: 8.5, letterSpacing: '0.04em', opacity: 0.7 }}>TOTAL</div>
                          <div className="p-mono" style={{ fontSize: 11, fontWeight: 700 }}>{total}</div>
                        </div>
                      </div>
                      {/* tiras com cores visuais */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <span className="p-eyebrow" style={{ fontSize: 8 }}>Tiras</span>
                        <ColorChips swatches={tiraSwatches(it)} size="xs" showLabels showNames/>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{total} × R$ {it.price.toFixed(2).replace('.', ',')}</div>
                      <div className="p-display" style={{ fontSize: 24, marginTop: 4 }}>R$ {(total * it.price).toFixed(2).replace('.', ',')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: financials + history */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="light-card" style={{ padding: 22 }}>
              <div className="p-eyebrow" style={{ fontSize: 9 }}>Total do pedido</div>
              <div className="p-display" style={{ fontSize: 40, marginTop: 8, color: 'var(--p-red)' }}>R$ 2.995,20</div>
              <hr className="p-rule" style={{ margin: '14px 0' }}/>
              <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
                {[['Mercadoria', 'R$ 2.995,20'], ['Frete (CIF)', 'R$ 216,00'], ['Desconto', '— R$ 0,00'], ['Comissão (4%)', 'R$ 119,80'], ['Margem est.', '32,4%']].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--p-mute)' }}>{r[0]}</span>
                    <span className="p-mono" style={{ fontWeight: 600 }}>{r[1]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="light-card" style={{ padding: 22 }}>
              <div className="p-eyebrow" style={{ fontSize: 9 }}>Histórico</div>
              {[
                { d: '20/04 15:43', u: 'Marcelo A.', a: 'Pedido criado' },
                { d: '21/04 09:12', u: 'Renata M.',  a: 'Aprovado' },
                { d: '23/04 14:30', u: 'Sistema',    a: '4 OPs geradas' },
              ].map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < 2 ? '1px solid var(--p-line)' : 'none' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--p-red)', marginTop: 5, flexShrink: 0 }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{h.a}</div>
                    <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{h.d} · {h.u}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ────────────────── 4. CONVERSÃO → OP ──────────────────
function PedidoConverter() {
  const ops = SAMPLE_ITEMS.map((it, i) => ({
    op: `OP-2026-${(2870 + i).toString().padStart(4, '0')}`,
    item: it,
    pares: SIZES.reduce((a, s) => a + (it.grade[s] || 0), 0),
    line: ['A1', 'A2', 'B1', 'C1'][i],
    start: ['12/05', '12/05', '13/05', '13/05'][i],
  }));

  return (
    <div className="light-app" style={{ width: 1480, height: 920, background: 'var(--p-bg)' }}>
      <header style={{ height: 64, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 16, background: 'white', borderBottom: '1px solid var(--p-line)' }}>
        <div>
          <div className="p-eyebrow" style={{ fontSize: 9, color: 'var(--p-mute)' }}>PV-2026-00097 · Gerar Ordens de Produção</div>
          <div style={{ fontFamily: 'Anton', fontSize: 22 }}>CONVERTER PEDIDO EM OPs</div>
        </div>
        <div style={{ flex: 1 }}/>
        <button className="btn-l">Cancelar</button>
        <button className="btn-l-red btn-l">Confirmar e gerar 4 OPs →</button>
      </header>

      <main style={{ padding: '24px 28px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
          <div className="light-card">
            <div className="light-section">
              <div className="light-section-h">
                <span className="num">01</span>
                <span className="ttl">Estratégia de geração</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {[
                  { t: '1 OP por item', d: '4 OPs · uma por referência+cor', sel: true },
                  { t: '1 OP por modelo', d: '2 OPs · I901 e I110' },
                  { t: 'OP única', d: '1 OP com todos os itens' },
                ].map((o, i) => (
                  <label key={i} style={{
                    border: '1.5px solid ' + (o.sel ? 'var(--p-red)' : 'var(--p-line)'),
                    background: o.sel ? 'var(--p-red-soft)' : 'white',
                    borderRadius: 6, padding: 14, cursor: 'pointer', position: 'relative',
                  }}>
                    <input type="radio" name="strat" defaultChecked={o.sel} style={{ position: 'absolute', top: 12, right: 12 }}/>
                    <div style={{ fontFamily: 'Anton', fontSize: 16, letterSpacing: '0.02em' }}>{o.t}</div>
                    <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 4 }}>{o.d}</div>
                  </label>
                ))}
              </div>
            </div>

            <div className="light-section">
              <div className="light-section-h">
                <span className="num">02</span>
                <span className="ttl">Ordens a gerar</span>
                <span className="sub">— Revise e ajuste antes de confirmar</span>
              </div>
              <table className="p-tbl p-tbl-zebra">
                <thead><tr>
                  <th>OP</th><th>Modelo · REF</th><th>Cores</th><th className="num">Pares</th><th>Linha</th><th>Início</th><th></th>
                </tr></thead>
                <tbody>
                  {ops.map((o, i) => (
                    <tr key={i}>
                      <td><span className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)' }}>{o.op}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{o.item.name}</span>
                          <RefChip code={o.item.ref} size="sm"/>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <ColorChips swatches={tiraSwatches(o.item)} size="xs" showLabels={false} showNames={false}/>
                          <span style={{ fontSize: 11 }}>{o.item.color}</span>
                        </div>
                      </td>
                      <td className="num" style={{ fontWeight: 700 }}>{o.pares}</td>
                      <td><span className="p-mono">{o.line}</span></td>
                      <td className="p-mono">{o.start}</td>
                      <td><button style={{ background:'transparent', border: 0, color: 'var(--p-mute)', cursor: 'pointer' }}><Icon.Dot3/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="light-section">
              <div className="light-section-h">
                <span className="num">03</span>
                <span className="ttl">Verificação de materiais</span>
              </div>
              {[
                { mat: 'Verniz preto · 1.2mm', need: '32 m²', stock: '48 m²', ok: true },
                { mat: 'Verniz creme · 1.2mm', need: '32 m²', stock: '36 m²', ok: true },
                { mat: 'Verniz off-white',     need: '24 m²', stock: '12 m²', ok: false },
                { mat: 'Verniz branco perl.',  need: '24 m²', stock: '0 m²',  ok: false },
                { mat: 'Solado TR-04 (25–32)', need: '144 pares', stock: '180 pares', ok: true },
              ].map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', borderBottom: i < 4 ? '1px solid var(--p-line)' : 'none' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{m.mat}</div>
                    <div className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>Necessário: {m.need} · Estoque: {m.stock}</div>
                  </div>
                  {m.ok
                    ? <span className="p-pill p-pill-ok">OK</span>
                    : <span className="p-pill p-pill-red">Faltam {parseInt(m.need) - parseInt(m.stock)} {m.need.split(' ').slice(-1)[0]}</span>}
                </div>
              ))}
            </div>
          </div>

          <div className="light-card" style={{ alignSelf: 'flex-start', padding: 22 }}>
            <div className="p-eyebrow" style={{ fontSize: 9 }}>Resumo</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 6 }}>4 OPs · 144 pares</div>
            <hr className="p-rule" style={{ margin: '14px 0' }}/>
            <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
              {[['Tempo estimado', '4 dias'], ['Início previsto', '12/05'], ['Conclusão', '15/05'], ['Materiais', '2 alertas'], ['Capacidade', '78% das linhas']].map((r, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--p-mute)' }}>{r[0]}</span>
                  <span style={{ fontWeight: 600 }}>{r[1]}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: 12, background: 'var(--p-red-soft)', border: '1px solid var(--p-red-line)', borderRadius: 4, fontSize: 11.5 }}>
              <strong style={{ color: 'var(--p-red)' }}>Atenção:</strong> 2 materiais com estoque insuficiente. Será necessário comprar antes do início.
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

window.PedidosLista = PedidosLista;
window.PedidoNovo = PedidoNovo;
window.PedidoDetalhe = PedidoDetalhe;
window.PedidoConverter = PedidoConverter;
