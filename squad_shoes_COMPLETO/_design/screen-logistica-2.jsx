// LOGÍSTICA · Romaneios + Transportadoras + Entregas

// ─── ROMANEIOS ───────────────────────────────────────
function LogRomaneios() {
  const rom = [
    { id: 'R-2026-0042', dest: 'VIP Shoes Araruama',  uf: 'RJ', volumes: 4,  cargas: ['EXP-1284'],                   peso: '32 kg',  valor: 28840,  saida: '09/05 14:30', transp: 'TransSul', placa: 'CR-09214', st: 'rota' },
    { id: 'R-2026-0041', dest: 'Riachuelo Magazine',  uf: 'RN', volumes: 12, cargas: ['EXP-1283'],                   peso: '264 kg', valor: 84280,  saida: '09/05 16:00', transp: 'Coletivo NE', placa: 'FR-88412', st: 'rota' },
    { id: 'R-2026-0040', dest: 'Múltiplos · SP/MG',    uf: 'SP', volumes: 14, cargas: ['EXP-1282', 'EXP-1281'],       peso: '180 kg', valor: 61020,  saida: '10/05 08:00', transp: 'TransSul', placa: 'BS-44128', st: 'aguarda' },
    { id: 'R-2026-0039', dest: 'Pampas Calçados',     uf: 'RS', volumes: 4,  cargas: ['EXP-1280'],                   peso: '70 kg',  valor: 19840,  saida: '11/05 06:00', transp: 'TransSul · subc.', placa: '—',         st: 'rasc' },
    { id: 'R-2026-0038', dest: 'Brioni Calçados',     uf: 'SP', volumes: 6,  cargas: ['EXP-1278'],                   peso: '62 kg',  valor: 18420,  saida: '07/05 11:00', transp: 'Coletivo SE', placa: 'BS-12882', st: 'ent' },
  ];
  const st = {
    rasc:    { l: 'Rascunho', cls: 'p-pill' },
    aguarda: { l: 'Aguardando', cls: 'p-pill-warn' },
    rota:    { l: 'Em rota', cls: 'p-pill-warn' },
    ent:     { l: 'Entregue', cls: 'p-pill-ok' },
  };
  return (
    <LightShell active="rom" breadcrumb="LOGÍSTICA · ROMANEIOS" title="ROMANEIOS" actions={<>
      <button className="btn-l">Imprimir</button>
      <button className="btn-l-red btn-l">+ Novo romaneio</button>
    </>}>
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Romaneio</th><th>Destinatário</th><th>UF</th>
            <th className="num">Vol.</th><th>Cargas</th><th className="num">Peso</th><th className="num">Valor</th>
            <th>Saída</th><th>Transportadora</th><th>Placa</th><th>Status</th>
          </tr></thead>
          <tbody>
            {rom.map((r, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{r.id}</td>
                <td style={{ fontWeight: 600 }}>{r.dest}</td>
                <td className="p-mono" style={{ fontSize: 11, fontWeight: 600 }}>{r.uf}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r.volumes}</td>
                <td style={{ fontSize: 10.5 }}>
                  {r.cargas.map((c, ci) => (
                    <span key={ci} className="p-mono" style={{ marginRight: 6, padding: '1px 6px', background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>{c}</span>
                  ))}
                </td>
                <td className="num"><span className="p-mono">{r.peso}</span></td>
                <td className="num" style={{ fontWeight: 700 }}>R$ {r.valor.toLocaleString('pt-BR')}</td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{r.saida}</td>
                <td style={{ fontSize: 11 }}>{r.transp}</td>
                <td className="p-mono" style={{ fontSize: 10.5, fontWeight: 600 }}>{r.placa}</td>
                <td><span className={`p-pill ${st[r.st].cls}`}>{st[r.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.LogRomaneios = LogRomaneios;

// ─── TRANSPORTADORAS ─────────────────────────────────
function LogTransportadoras() {
  const transp = [
    { cod: 'T-001', nome: 'TransSul Logística',     cnpj: '08.412.220/0001-18', regiao: 'BR · todas',    veic: 12, motor: 18, vol30d: 'R$ 184k', sla: 96, sin: 0, st: 'ok' },
    { cod: 'T-002', nome: 'Coletivo Nordeste',      cnpj: '14.882.022/0001-90', regiao: 'NE',            veic: 8,  motor: 12, vol30d: 'R$ 84k',  sla: 92, sin: 1, st: 'ok' },
    { cod: 'T-003', nome: 'Coletivo Sudeste',       cnpj: '12.412.118/0001-04', regiao: 'SE',            veic: 14, motor: 22, vol30d: 'R$ 124k', sla: 94, sin: 0, st: 'ok' },
    { cod: 'T-004', nome: 'Expressa Sul',           cnpj: '04.118.428/0001-22', regiao: 'S',             veic: 6,  motor: 9,  vol30d: 'R$ 48k',  sla: 88, sin: 2, st: 'warn', red: true },
    { cod: 'T-005', nome: 'CO Centro Logística',    cnpj: '18.114.882/0001-05', regiao: 'CO + N',        veic: 4,  motor: 6,  vol30d: 'R$ 12k',  sla: 84, sin: 1, st: 'warn' },
  ];
  return (
    <LightShell active="transp" breadcrumb="LOGÍSTICA · TRANSPORTADORAS" title="TRANSPORTADORAS" actions={<>
      <button className="btn-l-red btn-l">+ Nova transportadora</button>
    </>}>
      <div className="light-card" style={{ padding: 22 }}>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Código</th><th>Razão social</th><th>CNPJ</th><th>Região</th>
            <th className="num">Veículos</th><th className="num">Motoristas</th>
            <th className="num">Vol. 30d</th><th>SLA on-time</th><th className="num">Sinistros</th>
          </tr></thead>
          <tbody>
            {transp.map((t, i) => (
              <tr key={i} style={t.red ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{t.cod}</td>
                <td style={{ fontWeight: 600 }}>{t.nome}</td>
                <td className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{t.cnpj}</td>
                <td><span className="p-pill" style={{ fontSize: 8.5 }}>{t.regiao}</span></td>
                <td className="num">{t.veic}</td>
                <td className="num">{t.motor}</td>
                <td className="num" style={{ fontWeight: 700 }}>{t.vol30d}</td>
                <td style={{ width: 120 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: t.sla + '%', background: t.sla < 90 ? 'var(--p-red)' : t.sla < 95 ? 'var(--p-warn)' : 'var(--p-ok)' }}/>
                    </div>
                    <span className="p-mono" style={{ fontSize: 10, fontWeight: 700 }}>{t.sla}%</span>
                  </div>
                </td>
                <td className="num"><span className="p-mono" style={{ color: t.sin > 0 ? 'var(--p-red)' : 'var(--p-mute)', fontWeight: t.sin > 0 ? 700 : 400 }}>{t.sin}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.LogTransportadoras = LogTransportadoras;

// ─── ENTREGAS · rastreio ────────────────────────────
function LogEntregas() {
  const entr = [
    { id: 'EXP-1283', cli: 'Riachuelo Magazine', uf: 'RN', etapas: ['EMITIDA', 'COLETADA', 'EM TRÂNSITO', 'NA FILIAL', 'EM ROTA', 'ENTREGUE'], current: 2, saida: '09/05', prev: '13/05', red: false },
    { id: 'EXP-1284', cli: 'VIP Shoes Araruama', uf: 'RJ', etapas: ['EMITIDA', 'COLETADA', 'EM TRÂNSITO', 'NA FILIAL', 'EM ROTA', 'ENTREGUE'], current: 4, saida: '09/05', prev: '10/05', red: false },
    { id: 'EXP-1278', cli: 'Brioni Calçados',    uf: 'SP', etapas: ['EMITIDA', 'COLETADA', 'EM TRÂNSITO', 'NA FILIAL', 'EM ROTA', 'ENTREGUE'], current: 5, saida: '07/05', prev: '08/05', red: false },
    { id: 'EXP-1276', cli: 'VO Figueira',        uf: 'RJ', etapas: ['EMITIDA', 'COLETADA', 'EM TRÂNSITO', 'NA FILIAL', 'EM ROTA', 'ENTREGUE'], current: 2, saida: '05/05', prev: '07/05', red: true },
  ];
  return (
    <LightShell active="entr" breadcrumb="LOGÍSTICA · ENTREGAS" title="ENTREGAS · RASTREIO" actions={<>
      <button className="btn-l">Sinistros</button>
      <button className="btn-l">Histórico 30d</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Em trânsito',   v: '14',     s: 'previstas 7d' },
          { l: 'Atrasadas',     v: '1',      s: 'requer ação', red: true },
          { l: 'Entregues 7d',  v: '38',     s: 'SLA 94%' },
          { l: 'Devolvidas',    v: '2',      s: 'em análise' },
          { l: 'Tempo médio',   v: '3,2 dias', s: 'rota fábrica → loja' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        {entr.map((e, i) => (
          <div key={i} style={{ marginBottom: 16, padding: '14px 18px', background: e.red ? 'var(--p-red-soft)' : 'var(--p-soft)', border: '1px solid ' + (e.red ? 'var(--p-red)' : 'var(--p-line)') }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 13 }}>{e.id}</span>
                <span style={{ fontWeight: 600 }}>{e.cli}</span>
                <span className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', padding: '1px 6px', background: '#fff', border: '1px solid var(--p-line)' }}>{e.uf}</span>
              </div>
              <div style={{ display: 'flex', gap: 18, fontSize: 11 }}>
                <div><span className="p-eyebrow" style={{ fontSize: 7.5 }}>Saída: </span><span className="p-mono" style={{ fontWeight: 700 }}>{e.saida}</span></div>
                <div><span className="p-eyebrow" style={{ fontSize: 7.5 }}>Previsto: </span><span className="p-mono" style={{ fontWeight: 700, color: e.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{e.prev}</span></div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {e.etapas.map((et, ei) => {
                const done = ei <= e.current;
                const active = ei === e.current;
                return (
                  <React.Fragment key={ei}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 70 }}>
                      <div style={{
                        width: 22, height: 22,
                        background: active ? 'var(--p-red)' : done ? 'var(--p-ink)' : '#fff',
                        border: '1.5px solid', borderColor: active ? 'var(--p-red)' : done ? 'var(--p-ink)' : 'var(--p-line-2)',
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'JetBrains Mono', fontSize: 9.5, fontWeight: 700,
                      }}>{done ? (active ? '●' : '✓') : ei + 1}</div>
                      <div className="p-mono" style={{ fontSize: 7.5, letterSpacing: '0.08em', color: active ? 'var(--p-red)' : done ? 'var(--p-ink)' : 'var(--p-mute)', fontWeight: active || done ? 700 : 400, textAlign: 'center' }}>{et}</div>
                    </div>
                    {ei < e.etapas.length - 1 && (
                      <div style={{ flex: 1, height: 2, background: done ? 'var(--p-ink)' : 'var(--p-line)', marginBottom: 16 }}/>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </LightShell>
  );
}
window.LogEntregas = LogEntregas;
