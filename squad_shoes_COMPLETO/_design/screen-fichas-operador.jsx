// FICHAS DE OPERADOR (A4) — perfil, apontamento, roteiro OP, instrução, produtividade

function A4Head2({ title, num, sub }) {
  return (
    <div className="a4-head">
      <div className="brand">
        <div className="brand-mark"><PIcon.Logo size={22}/></div>
        <div>
          <div className="brand-name">SQUAD SHOES</div>
          <div className="brand-sub">{sub}</div>
        </div>
      </div>
      <div className="doc-meta">
        <div className="doc-title">{title}</div>
        <div className="doc-num">{num}</div>
      </div>
    </div>
  );
}

// ─── 1. FICHA DE PERFIL DO OPERADOR ───
function FichaPerfilOp() {
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head2 title="Ficha do Operador" num="OP-104 · Marcia Lopes" sub="Recursos Humanos · Operador"/>

        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 110px', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
          <div style={{ width: 110, height: 132, border: '1px solid var(--p-line-2)', background: 'var(--p-soft)', position: 'relative', overflow: 'hidden' }}>
            {/* Stylized head silhouette placeholder */}
            <svg viewBox="0 0 110 132" style={{ width: '100%', height: '100%' }}>
              <circle cx="55" cy="48" r="22" fill="var(--p-line-2)"/>
              <path d="M 18 132 C 18 96 38 80 55 80 C 72 80 92 96 92 132 Z" fill="var(--p-line-2)"/>
              <text x="55" y="125" textAnchor="middle" style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.14em', fill: 'var(--p-mute)' }}>FOTO 3×4</text>
            </svg>
          </div>
          <div>
            <div className="p-eyebrow">Operador #104</div>
            <div className="p-display" style={{ fontSize: 30, marginTop: 4 }}>MARCIA LOPES</div>
            <div style={{ fontSize: 11.5, color: 'var(--p-mute)', marginTop: 4 }}>Costureira sênior · Linha A1 · Turno 1</div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', columnGap: 10, rowGap: 6, marginTop: 10 }}>
              {[
                ['Admissão', '14/03/2018'],
                ['Tempo de casa', '8 anos 2 meses'],
                ['Setor', 'Costura'],
                ['CTPS', '12345 / 0042-RS'],
                ['Líder', 'Renata Mota'],
                ['Treinamentos', '6 ativos'],
              ].map((r, i) => (
                <div key={i} style={{ borderLeft: '2px solid var(--p-ink)', paddingLeft: 8 }}>
                  <div className="p-eyebrow" style={{ fontSize: 7.5 }}>{r[0]}</div>
                  <div style={{ fontWeight: 600, marginTop: 4, fontSize: 11 }}>{r[1]}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div className="p-eyebrow" style={{ fontSize: 7.5, marginBottom: 4 }}>Crachá digital</div>
            <PIcon.QR size={100}/>
            <div className="p-mono" style={{ fontSize: 8, color: 'var(--p-mute)', marginTop: 4, letterSpacing: '0.04em' }}>squad.sh/op/104</div>
          </div>
        </div>

        {/* Habilidades */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Habilidades certificadas</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 10 }}>
          <thead><tr>
            <th>Habilidade</th><th>Etapa</th><th>Nível</th><th>Certificado em</th><th>Validade</th>
          </tr></thead>
          <tbody>
            {[
              ['Costura ponto reto',     'Costura',    'Avançado',    '12/02/2024','24m'],
              ['Costura zigue-zague',    'Costura',    'Avançado',    '12/02/2024','24m'],
              ['Pesponto duplo',         'Costura',    'Pleno',       '08/05/2025','12m'],
              ['Vira de bordas',         'Costura',    'Pleno',       '08/05/2025','12m'],
              ['Inspeção visual',        'QC',         'Básico',      '15/01/2026','12m'],
              ['Manutenção 1º nível',    'Manutenção', 'Básico',      '03/03/2026','12m'],
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{r[0]}</td>
                <td>{r[1]}</td>
                <td><span className="p-pill p-pill-ok">{r[2]}</span></td>
                <td className="p-mono">{r[3]}</td>
                <td className="p-mono">{r[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Indicadores recentes */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          {[
            { l: 'Pares/hora médio', v: '38' },
            { l: 'FPY individual', v: '98,1%' },
            { l: 'Assiduidade 30d', v: '100%' },
            { l: 'Pontuação geral', v: '92' },
          ].map((k, i) => (
            <div key={i} className="p-kpi">
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Histórico recente · 30 dias</div>
        <table className="p-tbl">
          <thead><tr><th>Data</th><th>OP</th><th>Etapa</th><th className="num">Pares</th><th className="num">Refugo</th><th className="num">Hrs</th></tr></thead>
          <tbody>
            {[
              ['08/05', 'OP-2847', 'Costura', 312, 4, '8h00'],
              ['07/05', 'OP-2847', 'Costura', 304, 2, '8h00'],
              ['06/05', 'OP-2843', 'Costura', 288, 3, '8h00'],
              ['05/05', 'OP-2843', 'Costura', 296, 1, '8h00'],
              ['02/05', 'OP-2841', 'Costura', 312, 0, '8h00'],
            ].map((r, i) => (
              <tr key={i}>
                <td className="p-mono">{r[0]}</td>
                <td className="p-mono">{r[1]}</td>
                <td>{r[2]}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r[3]}</td>
                <td className="num" style={{ color: r[4] > 0 ? 'var(--p-red)' : 'inherit' }}>{r[4]}</td>
                <td className="num">{r[5]}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Sigs labels={['Líder', 'RH', 'Operador']}/>
        <A4Foot doc="OP-104 · Ficha do Operador" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 2. FICHA DE APONTAMENTO (preenche à mão) ───
function FichaApontamento() {
  const m = MODELOS['I901'];
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head2 title="Apontamento de Produção" num="APT · _____________" sub="Produção · Apontamento Manual"/>

        {/* HERO modelo + ref + cor — pré-preenchido para conferência */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10, marginBottom: 8, padding: '8px 12px', border: '1px solid var(--p-line-2)', background: 'var(--p-soft)', alignItems: 'center' }}>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>Modelo deste apontamento</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <div style={{ fontFamily: 'Anton', fontSize: 20, letterSpacing: '0.01em', lineHeight: 1 }}>{m.name}</div>
              <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '2px 8px', fontFamily: 'JetBrains Mono', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em' }}>REF {m.ref}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <ColorChips swatches={m.swatches} size="sm" showLabels={false} showNames={false}/>
              <div style={{ fontSize: 10, fontWeight: 600 }}>{m.cor}</div>
              <div style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono', fontSize: 9, color: 'var(--p-mute)', letterSpacing: '0.1em' }}>OP-2847 · L26-0190</div>
            </div>
          </div>
          <ShoePhoto w={100} h={72} label={`REF ${m.ref}`}/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          {[
            ['Data', '__ / __ / 2026'],
            ['Turno', '☐ 1   ☐ 2   ☐ 3'],
            ['Linha', '________________'],
            ['Operador', '________________________________'],
            ['Etapa', '☐ CORTE ☐ COSTURA ☐ MONT. ☐ ACAB. ☐ EMB.'],
            ['Líder visto', '________________'],
          ].map((r, i) => (
            <div key={i} style={{ borderBottom: '1px solid var(--p-line)', paddingBottom: 6 }}>
              <div className="p-eyebrow" style={{ fontSize: 8.5 }}>{r[0]}</div>
              <div style={{ marginTop: 5, fontSize: 12, fontFamily: 'JetBrains Mono', letterSpacing: '0.02em' }}>{r[1]}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Produção por hora <span style={{ color: 'var(--p-mute)', fontWeight: 400 }}>· meta {40} pares/h</span></div>
        <table className="p-tbl" style={{ marginBottom: 10 }}>
          <thead><tr>
            <th>Hora</th>
            <th className="num">Pares</th>
            <th style={{ width: 200 }}>Ritmo · pinte um quadrado a cada par</th>
            <th className="num">Refugo</th>
            <th>Observações</th>
          </tr></thead>
          <tbody>
            {['07–08','08–09','09–10','10–11','11–12','13–14','14–15','15–16','16–17'].map((h, i) => (
              <tr key={i} style={{ height: 24 }}>
                <td className="p-mono" style={{ fontWeight: 700 }}>{h}</td>
                <td className="num">&nbsp;</td>
                <td style={{ padding: '4px 10px' }}>
                  <div style={{ display: 'flex', gap: 1, position: 'relative' }}>
                    {Array.from({ length: 50 }).map((_, j) => (
                      <div key={j} style={{
                        flex: 1, height: 16,
                        background: '#fff',
                        borderTop: '1px solid var(--p-line-2)',
                        borderBottom: '1px solid var(--p-line-2)',
                        borderLeft: j === 0 ? '1px solid var(--p-line-2)' : 'none',
                        borderRight: '1px solid var(--p-line-2)',
                        backgroundColor: j === 39 ? 'var(--p-line-2)' : '#fff',
                      }}/>
                    ))}
                    {/* meta marker */}
                    <div style={{ position: 'absolute', left: '80%', top: -2, bottom: -2, width: 1.5, background: 'var(--p-red)' }}/>
                  </div>
                </td>
                <td className="num">&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
            <tr>
              <td className="p-mono" style={{ background: 'var(--p-ink)', color: 'white', fontWeight: 700, letterSpacing: '0.06em' }}>TOTAL</td>
              <td className="num" style={{ background: 'var(--p-ink)', color: 'white' }}>&nbsp;</td>
              <td colSpan="3" style={{ background: 'var(--p-ink)', color: 'white', fontFamily: 'JetBrains Mono', fontSize: 8.5, letterSpacing: '0.14em', paddingLeft: 12 }}>↓ SOMAR PARES DO TURNO</td>
            </tr>
          </tbody>
        </table>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Paradas e ocorrências</div>
        <table className="p-tbl" style={{ marginBottom: 10 }}>
          <thead><tr>
            <th>Início</th><th>Fim</th><th className="num">Duração</th><th>Tipo</th><th>Descrição</th>
          </tr></thead>
          <tbody>
            {Array.from({ length: 4 }).map((_, i) => (
              <tr key={i} style={{ height: 24 }}>
                <td className="p-mono">&nbsp;</td>
                <td className="p-mono">&nbsp;</td>
                <td className="num">&nbsp;</td>
                <td>&nbsp;</td>
                <td>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>03 · Observações gerais</div>
        <div style={{ border: '1px solid var(--p-line)', height: 70, padding: 8, background: 'repeating-linear-gradient(transparent, transparent 22px, var(--p-line) 22px, var(--p-line) 23px)', marginBottom: 10 }}/>

        <Sigs labels={['Operador', 'Líder', 'PCP']}/>
        <A4Foot doc="APT · Apontamento Manual" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 3. ROTEIRO DA OP (etiqueta) ───
function FichaRoteiro() {
  const m = MODELOS['I905']; // Sandália Leila — destaque para tiras
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head2 title="Roteiro da OP" num="OP-2851 · Sandália Leila" sub="Produção · Roteiro de OP"/>

        {/* HERO — modelo + ref + foto + QR */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 110px', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
          <div>
            <div className="p-eyebrow">Ordem de Produção</div>
            <div className="p-display" style={{ fontSize: 44, marginTop: 4, color: 'var(--p-red)' }}>OP-2851</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <div style={{ fontFamily: 'Anton', fontSize: 20, letterSpacing: '0.01em', lineHeight: 1 }}>{m.name}</div>
              <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '2px 8px', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>REF {m.ref}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 4 }}>{m.categoria} · {m.cor}</div>
            <div style={{ fontSize: 10.5, color: 'var(--p-mute)', marginTop: 2 }}>PV-2026-00097 · VIP Shoes Araruama · Entrega 12/05/2026</div>
          </div>
          <ShoePhoto w={130} h={104} label={`REF ${m.ref}`}/>
          <div style={{ textAlign: 'center' }}>
            <PIcon.QR size={104}/>
            <div className="p-mono" style={{ fontSize: 8, color: 'var(--p-mute)', marginTop: 4 }}>squad.sh/op/2851</div>
          </div>
        </div>

        {/* Cores em destaque · sequência tiras */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10, padding: '8px 12px', border: '1px solid var(--p-line-2)', background: 'var(--p-soft)', alignItems: 'center' }}>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>Cores · sequência das tiras</div>
            <div style={{ marginTop: 8 }}>
              <ColorChips swatches={m.swatches} size="md" showLabels showNames/>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, auto)', gap: '4px 14px', fontSize: 10.5 }}>
            {[
              ['Pares',  '540'],
              ['Forma',  'F-208'],
              ['Solado', 'TR-PR'],
              ['SKU',    m.sku],
            ].map((r, i) => (
              <React.Fragment key={i}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.14em', color: 'var(--p-mute)', textTransform: 'uppercase' }}>{r[0]}</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10 }}>{r[1]}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Roteiro horizontal */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Trajeto pela fábrica</div>
        <div className="flow-stages" style={{ marginBottom: 8 }}>
          {[
            { n: 'CORTE',       t: '02/05', s: 'done' },
            { n: 'COSTURA',     t: '02–04/05', s: 'done' },
            { n: 'MONTAGEM',    t: '05–06/05', s: 'active' },
            { n: 'ACABAMENTO',  t: '07/05', s: '' },
            { n: 'EMBALAGEM',   t: '08/05', s: '' },
            { n: 'EXPEDIÇÃO',   t: '12/05', s: '' },
          ].map((s, i) => (
            <div key={i} className={`flow-stage ${s.s}`}>
              <div className="lbl">Etapa {String(i+1).padStart(2,'0')}</div>
              <div className="nm">{s.n}</div>
              <div className="p-mono" style={{ fontSize: 10, color: s.s === 'active' ? 'var(--p-red)' : 'var(--p-mute)', marginTop: 4, fontWeight: s.s === 'active' ? 700 : 400 }}>{s.t}</div>
              {s.s === 'done' && <div style={{ position: 'absolute', top: 6, right: 6, color: 'var(--p-mute)', fontSize: 14 }}>✓</div>}
              {s.s === 'active' && <div style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: '50%', background: 'var(--p-red)' }}/>}
            </div>
          ))}
        </div>

        {/* Apontamento por etapa */}
        <div className="p-eyebrow" style={{ marginBottom: 6 }}>02 · Apontamento de passagem (preencher à mão)</div>
        <table className="p-tbl">
          <thead><tr>
            <th style={{ width: 28 }}>#</th><th>Etapa</th><th className="num">Entrada</th><th className="num">Saída</th><th className="num">Pares OK</th><th className="num">Refugo</th><th>Operador</th><th style={{ width: 90 }}>Visto</th>
          </tr></thead>
          <tbody>
            {['CORTE','COSTURA','MONTAGEM','ACABAMENTO','EMBALAGEM','EXPEDIÇÃO'].map((s, i) => (
              <tr key={i} style={{ height: 26 }}>
                <td className="p-mono" style={{ fontWeight: 700 }}>{String(i+1).padStart(2,'0')}</td>
                <td style={{ fontWeight: 600 }}>{s}</td>
                <td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
                <td style={{ background: 'var(--p-soft)' }}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ marginTop: 18, padding: 12, border: '1.5px solid var(--p-red)', background: 'var(--p-red-soft)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Icon.Alert style={{ color: 'var(--p-red)', width: 18, height: 18, flexShrink: 0, marginTop: 2 }}/>
          <div style={{ fontSize: 11 }}>
            <strong>Atenção tiras:</strong> esta OP tem 3 tiras com cores diferentes (T1 caramelo, T2 cru, T3 caramelo). Conferir sequência antes da costura. Refugos vão para a folha QC-2851.
          </div>
        </div>

        <A4Foot doc="OP-2851 · Roteiro de OP" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 4. INSTRUÇÃO DE TRABALHO ───
function FichaInstrucao() {
  const m = MODELOS['I901'];
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head2 title="Instrução de Trabalho" num="IT-COSTURA-I901 · Rev. 02" sub="Engenharia · Instrução de Trabalho"/>

        {/* HERO modelo + ref + foto + cores */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px', gap: 10, marginBottom: 10, padding: '8px 12px', border: '1px solid var(--p-line-2)', background: 'var(--p-soft)', alignItems: 'center' }}>
          <div>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>Modelo desta IT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              <div style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: '0.01em', lineHeight: 1 }}>{m.name}</div>
              <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '2px 8px', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>REF {m.ref}</div>
            </div>
            <div style={{ fontSize: 10.5, marginTop: 3, color: 'var(--p-ink-2)' }}>{m.categoria} · {m.cor}</div>
            <div style={{ marginTop: 8 }}>
              <ColorChips swatches={m.swatches} size="sm" showLabels showNames/>
            </div>
          </div>
          <ShoePhoto w={110} h={88} label={`REF ${m.ref}`}/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          {[
            ['Etapa', 'COSTURA'],
            ['Posto', 'Linha A1 · M.04'],
            ['Tempo padrão', '12 min/par'],
            ['Tolerância', '± 1,5 min'],
            ['Equipamento', 'Singer 591N'],
            ['Linha de costura', 'Pol. 40 preto'],
          ].map((r, i) => (
            <div key={i} style={{ background: 'var(--p-paper)', border: '1px solid var(--p-line)', padding: '7px 10px' }}>
              <div className="p-eyebrow" style={{ fontSize: 8 }}>{r[0]}</div>
              <div style={{ fontWeight: 600, marginTop: 3, fontSize: 11.5 }}>{r[1]}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 8 }}>01 · Sequência de operações</div>
        {[
          { n: '01', t: 'Posicionar peça na guia', d: 'Alinhar borda do cabedal com guia metálica do prensador. Verificar marcação de costura.', tm: '0:30',
            dg: <g><rect x="6" y="14" width="40" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"/><line x1="6" y1="24" x2="46" y2="24" stroke="currentColor" strokeWidth="0.8" strokeDasharray="2 2"/><circle cx="36" cy="14" r="2.4" fill="currentColor"/></g> },
          { n: '02', t: 'Costura de fechamento traseiro', d: 'Ponto reto · 8 PPI · linha 40 preto. Distância de 3mm da borda.', tm: '2:30',
            dg: <g><path d="M 6 30 Q 18 14 30 30 T 46 30" fill="none" stroke="currentColor" strokeWidth="1.5"/>{[10,16,22,28,34,40].map(x => <line key={x} x1={x} y1={28} x2={x} y2={32} stroke="currentColor" strokeWidth="1"/>)}</g> },
          { n: '03', t: 'Costura das tiras 1 e 2', d: 'Aplicar pesponto duplo nas três tiras. Verificar simetria das duas peças.', tm: '4:00',
            dg: <g><rect x="8" y="10" width="36" height="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2"/><rect x="8" y="20" width="36" height="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2"/><rect x="8" y="30" width="36" height="6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2"/></g> },
          { n: '04', t: 'Costura do reforço interno', d: 'Aplicar reforço de 4cm no calcanhar com ponto zigue-zague.', tm: '2:00',
            dg: <g><path d="M 8 18 L 14 30 L 20 18 L 26 30 L 32 18 L 38 30 L 44 18" fill="none" stroke="currentColor" strokeWidth="1.5"/><rect x="8" y="30" width="36" height="6" fill="var(--p-red-soft)" stroke="var(--p-red)" strokeWidth="0.8"/></g> },
          { n: '05', t: 'Acabamento de pontas', d: 'Cortar excessos de linha · revisar tensão · marcar com etiqueta.', tm: '1:30',
            dg: <g><line x1="10" y1="14" x2="42" y2="34" stroke="currentColor" strokeWidth="1.2"/><line x1="10" y1="34" x2="42" y2="14" stroke="currentColor" strokeWidth="1.2"/><circle cx="26" cy="24" r="6" fill="none" stroke="var(--p-red)" strokeWidth="1.5"/></g> },
          { n: '06', t: 'Inspeção e entrega', d: 'Verificar 6 pontos críticos · separar refugo na caixa vermelha.', tm: '1:30',
            dg: <g><circle cx="26" cy="24" r="10" fill="none" stroke="currentColor" strokeWidth="1.5"/><path d="M 22 24 L 25 27 L 30 21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></g> },
        ].map((s, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '36px 56px 1fr 70px', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--p-line)', alignItems: 'center' }}>
            <div className="p-display" style={{ fontSize: 26, color: 'var(--p-red)' }}>{s.n}</div>
            <div style={{ width: 52, height: 44, border: '1px solid var(--p-line-2)', background: 'var(--p-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 52 44" width="52" height="44" style={{ color: 'var(--p-ink-2)' }}>{s.dg}</svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{s.t}</div>
              <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 4, lineHeight: 1.4 }}>{s.d}</div>
            </div>
            <div className="p-mono" style={{ fontSize: 13, fontWeight: 700, textAlign: 'right' }}>{s.tm}</div>
          </div>
        ))}

        <div className="p-eyebrow" style={{ marginTop: 18, marginBottom: 6 }}>02 · Pontos críticos de qualidade</div>
        <table className="p-tbl">
          <thead><tr><th>Verificação</th><th>Critério</th><th>Frequência</th></tr></thead>
          <tbody>
            <tr><td>Tensão da costura</td><td>8 PPI · sem ondulação</td><td>Cada peça</td></tr>
            <tr><td>Simetria de tiras</td><td>± 2mm entre par</td><td>Cada par</td></tr>
            <tr><td>Reforço calcanhar</td><td>4cm de comprimento</td><td>Cada peça</td></tr>
            <tr><td>Tonalidade do material</td><td>Sem variação no par</td><td>Cada par</td></tr>
          </tbody>
        </table>

        <Sigs labels={['Engenharia', 'Líder', 'Operador (li e entendi)']}/>
        <A4Foot doc="IT-COSTURA-I901 · Rev. 02" page="1/1"/>
      </div>
    </div>
  );
}

// ─── 5. PRODUTIVIDADE INDIVIDUAL ───
function FichaProdutividade() {
  return (
    <div className="paper">
      <div className="sheet">
        <A4Head2 title="Produtividade Individual" num="OP-104 · Marcia Lopes · Maio/2026" sub="RH · Produtividade Mensal"/>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          {[
            { l: 'Pares no mês', v: '6.840' },
            { l: 'Pares/hora', v: '38,2' },
            { l: 'FPY', v: '98,1%' },
            { l: 'Pontuação', v: '92', sub: '/ 100' },
          ].map((k, i) => (
            <div key={i} className="p-kpi">
              <div className="lbl">{k.l}</div>
              <div className="val">{k.v}{k.sub && <span style={{ fontSize: 14, color: 'var(--p-mute)', marginLeft: 4 }}>{k.sub}</span>}</div>
            </div>
          ))}
        </div>

        <div className="p-eyebrow" style={{ marginBottom: 6 }}>01 · Produção semanal · 4 semanas</div>
        <table className="p-tbl p-tbl-zebra" style={{ marginBottom: 10 }}>
          <thead><tr>
            <th>Semana</th><th className="num">Hrs trab.</th><th className="num">Pares</th><th className="num">Pares/h</th><th className="num">Refugo</th><th className="num">FPY</th><th>Performance</th>
          </tr></thead>
          <tbody>
            {[
              ['W16', 40, 1480, 37, 28, '98,1%', 70],
              ['W17', 40, 1640, 41, 22, '98,7%', 90],
              ['W18', 40, 1560, 39, 31, '98,0%', 80],
              ['W19', 44, 1820, 41, 26, '98,6%', 95],
            ].map((r, i) => (
              <tr key={i}>
                <td className="p-mono" style={{ fontWeight: 700 }}>{r[0]}</td>
                <td className="num">{r[1]}h</td>
                <td className="num" style={{ fontWeight: 600 }}>{r[2]}</td>
                <td className="num" style={{ fontWeight: 600 }}>{r[3]}</td>
                <td className="num">{r[4]}</td>
                <td className="num">{r[5]}</td>
                <td>
                  <div style={{ height: 8, background: 'var(--p-soft)', border: '1px solid var(--p-line)', position: 'relative' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: r[6] + '%', background: 'var(--p-ink)' }}/>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 10 }}>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>02 · Modelos trabalhados</div>
            {[
              { l: 'Mocassim Verona', v: 2840, p: 41 },
              { l: 'Bota Aurora',     v: 1620, p: 24 },
              { l: 'Scarpin Bianca',  v: 1380, p: 20 },
              { l: 'Sandália Leila',  v:  680, p: 10 },
              { l: 'Outros',          v:  320, p: 5 },
            ].map((b, i) => (
              <div key={i} className="bar-row">
                <div className="lab">{b.l}</div>
                <div className="bar"><span style={{ width: b.p * 2 + '%' }}/></div>
                <div className="val">{b.v}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="p-eyebrow" style={{ marginBottom: 8 }}>03 · Pontuação · 6 critérios</div>
            <table className="p-tbl">
              <tbody>
                <tr><td>Produtividade</td><td className="num" style={{ fontWeight: 600 }}>95 / 100</td></tr>
                <tr><td>Qualidade (FPY)</td><td className="num" style={{ fontWeight: 600 }}>97 / 100</td></tr>
                <tr><td>Assiduidade</td><td className="num" style={{ fontWeight: 600 }}>100 / 100</td></tr>
                <tr><td>Trabalho em equipe</td><td className="num" style={{ fontWeight: 600 }}>90 / 100</td></tr>
                <tr><td>5S do posto</td><td className="num" style={{ fontWeight: 600 }}>85 / 100</td></tr>
                <tr><td>Iniciativa</td><td className="num" style={{ fontWeight: 600 }}>85 / 100</td></tr>
                <tr style={{ background: 'var(--p-ink)', color: 'white' }}>
                  <td style={{ fontWeight: 700, letterSpacing: '0.04em' }}>MÉDIA</td>
                  <td className="num" style={{ fontWeight: 700 }}>92 / 100</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: 14, background: 'var(--p-soft)', border: '1px solid var(--p-line)', fontSize: 11.5 }}>
          <div className="p-eyebrow" style={{ fontSize: 9, color: 'var(--p-red)' }}>Observações da liderança</div>
          <div style={{ marginTop: 6 }}>Excelente desempenho em maio. Indicada para certificação avançada em <strong>vira de bordas</strong> e mentoria das novas costureiras do turno B.</div>
        </div>

        <Sigs labels={['Líder', 'RH', 'Operador']}/>
        <A4Foot doc="OP-104 · Produtividade Mai/2026" page="1/1"/>
      </div>
    </div>
  );
}

window.FichaPerfilOp = FichaPerfilOp;
window.FichaApontamento = FichaApontamento;
window.FichaRoteiro = FichaRoteiro;
window.FichaInstrucao = FichaInstrucao;
window.FichaProdutividade = FichaProdutividade;
