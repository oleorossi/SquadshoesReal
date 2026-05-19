// ESTOQUE & AJUSTES — telas web com mesmo tratamento visual
// Estoque: Materiais, Acabados
// Ajustes: Configurações gerais, Templates de etiqueta

// ──── helpers shared layout ────
// Sidebar completa do sistema (espelha as prints do usuário)
const SIDEBAR_NAV = [
  { g: '', items: [{ id: 'painel', l: 'Painel', i: 'Dashboard' }] },
  { g: 'Comercial', items: [
    { id: 'pedidos',  l: 'Pedidos de Venda', i: 'PCP' },
    { id: 'pronta',   l: 'Pronta-Entrega',   i: 'Embalagem' },
    { id: 'clientes', l: 'Clientes',         i: 'Equipe' },
    { id: 'tabprc',   l: 'Tabelas de Preço', i: 'Relatorios' },
    { id: 'crm',      l: 'CRM',              i: 'Equipe' },
    { id: 'sac',      l: 'SAC',              i: 'Bell' },
    { id: 'forecast', l: 'Forecast',         i: 'Dashboard' },
  ]},
  { g: 'Produção', items: [
    { id: 'pcp',      l: 'PCP',              i: 'PCP' },
    { id: 'ops',      l: 'Ordens (OPs)',     i: 'Materiais' },
    { id: 'fluxo',    l: 'Fluxo',            i: 'Acabamento' },
    { id: 'live',     l: 'Live',             i: 'Dashboard' },
    { id: 'tline',    l: 'Timeline',         i: 'Calendar' },
    { id: 'cap',      l: 'Capacidade',       i: 'Dashboard' },
    { id: 'cc',       l: 'Centro Controle',  i: 'Alert' },
    { id: 'imp',      l: 'Imprimir Fichas',  i: 'Relatorios' },
    { id: 'pick',     l: 'Picking',          i: 'Materiais' },
    { id: 'qual',     l: 'Qualidade',        i: 'Qualidade' },
  ]},
  { g: 'Engenharia', items: [
    { id: 'fichas',   l: 'Fichas Técnicas',  i: 'Relatorios' },
    { id: 'solados',  l: 'Solados',          i: 'Acabamento' },
    { id: 'silks',    l: 'Silks',            i: 'Relatorios' },
    { id: 'rect',     l: 'Receitas',         i: 'Materiais' },
  ]},
  { g: 'Estoque', items: [
    { id: 'est',      l: 'Estoque',          i: 'Materiais' },
    { id: 'mat',      l: 'Matérias-primas',  i: 'Materiais' },
    { id: 'acab',     l: 'Acabados',         i: 'Acabamento' },
    { id: 'hist',     l: 'Histórico',        i: 'Calendar' },
    { id: 'mrp',      l: 'MRP',              i: 'PCP' },
  ]},
  { g: 'Compras', items: [
    { id: 'oc',       l: 'Ordens de Compra', i: 'PCP' },
    { id: 'rfq',      l: 'Cotações (RFQ)',   i: 'Relatorios' },
    { id: 'plan',     l: 'Planejamento',     i: 'Calendar' },
    { id: 'forn',     l: 'Fornecedores',     i: 'Equipe' },
    { id: 'cins',     l: 'Custos de Insumos',i: 'Materiais' },
  ]},
  { g: 'Logística', items: [
    { id: 'exped',    l: 'Expedição',        i: 'Embalagem' },
    { id: 'conf',     l: 'Conferência',      i: 'Qualidade' },
    { id: 'sess',     l: 'Sessões Picking',  i: 'Materiais' },
    { id: 'rom',      l: 'Romaneios',        i: 'Relatorios' },
    { id: 'transp',   l: 'Transportadoras',  i: 'Equipe' },
    { id: 'entr',     l: 'Entregas',         i: 'Embalagem' },
    { id: 'etq',      l: 'Etiquetas',        i: 'Relatorios' },
  ]},
  { g: 'Financeiro', items: [
    { id: 'fin',      l: 'Financeiro',       i: 'Dashboard' },
    { id: 'ap',       l: 'Contas (AR/AP)',   i: 'Relatorios' },
    { id: 'mkp',      l: 'Markup',           i: 'Dashboard' },
    { id: 'nfe',      l: 'NF-e',             i: 'Relatorios' },
    { id: 'cte',      l: 'CT-e',             i: 'Embalagem' },
    { id: 'mdfe',     l: 'MDF-e',            i: 'Relatorios' },
    { id: 'cnab',     l: 'CNAB / Boletos',   i: 'Relatorios' },
    { id: 'conc',     l: 'Conciliação',      i: 'Qualidade' },
  ]},
  { g: 'RH', items: [
    { id: 'prh',      l: 'Painel RH',        i: 'Equipe' },
    { id: 'bh',       l: 'Banco de Horas',   i: 'Calendar' },
    { id: 'terc',     l: 'Terceirizados',    i: 'Equipe' },
  ]},
  { g: 'Sistema', items: [
    { id: 'ajustes',  l: 'Ajustes',          i: 'Filter' },
    { id: 'tpls',     l: 'Templates etq.',   i: 'Relatorios' },
    { id: 'auto',     l: 'Automações',       i: 'PCP' },
    { id: 'audit',    l: 'Auditoria',        i: 'Qualidade' },
    { id: 'seg',      l: 'Segurança',        i: 'Qualidade' },
  ]},
];

