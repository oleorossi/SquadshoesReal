// LOTE FINAL 2: Terceirizados (RH), Automações (Sistema), Sessões Picking (Log), Imprimir Fichas + Fluxo (Produção)

// ─── Terceirizados ──────────────────────────────────
function RhTerceirizados() {
  const terc = [
    { cod: 'T-104', nome: 'Atelier Costura Real',  servico: 'Costura externa',     contato: 'Joana Real',     cnpj: '14.882.022/0001-90', pares30d: 1240, ot: 94, qc: 96, st: 'A', vinculadasOps: ['OP-2858', 'OP-2863'] },
    { cod: 'T-208', nome: 'Couros & Cia',          servico: 'Corte sob demanda',   contato: 'Marcelo Cia',    cnpj: '08.412.220/0001-18', pares30d: 820,  ot: 88, qc: 98, st: 'A', vinculadasOps: ['OP-2861'] },
    { cod: 'T-312', nome: 'Bordados Estrela',      servico: 'Bordados especiais',  contato: 'Maria Estrela',  cnpj: '12.412.118/0001-04', pares30d: 380,  ot: 82, qc: 92, st: 'B', vinculadasOps: ['OP-2867'] },
    { cod: 'T-419', nome: 'Acabamentos Fino',      servico: 'Acabamento manual',   contato: 'Roberto Fino',   cnpj: '04.118.428/0001-22', pares30d: 640,  ot: 78, qc: 88, st: 'B', vinculadasOps: ['OP-2843'], red: true },
  ];
  return (
    <LightShell active="terc" breadcrumb="RH · TERCEIRIZADOS" title="PRESTADORES DE SERVIÇO" actions={<>
      <button className="btn-l-red btn-l">+ Novo prestador</button>
    </>}>
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Código</th><th>Empresa</th><th>Serviço</th><th>Contato</th>
            <th className="num">Pares 30d</th><th>OT</th><th>QC</th><th>OPs ativas</th><th>Curva</th>
          </tr></thead>
          <tbody>
            {terc.map((t, i) => (
              <tr key={i} style={t.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{t.cod}</td>
                <td style={{ fontWeight: 600 }}>{t.nome}</td>
                <td><span className="p-pill" style={{ fontSize: 8.5 }}>{t.servico}</span></td>
                <td style={{ fontSize: 11 }}>{t.contato}</td>
                <td className="num" style={{ fontWeight: 600 }}>{t.pares30d}</td>
                <td style={{ width: 80 }}>
                  <span className="p-mono" style={{ fontWeight: 700, color: t.ot < 85 ? 'var(--p-red)' : 'inherit' }}>{t.ot}%</span>
                </td>
                <td>
                  <span className="p-mono" style={{ fontWeight: 700, color: t.qc < 90 ? 'var(--p-red)' : 'inherit' }}>{t.qc}%</span>
                </td>
                <td style={{ fontSize: 10 }}>
                  {t.vinculadasOps.map((o, oi) => (
                    <span key={oi} className="p-mono" style={{ marginRight: 4, padding: '1px 5px', background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>{o}</span>
                  ))}
                </td>
                <td>
                  <span style={{
                    display: 'inline-block', width: 22, height: 22, lineHeight: '22px', textAlign: 'center',
                    background: t.st === 'A' ? 'var(--p-ink)' : 'var(--p-line-2)',
                    color: t.st === 'A' ? '#fff' : 'var(--p-ink)',
                    fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700,
                  }}>{t.st}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.RhTerceirizados = RhTerceirizados;

// ─── Automações ─────────────────────────────────────
function SisAutomacoes() {
  const auto = [
    { id: 'AU-014', nome: 'Auto-gerar OC quando MP < ponto pedido', mod: 'Estoque → Compras', exec: 142, ult: '08/05 10:42', ativa: true },
    { id: 'AU-012', nome: 'Notificar PCP se OEE linha < 75%',        mod: 'Produção → Slack',  exec: 8,   ult: '08/05 14:32', ativa: true },
    { id: 'AU-011', nome: 'Emitir 2ª via boleto após 5d de atraso',  mod: 'Financeiro',        exec: 12,  ult: '07/05 09:00', ativa: true },
    { id: 'AU-010', nome: 'Imprimir etiqueta caixa ao fechar lote',  mod: 'OP → Etiquetas',    exec: 824, ult: '08/05 14:30', ativa: true },
    { id: 'AU-008', nome: 'Bloquear cliente se 2 NFs vencidas',      mod: 'Comercial',         exec: 4,   ult: '06/05 17:08', ativa: true },
    { id: 'AU-005', nome: 'Sugerir RFQ ao receber OC > R$ 5k',       mod: 'Compras',           exec: 18,  ult: '02/05 14:00', ativa: false },
  ];
  return (
    <LightShell active="auto" breadcrumb="SISTEMA · AUTOMAÇÕES" title="AUTOMAÇÕES & GATILHOS" actions={<>
      <button className="btn-l">Templates</button>
      <button className="btn-l-red btn-l">+ Nova automação</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Ativas',           v: '14', s: 'de 18 cadastradas' },
          { l: 'Disparos 30d',     v: '1.284', s: 'todas as regras' },
          { l: 'Falhas',           v: '2', s: 'requer revisão', red: true },
          { l: 'Tempo economizado',v: '124h', s: 'estimado' },
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
            <th>ID</th><th>Regra</th><th>Módulos</th>
            <th className="num">Execuções 30d</th><th>Última execução</th><th>Estado</th>
          </tr></thead>
          <tbody>
            {auto.map((a, i) => (
              <tr key={i} style={!a.ativa ? { opacity: 0.5 } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{a.id}</td>
                <td style={{ fontWeight: 600 }}>{a.nome}</td>
                <td><span className="p-pill" style={{ fontSize: 8.5 }}>{a.mod}</span></td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 600 }}>{a.exec}</span></td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{a.ult}</td>
                <td>{a.ativa ? <span className="p-pill p-pill-ok">Ativa</span> : <span className="p-pill">Pausada</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.SisAutomacoes = SisAutomacoes;

// ─── Sessões de Picking ─────────────────────────────
function LogSessoesPicking() {
  const sessoes = [
    { id: 'PKG-0142', op: 'PV-2026-00097', cli: 'VIP Shoes Araruama',  oper: 'Daniela R.', inicio: '08/05 14:08', pares: 144, prog: 78, st: 'ativa' },
    { id: 'PKG-0141', op: 'PV-2026-00094', cli: 'Brioni Calçados',     oper: 'Roseli P.',  inicio: '08/05 13:30', pares: 108, prog: 100, st: 'concl' },
    { id: 'PKG-0140', op: 'PV-2026-00093', cli: 'Pampas Calçados',     oper: 'Sandra M.',  inicio: '08/05 11:14', pares: 320, prog: 100, st: 'concl' },
    { id: 'PKG-0139', op: 'PV-2026-00092', cli: 'Centauro Esportes',   oper: 'Daniela R.', inicio: '08/05 09:42', pares: 540, prog: 100, st: 'concl' },
    { id: 'PKG-0138', op: 'PV-2026-00083', cli: 'Riachuelo Magazine',  oper: 'Lúcia C.',   inicio: '07/05 16:00', pares: 1200, prog: 100, st: 'concl' },
  ];
  const st = {
    ativa: { l: 'Em curso',   cls: 'p-pill-warn' },
    concl: { l: 'Concluída',  cls: 'p-pill-ok' },
  };
  return (
    <LightShell active="sess" breadcrumb="LOGÍSTICA · SESSÕES PICKING" title="SESSÕES DE PICKING">
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Sessão</th><th>Pedido</th><th>Cliente</th><th>Operador</th>
            <th>Início</th><th className="num">Pares</th><th>Progresso</th><th>Status</th>
          </tr></thead>
          <tbody>
            {sessoes.map((s, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{s.id}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{s.op}</td>
                <td style={{ fontWeight: 600 }}>{s.cli}</td>
                <td style={{ fontSize: 11 }}>{s.oper}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{s.inicio}</td>
                <td className="num" style={{ fontWeight: 600 }}>{s.pares}</td>
                <td style={{ width: 130 }}>
                  <div style={{ height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                    <div style={{ height: '100%', width: s.prog + '%', background: s.st === 'ativa' ? 'var(--p-red)' : 'var(--p-ok)' }}/>
                  </div>
                </td>
                <td><span className={`p-pill ${st[s.st].cls}`}>{st[s.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.LogSessoesPicking = LogSessoesPicking;

// ─── Imprimir Fichas (Produção) ─────────────────────
function ProdImprimir() {
  const ops = [
    { id: 'OP-2847', m: MODELOS['I901'], pares: 420, fichas: ['Roteiro', 'IT-Corte', 'IT-Costura', 'IT-Montagem', 'Apontamento', 'Cartão A5'] },
    { id: 'OP-2851', m: MODELOS['I905'], pares: 540, fichas: ['Roteiro', 'IT-Corte', 'IT-Costura', 'IT-Tiras', 'Apontamento', 'Cartão A5'] },
    { id: 'OP-2849', m: MODELOS['I918'], pares: 280, fichas: ['Roteiro', 'IT-Corte', 'IT-Costura', 'IT-Montagem', 'Apontamento', 'Cartão A5'] },
  ];
  return (
    <LightShell active="imp" breadcrumb="PRODUÇÃO · IMPRIMIR FICHAS" title="IMPRIMIR FICHAS DE PRODUÇÃO" actions={<>
      <button className="btn-l">Histórico</button>
    </>}>
      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ marginBottom: 14 }}>
          <div className="p-eyebrow">Selecione OPs e fichas a imprimir</div>
        </div>
        {ops.map((o, i) => (
          <div key={i} style={{ padding: '14px 18px', marginBottom: 10, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <input type="checkbox" defaultChecked={i === 0} style={{ width: 18, height: 18 }}/>
              <ShoePhoto w={56} h={42} label=""/>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 13 }}>{o.id}</span>
                  <span style={{ fontWeight: 600 }}>{o.m.name}</span>
                  <RefChip code={o.m.ref} size="sm"/>
                  <span className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{o.pares} pares</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {o.fichas.map((f, fi) => (
                    <label key={fi} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: '#fff', border: '1px solid var(--p-line-2)', fontSize: 10.5, cursor: 'pointer' }}>
                      <input type="checkbox" defaultChecked={fi < 3 || fi === 5} style={{ width: 12, height: 12 }}/>
                      {f}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 18, padding: 14, background: 'var(--p-ink)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)' }}>SELECIONADAS</div>
            <div style={{ fontFamily: 'Anton', fontSize: 22, marginTop: 2 }}>1 OP · 4 fichas · 12 páginas</div>
          </div>
          <button className="btn-l-red btn-l" style={{ background: 'var(--p-red)' }}>Imprimir agora →</button>
        </div>
      </div>
    </LightShell>
  );
}
window.ProdImprimir = ProdImprimir;

// ─── Fluxo (Produção) — Kanban editorial ─────────────
function ProdFluxo() {
  const cols = [
    { l: 'FILA', cards: [
      { op: 'OP-2858', m: MODELOS['I901'], pares: 240 },
      { op: 'OP-2861', m: MODELOS['I918'], pares: 180 },
    ]},
    { l: 'CORTE', cards: [
      { op: 'OP-2849', m: MODELOS['I918'], pares: 280 },
    ]},
    { l: 'COSTURA', cards: [
      { op: 'OP-2847', m: MODELOS['I901'], pares: 420 },
      { op: 'OP-2841', m: MODELOS['I901'], pares: 240 },
    ]},
    { l: 'MONTAGEM', cards: [
      { op: 'OP-2851', m: MODELOS['I905'], pares: 540, red: true },
    ]},
    { l: 'ACABAMENTO', cards: [
      { op: 'OP-2843', m: MODELOS['I918'], pares: 180 },
    ]},
    { l: 'EMBALAGEM', cards: [
      { op: 'OP-2855', m: MODELOS['I901'], pares: 320 },
    ]},
    { l: 'PRONTAS', cards: [
      { op: 'OP-2839', m: MODELOS['I905'], pares: 480, done: true },
    ]},
  ];
  return (
    <LightShell active="fluxo" breadcrumb="PRODUÇÃO · FLUXO" title="FLUXO · KANBAN POR ETAPA">
      <div style={{ display: 'flex', gap: 8, overflow: 'auto' }}>
        {cols.map((c, ci) => (
          <div key={ci} style={{ flex: '1 0 200px', minWidth: 200 }}>
            <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9.5, letterSpacing: '0.12em', fontWeight: 700 }}>{c.l}</span>
              <span className="p-mono" style={{ fontSize: 9, opacity: 0.7 }}>{c.cards.length}</span>
            </div>
            <div style={{ padding: 8, background: 'var(--p-soft)', border: '1px solid var(--p-line)', borderTop: 'none', minHeight: 200 }}>
              {c.cards.map((card, k) => (
                <div key={k} style={{
                  padding: 10, marginBottom: 6, background: '#fff',
                  border: '1px solid ' + (card.red ? 'var(--p-red)' : 'var(--p-line)'),
                  opacity: card.done ? 0.5 : 1,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span className="p-mono" style={{ fontWeight: 700, color: card.red ? 'var(--p-red)' : 'var(--p-red)', fontSize: 10.5 }}>{card.op}</span>
                    <RefChip code={card.m.ref} size="sm"/>
                  </div>
                  <div style={{ fontSize: 10.5, fontWeight: 600 }}>{card.m.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                    <ColorChips swatches={card.m.swatches} size="xs" showLabels={false} showNames={false}/>
                    <span className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginLeft: 'auto', fontWeight: 700 }}>{card.pares} pares</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </LightShell>
  );
}
window.ProdFluxo = ProdFluxo;
