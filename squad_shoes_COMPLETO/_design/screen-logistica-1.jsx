// LOGÍSTICA · Expedição + Conferência

// ─── EXPEDIÇÃO ───────────────────────────────────────
function LogExpedicao() {
  const cargas = [
    { id: 'EXP-1284', cli: 'VIP Shoes Araruama',  uf: 'RJ', volumes: 4,  pares: 144, peso: 32, prev: '09/05 14:30', transp: 'TransSul · CR-09214', st: 'pronta' },
    { id: 'EXP-1283', cli: 'Riachuelo Magazine',  uf: 'RN', volumes: 12, pares: 1200, peso: 264, prev: '09/05 16:00', transp: 'Coletivo Nordeste', st: 'pronta' },
    { id: 'EXP-1282', cli: 'Brioni Calçados',     uf: 'SP', volumes: 6,  pares: 280, peso: 62, prev: '10/05 08:00', transp: 'TransSul · BS-44128', st: 'embalando' },
    { id: 'EXP-1281', cli: 'Centauro Esportes',   uf: 'MG', volumes: 8,  pares: 540, peso: 118, prev: '10/05 12:00', transp: 'A definir',           st: 'conf' },
    { id: 'EXP-1280', cli: 'Pampas Calçados',     uf: 'RS', volumes: 4,  pares: 320, peso: 70, prev: '11/05 06:00', transp: 'A definir',           st: 'aguarda' },
  ];
  const st = {
    aguarda:    { l: 'Aguardando OP',   cls: 'p-pill' },
    conf:       { l: 'Em conferência',  cls: 'p-pill-warn' },
    embalando:  { l: 'Embalando',       cls: 'p-pill-warn' },
    pronta:     { l: 'Pronta · sair',   cls: 'p-pill-ok' },
  };
  return (
    <LightShell active="exped" breadcrumb="LOGÍSTICA · EXPEDIÇÃO" title="EXPEDIÇÃO · PRÓXIMAS SAÍDAS" actions={<>
      <button className="btn-l">Imprimir manifesto</button>
      <button className="btn-l-red btn-l">+ Nova expedição</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Saídas hoje',     v: '3',     s: 'até 18:00' },
          { l: 'Volumes prontos', v: '16',    s: '+12 em conferência' },
          { l: 'Pares a expedir', v: '2.484', s: '5 cargas' },
          { l: 'Peso total',      v: '546 kg', s: 'para amanhã' },
          { l: 'Veículos hoje',   v: '2',     s: '1 em rota · 1 aguardando' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5 }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['Todas', 'Hoje', 'Amanhã', 'Pronta', 'Em conferência', 'Aguardando'].map((t, i) => (
            <button key={i} className="btn-l" style={i === 0 ? { background: 'var(--p-red)', color: '#fff', borderColor: 'var(--p-red)' } : {}}>{t}</button>
          ))}
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Expedição</th><th>Destinatário</th><th>UF</th>
            <th className="num">Volumes</th><th className="num">Pares</th><th className="num">Peso</th>
            <th>Saída prevista</th><th>Transportadora</th><th>Status</th>
          </tr></thead>
          <tbody>
            {cargas.map((c, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700, color: 'var(--p-red)', fontSize: 11 }}>{c.id}</td>
                <td style={{ fontWeight: 600 }}>{c.cli}</td>
                <td className="p-mono" style={{ fontSize: 11, fontWeight: 600 }}>{c.uf}</td>
                <td className="num" style={{ fontWeight: 600 }}>{c.volumes}</td>
                <td className="num">{c.pares}</td>
                <td className="num"><span className="p-mono">{c.peso}kg</span></td>
                <td className="p-mono" style={{ fontSize: 10.5 }}>{c.prev}</td>
                <td style={{ fontSize: 11 }}>{c.transp}</td>
                <td><span className={`p-pill ${st[c.st].cls}`}>{st[c.st].l}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </LightShell>
  );
}
window.LogExpedicao = LogExpedicao;

// ─── CONFERÊNCIA · PDA ────────────────────────────────
function LogConferencia() {
  const sessao = { id: 'CONF-2026-0084', op: 'EXP-1283 · Riachuelo Magazine', operador: 'Lúcia C.', inicio: '13:42', total: 1200, bipados: 938 };
  const itens = [
    { ref: 'I901', m: MODELOS['I901'], num: '36', pedido: 80,  bipado: 80,  st: 'ok' },
    { ref: 'I901', m: MODELOS['I901'], num: '37', pedido: 120, bipado: 120, st: 'ok' },
    { ref: 'I901', m: MODELOS['I901'], num: '38', pedido: 80,  bipado: 80,  st: 'ok' },
    { ref: 'I918', m: MODELOS['I918'], num: '36', pedido: 60,  bipado: 60,  st: 'ok' },
    { ref: 'I918', m: MODELOS['I918'], num: '37', pedido: 120, bipado: 118, st: 'div', dif: -2 },
    { ref: 'I918', m: MODELOS['I918'], num: '38', pedido: 60,  bipado: 0,   st: 'pend' },
    { ref: 'I905', m: MODELOS['I905'], num: '36', pedido: 80,  bipado: 80,  st: 'ok' },
    { ref: 'I905', m: MODELOS['I905'], num: '37', pedido: 200, bipado: 200, st: 'ok' },
    { ref: 'I905', m: MODELOS['I905'], num: '38', pedido: 200, bipado: 200, st: 'ok' },
    { ref: 'I905', m: MODELOS['I905'], num: '39', pedido: 200, bipado: 0,   st: 'pend' },
  ];
  return (
    <LightShell active="conf" breadcrumb="LOGÍSTICA · CONFERÊNCIA" title="CONFERÊNCIA DE CARGA · PDA" actions={<>
      <button className="btn-l">Pausar</button>
      <button className="btn-l-red btn-l">Finalizar sessão</button>
    </>}>
      {/* HERO sessão */}
      <div className="light-card" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 180px', gap: 22, alignItems: 'center' }}>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>SESSÃO</div>
            <div className="p-display" style={{ fontSize: 26, color: 'var(--p-red)' }}>{sessao.id}</div>
            <div style={{ fontSize: 11.5, color: 'var(--p-mute)', marginTop: 4 }}>{sessao.op}</div>
          </div>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>OPERADOR</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{sessao.operador}</div>
            <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 2 }}>Início: {sessao.inicio}</div>
          </div>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>BIPADOS</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span className="p-display" style={{ fontSize: 32 }}>{sessao.bipados}</span>
              <span className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)' }}>/ {sessao.total}</span>
            </div>
            <div style={{ height: 6, background: 'var(--p-soft)', border: '1px solid var(--p-line)', marginTop: 4 }}>
              <div style={{ height: '100%', width: ((sessao.bipados/sessao.total) * 100) + '%', background: 'var(--p-red)' }}/>
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: 8, border: '1px solid var(--p-line-2)', background: 'var(--p-soft)' }}>
            <PIcon.QR size={88}/>
            <div className="p-mono" style={{ fontSize: 8.5, color: 'var(--p-mute)', marginTop: 4 }}>PDA · bipar etiqueta CAIXA</div>
          </div>
        </div>
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div className="p-eyebrow">Comparação pedido × bipado</div>
            <div className="p-display" style={{ fontSize: 20, marginTop: 4 }}>10 ITENS · 1 DIVERGÊNCIA</div>
          </div>
        </div>
        <table className="p-tbl p-tbl-zebra">
          <thead><tr>
            <th>Modelo · REF</th><th>Cor</th><th className="num">Num.</th>
            <th className="num">Pedido</th><th className="num">Bipado</th><th>Distribuição</th><th className="num">Diferença</th><th>Status</th>
          </tr></thead>
          <tbody>
            {itens.map((it, i) => {
              const ok = it.st === 'ok';
              const pct = (it.bipado / it.pedido) * 100;
              return (
                <tr key={i} style={it.st === 'div' ? { background: 'var(--p-red-soft)' } : {}}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600 }}>{it.m.name}</span>
                      <RefChip code={it.ref} size="sm"/>
                    </div>
                  </td>
                  <td><ColorChips swatches={it.m.swatches} size="xs" showLabels={false} showNames={false}/></td>
                  <td className="num"><span className="p-display" style={{ fontSize: 18, color: 'var(--p-red)' }}>{it.num}</span></td>
                  <td className="num"><span className="p-mono">{it.pedido}</span></td>
                  <td className="num">
                    <span className="p-mono" style={{ fontWeight: 700, fontSize: 14, color: ok ? 'var(--p-ok)' : it.st === 'div' ? 'var(--p-red)' : 'var(--p-mute)' }}>{it.bipado}</span>
                  </td>
                  <td style={{ width: 120 }}>
                    <div style={{ height: 4, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                      <div style={{ height: '100%', width: pct + '%', background: ok ? 'var(--p-ok)' : it.st === 'div' ? 'var(--p-red)' : 'var(--p-mute)' }}/>
                    </div>
                  </td>
                  <td className="num">
                    {ok ? <span className="p-mono" style={{ color: 'var(--p-ok)' }}>0</span> :
                      it.st === 'div' ? <span className="p-mono" style={{ color: 'var(--p-red)', fontWeight: 700 }}>{it.dif}</span> :
                      <span className="p-mono" style={{ color: 'var(--p-mute)' }}>{it.pedido}</span>}
                  </td>
                  <td>
                    {ok && <span className="p-pill p-pill-ok">Completo</span>}
                    {it.st === 'div' && <span className="p-pill p-pill-red">2 faltando</span>}
                    {it.st === 'pend' && <span className="p-pill">Pendente</span>}
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
window.LogConferencia = LogConferencia;
