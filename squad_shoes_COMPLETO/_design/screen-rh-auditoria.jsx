// RH (Painel + Banco de Horas) + Sistema · Auditoria

// ─── Painel RH ────────────────────────────────────────
function RhPainel() {
  const colab = [
    { id: 'OP-104', nome: 'Marcia Lopes',    setor: 'Costura',     turno: 1, casa: '8a 2m', score: 92, paresHora: 41, fpy: 98.1, ass: 100 },
    { id: 'OP-218', nome: 'Cleber Borges',   setor: 'Corte',       turno: 1, casa: '5a 4m', score: 88, paresHora: 38, fpy: 97.4, ass: 96 },
    { id: 'OP-312', nome: 'Daniela Ramos',   setor: 'Montagem',    turno: 1, casa: '11a',   score: 95, paresHora: 36, fpy: 98.8, ass: 100 },
    { id: 'OP-409', nome: 'Sandra Martins',  setor: 'Acabamento',  turno: 2, casa: '3a 8m', score: 85, paresHora: 32, fpy: 96.2, ass: 92 },
    { id: 'OP-512', nome: 'Roseli Pereira',  setor: 'Embalagem',   turno: 2, casa: '6a 1m', score: 90, paresHora: 44, fpy: 99.1, ass: 100 },
    { id: 'OP-618', nome: 'Henrique Cunha',  setor: 'Manutenção',  turno: 1, casa: '14a',   score: 87, paresHora: '—', fpy: '—', ass: 88 },
    { id: 'OP-721', nome: 'Patricia Alves',  setor: 'Costura',     turno: 1, casa: '2a 4m', score: 82, paresHora: 34, fpy: 95.8, ass: 100 },
    { id: 'OP-844', nome: 'Wilson Gomes',    setor: 'Corte',       turno: 2, casa: '9a 7m', score: 89, paresHora: 39, fpy: 97.2, ass: 96 },
  ];
  return (
    <LightShell active="prh" breadcrumb="RH · PAINEL" title="PAINEL RH" actions={<>
      <button className="btn-l">Folha</button>
      <button className="btn-l-red btn-l">+ Admissão</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Colaboradores', v: '64',   s: '52 chão + 12 adm' },
          { l: 'Em férias',     v: '4',    s: 'maio' },
          { l: 'Absenteísmo',   v: '2,1%', s: 'meta < 3%' },
          { l: 'Hora extra',    v: '184h', s: 'mês atual' },
          { l: 'Folha mês',     v: 'R$ 184k', s: '+vínculos' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 18 }}>
        <div className="light-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div className="p-eyebrow">Colaboradores · chão de fábrica</div>
              <div className="p-display" style={{ fontSize: 18, marginTop: 4 }}>RANKING SEMANA</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-l">Setor</button>
              <button className="btn-l">Turno</button>
            </div>
          </div>
          <table className="p-tbl p-tbl-zebra">
            <thead><tr>
              <th>ID</th><th>Colaborador</th><th>Setor</th><th>Turno</th>
              <th>Casa</th><th className="num">Score</th><th>Performance</th>
            </tr></thead>
            <tbody>
              {colab.map((c, i) => (
                <tr key={i}>
                  <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{c.id}</td>
                  <td style={{ fontWeight: 600 }}>{c.nome}</td>
                  <td><span className="p-pill" style={{ fontSize: 8.5 }}>{c.setor}</span></td>
                  <td className="p-mono" style={{ fontSize: 11 }}>T{c.turno}</td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{c.casa}</td>
                  <td className="num">
                    <span style={{ fontFamily: 'Anton', fontSize: 18, color: c.score >= 90 ? 'var(--p-ok)' : c.score >= 80 ? 'var(--p-ink)' : 'var(--p-warn)' }}>{c.score}</span>
                  </td>
                  <td style={{ width: 150 }}>
                    <div style={{ height: 6, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: c.score + '%', background: c.score >= 90 ? 'var(--p-ok)' : 'var(--p-ink)' }}/>
                    </div>
                    <div className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginTop: 2 }}>{c.paresHora !== '—' ? `${c.paresHora} pares/h · FPY ${c.fpy}%` : 'apoio · sem meta de pares'}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Setores · cabeças hoje</div>
          {[
            { s: 'Costura',     ativos: 14, total: 16, tx: 88 },
            { s: 'Corte',       ativos: 8,  total: 8,  tx: 100 },
            { s: 'Montagem',    ativos: 10, total: 12, tx: 83 },
            { s: 'Acabamento',  ativos: 6,  total: 6,  tx: 100 },
            { s: 'Embalagem',   ativos: 5,  total: 6,  tx: 83 },
            { s: 'Manutenção',  ativos: 3,  total: 4,  tx: 75 },
            { s: 'Qualidade',   ativos: 2,  total: 2,  tx: 100 },
          ].map((s, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600 }}>{s.s}</span>
                <span className="p-mono" style={{ fontSize: 10.5, color: s.tx < 90 ? 'var(--p-red)' : 'var(--p-mute)', fontWeight: 600 }}>{s.ativos}/{s.total}</span>
              </div>
              <div style={{ height: 5, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                <div style={{ height: '100%', width: s.tx + '%', background: s.tx < 90 ? 'var(--p-red)' : 'var(--p-ink)' }}/>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 10.5 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Alerta</div>
            <div style={{ marginTop: 4 }}>4 setores abaixo de 90% de presença. Verificar atestados pendentes.</div>
          </div>
        </div>
      </div>
    </LightShell>
  );
}
window.RhPainel = RhPainel;

// ─── Banco de Horas ──────────────────────────────────
function RhBancoHoras() {
  const colab = [
    { id: 'OP-104', nome: 'Marcia Lopes',    saldo:  4.5, h: 'h', ult: '08/05 · +1h', regra: 'até 40h', limite: 80 },
    { id: 'OP-218', nome: 'Cleber Borges',   saldo: -2.0, h: 'h', ult: '06/05 · −1h', regra: 'até 40h', limite: -16 },
    { id: 'OP-312', nome: 'Daniela Ramos',   saldo: 12.0, h: 'h', ult: '08/05 · +2h', regra: 'até 40h', limite: 80 },
    { id: 'OP-409', nome: 'Sandra Martins',  saldo:  0.0, h: 'h', ult: '—',           regra: 'até 40h', limite: 0  },
    { id: 'OP-512', nome: 'Roseli Pereira',  saldo: 22.5, h: 'h', ult: '08/05 · +3h', regra: 'até 40h', limite: 80 },
    { id: 'OP-618', nome: 'Henrique Cunha',  saldo: 38.0, h: 'h', ult: '07/05 · +4h', regra: 'até 40h', limite: 80, red: true },
    { id: 'OP-721', nome: 'Patricia Alves',  saldo: -8.0, h: 'h', ult: '05/05 · −2h', regra: 'até 40h', limite: -16, red: true },
    { id: 'OP-844', nome: 'Wilson Gomes',    saldo:  6.5, h: 'h', ult: '08/05 · +1h', regra: 'até 40h', limite: 80 },
  ];
  return (
    <LightShell active="bh" breadcrumb="RH · BANCO DE HORAS" title="BANCO DE HORAS" actions={<>
      <button className="btn-l">Fechar período</button>
      <button className="btn-l-red btn-l">+ Lançamento manual</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Saldo positivo', v: '64',   s: 'colaboradores' },
          { l: 'Saldo negativo', v: '8',    s: 'a compensar', red: true },
          { l: 'Total horas',    v: '+184h', s: 'líquido fábrica' },
          { l: 'Próximo limite', v: '2',    s: '> 35h acumulado', red: true },
          { l: 'Período',        v: 'MAI',  s: 'fecha 31/05' },
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
            <th>ID</th><th>Colaborador</th><th className="num">Saldo</th>
            <th>Distribuição</th><th>Última movim.</th><th>Regra</th>
          </tr></thead>
          <tbody>
            {colab.map((c, i) => {
              const pos = c.saldo >= 0;
              const pct = Math.min(100, (Math.abs(c.saldo) / 40) * 100);
              return (
                <tr key={i} style={c.red ? { background: 'var(--p-red-soft)' } : {}}>
                  <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{c.id}</td>
                  <td style={{ fontWeight: 600 }}>{c.nome}</td>
                  <td className="num">
                    <span style={{ fontFamily: 'Anton', fontSize: 20, color: pos ? 'var(--p-ok)' : 'var(--p-red)' }}>
                      {pos ? '+' : ''}{c.saldo.toFixed(1)}h
                    </span>
                  </td>
                  <td style={{ width: 220 }}>
                    {/* Eixo zero no meio */}
                    <div style={{ position: 'relative', height: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--p-ink)', opacity: 0.4 }}/>
                      {pos ? (
                        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: (pct/2) + '%', background: c.red ? 'var(--p-red)' : 'var(--p-ok)' }}/>
                      ) : (
                        <div style={{ position: 'absolute', right: '50%', top: 0, bottom: 0, width: (pct/2) + '%', background: 'var(--p-red)' }}/>
                      )}
                    </div>
                    <div className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginTop: 2, display: 'flex', justifyContent: 'space-between' }}>
                      <span>−40h</span><span>0</span><span>+40h</span>
                    </div>
                  </td>
                  <td className="p-mono" style={{ fontSize: 10.5 }}>{c.ult}</td>
                  <td><span className="p-pill" style={{ fontSize: 8.5 }}>{c.regra}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.RhBancoHoras = RhBancoHoras;

// ─── Sistema · Auditoria ─────────────────────────────
function SisAuditoria() {
  const eventos = [
    { ts: '08/05 14:32:18', usr: 'tatiana.a',  acao: 'EDIT',   recurso: 'Ficha Técnica FT-2026-I905',          campo: 'Material tira 2',     antes: 'Cru 1,8mm', depois: 'Cru 2,0mm', ip: '192.168.0.42', sev: 'info' },
    { ts: '08/05 14:28:04', usr: 'renata.m',   acao: 'APROVA', recurso: 'OP-2851',                              campo: 'status',              antes: 'pendente',  depois: 'liberada',  ip: '192.168.0.18', sev: 'info' },
    { ts: '08/05 13:55:42', usr: 'marcio.l',   acao: 'IMPRIME',recurso: 'Etiqueta CXIND-B · 142 unidades',     campo: '—',                   antes: '—',         depois: '—',         ip: '192.168.0.88', sev: 'info' },
    { ts: '08/05 11:42:08', usr: 'helena.c',   acao: 'CRIA',   recurso: 'NF-e 189.428',                         campo: '—',                   antes: '—',         depois: 'autorizada',ip: '192.168.0.55', sev: 'info' },
    { ts: '08/05 10:14:30', usr: 'sistema',    acao: 'ALERTA', recurso: 'Estoque MP-COL-PU',                    campo: 'nível',               antes: '22 kg',     depois: '14 kg',     ip: '—',            sev: 'warn' },
    { ts: '08/05 09:48:14', usr: 'pedro.m',    acao: 'DELETE', recurso: 'OC-2026-0209 (rascunho)',              campo: '—',                   antes: 'rascunho',  depois: 'removido',  ip: '192.168.0.71', sev: 'warn' },
    { ts: '08/05 08:30:00', usr: 'sistema',    acao: 'LOGIN',  recurso: 'admin (renata.m)',                     campo: '—',                   antes: '—',         depois: '—',         ip: '192.168.0.18', sev: 'info' },
    { ts: '07/05 23:14:42', usr: 'admin',      acao: 'EDIT',   recurso: 'Permissão · grupo "Comercial"',        campo: 'pode_excluir_pv',     antes: 'não',       depois: 'sim',       ip: '177.18.42.84', sev: 'crit' },
    { ts: '07/05 18:02:28', usr: 'wilson.g',   acao: 'FALHA',  recurso: 'Login (5 tentativas)',                  campo: 'senha',               antes: '—',         depois: 'bloqueado', ip: '187.42.118.4', sev: 'crit' },
    { ts: '07/05 17:42:08', usr: 'tatiana.a',  acao: 'CRIA',   recurso: 'Silk SK-FLR-08 (rascunho)',            campo: '—',                   antes: '—',         depois: 'rascunho',  ip: '192.168.0.42', sev: 'info' },
  ];
  const sev = {
    info: { l: 'Info',     cls: 'p-pill', color: 'var(--p-ink-2)' },
    warn: { l: 'Atenção',  cls: 'p-pill-warn', color: 'var(--p-warn)' },
    crit: { l: 'Crítico',  cls: 'p-pill-red',  color: 'var(--p-red)' },
  };
  const acaoColor = {
    EDIT: 'var(--p-info)', APROVA: 'var(--p-ok)', IMPRIME: 'var(--p-ink-2)',
    CRIA: 'var(--p-ok)',  ALERTA: 'var(--p-warn)', DELETE: 'var(--p-red)',
    LOGIN: 'var(--p-ink-2)', FALHA: 'var(--p-red)',
  };
  return (
    <LightShell active="audit" breadcrumb="SISTEMA · AUDITORIA" title="AUDITORIA · LOG DE EVENTOS" actions={<>
      <button className="btn-l">Exportar CSV</button>
      <button className="btn-l"><Icon.Filter style={{ width: 13, height: 13 }}/> Filtros</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Eventos hoje', v: '124',   s: 'em 7 módulos' },
          { l: 'Críticos 7d',  v: '4',     s: 'requer revisão', red: true },
          { l: 'Logins',       v: '38',    s: '12 usuários' },
          { l: 'Falhas auth',  v: '2',     s: '1 bloqueado', red: true },
          { l: 'Retenção',     v: '12m',   s: 'política LGPD' },
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
          {['Tudo', 'Edições', 'Aprovações', 'Logins', 'Críticos', 'Sistema'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl">
          <thead><tr>
            <th style={{ width: 130 }}>Timestamp</th>
            <th>Usuário</th>
            <th style={{ width: 80 }}>Ação</th>
            <th>Recurso</th>
            <th>Campo</th>
            <th>Antes → Depois</th>
            <th>IP</th>
            <th>Severidade</th>
          </tr></thead>
          <tbody>
            {eventos.map((e, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--p-line)', background: e.sev === 'crit' ? 'var(--p-red-soft)' : 'transparent' }}>
                <td className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{e.ts}</td>
                <td className="p-mono" style={{ fontSize: 10.5, fontWeight: 600 }}>{e.usr}</td>
                <td>
                  <span style={{
                    display: 'inline-block', background: acaoColor[e.acao] || 'var(--p-ink)',
                    color: '#fff', padding: '2px 7px',
                    fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                  }}>{e.acao}</span>
                </td>
                <td style={{ fontSize: 11.5, fontWeight: 600 }}>{e.recurso}</td>
                <td className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{e.campo}</td>
                <td className="p-mono" style={{ fontSize: 10 }}>
                  {e.antes !== '—' && <>
                    <span style={{ color: 'var(--p-mute)', textDecoration: 'line-through' }}>{e.antes}</span>
                    <span style={{ margin: '0 6px', color: 'var(--p-mute)' }}>→</span>
                  </>}
                  <span style={{ color: e.sev === 'crit' ? 'var(--p-red)' : 'var(--p-ink)', fontWeight: 600 }}>{e.depois}</span>
                </td>
                <td className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)' }}>{e.ip}</td>
                <td><span className={`p-pill ${sev[e.sev].cls}`}>{sev[e.sev].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.SisAuditoria = SisAuditoria;
