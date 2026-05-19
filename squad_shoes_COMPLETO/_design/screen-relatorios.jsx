// RELATÓRIOS A4 — daily, OP, OEE, Quality, Refugo, Weekly
// All print-ready, light tone, red accents

function A4Head({ title, num, sub }) {
  return (
    <div className="a4-head">
      <div className="brand">
        <div className="brand-mark"><PIcon.Logo size={26}/></div>
        <div>
          <div className="brand-name">SQUAD SHOES</div>
          <div className="brand-sub">{sub || 'Relatório de Produção'}</div>
        </div>
      </div>
      <div className="doc-meta">
        <div className="doc-title">{title}</div>
        <div className="doc-num">{num}</div>
        <div className="doc-emit">Emitido 09/05/2026 · Renata Mota</div>
      </div>
    </div>
  );
}
function A4Foot({ doc, page = '1/1', landscape }) {
  return (
    <div className={`a4-foot ${landscape ? 'l' : ''}`}>
      <span>{doc}</span>
      <span>09/05/2026 · v2026.05</span>
      <span>Página {page}</span>
    </div>
  );
}
function Sigs({ labels = ['Líder de produção', 'Supervisor', 'Gerência'] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${labels.length}, 1fr)`, gap: 24, marginTop: 30 }}>
      {labels.map((l, i) => (
        <div key={i} className="sig">
          <div className="sig-line"/>
          <div className="sig-cap">{l}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 1. RELATÓRIO DIÁRIO DE PRODUÇÃO (PORTRAIT) ───
function RelDiario() {
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head title="Relatório Diário" num="RD-2026-129 · Turno 1" sub="Produção · Diário"/>

        {/* KPIs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {[
            { l: 'Pares produzidos', v: '1.284', s: '+8.4% vs. média', red: false },
            { l: 'OEE médio', v: '87,2%', s: 'meta 85%', red: false },
            { l: 'Refugo', v: '1,8%', s: 'meta < 2%', red: false },
            { l: 'OPs encerradas', v: '3', s: '5 em curso', red: true },
          ].map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
              <div className="sub">{k.s}</div>
            </div>
          ))}
        </div>

        {/* Produção por linha */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Produção por linha</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Linha</th><th>OP</th><th>Modelo</th><th className="num">Meta</th><th className="num">Realizado</th><th className="num">% Meta</th><th className="num">OEE</th><th className="num">Refugo</th>
          </tr></thead>
          <tbody>
            {[
              ['A1','OP-2847','Mocassim Verona', 320, 304, 95, 91, '1,2%'],
              ['A2','OP-2849','Scarpin Bianca',  280, 288, 103, 94, '0,8%'],
              ['B1','OP-2851','Sandália Leila',  280, 198, 71, 64, '3,4%', true],
              ['B2','OP-2843','Bota Aurora',     180, 186, 103, 88, '1,6%'],
              ['C1','OP-2855','Tênis Nova',      300, 308, 103, 96, '1,0%'],
            ].map((r, i) => (
              <tr key={i} style={r[8] ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                <td className="p-mono">{r[1]}</td>
                <td style={{ fontWeight: 600 }}>{r[2]}</td>
                <td className="num">{r[3]}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r[4]}</td>
                <td className="num" style={{ color: r[5] < 90 ? 'var(--p-red)' : 'inherit', fontWeight: 600 }}>{r[5]}%</td>
                <td className="num">{r[6]}%</td>
                <td className="num">{r[7]}</td>
              </tr>
            ))}
            <tr>
              <td colSpan="3" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>TOTAIS</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>1.360</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>1.284</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>94%</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>87%</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>1,8%</td>
            </tr>
          </tbody>
        </table>

        {/* Bar chart visual */}
        <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · % da meta por linha</div>
        {[
          { l: 'Linha A1', v: 95 },
          { l: 'Linha A2', v: 103 },
          { l: 'Linha B1', v: 71, red: true },
          { l: 'Linha B2', v: 103 },
          { l: 'Linha C1', v: 103 },
        ].map((b, i) => (
          <div key={i} className="bar-row">
            <div className="lab">{b.l}</div>
            <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: Math.min(100, b.v) + '%' }}/></div>
            <div className="val" style={{ color: b.red ? 'var(--p-red)' : 'inherit' }}>{b.v}%</div>
          </div>
        ))}

        {/* Ocorrências */}
        <div style={{ marginTop: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Ocorrências do turno</div>
          <table className="p-tbl">
            <thead><tr><th>Hora</th><th>Linha</th><th>Tipo</th><th>Descrição</th><th className="num">Duração</th></tr></thead>
            <tbody>
              <tr><td className="p-mono">10:14</td><td className="p-mono">B1</td><td><span className="p-pill p-pill-warn">Pausa</span></td><td>Cola fora da temperatura · ajuste de máquina</td><td className="num">12 min</td></tr>
              <tr><td className="p-mono">11:42</td><td className="p-mono">A1</td><td><span className="p-pill p-pill-red">Refugo</span></td><td>4 pares com defeito de costura · re-trabalho</td><td className="num">—</td></tr>
              <tr><td className="p-mono">14:08</td><td className="p-mono">C1</td><td><span className="p-pill p-pill-ok">Set-up</span></td><td>Troca de modelo · OP-2855 → OP-2858</td><td className="num">8 min</td></tr>
            </tbody>
          </table>
        </div>

        <Sigs/>
        <A4Foot doc="RD-2026-129 · Diário de Produção" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 2. RELATÓRIO POR OP ───
function RelOP() {
  const m = MODELOS['I901'];
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head title="Relatório de OP" num="OP-2847 · Mocassim Verona" sub="Produção · OP fechada"/>

        {/* HERO — modelo + REF + foto + cores */}
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: 14, marginBottom: 14, alignItems: 'flex-start' }}>
          <ShoePhoto w={130} h={110} label={`REF ${m.ref}`}/>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="p-eyebrow">Ordem de Produção</div>
              <RefChip code={m.ref} size="md"/>
            </div>
            <div className="p-display" style={{ fontSize: 26, marginTop: 4 }}>OP-2847 · {m.name}</div>
            <div style={{ fontSize: 11, marginTop: 3, color: 'var(--p-mute)' }}>{m.categoria} · {m.cor} · {m.sku}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, padding: '6px 10px', background: 'var(--p-soft)', border: '1px solid var(--p-line-2)' }}>
              <span className="p-eyebrow" style={{ fontSize: 8 }}>Cores</span>
              <ColorChips swatches={m.swatches} size="sm" showLabels showNames/>
            </div>
          </div>
        </div>

        {/* identificação + indicadores */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Identificação</div>
            <table className="p-tbl">
              <tbody>
                {[
                  ['Cliente', 'VIP Shoes Araruama'],
                  ['Pedido', 'PV-2026-00097'],
                  ['Pares planejados', '420'],
                  ['Pares produzidos', '420 (100%)'],
                  ['Refugo', '6 pares (1,4%)'],
                  ['Aberta em', '02/05/2026'],
                  ['Fechada em', '08/05/2026'],
                  ['Tempo total', '5 dias úteis'],
                ].map((r, i) => (
                  <tr key={i}>
                    <td style={{ width: 130, color: 'var(--p-mute)' }}>{r[0]}</td>
                    <td style={{ fontWeight: 600 }}>{r[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Indicadores</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { l: 'OEE OP', v: '89%' },
                { l: 'FPY', v: '96,4%' },
                { l: 'Tempo/par', v: '31 min' },
                { l: 'Custo/par', v: 'R$ 28,40' },
              ].map((k, i) => (
                <div key={i} className="p-kpi">
                  <div className="lbl">{k.l}</div>
                  <div className="val">{k.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Etapas */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Apontamento por etapa</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Etapa</th><th>Operador</th><th>Início</th><th>Fim</th><th className="num">Pares</th><th className="num">Refugo</th><th className="num">Tempo</th>
          </tr></thead>
          <tbody>
            {[
              ['CORTE',      'Cleber B.',     '02/05 08:00', '02/05 14:30', 420, 0, '6h30'],
              ['COSTURA',    'Marcia L.',     '02/05 14:00', '04/05 17:00', 420, 4, '24h00'],
              ['MONTAGEM',   'Daniela R.',    '05/05 08:00', '06/05 12:00', 420, 1, '12h00'],
              ['ACABAMENTO', 'Sandra M.',     '06/05 13:00', '07/05 15:00', 420, 1, '10h00'],
              ['EMBALAGEM',  'Roseli P.',     '07/05 15:30', '08/05 11:30', 414, 0, '6h00'],
            ].map((r, i) => (
              <tr key={i}>
                <td><span className="p-mono" style={{ fontWeight: 700, fontSize: 9.5, letterSpacing: '0.08em' }}>{r[0]}</span></td>
                <td>{r[1]}</td>
                <td className="p-mono" style={{ fontSize: 10 }}>{r[2]}</td>
                <td className="p-mono" style={{ fontSize: 10 }}>{r[3]}</td>
                <td className="num">{r[4]}</td>
                <td className="num" style={{ color: r[5] > 0 ? 'var(--p-red)' : 'inherit', fontWeight: 600 }}>{r[5]}</td>
                <td className="num">{r[6]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Materiais consumidos */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>04 · Consumo de materiais</div>
        <table className="p-tbl">
          <thead><tr>
            <th>Material</th><th className="num">Previsto</th><th className="num">Real</th><th className="num">Variação</th><th className="num">Custo</th>
          </tr></thead>
          <tbody>
            {[
              ['Verniz adocicado',  '134,4 dm²','138,2 dm²','+2,8%', 'R$ 207,30'],
              ['Pelica creme',      '100,8 dm²','99,4 dm²', '−1,4%', 'R$ 99,40'],
              ['TR solado',         '420 pares','420 pares','0%',     'R$ 2.856,00'],
              ['EVA palmilha',      '420 pares','420 pares','0%',     'R$ 378,00'],
              ['Linha · Cola',      '—',       '—',         '—',     'R$ 312,40'],
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td className="num">{r[1]}</td>
                <td className="num">{r[2]}</td>
                <td className="num" style={{ color: r[3].startsWith('+') ? 'var(--p-red)' : 'inherit' }}>{r[3]}</td>
                <td className="num">{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Sigs labels={['Líder OP', 'PCP', 'Qualidade']}/>
        <A4Foot doc="OP-2847 · Relatório de fechamento" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 3. RELATÓRIO OEE (LANDSCAPE) ───
function RelOEE() {
  return (
    <div className="paper">
      <div className="sheet sheet-l">
        <A4Head title="Eficiência (OEE)" num="REL-OEE-W19 · Semana 19" sub="Produção · OEE Semanal"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
          {[
            { l: 'OEE Geral', v: '87,2%' },
            { l: 'Disponibilidade', v: '94,1%' },
            { l: 'Performance', v: '91,8%' },
            { l: 'Qualidade', v: '98,2%' },
            { l: 'Pares totais', v: '6.420' },
            { l: 'Horas operadas', v: '241h' },
          ].map((k, i) => (
            <div key={i} className="p-kpi">
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · OEE por linha · semana 19</div>
            <table className="p-tbl p-tbl-zebra">
              <thead><tr>
                <th>Linha</th><th className="num">Disp.</th><th className="num">Perf.</th><th className="num">Qual.</th><th className="num">OEE</th><th className="num">Pares</th><th>Tendência</th>
              </tr></thead>
              <tbody>
                {[
                  ['A1', 96, 94, 99, 90, 1340, [80,82,85,87,88,90]],
                  ['A2', 97, 96, 99, 92, 1420, [88,89,90,91,92,92]],
                  ['B1', 84, 82, 97, 67, 980,  [78,75,72,70,68,67], true],
                  ['B2', 95, 91, 98, 85, 1080, [82,83,84,85,85,85]],
                  ['C1', 98, 96, 99, 93, 1480, [88,90,91,92,93,93]],
                  ['C2', 0,  0,  0,  0,  0,    [60,55,40,20,10,0],  true],
                ].map((r, i) => {
                  const data = r[6]; const max = 100;
                  const pts = data.map((v, j) => `${(j / (data.length - 1)) * 80},${20 - (v / max) * 18}`).join(' ');
                  return (
                    <tr key={i} style={r[7] ? { background: 'var(--p-red-soft)' } : {}}>
                      <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                      <td className="num">{r[1]}%</td>
                      <td className="num">{r[2]}%</td>
                      <td className="num">{r[3]}%</td>
                      <td className="num" style={{ fontWeight: 700, color: r[4] < 75 ? 'var(--p-red)' : 'inherit' }}>{r[4]}%</td>
                      <td className="num">{r[5]}</td>
                      <td>
                        <svg width="80" height="20"><polyline points={pts} fill="none" stroke={r[7] ? '#B7141F' : '#14110E'} strokeWidth="1.2"/></svg>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Causas de perda</div>
            {[
              { l: 'Falta de material', v: 28, h: 'h' },
              { l: 'Set-up / troca',    v: 18, h: 'h' },
              { l: 'Manutenção',        v: 12, h: 'h' },
              { l: 'Refugo / re-trabalho', v: 9, h: 'h' },
              { l: 'Ajuste de cola',    v: 6,  h: 'h' },
              { l: 'Outros',            v: 4,  h: 'h' },
            ].map((b, i) => (
              <div key={i} className="bar-row">
                <div className="lab">{b.l}</div>
                <div className="bar"><span className={i === 0 ? 'red' : ''} style={{ width: (b.v / 30) * 100 + '%' }}/></div>
                <div className="val">{b.v}{b.h}</div>
              </div>
            ))}
            <div style={{ marginTop: 16, padding: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 10.5 }}>
              <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Foco da semana</div>
              <div style={{ marginTop: 4 }}>Reduzir paradas por <strong>falta de material</strong> revisando ponto de pedido de verniz adocicado e cola PU.</div>
            </div>
          </div>
        </div>

        <Sigs labels={['Supervisor', 'PCP', 'Gerência']}/>
        <A4Foot doc="REL-OEE-W19" landscape page="1/1"/>
      </div>
    </div>
  );
}

// ─── 4. RELATÓRIO DE QUALIDADE / FPY ───
function RelQualidade() {
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head title="Qualidade · FPY" num="QC-W19 · Semana 19" sub="Qualidade · FPY"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {[
            { l: 'FPY semanal', v: '96,4%' },
            { l: 'Inspeções',  v: '6.420' },
            { l: 'Reprovados', v: '231', red: true },
            { l: 'Re-trabalho',v: '187' },
          ].map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Defeitos por categoria</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Defeito</th><th>Etapa</th><th className="num">Qtd</th><th className="num">% total</th><th className="num">Tendência S-1</th>
          </tr></thead>
          <tbody>
            {[
              ['Costura aberta',     'Costura',   78, '33,8%', '+8'],
              ['Cola má aplicação',  'Montagem',  44, '19,0%', '−2'],
              ['Risco no verniz',    'Acabamento',38, '16,5%', '+4'],
              ['Furo descentrado',   'Corte',     31, '13,4%', '0'],
              ['Solado solto',       'Montagem',  22, '9,5%',  '−5'],
              ['Embalagem trocada',  'Embalagem', 12, '5,2%',  '+1'],
              ['Outros',             '—',          6, '2,6%',  '−1'],
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td>{r[1]}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r[2]}</td>
                <td className="num">{r[3]}</td>
                <td className="num" style={{ color: r[4].startsWith('+') ? 'var(--p-red)' : r[4].startsWith('−') ? 'var(--p-ok)' : 'var(--p-mute)' }}>{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · Pareto · top 5 defeitos</div>
        {[
          { l: 'Costura aberta',    v: 33.8, red: true },
          { l: 'Cola má aplicação', v: 19.0 },
          { l: 'Risco no verniz',   v: 16.5 },
          { l: 'Furo descentrado',  v: 13.4 },
          { l: 'Solado solto',      v: 9.5 },
        ].map((b, i) => (
          <div key={i} className="bar-row">
            <div className="lab">{b.l}</div>
            <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: (b.v / 35) * 100 + '%' }}/></div>
            <div className="val">{b.v}%</div>
          </div>
        ))}

        <div style={{ marginTop: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Ações corretivas em curso</div>
          <table className="p-tbl">
            <thead><tr><th>Ação</th><th>Responsável</th><th>Prazo</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>Treinar 4 costureiras turno B em ponto reforçado</td><td>Marcia L.</td><td className="p-mono">15/05</td><td><span className="p-pill p-pill-warn">Em curso</span></td></tr>
              <tr><td>Calibrar máquina de cola linha B1</td><td>Manutenção</td><td className="p-mono">12/05</td><td><span className="p-pill p-pill-ok">Concluído</span></td></tr>
              <tr><td>Revisar lote de verniz adocicado fornecedor X</td><td>Suprimentos</td><td className="p-mono">14/05</td><td><span className="p-pill">Aberta</span></td></tr>
            </tbody>
          </table>
        </div>

        <Sigs labels={['Líder QC', 'Supervisor', 'Gerência']}/>
        <A4Foot doc="QC-W19 · Qualidade" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 5. RELATÓRIO DE REFUGO ───
function RelRefugo() {
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head title="Refugo & Re-trabalho" num="REF-W19 · Semana 19" sub="Qualidade · Refugo"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {[
            { l: 'Refugo total', v: '1,8%', s: 'meta < 2%' },
            { l: 'Pares perdidos', v: '116', red: true },
            { l: 'Custo refugo', v: 'R$ 4.290', red: true },
            { l: 'Re-trabalho', v: 'R$ 1.870' },
          ].map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
              {k.s && <div className="sub">{k.s}</div>}
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Refugo por linha · semana 19</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Linha</th><th>OP</th><th className="num">Pares</th><th className="num">Refugo</th><th className="num">% Refugo</th><th className="num">Custo</th><th>Causa principal</th>
          </tr></thead>
          <tbody>
            {[
              ['A1','OP-2847', 1340, 18, '1,3%', 'R$ 510',  'Costura aberta'],
              ['A2','OP-2849', 1420, 12, '0,8%', 'R$ 332',  'Furo descentrado'],
              ['B1','OP-2851', 980,  44, '4,5%', 'R$ 1.628','Cola má aplicação', true],
              ['B2','OP-2843', 1080, 14, '1,3%', 'R$ 392',  'Risco no verniz'],
              ['C1','OP-2855', 1480, 16, '1,1%', 'R$ 480',  'Embalagem trocada'],
              ['—', '—',       120,  12, '10%',  'R$ 948',  'Set-up / curva', true],
            ].map((r, i) => (
              <tr key={i} style={r[7] ? { background: 'var(--p-red-soft)' } : {}}>
                <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                <td className="p-mono">{r[1]}</td>
                <td className="num">{r[2]}</td>
                <td className="num" style={{ fontWeight: 600, color: r[7] ? 'var(--p-red)' : 'inherit' }}>{r[3]}</td>
                <td className="num" style={{ fontWeight: 600, color: parseFloat(r[4]) > 2 ? 'var(--p-red)' : 'inherit' }}>{r[4]}</td>
                <td className="num">{r[5]}</td>
                <td>{r[6]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · Refugo por etapa (%)</div>
            {[
              { l: 'Corte',      v: 0.6 },
              { l: 'Costura',    v: 1.4, red: true },
              { l: 'Montagem',   v: 1.0 },
              { l: 'Acabamento', v: 0.8 },
              { l: 'Embalagem',  v: 0.2 },
            ].map((b, i) => (
              <div key={i} className="bar-row">
                <div className="lab">{b.l}</div>
                <div className="bar"><span className={b.red ? 'red' : ''} style={{ width: (b.v / 1.5) * 100 + '%' }}/></div>
                <div className="val">{b.v}%</div>
              </div>
            ))}
          </div>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>03 · Custo R$ por categoria</div>
            <table className="p-tbl">
              <tbody>
                <tr><td>Material perdido</td><td className="num">R$ 1.890</td></tr>
                <tr><td>Mão de obra perdida</td><td className="num">R$ 1.420</td></tr>
                <tr><td>Re-trabalho</td><td className="num">R$ 1.870</td></tr>
                <tr style={{ background: 'var(--p-ink)', color: 'white' }}><td style={{ fontWeight: 700, letterSpacing: '0.04em' }}>TOTAL</td><td className="num" style={{ fontWeight: 700 }}>R$ 5.180</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <Sigs/>
        <A4Foot doc="REF-W19 · Refugo & Re-trabalho" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 6. RELATÓRIO SEMANAL CONSOLIDADO (LANDSCAPE) ───
function RelSemanal() {
  return (
    <div className="paper">
      <div className="sheet sheet-l">
        <A4Head title="Consolidado Semanal" num="SEM-W19 · 04–08 / 05" sub="Produção · Semanal"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
          {[
            { l: 'Pares', v: '6.420', s: '+4,2%' },
            { l: 'OEE', v: '87,2%' },
            { l: 'FPY', v: '96,4%' },
            { l: 'Refugo', v: '1,8%' },
            { l: 'OPs fechadas', v: '12' },
            { l: 'Receita', v: 'R$ 184k' },
          ].map((k, i) => (
            <div key={i} className="p-kpi">
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
              {k.s && <div className="sub">{k.s}</div>}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Produção dia a dia</div>
            {/* simple bars per day */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 140, padding: '14px 0', borderBottom: '1px solid var(--p-line)' }}>
              {[
                { d: 'SEG', v: 1240 },
                { d: 'TER', v: 1320 },
                { d: 'QUA', v: 1284 },
                { d: 'QUI', v: 1380 },
                { d: 'SEX', v: 1196 },
              ].map((b, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div className="p-mono" style={{ fontSize: 9.5, fontWeight: 700 }}>{b.v}</div>
                  <div style={{ width: '100%', height: (b.v / 1500) * 110, background: i === 3 ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                  <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{b.d}</div>
                </div>
              ))}
            </div>
            <div className="p-mono" style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 8 }}>Meta diária: 1.300 pares · 4 dias acima da meta</div>

            <div style={{ marginTop: 22 }}>
              <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Top 5 modelos da semana</div>
              <table className="p-tbl p-tbl-zebra">
                <thead><tr><th>Modelo · REF</th><th>Cor</th><th className="num">Pares</th><th className="num">% Total</th><th className="num">Refugo</th><th>Status OPs</th></tr></thead>
                <tbody>
                  {[
                    { name: 'Mocassim Verona', ref: 'I901', cor: 'Adocicado', corHex: '#5C2F1E', pares: 1340, pct: '20,9%', refugo: '1,3%' },
                    { name: 'Tênis Nova',      ref: 'I312', cor: 'Branco',    corHex: '#F4F0E5', pares: 1480, pct: '23,1%', refugo: '1,1%' },
                    { name: 'Sandália Leila',  ref: 'I905', cor: 'Caramelo/Cru', corHex: '#8E5326', pares: 980,  pct: '15,3%', refugo: '4,5%', red: true },
                    { name: 'Bota Aurora',     ref: 'I422', cor: 'Castor',    corHex: '#7A5A3E', pares: 1080, pct: '16,8%', refugo: '1,3%' },
                    { name: 'Scarpin Bianca',  ref: 'I918', cor: 'Preto verniz', corHex: '#0E0E0E', pares: 1420, pct: '22,1%', refugo: '0,8%' },
                  ].map((r, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 600 }}>{r.name}</span>
                          <RefChip code={r.ref} size="sm"/>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 12, height: 12, background: r.corHex, border: '1px solid var(--p-ink)' }}/>
                          <span style={{ fontSize: 11 }}>{r.cor}</span>
                        </div>
                      </td>
                      <td className="num">{r.pares}</td>
                      <td className="num">{r.pct}</td>
                      <td className="num" style={{ color: r.red ? 'var(--p-red)' : 'inherit', fontWeight: r.red ? 700 : 400 }}>{r.refugo}</td>
                      <td>{i < 4 ? <span className="p-pill p-pill-ok">No prazo</span> : <span className="p-pill p-pill-red">Atraso</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Indicadores · 6 semanas</div>
            <table className="p-tbl p-tbl-zebra">
              <thead><tr><th>Sem.</th><th className="num">Pares</th><th className="num">OEE</th><th className="num">FPY</th><th className="num">Refugo</th></tr></thead>
              <tbody>
                {[
                  ['W14', 5980, '83%', '94,8%', '2,4%'],
                  ['W15', 6120, '85%', '95,2%', '2,1%'],
                  ['W16', 6240, '85%', '95,8%', '2,0%'],
                  ['W17', 6180, '86%', '96,0%', '1,9%'],
                  ['W18', 6160, '86%', '96,2%', '1,9%'],
                  ['W19', 6420, '87%', '96,4%', '1,8%'],
                ].map((r, i) => (
                  <tr key={i} style={i === 5 ? { background: 'var(--p-red-soft)', fontWeight: 600 } : {}}>
                    <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                    <td className="num">{r[1]}</td>
                    <td className="num">{r[2]}</td>
                    <td className="num">{r[3]}</td>
                    <td className="num">{r[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 16, padding: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 10.5 }}>
              <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Destaque</div>
              <div style={{ marginTop: 4 }}>6ª semana consecutiva de melhoria em OEE e FPY. Sandália Leila concentra 38% do refugo — investigação em curso.</div>
            </div>
          </div>
        </div>

        <Sigs labels={['Supervisor', 'PCP', 'Gerência']}/>
        <A4Foot doc="SEM-W19 · Consolidado" landscape page="1/1"/>
      </div>
    </div>
  );
}

window.RelDiario = RelDiario;
window.RelOP = RelOP;
window.RelOEE = RelOEE;
window.RelQualidade = RelQualidade;
window.RelRefugo = RelRefugo;
window.RelSemanal = RelSemanal;

// ─── 7. RELATÓRIO DE PARADAS (PORTRAIT) ───
function RelParadas() {
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head title="Paradas de Máquina" num="PAR-W19 · Semana 19" sub="Manutenção · Paradas"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 22 }}>
          {[
            { l: 'Horas paradas', v: '77h' },
            { l: 'Nº de paradas', v: '42' },
            { l: 'MTBF médio', v: '8,4h' },
            { l: 'MTTR médio', v: '34min', red: true },
          ].map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Pareto · causas de parada</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Causa</th><th className="num">Hrs</th><th className="num">%</th><th className="num">% acum.</th><th>Distribuição</th>
          </tr></thead>
          <tbody>
            {[
              ['Falta de material',      28, 36.4, 36.4, true],
              ['Set-up / troca modelo',  18, 23.4, 59.8],
              ['Manutenção corretiva',   12, 15.6, 75.4],
              ['Ajuste de cola/temp.',    9, 11.7, 87.1],
              ['Qualidade / re-trab.',    6,  7.8, 94.9],
              ['Outros',                  4,  5.1, 100],
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td className="num">{r[1]}h</td>
                <td className="num">{r[2]}%</td>
                <td className="num">{r[3]}%</td>
                <td style={{ width: 200, padding: '6px 10px' }}>
                  <div style={{ position: 'relative', height: 14 }}>
                    <div style={{ position: 'absolute', left: 0, top: 4, height: 6, width: ((r[1] / 30) * 100) + '%', background: r[4] ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                    <div style={{ position: 'absolute', left: r[3] + '%', top: 0, bottom: 0, width: 1.5, background: 'var(--p-red)' }}/>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Paradas por máquina</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Máquina</th><th>Linha</th><th className="num">Ocorr.</th><th className="num">Hrs</th><th className="num">MTBF</th><th className="num">MTTR</th><th>Última falha</th>
          </tr></thead>
          <tbody>
            {[
              ['Singer 591N-04', 'A1', 4, '3,2h', '11,0h', '48min', 'Tensão linha'],
              ['Galoneira G-12', 'A2', 2, '1,1h', '22,0h', '33min', 'Calibração'],
              ['Prensa hidr. PR-3','B1',  6, '14,2h', '7,3h',  '142min', 'Vazamento', true],
              ['Lixadeira LX-08','B2',  3, '2,4h', '14,7h', '48min', 'Troca de lixa'],
              ['Forno IR-2',     'C1', 2, '0,9h', '22,0h', '27min', 'Ajuste temp.'],
              ['Costura zigzag Z-07','A1', 5, '4,1h', '8,8h', '49min', 'Quebra agulha'],
            ].map((r, i) => (
              <tr key={i} style={r[7] ? { background: 'var(--p-red-soft)' } : {}}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td className="p-mono" style={{ fontWeight: 700 }}>{r[1]}</td>
                <td className="num">{r[2]}</td>
                <td className="num" style={{ fontWeight: r[7] ? 700 : 400, color: r[7] ? 'var(--p-red)' : 'inherit' }}>{r[3]}</td>
                <td className="num">{r[4]}</td>
                <td className="num" style={{ fontWeight: r[7] ? 700 : 400, color: r[7] ? 'var(--p-red)' : 'inherit' }}>{r[5]}</td>
                <td>{r[6]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Ocorrências críticas · semana</div>
        <table className="p-tbl">
          <thead><tr><th>Dia</th><th>Hora</th><th>Linha</th><th>Máquina</th><th className="num">Duração</th><th>Descrição</th></tr></thead>
          <tbody>
            <tr><td className="p-mono">SEG</td><td className="p-mono">10:14</td><td className="p-mono">B1</td><td>Prensa PR-3</td><td className="num" style={{ color: 'var(--p-red)', fontWeight: 700 }}>3h12</td><td>Vazamento óleo · troca de retentor</td></tr>
            <tr><td className="p-mono">QUA</td><td className="p-mono">08:40</td><td className="p-mono">B1</td><td>Prensa PR-3</td><td className="num" style={{ color: 'var(--p-red)', fontWeight: 700 }}>4h28</td><td>Falha hidráulica · técnico externo</td></tr>
            <tr><td className="p-mono">QUI</td><td className="p-mono">13:22</td><td className="p-mono">A1</td><td>Z-07</td><td className="num">1h08</td><td>Quebra de agulha · ajuste de tensão</td></tr>
            <tr><td className="p-mono">SEX</td><td className="p-mono">09:50</td><td className="p-mono">B2</td><td>LX-08</td><td className="num">42min</td><td>Troca de cinta · estoque baixo</td></tr>
          </tbody>
        </table>

        <div style={{ marginTop: 18, padding: 12, border: '1.5px solid var(--p-red)', background: 'var(--p-red-soft)', display: 'flex', gap: 12 }}>
          <div style={{ fontSize: 11 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Plano de ação</div>
            <div style={{ marginTop: 4 }}>Prensa PR-3 da linha B1 concentra <strong>18% das horas paradas</strong> da semana. Solicitada substituição de bomba hidráulica · OC-2026-218 · prazo 16/05.</div>
          </div>
        </div>

        <Sigs labels={['Manutenção', 'PCP', 'Gerência']}/>
        <A4Foot doc="PAR-W19 · Paradas de Máquina" page="1/1"/>
      </div>
    </div>
  );
}
window.RelParadas = RelParadas;

// ─── 8. RELATÓRIO DE CONSUMO DE MATERIAIS (LANDSCAPE) ───
function RelConsumo() {
  return (
    <div className="paper">
      <div className="sheet sheet-l">
        <A4Head title="Consumo de Materiais" num="CMP-W19 · 04–08 / 05" sub="PCP · Consumo Real × Previsto"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 18 }}>
          {[
            { l: 'Pares produzidos', v: '6.420' },
            { l: 'Custo MP total',   v: 'R$ 184k' },
            { l: 'Custo / par',      v: 'R$ 28,67' },
            { l: 'Var. vs orçado',   v: '+2,4%', red: true },
            { l: 'SKUs consumidos',  v: '42' },
            { l: 'OPs encerradas',   v: '12' },
          ].map((k, i) => (
            <div key={i} className={`p-kpi ${k.red ? 'red' : ''}`}>
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Consumo por material · semana 19</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 18 }}>
          <thead><tr>
            <th>Material</th><th>SKU</th><th>Categoria</th>
            <th className="num">Previsto</th><th className="num">Real</th>
            <th className="num">Variação</th><th className="num">Δ R$</th>
            <th>Distribuição</th><th>Status</th>
          </tr></thead>
          <tbody>
            {[
              ['Verniz adocicado',   'MP-VRN-4280',  'Couro sint.', '1.840 dm²', '1.892 dm²', '+2,8%', '+R$ 78',  74, 'high'],
              ['Couro caramelo 2.0', 'MP-CRO-CRM',   'Couro',       '420 m²',    '418 m²',    '−0,5%', '−R$ 22',  60],
              ['Pelica creme',       'MP-PEL-CRM',   'Couro',       '380 m²',    '376 m²',    '−1,1%', '−R$ 18',  58],
              ['TR solado · sortido','MP-TR-MIX',    'Solado',      '6.420 pç',  '6.420 pç',  '0%',    '—',        90],
              ['EVA palmilha',       'MP-EVA-9',     'Palmilha',    '6.420 pç',  '6.430 pç',  '+0,2%', '+R$ 9',   88],
              ['Cola PU branca',     'MP-COL-PU',    'Químico',     '42 kg',     '47 kg',     '+11,9%','+R$ 220', 36, 'high'],
              ['Linha 40 preto',     'MP-LN-40N',    'Linha',       '180 cones', '178 cones', '−1,1%', '−R$ 8',   18],
              ['Forro nylon bege',   'MP-FOR-BG',    'Forro',       '420 m',     '420 m',     '0%',    '—',       40],
              ['Caixa M · 30×20',    'EMB-CX-M',     'Embalagem',   '6.420 pç',  '6.420 pç',  '0%',    '—',       90],
              ['Etiqueta de caixa',  'EMB-ETQ-CX',   'Embalagem',   '6.420 pç',  '6.420 pç',  '0%',    '—',       90],
            ].map((r, i) => (
              <tr key={i} style={r[8] === 'high' ? { background: 'var(--p-red-soft)' } : {}}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)' }}>{r[1]}</td>
                <td><span className="p-pill" style={{ fontSize: 7.5 }}>{r[2]}</span></td>
                <td className="num">{r[3]}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r[4]}</td>
                <td className="num" style={{ color: r[5].startsWith('+') ? 'var(--p-red)' : r[5].startsWith('−') ? 'var(--p-ok)' : 'var(--p-mute)', fontWeight: 600 }}>{r[5]}</td>
                <td className="num" style={{ color: r[6].startsWith('+') ? 'var(--p-red)' : r[6].startsWith('−') ? 'var(--p-ok)' : 'var(--p-mute)' }}>{r[6]}</td>
                <td style={{ width: 130 }}>
                  <div style={{ height: 6, background: 'var(--p-soft)', border: '1px solid var(--p-line)', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: r[7] + '%', background: r[8] === 'high' ? 'var(--p-red)' : 'var(--p-ink)' }}/>
                  </div>
                </td>
                <td>
                  {r[8] === 'high'
                    ? <span className="p-pill p-pill-red">Acima</span>
                    : r[5] === '0%'
                      ? <span className="p-pill p-pill-ok">No padrão</span>
                      : <span className="p-pill">Dentro</span>}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan="3" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10 }}>TOTAIS DA SEMANA</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>R$ 179.620</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>R$ 183.879</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>+2,4%</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700 }}>+R$ 4.259</td>
              <td colSpan="2" style={{ background: 'var(--p-ink)', color: 'white' }}>&nbsp;</td>
            </tr>
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 22 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · Variação por OP encerrada</div>
            <table className="p-tbl">
              <thead><tr>
                <th>OP</th><th>Modelo · REF</th><th className="num">Custo prev.</th><th className="num">Real</th><th className="num">Δ</th><th>Causa principal</th>
              </tr></thead>
              <tbody>
                {[
                  ['OP-2847', 'Mocassim Verona', 'I901', 'R$ 11.928','R$ 12.144','+1,8%','Excesso verniz'],
                  ['OP-2849', 'Scarpin Bianca',  'I918', 'R$  9.520','R$  9.440','−0,8%','—'],
                  ['OP-2851', 'Sandália Leila',  'I905', 'R$ 18.972','R$ 21.420','+12,9%','Cola PU + refugo', true],
                  ['OP-2843', 'Bota Aurora',     'I422', 'R$  6.480','R$  6.520','+0,6%','—'],
                  ['OP-2855', 'Tênis Nova',      'I312', 'R$ 12.288','R$ 12.180','−0,9%','—'],
                ].map((r, i) => (
                  <tr key={i} style={r[7] ? { background: 'var(--p-red-soft)' } : {}}>
                    <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{r[1]}</span>
                        <RefChip code={r[2]} size="sm"/>
                      </div>
                    </td>
                    <td className="num">{r[3]}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{r[4]}</td>
                    <td className="num" style={{ color: r[5].startsWith('+') ? 'var(--p-red)' : 'var(--p-ok)', fontWeight: 700 }}>{r[5]}</td>
                    <td>{r[6]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>03 · Materiais em ponto de pedido</div>
            <table className="p-tbl">
              <thead><tr><th>Material</th><th className="num">Estoque</th><th className="num">Cobertura</th></tr></thead>
              <tbody>
                <tr><td>Cola PU branca</td><td className="num" style={{ color: 'var(--p-red)', fontWeight: 700 }}>14 kg</td><td className="num">2 dias</td></tr>
                <tr><td>Couro caramelo 2.0</td><td className="num" style={{ color: 'var(--p-red)', fontWeight: 700 }}>48 m²</td><td className="num">3 dias</td></tr>
                <tr><td>Forro nylon bege</td><td className="num" style={{ color: 'var(--p-warn)', fontWeight: 700 }}>86 m</td><td className="num">5 dias</td></tr>
                <tr><td>Linha 40 vermelho</td><td className="num" style={{ color: 'var(--p-warn)', fontWeight: 700 }}>62 cones</td><td className="num">6 dias</td></tr>
              </tbody>
            </table>

            <div style={{ marginTop: 14, padding: 12, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 10.5 }}>
              <div className="p-eyebrow" style={{ fontSize: 8.5, color: 'var(--p-red)' }}>Ação Suprimentos</div>
              <div style={{ marginTop: 4 }}>2 SKUs em ruptura iminente. <strong>Cola PU</strong> e <strong>Couro caramelo 2.0</strong> precisam de pedido emergencial até 11/05.</div>
            </div>
          </div>
        </div>

        <Sigs labels={['PCP', 'Suprimentos', 'Gerência']}/>
        <A4Foot doc="CMP-W19 · Consumo de Materiais" landscape page="1/1"/>
      </div>
    </div>
  );
}
window.RelConsumo = RelConsumo;
