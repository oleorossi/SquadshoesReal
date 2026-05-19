// FINANCEIRO · NF-e, CT-e, MDF-e, Contas (AR/AP)

// ─── NF-e ─────────────────────────────────────────────
function FinNFe() {
  const nfes = [
    { num: '189.428', dest: 'VIP Shoes Araruama',  uf: 'RJ', emit: '08/05/2026 14:30', valor: 28840, pares: 420, ops: 'OP-2847', st: 'aut',  chave: '24260514...8428' },
    { num: '189.427', dest: 'Brioni Calçados',     uf: 'SP', emit: '08/05/2026 11:18', valor: 18420, pares: 280, ops: 'OP-2849', st: 'aut',  chave: '24260514...8427' },
    { num: '189.426', dest: 'Centauro Esportes',   uf: 'MG', emit: '07/05/2026 16:42', valor: 42180, pares: 540, ops: 'OP-2851 +2', st: 'aut',  chave: '24260514...8426' },
    { num: '189.425', dest: 'Riachuelo Magazine',  uf: 'RN', emit: '07/05/2026 09:14', valor: 84280, pares: 1200, ops: 'OP-2848 +5', st: 'aut',  chave: '24260514...8425' },
    { num: '189.424', dest: 'VO Figueira',         uf: 'RJ', emit: '06/05/2026 17:08', valor: 6420,  pares: 108, ops: 'OP-2842', st: 'cont', red: true },
    { num: '189.423', dest: 'Pampas Calçados',     uf: 'RS', emit: '06/05/2026 14:22', valor: 19840, pares: 320, ops: 'OP-2843', st: 'aut' },
    { num: '189.422', dest: 'Pompéia Calçados',    uf: 'SP', emit: '05/05/2026 11:45', valor: 12840, pares: 220, ops: 'OP-2841', st: 'aut' },
    { num: '—',       dest: 'Tiana de Icaraí',     uf: 'RJ', emit: '08/05/2026 09:20', valor: 4280,  pares: 72,  ops: 'OP-2855', st: 'rasc' },
  ];
  const st = {
    aut:  { l: 'Autorizada', cls: 'p-pill-ok' },
    rasc: { l: 'Rascunho',   cls: 'p-pill' },
    cont: { l: 'Contingência', cls: 'p-pill-red' },
  };
  return (
    <LightShell active="nfe" breadcrumb="FINANCEIRO · NF-e" title="NOTAS FISCAIS ELETRÔNICAS" actions={<>
      <button className="btn-l">Sefaz · Consultar</button>
      <button className="btn-l-red btn-l">+ Emitir NF-e</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Emitidas hoje', v: '8',           s: 'R$ 184k' },
          { l: 'Autorizadas',   v: '42',          s: 'mês atual' },
          { l: 'Contingência',  v: '1',           s: 'aguardando Sefaz', red: true },
          { l: 'Rascunhos',     v: '3',           s: 'pendentes' },
          { l: 'Faturado mês',  v: 'R$ 1,24M',    s: '+18% vs abr' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['Todas', 'Hoje', 'Autorizadas', 'Contingência', 'Rascunhos', 'Canceladas'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Nº</th><th>Destinatário</th><th>UF</th><th>Emissão</th>
            <th className="num">Pares</th><th className="num">Valor</th><th>OPs origem</th><th>Chave</th><th>Status</th>
          </tr></thead>
          <tbody>
            {nfes.map((n, i) => (
              <tr key={i} style={n.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{n.num}</td>
                <td style={{ fontWeight: 600 }}>{n.dest}</td>
                <td className="p-mono" style={{ fontSize: 11, fontWeight: 600 }}>{n.uf}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{n.emit}</td>
                <td className="num">{n.pares}</td>
                <td className="num" style={{ fontWeight: 700 }}>R$ {n.valor.toLocaleString('pt-BR')}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{n.ops}</td>
                <td className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>{n.chave}</td>
                <td><span className={`p-pill ${st[n.st].cls}`}>{st[n.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.FinNFe = FinNFe;

// ─── CT-e (Conhecimento de Transporte — empty state como print) ──
function FinCTe() {
  return (
    <LightShell active="cte" breadcrumb="FINANCEIRO · CT-e" title="CT-e · CONHECIMENTO DE TRANSPORTE" actions={<>
      <button className="btn-l">Importar XML</button>
      <button className="btn-l-red btn-l">+ Emitir CT-e</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Emitidos hoje', v: '0',  s: 'nenhum CT-e' },
          { l: 'Mês atual',     v: '0',  s: 'maio/2026' },
          { l: 'Pendentes',     v: '0',  s: 'aguardando' },
          { l: 'Cancelados',    v: '0',  s: '90 dias' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: 'var(--p-dim)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      <div className="light-card" style={{ padding: 60, textAlign: 'center' }}>
        <div style={{ width: 100, height: 100, margin: '0 auto', border: '2px dashed var(--p-line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
          <div style={{ fontFamily: 'Anton', fontSize: 38, color: 'var(--p-dim)', letterSpacing: '0.02em' }}>CT-e</div>
          <div style={{ position: 'absolute', top: -10, right: -10, background: 'var(--p-red)', color: '#fff', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon.Plus style={{ width: 14, height: 14 }}/></div>
        </div>
        <div className="p-display" style={{ fontSize: 24, marginTop: 22 }}>NENHUM CT-e EMITIDO</div>
        <div style={{ fontSize: 12.5, color: 'var(--p-mute)', marginTop: 6, maxWidth: 500, marginInline: 'auto', lineHeight: 1.5 }}>
          O CT-e (Conhecimento de Transporte Eletrônico) é emitido quando você mesmo presta o serviço de transporte ou contrata transportadora autônoma. Para entregas com transportadora, ela emite o CT-e.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 22 }}>
          <button className="btn-l">Ver guia de emissão</button>
          <button className="btn-l-red btn-l"><Icon.Plus style={{ width: 13, height: 13 }}/> Criar primeiro rascunho</button>
        </div>

        <div style={{ marginTop: 40, padding: '14px 20px', background: 'var(--p-soft)', border: '1px solid var(--p-line)', maxWidth: 540, marginInline: 'auto', textAlign: 'left' }}>
          <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Quando usar CT-e</div>
          <ul style={{ fontSize: 11, marginTop: 6, paddingLeft: 18, lineHeight: 1.6 }}>
            <li>Frota própria fazendo entrega</li>
            <li>Transportadora autônoma sem CT-e próprio</li>
            <li>Subcontratação de transporte</li>
            <li>Devoluções com frete por conta do destinatário</li>
          </ul>
        </div>
      </div>
    </LightShell>
  );
}
window.FinCTe = FinCTe;

// ─── MDF-e ───────────────────────────────────────────
function FinMDFe() {
  const mdfes = [
    { num: 'MDF-1284', placa: 'CR-09214', motorista: 'Roberval Silva', cpf: '184.***.***-22', rota: 'Franca/SP → Araruama/RJ',     emissao: '08/05 06:00', cargas: 4, nfes: 12, valor: 184000, st: 'aut' },
    { num: 'MDF-1283', placa: 'BS-44128', motorista: 'Carlos Henrique', cpf: '298.***.***-04', rota: 'Franca/SP → São Paulo/SP',    emissao: '07/05 14:30', cargas: 6, nfes: 18, valor: 92400,  st: 'enc' },
    { num: 'MDF-1282', placa: 'FR-88412', motorista: 'Mauricio Pinto',  cpf: '412.***.***-18', rota: 'Franca/SP → Porto Alegre/RS', emissao: '06/05 04:30', cargas: 3, nfes: 9,  valor: 64800,  st: 'enc' },
    { num: 'MDF-1281', placa: 'CR-09214', motorista: 'Roberval Silva',  cpf: '184.***.***-22', rota: 'Franca/SP → Belo Horizonte/MG', emissao: '05/05 05:00', cargas: 5, nfes: 14, valor: 128400, st: 'enc' },
    { num: '—',       placa: 'XX-00000', motorista: 'A definir',        cpf: '—',              rota: 'Franca/SP → Niterói/RJ',     emissao: '—',           cargas: 2, nfes: 6,  valor: 22400,  st: 'rasc' },
  ];
  const st = {
    aut:  { l: 'Em trânsito', cls: 'p-pill-warn' },
    enc:  { l: 'Encerrado',   cls: 'p-pill-ok' },
    rasc: { l: 'Rascunho',    cls: 'p-pill' },
  };
  return (
    <LightShell active="mdfe" breadcrumb="FINANCEIRO · MDF-e" title="MDF-e · MANIFESTO DE DOCUMENTOS" actions={<>
      <button className="btn-l">Encerrar manifesto</button>
      <button className="btn-l-red btn-l">+ Novo MDF-e</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Em trânsito',  v: '1',     s: 'CR-09214' },
          { l: 'Encerrados',   v: '14',    s: 'mês atual' },
          { l: 'Veículos',     v: '4',     s: 'frota + parceiros' },
          { l: 'Motoristas',   v: '6',     s: 'CNH válida' },
          { l: 'Valor mês',    v: 'R$ 624k', s: 'em manifestos' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>MDF-e</th><th>Placa</th><th>Motorista</th><th>Rota</th>
            <th>Emissão</th><th className="num">Cargas</th><th className="num">NF-es</th>
            <th className="num">Valor</th><th>Status</th>
          </tr></thead>
          <tbody>
            {mdfes.map((m, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{m.num}</td>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{m.placa}</td>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{m.motorista}</div>
                  <div className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>{m.cpf}</div>
                </td>
                <td style={{ fontSize: 11 }}>{m.rota}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{m.emissao}</td>
                <td className="num">{m.cargas}</td>
                <td className="num">{m.nfes}</td>
                <td className="num" style={{ fontWeight: 700 }}>R$ {m.valor.toLocaleString('pt-BR')}</td>
                <td><span className={`p-pill ${st[m.st].cls}`}>{st[m.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.FinMDFe = FinMDFe;

// ─── Contas (AR/AP) ───────────────────────────────────
function FinContas() {
  const contas = [
    { tipo: 'AR', doc: 'NF 189.428', parte: 'VIP Shoes Araruama',  venc: '07/06', valor: 28840, st: 'aberto' },
    { tipo: 'AR', doc: 'NF 189.425', parte: 'Riachuelo Magazine',  venc: '05/06', valor: 84280, st: 'aberto' },
    { tipo: 'AR', doc: 'NF 189.422', parte: 'Pompéia Calçados',    venc: '03/06', valor: 12840, st: 'aberto' },
    { tipo: 'AR', doc: 'NF 189.418', parte: 'VO Figueira',         venc: '02/05', valor: 6420,  st: 'venc', red: true },
    { tipo: 'AR', doc: 'NF 189.412', parte: 'Brioni Calçados',     venc: '28/04', valor: 18420, st: 'pago' },
    { tipo: 'AP', doc: 'OC-2026-0214', parte: 'Curtume Vale',       venc: '15/05', valor: 14400, st: 'aberto' },
    { tipo: 'AP', doc: 'OC-2026-0213', parte: 'Soltec',             venc: '12/05', valor: 4080,  st: 'aberto' },
    { tipo: 'AP', doc: 'OC-2026-0212', parte: 'Adhesivos PR',       venc: '10/05', valor: 1760,  st: 'aberto' },
    { tipo: 'AP', doc: 'OC-2026-0210', parte: 'Pelicas RS',         venc: '08/05', valor: 1080,  st: 'venc', red: true },
    { tipo: 'AP', doc: 'OC-2026-0208', parte: 'EVA Pack',           venc: '05/05', valor: 1800,  st: 'pago' },
  ];
  const st = {
    aberto: { l: 'Em aberto', cls: 'p-pill-warn' },
    venc:   { l: 'Vencido',   cls: 'p-pill-red' },
    pago:   { l: 'Pago',      cls: 'p-pill-ok' },
  };
  const totalAR = contas.filter(c => c.tipo === 'AR' && c.st === 'aberto').reduce((a,c) => a+c.valor, 0);
  const totalAP = contas.filter(c => c.tipo === 'AP' && c.st === 'aberto').reduce((a,c) => a+c.valor, 0);

  return (
    <LightShell active="ap" breadcrumb="FINANCEIRO · CONTAS A RECEBER / A PAGAR" title="CONTAS · AR & AP" actions={<>
      <button className="btn-l">Exportar OFX</button>
      <button className="btn-l-red btn-l">+ Lançamento</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'A receber 30d', v: 'R$ ' + (totalAR/1000).toFixed(0) + 'k', s: 'em aberto' },
          { l: 'A pagar 30d',   v: 'R$ ' + (totalAP/1000).toFixed(0) + 'k', s: 'em aberto' },
          { l: 'Vencidos AR',   v: '1',  s: 'cobrança', red: true },
          { l: 'Vencidos AP',   v: '1',  s: 'pagar urgente', red: true },
          { l: 'Saldo previsto',v: 'R$ ' + ((totalAR-totalAP)/1000).toFixed(0) + 'k', s: 'líquido 30d' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['Todas', 'A Receber', 'A Pagar', 'Vencidas', 'Próximos 7d', 'Pagas'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Tipo</th><th>Documento</th><th>Cliente / Fornecedor</th>
            <th>Vencimento</th><th className="num">Valor</th><th>Status</th>
          </tr></thead>
          <tbody>
            {contas.map((c, i) => (
              <tr key={i} style={c.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td>
                  <span style={{
                    display: 'inline-block', background: c.tipo === 'AR' ? 'var(--p-ok)' : 'var(--p-red)',
                    color: '#fff', padding: '2px 8px',
                    fontFamily: 'JetBrains Mono', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em',
                  }}>{c.tipo}</span>
                </td>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{c.doc}</td>
                <td style={{ fontWeight: 600 }}>{c.parte}</td>
                <td className="p-mono" style={{ fontSize: 11, fontWeight: c.red ? 700 : 400, color: c.red ? 'var(--p-red)' : 'inherit' }}>{c.venc}</td>
                <td className="num" style={{ fontWeight: 700, color: c.tipo === 'AR' ? 'var(--p-ok)' : 'var(--p-red)' }}>{c.tipo === 'AR' ? '+' : '−'} R$ {c.valor.toLocaleString('pt-BR')}</td>
                <td><span className={`p-pill ${st[c.st].cls}`}>{st[c.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.FinContas = FinContas;
