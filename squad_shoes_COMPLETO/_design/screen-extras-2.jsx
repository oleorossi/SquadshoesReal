// COMERCIAL extras (CRM, SAC, Forecast) + COMPRAS (RFQ, Custos) + FINANCEIRO (Markup, Conciliação)

// ─── CRM ─────────────────────────────────────────────
function ComercialCRM() {
  const opps = [
    { id: 'OPP-128', cli: 'Magazine Luiza',      etapa: 'PROPOSTA',     valor: 184000, prob: 60, rep: 'MA13', proxAcao: 'Enviar mostruário', dias: 12 },
    { id: 'OPP-127', cli: 'Marisa Filiais',      etapa: 'NEGOCIAÇÃO',   valor: 92400,  prob: 80, rep: 'AS04', proxAcao: 'Revisar tabela',     dias: 3 },
    { id: 'OPP-124', cli: 'Centauro · linha 26', etapa: 'FECHAMENTO',   valor: 280000, prob: 90, rep: 'MA13', proxAcao: 'Assinar contrato',   dias: 1 },
    { id: 'OPP-122', cli: 'Boutique Vee · MG',   etapa: 'QUALIFICAÇÃO', valor: 28000,  prob: 30, rep: 'JL08', proxAcao: 'Visita técnica',     dias: 18 },
    { id: 'OPP-119', cli: 'Lojão Vitória/ES',    etapa: 'PROPOSTA',     valor: 42000,  prob: 50, rep: 'JL08', proxAcao: 'Follow-up email',   dias: 8 },
  ];
  return (
    <LightShell active="crm" breadcrumb="COMERCIAL · CRM" title="CRM · OPORTUNIDADES" actions={<>
      <button className="btn-l">Pipeline</button>
      <button className="btn-l-red btn-l">+ Nova oportunidade</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'No funil',       v: '24',          s: 'oportunidades' },
          { l: 'Valor pipeline', v: 'R$ 1,8M',     s: 'ponderado: R$ 624k' },
          { l: 'Fech. 30d',      v: 'R$ 240k',     s: '8 deals' },
          { l: 'Conversão',      v: '32%',         s: 'média 90d' },
          { l: 'Atrasadas',      v: '3',           s: 'sem ação 14d', red: true },
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
            <th>Oportunidade</th><th>Cliente</th><th>Etapa</th>
            <th className="num">Valor</th><th>Probabilidade</th><th>Rep.</th>
            <th>Próxima ação</th><th className="num">Dias</th>
          </tr></thead>
          <tbody>
            {opps.map((o, i) => (
              <tr key={i} style={o.dias > 14 ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{o.id}</td>
                <td style={{ fontWeight: 600 }}>{o.cli}</td>
                <td><span className="p-mono" style={{ fontSize: 9.5, letterSpacing: '0.08em', padding: '2px 6px', background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>{o.etapa}</span></td>
                <td className="num" style={{ fontWeight: 700 }}>R$ {o.valor.toLocaleString('pt-BR')}</td>
                <td style={{ width: 130 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 5, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: o.prob + '%', background: o.prob >= 70 ? 'var(--p-ok)' : 'var(--p-ink)' }}/>
                    </div>
                    <span className="p-mono" style={{ fontSize: 10.5, fontWeight: 700 }}>{o.prob}%</span>
                  </div>
                </td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{o.rep}</td>
                <td style={{ fontSize: 11 }}>{o.proxAcao}</td>
                <td className="num"><span className="p-mono" style={{ fontWeight: 600, color: o.dias > 14 ? 'var(--p-red)' : 'inherit' }}>{o.dias}d</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.ComercialCRM = ComercialCRM;

// ─── SAC ─────────────────────────────────────────────
function ComercialSAC() {
  const tickets = [
    { id: 'SAC-2026-0184', cli: 'VIP Shoes Araruama', assunto: 'Defeito de solado em 4 pares', op: 'OP-2847', sev: 'alta',  aberto: '2d', resp: 'Lúcia',  st: 'em-atend' },
    { id: 'SAC-2026-0183', cli: 'Riachuelo Magazine', assunto: 'Numeração trocada · caixa 1284', op: 'OP-2839', sev: 'alta',  aberto: '3d', resp: 'Bruno',  st: 'aguarda-cli' },
    { id: 'SAC-2026-0182', cli: 'Centauro Esportes',  assunto: 'Tag interna com REF errada',     op: 'OP-2845', sev: 'média', aberto: '5d', resp: 'Camila', st: 'em-atend' },
    { id: 'SAC-2026-0180', cli: 'Pampas Calçados',    assunto: 'Atraso de entrega · OC',         op: '—',       sev: 'média', aberto: '4d', resp: 'Marcio', st: 'em-atend' },
    { id: 'SAC-2026-0178', cli: 'Brioni Calçados',    assunto: 'Devolução · cor diferente',       op: 'OP-2841', sev: 'baixa', aberto: '8d', resp: 'Marcio', st: 'aguarda-cli' },
    { id: 'SAC-2026-0175', cli: 'Lojão de Niterói',   assunto: 'Pergunta sobre prazo',             op: '—',       sev: 'baixa', aberto: '1d', resp: 'Marcio', st: 'novo' },
  ];
  const st = {
    novo:         { l: 'Novo',           cls: 'p-pill-warn' },
    'em-atend':   { l: 'Em atendimento', cls: 'p-pill' },
    'aguarda-cli':{ l: 'Aguarda cliente', cls: 'p-pill' },
    resolvido:    { l: 'Resolvido',       cls: 'p-pill-ok' },
  };
  const sev = { alta: 'var(--p-red)', média: 'var(--p-warn)', baixa: 'var(--p-mute)' };
  return (
    <LightShell active="sac" breadcrumb="COMERCIAL · SAC" title="SAC · ATENDIMENTO PÓS-VENDA" actions={<>
      <button className="btn-l">SLA</button>
      <button className="btn-l-red btn-l">+ Abrir ticket</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Abertos',     v: '24',  s: '6 hoje' },
          { l: 'Alta sev.',   v: '3',   s: 'requer ação', red: true },
          { l: 'NPS · 30d',   v: '+72', s: '184 respostas', col: 'var(--p-ok)' },
          { l: 'TMR',         v: '14h', s: 'tempo médio resp.' },
          { l: 'Reincidência',v: '8%',  s: 'mesmo cliente' },
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
            <th>Ticket</th><th>Cliente</th><th>Assunto</th><th>OP origem</th>
            <th>Severidade</th><th>Aberto há</th><th>Responsável</th><th>Status</th>
          </tr></thead>
          <tbody>
            {tickets.map((t, i) => (
              <tr key={i} style={t.sev === 'alta' ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{t.id}</td>
                <td style={{ fontWeight: 600 }}>{t.cli}</td>
                <td style={{ fontSize: 11.5 }}>{t.assunto}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{t.op}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sev[t.sev] }}/>
                    <span className="p-mono" style={{ fontSize: 9.5, letterSpacing: '0.06em', fontWeight: 700, color: sev[t.sev] }}>{t.sev.toUpperCase()}</span>
                  </div>
                </td>
                <td className="p-mono" style={{ fontSize: 10.5, fontWeight: parseInt(t.aberto) > 4 ? 700 : 400, color: parseInt(t.aberto) > 4 ? 'var(--p-red)' : 'inherit' }}>{t.aberto}</td>
                <td style={{ fontSize: 11 }}>{t.resp}</td>
                <td><span className={`p-pill ${st[t.st].cls}`}>{st[t.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.ComercialSAC = ComercialSAC;

// ─── FORECAST ────────────────────────────────────────
function ComercialForecast() {
  const modelos = [
    { ref: 'I901', m: MODELOS['I901'], hist: 1340, fut4: [1380, 1420, 1380, 1280], trend: 'up' },
    { ref: 'I918', m: MODELOS['I918'], hist: 1420, fut4: [1380, 1340, 1280, 1240], trend: 'down' },
    { ref: 'I905', m: MODELOS['I905'], hist: 980,  fut4: [1080, 1240, 1380, 1480], trend: 'up' },
  ];
  return (
    <LightShell active="forecast" breadcrumb="COMERCIAL · FORECAST" title="FORECAST DE VENDAS · 4 SEMANAS">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Previsto 4 sem',  v: '24.840', s: 'pares' },
          { l: 'Variação histórica', v: '+12%', s: 'vs últ. 4 sem' },
          { l: 'Confiança',        v: '82%',    s: 'modelo ML' },
          { l: 'Modelos em alta',  v: '14',     s: 'de 24 ativos' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {modelos.map((mod, i) => {
            const max = Math.max(mod.hist, ...mod.fut4);
            return (
              <div key={i} style={{ border: '1px solid var(--p-line)', background: 'var(--p-soft)', padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{mod.m.name}</span>
                  <RefChip code={mod.ref} size="sm"/>
                  <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, color: mod.trend === 'up' ? 'var(--p-ok)' : 'var(--p-red)' }}>
                    {mod.trend === 'up' ? '↑' : '↓'}
                  </span>
                </div>
                <ColorChips swatches={mod.m.swatches} size="xs" showLabels={false} showNames={false}/>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, marginTop: 14, padding: '8px 0', borderBottom: '1px solid var(--p-line)' }}>
                  <div style={{ flex: 1, height: (mod.hist / max) * 60, background: 'var(--p-line-2)' }}/>
                  {mod.fut4.map((v, j) => (
                    <div key={j} style={{ flex: 1, height: (v / max) * 60, background: 'var(--p-red)', opacity: 0.5 + j * 0.12 }}/>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono', fontSize: 8, color: 'var(--p-mute)', marginTop: 4 }}>
                  <span>W19</span><span>W20</span><span>W21</span><span>W22</span><span>W23</span>
                </div>
                <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 8, textAlign: 'center' }}>
                  Total 4 sem: <span style={{ fontWeight: 700, color: 'var(--p-ink)' }}>{mod.fut4.reduce((a, b) => a + b, 0).toLocaleString('pt-BR')}</span> pares
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </LightShell>
  );
}
window.ComercialForecast = ComercialForecast;
