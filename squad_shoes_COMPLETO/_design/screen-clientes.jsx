// COMERCIAL · CLIENTES — listagem + KPIs + filtros
function ComercialClientes() {
  const clientes = [
    { cod: 'L036', razao: 'VIP SHOES ARARUAMA',     cidade: 'Araruama/RJ',  rep: 'MA13', curva: 'A', cred: 45000,  saldo: 12400,  ult: '06/05', op: 1, st: 'ok'   },
    { cod: 'L184', razao: 'BRIONI CALÇADOS',        cidade: 'São Paulo/SP', rep: 'MA13', curva: 'A', cred: 80000,  saldo: 38600,  ult: '04/05', op: 2, st: 'ok'   },
    { cod: 'L240', razao: 'PAMPAS CALÇADOS',         cidade: 'P. Alegre/RS', rep: 'AS04', curva: 'A', cred: 60000,  saldo: 28400,  ult: '02/05', op: 1, st: 'ok'   },
    { cod: 'L309', razao: 'VO FIGUEIRA',             cidade: 'Niterói/RJ',   rep: '—',    curva: 'B', cred: 20000,  saldo: 18200,  ult: '28/04', op: 0, st: 'warn' },
    { cod: 'L312', razao: 'TIANA DE ICARAÍ',         cidade: 'Niterói/RJ',   rep: '—',    curva: 'B', cred: 15000,  saldo: 16400,  ult: '21/04', op: 0, st: 'late' },
    { cod: 'L424', razao: 'ALCINEU DE MADUREIRA',    cidade: 'Rio/RJ',       rep: 'JL08', curva: 'B', cred: 22000,  saldo: 9100,   ult: '02/05', op: 1, st: 'ok'   },
    { cod: 'L501', razao: 'LOJÃO DE NITERÓI',        cidade: 'Niterói/RJ',   rep: 'JL08', curva: 'B', cred: 18000,  saldo: 4800,   ult: '05/05', op: 0, st: 'ok'   },
    { cod: 'L612', razao: 'CENTAURO ESPORTES',       cidade: 'B. Hor./MG',   rep: 'AS04', curva: 'A', cred: 120000, saldo: 64000,  ult: '07/05', op: 3, st: 'ok'   },
    { cod: 'L688', razao: 'RIACHUELO MAGAZINE',      cidade: 'Natal/RN',     rep: 'MA13', curva: 'A', cred: 200000, saldo: 142000, ult: '08/05', op: 4, st: 'ok'   },
    { cod: 'L702', razao: 'POMPÉIA CALÇADOS',        cidade: 'Itu/SP',       rep: 'JL08', curva: 'B', cred: 28000,  saldo: 12800,  ult: '01/05', op: 1, st: 'ok'   },
  ];
  return (
    <LightShell active="clientes" breadcrumb="COMERCIAL · CLIENTES" title="CLIENTES" actions={<>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Curva</button>
      <button className="btn-l-red btn-l">+ Novo cliente</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Ativos',    v: '418',     s: '+8 este mês' },
          { l: 'Curva A',   v: '64',      s: '15% da carteira' },
          { l: 'Inadim.',   v: '12',      s: 'requer ação', red: true },
          { l: 'Crédito usado', v: '72%', s: 'do total liberado' },
          { l: 'Ticket méd.',   v: 'R$ 3.840', s: '90 dias' },
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
          {['Todos', 'Curva A', 'Curva B', 'Curva C', 'Sem rep.', 'Inadim.'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Código</th><th>Razão social</th><th>Cidade</th><th>Rep.</th><th>Curva</th>
            <th className="num">Limite</th><th className="num">Saldo</th><th>Uso</th>
            <th>Última</th><th className="num">OPs</th><th>Status</th>
          </tr></thead>
          <tbody>
            {clientes.map((c, i) => {
              const uso = Math.min(100, (c.saldo / c.cred) * 100);
              return (
                <tr key={i}>
                  <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{c.cod}</td>
                  <td style={{ fontWeight: 600 }}>{c.razao}</td>
                  <td style={{ fontSize: 11 }}>{c.cidade}</td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{c.rep}</td>
                  <td>
                    <span style={{
                      display: 'inline-block', width: 20, height: 20, lineHeight: '20px', textAlign: 'center',
                      background: c.curva === 'A' ? 'var(--p-ink)' : 'var(--p-line-2)',
                      color: c.curva === 'A' ? '#fff' : 'var(--p-ink)',
                      fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700,
                    }}>{c.curva}</span>
                  </td>
                  <td className="num">R$ {(c.cred/1000).toFixed(0)}k</td>
                  <td className="num" style={{ fontWeight: 600, color: c.st === 'late' ? 'var(--p-red)' : 'inherit' }}>R$ {(c.saldo/1000).toFixed(1)}k</td>
                  <td style={{ width: 100 }}>
                    <div style={{ height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: uso + '%', background: uso > 100 ? 'var(--p-red)' : uso > 80 ? 'var(--p-warn)' : 'var(--p-ink)' }}/>
                    </div>
                    <div className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginTop: 1 }}>{Math.round(uso)}%</div>
                  </td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{c.ult}</td>
                  <td className="num">{c.op || '—'}</td>
                  <td>
                    {c.st === 'ok'   && <span className="p-pill p-pill-ok">Ativo</span>}
                    {c.st === 'warn' && <span className="p-pill p-pill-warn">Limite</span>}
                    {c.st === 'late' && <span className="p-pill p-pill-red">Atraso</span>}
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
window.ComercialClientes = ComercialClientes;
