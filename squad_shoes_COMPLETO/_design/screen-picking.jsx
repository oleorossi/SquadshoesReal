// PRODUÇÃO · PICKING — sessão de separação ativa para expedição
function ProducaoPicking() {
  const sessao = {
    id: 'PKG-2026-0142', op: 'pedido PV-2026-00097', cli: 'VIP Shoes Araruama', operador: 'Daniela R.', inicio: '08/05 · 14:08', progresso: 78,
  };
  const itens = [
    { ref: 'I901', m: MODELOS['I901'], num: '36', pickPedido: 6, pickReal: 6, end: 'A-12-3', st: 'done' },
    { ref: 'I901', m: MODELOS['I901'], num: '37', pickPedido: 10, pickReal: 10, end: 'A-12-4', st: 'done' },
    { ref: 'I901', m: MODELOS['I901'], num: '38', pickPedido: 4, pickReal: 4, end: 'A-12-5', st: 'done' },
    { ref: 'I918', m: MODELOS['I918'], num: '36', pickPedido: 4, pickReal: 4, end: 'B-04-2', st: 'done' },
    { ref: 'I918', m: MODELOS['I918'], num: '37', pickPedido: 6, pickReal: 4, end: 'B-04-3', st: 'partial' },
    { ref: 'I905', m: MODELOS['I905'], num: '37', pickPedido: 8, pickReal: 0, end: 'C-08-1', st: 'pending' },
    { ref: 'I905', m: MODELOS['I905'], num: '38', pickPedido: 4, pickReal: 0, end: 'C-08-2', st: 'pending' },
  ];
  const totalPed = itens.reduce((a, x) => a + x.pickPedido, 0);
  const totalReal = itens.reduce((a, x) => a + x.pickReal, 0);
  return (
    <LightShell active="pick" breadcrumb="PRODUÇÃO · PICKING" title="SESSÃO ATIVA · SEPARAÇÃO" actions={<>
      <button className="btn-l">Pausar</button>
      <button className="btn-l-red btn-l">Finalizar sessão</button>
    </>}>
      {/* HERO sessão */}
      <div className="light-card" style={{ padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 200px', gap: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>SESSÃO</div>
            <div className="p-display" style={{ fontSize: 28, color: 'var(--p-red)' }}>{sessao.id}</div>
            <div style={{ fontSize: 11.5, color: 'var(--p-mute)', marginTop: 4 }}>{sessao.op} · {sessao.cli}</div>
          </div>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>OPERADOR</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{sessao.operador}</div>
            <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 2 }}>Início: {sessao.inicio}</div>
          </div>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>PROGRESSO</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
              <span className="p-display" style={{ fontSize: 28 }}>{totalReal}</span>
              <span className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)' }}>/ {totalPed} pares</span>
            </div>
            <div style={{ height: 6, background: 'var(--p-soft)', border: '1px solid var(--p-line)', marginTop: 4 }}>
              <div style={{ height: '100%', width: ((totalReal/totalPed) * 100) + '%', background: 'var(--p-red)' }}/>
            </div>
          </div>
          <div style={{ textAlign: 'center', padding: 8, border: '1px solid var(--p-line-2)', background: 'var(--p-soft)' }}>
            <PIcon.QR size={88}/>
            <div className="p-mono" style={{ fontSize: 8.5, color: 'var(--p-mute)', marginTop: 4 }}>PDA · bipar para apontar</div>
          </div>
        </div>
      </div>

      {/* Lista de itens */}
      <div className="light-card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div>
            <div className="p-eyebrow">Lista de picking · 7 SKUs</div>
            <div className="p-display" style={{ fontSize: 18, marginTop: 4 }}>SEPARE NA ORDEM DA ROTA</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-l">Reordenar por endereço</button>
            <button className="btn-l">Imprimir mapa</button>
          </div>
        </div>

        {itens.map((it, i) => {
          const done = it.st === 'done';
          const partial = it.st === 'partial';
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '40px 60px 1fr 100px 90px 120px 80px',
              gap: 14, alignItems: 'center', padding: '14px 16px', marginBottom: 6,
              background: done ? 'var(--p-soft)' : partial ? 'var(--p-red-soft)' : '#fff',
              border: '1px solid ' + (partial ? 'var(--p-red)' : 'var(--p-line)'),
              opacity: done ? 0.7 : 1,
            }}>
              {/* Status */}
              <div style={{
                width: 28, height: 28, border: '1.5px solid', borderColor: done ? 'var(--p-ink)' : partial ? 'var(--p-red)' : 'var(--p-line-2)',
                background: done ? 'var(--p-ink)' : '#fff',
                color: done ? '#fff' : 'var(--p-ink)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700,
              }}>{done ? '✓' : i+1}</div>

              {/* Foto */}
              <ShoePhoto w={60} h={42} label=""/>

              {/* Modelo + REF + cores */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{it.m.name}</span>
                  <RefChip code={it.ref} size="sm"/>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <ColorChips swatches={it.m.swatches} size="xs" showLabels={false} showNames={false}/>
                  <span style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{it.m.cor}</span>
                </div>
              </div>

              {/* Endereço */}
              <div>
                <div className="p-eyebrow" style={{ fontSize: 8 }}>Endereço</div>
                <div className="p-mono" style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{it.end}</div>
              </div>

              {/* Numeração */}
              <div style={{ textAlign: 'center' }}>
                <div className="p-eyebrow" style={{ fontSize: 8 }}>Num</div>
                <div className="p-display" style={{ fontSize: 28, color: 'var(--p-red)', marginTop: 2 }}>{it.num}</div>
              </div>

              {/* Pedido vs real */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <div style={{ textAlign: 'center', padding: '6px 10px', background: done ? 'var(--p-ink)' : 'var(--p-soft)', color: done ? '#fff' : 'var(--p-ink)', border: '1px solid ' + (done ? 'var(--p-ink)' : 'var(--p-line)') }}>
                  <div className="p-mono" style={{ fontSize: 7, letterSpacing: '0.14em', opacity: 0.7 }}>BIPADO</div>
                  <div className="p-mono" style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, marginTop: 2 }}>{it.pickReal}</div>
                </div>
                <div className="p-mono" style={{ fontSize: 11, color: 'var(--p-mute)' }}>/</div>
                <div style={{ textAlign: 'center', padding: '6px 10px' }}>
                  <div className="p-mono" style={{ fontSize: 7, letterSpacing: '0.14em', color: 'var(--p-mute)' }}>PEDIDO</div>
                  <div className="p-mono" style={{ fontSize: 16, fontWeight: 600, lineHeight: 1, marginTop: 2 }}>{it.pickPedido}</div>
                </div>
              </div>

              {/* Status pill */}
              <div style={{ textAlign: 'right' }}>
                {done && <span className="p-pill p-pill-ok">Completo</span>}
                {partial && <span className="p-pill p-pill-red">Faltam {it.pickPedido - it.pickReal}</span>}
                {it.st === 'pending' && <span className="p-pill">Pendente</span>}
              </div>
            </div>
          );
        })}
      </div>
    </LightShell>
  );
}
window.ProducaoPicking = ProducaoPicking;