function LightShell({ active, breadcrumb, children, title, actions }) {
  return (
    <div className="light-app" style={{ width: 1480, height: 920, display: 'flex', background: 'var(--p-bg)' }}>
      <aside style={{ width: 232, background: 'white', borderRight: '1px solid var(--p-line)', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--p-line)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <PIcon.Logo size={28}/>
          <div>
            <div style={{ fontFamily: 'Anton', fontSize: 15, letterSpacing: '0.04em' }}>SQUAD SHOES</div>
            <div className="p-eyebrow" style={{ fontSize: 7.5, color: 'var(--p-red)' }}>Gestão Industrial</div>
          </div>
        </div>
        <nav style={{ padding: '12px 10px', flex: 1, overflow: 'auto' }}>
          {SIDEBAR_NAV.map((g, gi) => (
            <div key={gi} style={{ marginBottom: 10 }}>
              {g.g && <div className="p-eyebrow" style={{ padding: '6px 10px 4px', fontSize: 8, color: 'var(--p-dim)' }}>{g.g}</div>}
              {g.items.map(it => {
                const Ic = Icon[it.i] || Icon.Materiais;
                const a = it.id === active;
                return (
                  <div key={it.id} style={{
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '6px 10px', borderRadius: 4, marginBottom: 1,
                    background: a ? 'var(--p-red-soft)' : 'transparent',
                    color: a ? 'var(--p-red)' : 'var(--p-ink-2)',
                    borderLeft: '2px solid ' + (a ? 'var(--p-red)' : 'transparent'),
                    fontSize: 11.5, fontWeight: a ? 600 : 500, cursor: 'pointer',
                  }}>
                    <Ic style={{ color: a ? 'var(--p-red)' : 'var(--p-mute)', width: 14, height: 14 }}/>
                    {it.l}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{ height: 64, padding: '0 28px', display: 'flex', alignItems: 'center', gap: 14, background: 'white', borderBottom: '1px solid var(--p-line)', flexShrink: 0 }}>
          <div className="p-eyebrow" style={{ fontSize: 9, color: 'var(--p-mute)' }}>{breadcrumb}</div>
          <div style={{ flex: 1 }}/>
          <div style={{ position: 'relative', width: 240 }}>
            <Icon.Search style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--p-mute)', width: 14, height: 14 }}/>
            <input className="light-input" placeholder="Buscar…" style={{ paddingLeft: 32, height: 34 }}/>
          </div>
          {actions || <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Filtrar</button>}
        </header>
        <main style={{ flex: 1, padding: '20px 28px', overflow: 'auto', background: 'var(--p-bg)' }}>
          {title && (
            <div style={{ marginBottom: 18 }}>
              <div className="p-display" style={{ fontSize: 26, letterSpacing: '0.005em' }}>{title}</div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

// ─── 1. ESTOQUE DE MATÉRIAS-PRIMAS ────────────────────
function EstoqueMateriais() {
  const itens = [
    { sku: 'MP-CRO-CRM',  nome: 'Couro Caramelo 2.0mm',  cat: 'Couro',     cor: { h: '#8E5326', name: 'Caramelo' },  estoque: 48,   unid: 'm²',  pp: 80,  custo: 'R$ 92/m²',  forn: 'Curtume Vale',  giro: 14 },
    { sku: 'MP-CRO-PRT',  nome: 'Couro Preto 2.5mm',     cat: 'Couro',     cor: { h: '#0E0E0E', name: 'Preto' },     estoque: 312,  unid: 'm²',  pp: 100, custo: 'R$ 88/m²',  forn: 'Curtume Vale',  giro: 18 },
    { sku: 'MP-CRO-CRU',  nome: 'Couro Cru 2.0mm',       cat: 'Couro',     cor: { h: '#E8DCC8', name: 'Cru' },       estoque: 92,   unid: 'm²',  pp: 60,  custo: 'R$ 94/m²',  forn: 'Curtume Vale',  giro: 22 },
    { sku: 'MP-VRN-4280', nome: 'Verniz Adocicado',      cat: 'Couro sint.', cor: { h: '#5C2F1E', name: 'Adocicado' }, estoque: 184, unid: 'dm²', pp: 200, custo: 'R$ 1,12/dm²', forn: 'Sintex SP',     giro: 12 },
    { sku: 'MP-VRN-CHA',  nome: 'Verniz Champagne',      cat: 'Couro sint.', cor: { h: '#D9C9A8', name: 'Champagne' }, estoque: 220, unid: 'dm²', pp: 200, custo: 'R$ 1,18/dm²', forn: 'Sintex SP',     giro: 16 },
    { sku: 'MP-SOLA-TR',  nome: 'Sola TR sortida',       cat: 'Solado',    cor: { h: '#1A1A1A', name: 'Preto' },     estoque: 1840, unid: 'pç',  pp: 600, custo: 'R$ 6,80',  forn: 'Soltec',        giro: 9  },
    { sku: 'MP-EVA-9',    nome: 'EVA palmilha 3mm',      cat: 'Palmilha',  cor: { h: '#222', name: 'Preto' },        estoque: 6420, unid: 'pç',  pp: 800, custo: 'R$ 0,90',  forn: 'EVA Pack',      giro: 8  },
    { sku: 'MP-FOR-CRM',  nome: 'Forro pelica creme',    cat: 'Forro',     cor: { h: '#F2E6D3', name: 'Creme' },     estoque: 86,   unid: 'm',   pp: 200, custo: 'R$ 18/m',  forn: 'Pelicas RS',    giro: 11 },
    { sku: 'MP-COL-PU',   nome: 'Cola PU branca',        cat: 'Químico',   cor: null,                                  estoque: 14,   unid: 'kg',  pp: 30,  custo: 'R$ 44/kg', forn: 'Adhesivos PR',  giro: 6  },
    { sku: 'MP-LN-40N',   nome: 'Linha 40 preto',        cat: 'Linha',     cor: { h: '#000', name: 'Preto' },        estoque: 540,  unid: 'cones', pp: 100, custo: 'R$ 8,20/cone', forn: 'Coats',     giro: 24 },
  ];

  return (
    <LightShell active="mat" breadcrumb="ESTOQUE · MATÉRIAS-PRIMAS" title="MATÉRIAS-PRIMAS · POSIÇÃO ATUAL">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {[
          { l: 'SKUs ativos', v: '184',   s: '12 categorias' },
          { l: 'Abaixo do PP', v: '12',    s: 'requerem pedido', red: true },
          { l: 'Esgotados',    v: '3',     s: 'crítico',           red: true },
          { l: 'Giro médio',   v: '14',    s: 'dias' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 16 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 36, marginTop: 6, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div className="p-eyebrow">Inventário · 184 SKUs</div>
            <div className="p-display" style={{ fontSize: 22, marginTop: 4 }}>POR MATERIAL</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Categoria</button>
            <button className="btn-l-red btn-l">+ Pedido de compra</button>
          </div>
        </div>

        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>SKU</th><th>Material</th><th>Categoria</th><th>Cor</th>
            <th className="num">Estoque</th><th>Cobertura</th><th>Fornecedor</th><th className="num">Giro</th><th>Status</th>
          </tr></thead>
          <tbody>
            {itens.map((it, i) => {
              const cov = it.pp ? (it.estoque / it.pp) * 100 : 0;
              const status = it.estoque === 0 ? 'out' : it.estoque < it.pp ? 'low' : 'ok';
              return (
                <tr key={i} style={status === 'low' ? { background: 'var(--p-red-soft)' } : {}}>
                  <td className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{it.sku}</td>
                  <td style={{ fontWeight: 600 }}>{it.nome}</td>
                  <td><span className="p-pill" style={{ fontSize: 8.5 }}>{it.cat}</span></td>
                  <td>
                    {it.cor ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 14, height: 14, background: it.cor.h, border: '1px solid var(--p-ink)' }}/>
                        <span style={{ fontSize: 10.5 }}>{it.cor.name}</span>
                      </div>
                    ) : <span style={{ color: 'var(--p-mute)' }}>—</span>}
                  </td>
                  <td className="num">
                    <span className="p-mono" style={{ fontWeight: 700, fontSize: 12, color: status === 'low' ? 'var(--p-red)' : 'var(--p-ink)' }}>{it.estoque}</span>
                    <span className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginLeft: 3 }}>{it.unid}</span>
                  </td>
                  <td style={{ width: 130 }}>
                    <div style={{ height: 6, background: 'var(--p-soft)', border: '1px solid var(--p-line)', position: 'relative' }}>
                      <div style={{ position: 'absolute', left: '100%', top: -2, bottom: -2, width: 1, background: 'var(--p-mute)', opacity: 0.4 }}/>
                      <div style={{ height: '100%', width: Math.min(100, cov) + '%', background: status === 'low' ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                    </div>
                    <div className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginTop: 2 }}>{Math.round(cov)}% do PP</div>
                  </td>
                  <td style={{ fontSize: 10.5 }}>{it.forn}</td>
                  <td className="num"><span className="p-mono" style={{ fontSize: 11 }}>{it.giro}d</span></td>
                  <td>
                    {status === 'ok'   && <span className="p-pill p-pill-ok">OK</span>}
                    {status === 'low'  && <span className="p-pill p-pill-red">Baixo</span>}
                    {status === 'out'  && <span className="p-pill p-pill-red">Esgotado</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.EstoqueMateriais = EstoqueMateriais;
window.LightShell = LightShell;

// ─── 2. ESTOQUE DE PRODUTOS ACABADOS ──────────────────
function EstoqueAcabados() {
  const linhas = [
    { ref: 'I901', name: 'Mocassim Verona', cor: 'Adocicado',      corHex: '#5C2F1E', cores: MODELOS['I901'].swatches, grade: { 34: 24, 35: 38, 36: 56, 37: 72, 38: 44, 39: 18 } },
    { ref: 'I901', name: 'Mocassim Verona', cor: 'Champagne',      corHex: '#D9C9A8', cores: [{ h: '#D9C9A8', label: 'CAB', name: 'Champagne' }, { h: '#F2E6D3', label: 'FOR', name: 'Creme' }], grade: { 34: 12, 35: 22, 36: 32, 37: 40, 38: 26, 39: 8 } },
    { ref: 'I905', name: 'Sandália Leila',  cor: 'Caramelo/Cru',   corHex: '#8E5326', cores: MODELOS['I905'].swatches, grade: { 34: 6, 35: 14, 36: 28, 37: 42, 38: 18, 39: 0 } },
    { ref: 'I918', name: 'Scarpin Bianca',  cor: 'Preto Verniz',   corHex: '#0E0E0E', cores: MODELOS['I918'].swatches, grade: { 33: 4, 34: 18, 35: 30, 36: 44, 37: 52, 38: 28, 39: 8 } },
    { ref: 'I422', name: 'Bota Aurora',     cor: 'Castor',         corHex: '#7A5A3E', cores: [{ h: '#7A5A3E', label: 'CAB', name: 'Castor' }, { h: '#1A1A1A', label: 'SL', name: 'Preto' }], grade: { 34: 0, 35: 8, 36: 18, 37: 26, 38: 14, 39: 4 } },
  ];

  return (
    <LightShell active="acab" breadcrumb="ESTOQUE · PRODUTOS ACABADOS" title="ACABADOS · POSIÇÃO POR MODELO">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {[
          { l: 'Pares em estoque', v: '6.840', s: '24 referências' },
          { l: 'Pares prontos',    v: '2.180', s: 'aguardando expedição', red: false },
          { l: 'Cobertura média',  v: '12',    s: 'dias de venda' },
          { l: 'Em pronta-entrega',v: '54',    s: 'caixas (1.296 pares)' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 16 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 36, marginTop: 6 }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div className="p-eyebrow">Inventário · acabados</div>
            <div className="p-display" style={{ fontSize: 22, marginTop: 4 }}>POR MODELO · NUMERAÇÃO</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Modelo</button>
            <button className="btn-l">Imprimir manifesto</button>
            <button className="btn-l-red btn-l">+ Faturar lote</button>
          </div>
        </div>

        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th style={{ width: 60 }}>Foto</th>
            <th>Modelo · REF</th>
            <th>Cor</th>
            <th>Cores</th>
            <th className="num" colSpan="7">Numeração / pares</th>
            <th className="num">Total</th>
          </tr>
          <tr style={{ background: 'var(--p-soft)' }}>
            <th colSpan="4"></th>
            {[33, 34, 35, 36, 37, 38, 39].map(s => (
              <th key={s} className="num" style={{ fontFamily: 'JetBrains Mono', fontSize: 9 }}>{s}</th>
            ))}
            <th></th>
          </tr></thead>
          <tbody>
            {linhas.map((l, i) => {
              const total = Object.values(l.grade).reduce((a, b) => a + b, 0);
              return (
                <tr key={i}>
                  <td><ShoePhoto w={50} h={36} label=""/></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{l.name}</span>
                      <RefChip code={l.ref} size="sm"/>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 12, height: 12, background: l.corHex, border: '1px solid var(--p-ink)' }}/>
                      <span style={{ fontSize: 10.5 }}>{l.cor}</span>
                    </div>
                  </td>
                  <td>
                    <ColorChips swatches={l.cores} size="xs" showLabels={false} showNames={false}/>
                  </td>
                  {[33, 34, 35, 36, 37, 38, 39].map(s => (
                    <td key={s} className="num">
                      <span className="p-mono" style={{ fontWeight: l.grade[s] ? 700 : 400, color: l.grade[s] ? 'var(--p-ink)' : 'var(--p-dim)', fontSize: 11 }}>{l.grade[s] || '—'}</span>
                    </td>
                  ))}
                  <td className="num" style={{ background: 'var(--p-ink)', color: '#fff' }}>
                    <span className="p-mono" style={{ fontWeight: 700, fontSize: 12 }}>{total}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.EstoqueAcabados = EstoqueAcabados;

// ─── 3. AJUSTES · CONFIGURAÇÕES ───────────────────────
function AjustesGeral() {
  return (
    <LightShell active="ajustes" breadcrumb="SISTEMA · AJUSTES" title="AJUSTES DO SISTEMA">
      <div style={{ display: 'grid', gridTemplateColumns: '232px 1fr', gap: 22 }}>
        {/* sub-nav */}
        <aside style={{ borderRight: '1px solid var(--p-line)', paddingRight: 16 }}>
          {[
            ['Empresa',          true],
            ['Linhas & turnos',  false],
            ['Numeração de OPs', false],
            ['Modelos & referências', false],
            ['Templates de etiqueta', false],
            ['Usuários & permissões', false],
            ['Integrações',      false],
            ['Backup & dados',   false],
          ].map((r, i) => (
            <div key={i} style={{
              padding: '10px 12px', borderLeft: '2px solid ' + (r[1] ? 'var(--p-red)' : 'transparent'),
              background: r[1] ? 'var(--p-red-soft)' : 'transparent',
              color: r[1] ? 'var(--p-red)' : 'var(--p-ink-2)',
              fontSize: 12.5, fontWeight: r[1] ? 600 : 500, cursor: 'pointer', marginBottom: 2,
            }}>{r[0]}</div>
          ))}
        </aside>

        {/* form */}
        <div className="light-card" style={{ padding: 0 }}>
          <div className="light-section">
            <div className="light-section-h">
              <span className="num">01</span>
              <span className="ttl">Identificação da empresa</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <label className="light-label">Razão social</label>
                <input className="light-input" defaultValue="SQUAD SHOES INDUSTRIAL LTDA"/>
              </div>
              <div>
                <label className="light-label">Nome fantasia</label>
                <input className="light-input" defaultValue="Squad Shoes"/>
              </div>
              <div>
                <label className="light-label">CNPJ</label>
                <input className="light-input tabular" defaultValue="14.328.412/0001-04"/>
              </div>
              <div>
                <label className="light-label">Inscrição estadual</label>
                <input className="light-input tabular" defaultValue="118.428.420.118"/>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label className="light-label">Endereço da planta</label>
                <input className="light-input" defaultValue="Av. Industrial 1284 · Franca / SP · CEP 14400-000"/>
              </div>
            </div>
          </div>

          <div className="light-section">
            <div className="light-section-h">
              <span className="num">02</span>
              <span className="ttl">Padrões de produção</span>
              <span className="sub">— Defaults usados em todas as OPs</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
              <div>
                <label className="light-label">Curva padrão</label>
                <select className="light-input"><option>1 caixa = 12 pares · 25–32</option></select>
              </div>
              <div>
                <label className="light-label">Tolerância de refugo</label>
                <input className="light-input tabular" defaultValue="2,0 %"/>
              </div>
              <div>
                <label className="light-label">Meta OEE</label>
                <input className="light-input tabular" defaultValue="85 %"/>
              </div>
              <div>
                <label className="light-label">Turno 1</label>
                <input className="light-input tabular" defaultValue="07:00 – 16:00"/>
              </div>
              <div>
                <label className="light-label">Turno 2</label>
                <input className="light-input tabular" defaultValue="16:00 – 00:00"/>
              </div>
              <div>
                <label className="light-label">Tempo padrão por par</label>
                <input className="light-input tabular" defaultValue="31 min"/>
              </div>
            </div>
          </div>

          <div className="light-section">
            <div className="light-section-h">
              <span className="num">03</span>
              <span className="ttl">Numeração automática</span>
            </div>
            <table className="p-tbl">
              <thead><tr>
                <th>Documento</th><th>Prefixo</th><th className="num">Próximo</th><th>Formato</th><th></th>
              </tr></thead>
              <tbody>
                <tr><td>Pedido de Venda</td><td className="p-mono">PV-2026-</td><td className="num p-mono">00098</td><td className="p-mono">PV-AAAA-NNNNN</td><td><button className="btn-l" style={{ height: 24, fontSize: 10 }}>Editar</button></td></tr>
                <tr><td>Ordem de Produção</td><td className="p-mono">OP-</td><td className="num p-mono">2858</td><td className="p-mono">OP-NNNN</td><td><button className="btn-l" style={{ height: 24, fontSize: 10 }}>Editar</button></td></tr>
                <tr><td>Ficha Técnica</td><td className="p-mono">FT-2026-</td><td className="num p-mono">42</td><td className="p-mono">FT-AAAA-REF-COR</td><td><button className="btn-l" style={{ height: 24, fontSize: 10 }}>Editar</button></td></tr>
                <tr><td>NF-e</td><td className="p-mono">—</td><td className="num p-mono">189.429</td><td className="p-mono">SEFAZ sequencial</td><td><button className="btn-l" style={{ height: 24, fontSize: 10 }}>Editar</button></td></tr>
              </tbody>
            </table>
          </div>

          <div className="light-section">
            <div className="light-section-h">
              <span className="num">04</span>
              <span className="ttl">Identidade visual</span>
              <span className="sub">— Cor de destaque aparece em OPs, badges e etiquetas</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div>
                <label className="light-label">Cor de destaque</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {['#B7141F', '#D9531E', '#1F7A4D', '#0D4F8A', '#14110E'].map((c, i) => (
                    <div key={i} style={{
                      width: 32, height: 32, background: c,
                      border: i === 0 ? '2px solid var(--p-ink)' : '1px solid var(--p-line-2)',
                      cursor: 'pointer', position: 'relative',
                    }}>
                      {i === 0 && <div style={{ position: 'absolute', top: -8, right: -8, background: 'var(--p-ink)', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>✓</div>}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="light-label">Fonte de display</label>
                <select className="light-input" style={{ width: 200 }}><option>Anton (default)</option><option>Bebas Neue</option><option>Oswald</option></select>
              </div>
            </div>
          </div>

          <div style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: 10, background: 'var(--p-soft)', borderTop: '1px solid var(--p-line)' }}>
            <button className="btn-l">Cancelar</button>
            <button className="btn-l-red btn-l">Salvar alterações</button>
          </div>
        </div>
      </div>
    </LightShell>
  );
}
window.AjustesGeral = AjustesGeral;

// ─── 4. AJUSTES · TEMPLATES DE ETIQUETA ──────────────
function AjustesTemplates() {
  const templates = [
    { id: 'TPL-CXIND-A',  name: 'Caixa individual · A',   tam: '100×60mm',  uso: 'Padrão da casa',     impr: 'Zebra GX430t · 203dpi', editor: 'Tatiana A.', mod: '02/05', ativo: true },
    { id: 'TPL-CXIND-B',  name: 'Caixa individual · B',   tam: '100×100mm', uso: 'Sandália de tiras',  impr: 'Zebra GX430t · 203dpi', editor: 'Tatiana A.', mod: '02/05', ativo: true },
    { id: 'TPL-CXIND-C',  name: 'Caixa individual · C',   tam: '100×50mm',  uso: 'Linhas econômicas',  impr: 'Brother QL-820',         editor: 'Marcio',     mod: '28/04', ativo: true },
    { id: 'TPL-CXEXT-A',  name: 'Caixa externa · A',      tam: '100×150mm', uso: 'Master pack mono',   impr: 'Zebra ZD420 · 300dpi',  editor: 'Tatiana A.', mod: '01/05', ativo: true },
    { id: 'TPL-CXEXT-B',  name: 'Caixa externa · B',      tam: '100×150mm', uso: 'Manifesto multi-mod',impr: 'Zebra ZD420 · 300dpi',  editor: 'Tatiana A.', mod: '03/05', ativo: true },
    { id: 'TPL-MP-A',     name: 'Etiqueta MP',            tam: '100×70mm',  uso: 'Recebimento couro',  impr: 'Zebra GX430t',          editor: 'Henrique',   mod: '15/04', ativo: true },
    { id: 'TPL-PAR-A',    name: 'Tag de par',             tam: '50×80mm',   uso: 'Tag interna caixa',  impr: 'Brother QL-820',        editor: 'Tatiana A.', mod: '20/04', ativo: false },
  ];

  return (
    <LightShell active="tpls" breadcrumb="SISTEMA · TEMPLATES DE ETIQUETA" title="TEMPLATES DE ETIQUETA TÉRMICA">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 18 }}>
        {[
          { l: 'Templates ativos', v: '6',   s: 'de 7 cadastrados' },
          { l: 'Impressoras conectadas', v: '4', s: 'Zebra · Brother' },
          { l: 'Etiquetas impressas hoje', v: '1.284', s: 'em 7 estações' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 16 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 36, marginTop: 6 }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div className="p-eyebrow">Layouts de impressora térmica</div>
            <div className="p-display" style={{ fontSize: 22, marginTop: 4 }}>TEMPLATES CADASTRADOS</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-l">Importar ZPL/EPL</button>
            <button className="btn-l-red btn-l">+ Novo template</button>
          </div>
        </div>

        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th style={{ width: 80 }}>Preview</th>
            <th>ID · Nome</th>
            <th>Tamanho</th>
            <th>Uso recomendado</th>
            <th>Impressora</th>
            <th>Editor</th>
            <th>Modif.</th>
            <th>Status</th>
            <th></th>
          </tr></thead>
          <tbody>
            {templates.map((t, i) => (
              <tr key={i}>
                <td>
                  <div style={{ width: 64, height: 36, background: '#fff', border: '1px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: 50, height: 4, background: '#000' }}/>
                  </div>
                </td>
                <td>
                  <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{t.id}</div>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                </td>
                <td className="p-mono" style={{ fontSize: 11 }}>{t.tam}</td>
                <td style={{ fontSize: 11 }}>{t.uso}</td>
                <td style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{t.impr}</td>
                <td style={{ fontSize: 11 }}>{t.editor}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{t.mod}</td>
                <td>{t.ativo ? <span className="p-pill p-pill-ok">Ativo</span> : <span className="p-pill">Rascunho</span>}</td>
                <td>
                  <button className="btn-l" style={{ height: 24, fontSize: 10 }}>Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.AjustesTemplates = AjustesTemplates;
