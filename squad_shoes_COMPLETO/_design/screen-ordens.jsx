// PRODUÇÃO · ORDENS (OPs) — listagem mestre de OPs ativas/concluídas
function ProducaoOrdens() {
  const ops = [
    { id: 'OP-2847', m: MODELOS['I901'], pares: 420, cli: 'VIP Shoes Araruama', linha: 'A1', etapa: 'COSTURA',    prog: 62, abre: '02/05', due: '08/05', st: 'urgente' },
    { id: 'OP-2849', m: MODELOS['I918'], pares: 280, cli: 'Brioni Calçados',    linha: 'A2', etapa: 'CORTE',      prog: 28, abre: '05/05', due: '10/05', st: 'ok' },
    { id: 'OP-2851', m: MODELOS['I905'], pares: 540, cli: 'Centauro Esportes',  linha: 'B1', etapa: 'MONTAGEM',   prog: 78, abre: '04/05', due: '12/05', st: 'ok' },
    { id: 'OP-2843', m: MODELOS['I918'], pares: 180, cli: 'Pompéia Calçados',   linha: 'B2', etapa: 'ACABAMENTO', prog: 91, abre: '01/05', due: 'Hoje',  st: 'late' },
    { id: 'OP-2855', m: MODELOS['I901'], pares: 320, cli: 'Riachuelo',          linha: 'C1', etapa: 'EMBALAGEM',  prog: 96, abre: '03/05', due: '07/05', st: 'ok' },
    { id: 'OP-2841', m: MODELOS['I901'], pares: 240, cli: 'Pampas Calçados',    linha: 'C2', etapa: 'COSTURA',    prog: 44, abre: '02/05', due: '09/05', st: 'ok' },
    { id: 'OP-2853', m: MODELOS['I905'], pares: 360, cli: 'Centauro Esportes',  linha: '—',  etapa: 'FILA',       prog: 0,  abre: '08/05', due: '14/05', st: 'queue' },
    { id: 'OP-2857', m: MODELOS['I918'], pares: 220, cli: 'VO Figueira',        linha: '—',  etapa: 'FILA',       prog: 0,  abre: '08/05', due: '15/05', st: 'queue' },
    { id: 'OP-2839', m: MODELOS['I905'], pares: 480, cli: 'Brioni Calçados',    linha: '—',  etapa: 'CONCLUÍDA',  prog: 100, abre: '25/04', due: '05/05', st: 'done' },
  ];
  const st = {
    urgente: { l: 'Urgente', cls: 'p-pill-red' },
    ok:      { l: 'Ativa', cls: 'p-pill-warn' },
    late:    { l: 'Atrasada', cls: 'p-pill-red' },
    queue:   { l: 'Fila', cls: 'p-pill' },
    done:    { l: 'Concluída', cls: 'p-pill-ok' },
  };
  return (
    <LightShell active="ops" breadcrumb="PRODUÇÃO · ORDENS DE PRODUÇÃO" title="ORDENS DE PRODUÇÃO" actions={<>
      <button className="btn-l">Exportar</button>
      <button className="btn-l-red btn-l">+ Nova OP</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 12 }}>
        {[
          { l: 'Ativas',     v: '19' },
          { l: 'Em fila',    v: '7' },
          { l: 'Atrasadas',  v: '2', red: true },
          { l: 'Concluídas', v: '14', s: 'esta semana' },
          { l: 'Pares total',v: '5.840', s: 'em produção' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 10 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 24, marginTop: 4, color: k.red ? 'var(--p-red)' : 'var(--p-ink)' }}>{k.v}</div>
            {k.s && <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>}
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['Todas', 'Ativas', 'Fila', 'Atrasadas', 'Concluídas'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>OP</th><th>Modelo</th><th>Cor</th><th>Cliente</th>
            <th className="num">Pares</th><th>Linha</th><th>Etapa</th><th>Progresso</th>
            <th>Abre</th><th>Prazo</th><th>Status</th>
          </tr></thead>
          <tbody>
            {ops.map((o, i) => (
              <tr key={i} style={o.st === 'urgente' || o.st === 'late' ? { background: 'var(--p-red-soft)' } : o.st === 'done' ? { opacity: 0.6 } : {}}>
                <td className="p-mono" style={{ fontWeight: 700, color: o.st === 'queue' ? 'var(--p-mute)' : 'var(--p-red)', fontSize: 11 }}>{o.id}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{o.m.name}</span>
                    <RefChip code={o.m.ref} size="sm"/>
                  </div>
                </td>
                <td><ColorChips swatches={o.m.swatches} size="xs" showLabels={false} showNames={false}/></td>
                <td style={{ fontSize: 11 }}>{o.cli}</td>
                <td className="num" style={{ fontWeight: 600 }}>{o.pares}</td>
                <td className="p-mono">{o.linha}</td>
                <td><span className="p-mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em' }}>{o.etapa}</span></td>
                <td style={{ width: 100 }}>
                  <div style={{ height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                    <div style={{ height: '100%', width: o.prog + '%', background: o.st === 'late' || o.st === 'urgente' ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                  </div>
                  <div className="p-mono" style={{ fontSize: 9, color: 'var(--p-mute)', marginTop: 1 }}>{o.prog}%</div>
                </td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{o.abre}</td>
                <td className="p-mono" style={{ fontSize: 10.5, color: o.st === 'late' ? 'var(--p-red)' : 'inherit', fontWeight: o.st === 'late' ? 700 : 400 }}>{o.due}</td>
                <td><span className={`p-pill ${st[o.st].cls}`}>{st[o.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.ProducaoOrdens = ProducaoOrdens;
