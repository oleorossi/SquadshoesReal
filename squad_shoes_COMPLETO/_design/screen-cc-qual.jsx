// PRODUÇÃO · Centro de Controle (alertas) + Qualidade (FPY listing)

// ─── Centro de Controle ──────────────────────────────
function ProducaoCC() {
  const alertas = [
    { sev: 'crit', tag: 'PRODUÇÃO',    titulo: 'OP-2851 atrasada · 4,5% refugo',    desc: 'Sandália Leila B1 · meta de 540 pares em 12/05 sob risco',  area: 'Líder PCP',  ts: '14:32', acao: 'Realocar para A2' },
    { sev: 'crit', tag: 'ESTOQUE',     titulo: 'Cola PU em ruptura iminente',        desc: '14 kg restantes · 2 dias de cobertura · OC-0216 atrasada', area: 'Suprimentos', ts: '13:48', acao: 'Acionar fornecedor' },
    { sev: 'crit', tag: 'MANUTENÇÃO',  titulo: 'Prensa PR-3 · 7h paradas semana',    desc: 'Vazamento óleo recorrente · técnico externo solicitado',   area: 'Manutenção',  ts: '11:14', acao: 'Substituir bomba' },
    { sev: 'crit', tag: 'FINANCEIRO',  titulo: 'NF 189.418 vencida · R$ 6.420',      desc: 'VO Figueira · 6 dias de atraso · 2ª cobrança hoje',         area: 'Financeiro',  ts: '09:30', acao: 'Boletar 2ª via' },
    { sev: 'warn', tag: 'QUALIDADE',   titulo: 'FPY Linha B1 caiu para 95,5%',       desc: 'Costura aberta em 33% dos refugos · treinamento sugerido',  area: 'QC',          ts: '14:08', acao: 'Treinar costureiras T2' },
    { sev: 'warn', tag: 'COMPRAS',     titulo: 'Verniz Adocicado · 5d cobertura',    desc: 'Sintex SP · OC sugerida 200 dm²',                            area: 'Suprimentos', ts: '10:42', acao: 'Aprovar OC sugerida' },
    { sev: 'warn', tag: 'PRODUÇÃO',    titulo: 'Linha C2 sem OP designada',          desc: '4h ociosas · pode pegar OP-2861 (Pampas)',                  area: 'PCP',         ts: '08:00', acao: 'Sequenciar OP-2861' },
    { sev: 'info', tag: 'RH',          titulo: '2 colaboradores com BH acima de 35h', desc: 'Marcia L. e Henrique C. · próximos do limite legal',         area: 'RH',          ts: '08:00', acao: 'Compensar 7 dias' },
  ];
  const sevColor = { crit: 'var(--p-red)', warn: 'var(--p-warn)', info: 'var(--p-ink-2)' };
  const sevBg    = { crit: 'var(--p-red-soft)', warn: 'rgba(138,90,0,0.06)', info: 'var(--p-soft)' };

  return (
    <LightShell active="cc" breadcrumb="PRODUÇÃO · CENTRO DE CONTROLE" title="CENTRO DE CONTROLE · ALERTAS" actions={<>
      <button className="btn-l">Configurar regras</button>
      <button className="btn-l">Ack todos</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'Críticos',  v: '4', s: 'requer ação imediata', col: 'var(--p-red)' },
          { l: 'Atenção',   v: '3', s: 'monitorar', col: 'var(--p-warn)' },
          { l: 'Info',      v: '1', s: 'sem urgência', col: 'var(--p-ink)' },
          { l: 'Ack hoje',  v: '12', s: 'reconhecidos', col: 'var(--p-ok)' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 28, marginTop: 5, color: k.col }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div className="light-card" style={{ padding: 22 }}>
        {alertas.map((a, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '12px 100px 1fr 140px 130px',
            gap: 14, alignItems: 'center',
            padding: '14px 16px', marginBottom: 8,
            background: sevBg[a.sev], borderLeft: `3px solid ${sevColor[a.sev]}`,
            border: '1px solid var(--p-line)',
          }}>
            <span style={{ width: 8, height: 8, background: sevColor[a.sev], borderRadius: '50%' }}/>
            <div>
              <div className="p-eyebrow" style={{ fontSize: 8, color: sevColor[a.sev] }}>{a.tag}</div>
              <div className="p-mono" style={{ fontSize: 9.5, color: 'var(--p-mute)', marginTop: 2 }}>{a.ts}</div>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{a.titulo}</div>
              <div style={{ fontSize: 11, color: 'var(--p-mute)', marginTop: 2 }}>{a.desc}</div>
            </div>
            <div style={{ fontSize: 11 }}>
              <div className="p-eyebrow" style={{ fontSize: 7.5 }}>Responsável</div>
              <div style={{ fontWeight: 600, marginTop: 2 }}>{a.area}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <button className="btn-l-red btn-l" style={{ fontSize: 10.5, height: 26, padding: '0 10px' }}>{a.acao} →</button>
            </div>
          </div>
        ))}
      </div>
    </LightShell>
  );
}
window.ProducaoCC = ProducaoCC;

// ─── Qualidade ───────────────────────────────────────
function ProducaoQualidade() {
  const insp = [
    { h: '14:22', op: 'OP-2855', m: MODELOS['I901'], insp: 'Camila', am: 50, ok: 50, df: 0, fpy: 100 },
    { h: '13:48', op: 'OP-2843', m: MODELOS['I918'], insp: 'Lúcia',  am: 30, ok: 27, df: 3, fpy: 90 },
    { h: '13:15', op: 'OP-2851', m: MODELOS['I905'], insp: 'Camila', am: 50, ok: 49, df: 1, fpy: 98 },
    { h: '12:40', op: 'OP-2847', m: MODELOS['I901'], insp: 'Bruno',  am: 40, ok: 38, df: 2, fpy: 95 },
    { h: '11:55', op: 'OP-2849', m: MODELOS['I918'], insp: 'Lúcia',  am: 30, ok: 30, df: 0, fpy: 100 },
    { h: '11:10', op: 'OP-2841', m: MODELOS['I901'], insp: 'Bruno',  am: 50, ok: 48, df: 2, fpy: 96 },
  ];
  return (
    <LightShell active="qual" breadcrumb="PRODUÇÃO · QUALIDADE" title="QUALIDADE · FPY E DEFEITOS" actions={<>
      <button className="btn-l">Defeitos top</button>
      <button className="btn-l-red btn-l">+ Nova inspeção</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { l: 'FPY hoje',     v: '96,4%', s: 'meta 96%', col: 'var(--p-ok)' },
          { l: 'Inspeções',    v: '24',    s: 'amostras 1.180', col: 'var(--p-ink)' },
          { l: 'Reprovados',   v: '42',    s: '3,6% das amostras', col: 'var(--p-warn)' },
          { l: 'Top defeito',  v: 'COSTURA', s: '38% dos casos', col: 'var(--p-red)' },
          { l: 'Re-trabalho',  v: 'R$ 1,9k', s: 'semana', col: 'var(--p-ink)' },
        ].map((k, i) => (
          <div key={i} className="light-card" style={{ padding: 14 }}>
            <div className="p-eyebrow" style={{ fontSize: 8 }}>{k.l}</div>
            <div className="p-display" style={{ fontSize: 26, marginTop: 5, color: k.col }}>{k.v}</div>
            <div style={{ fontSize: 10, color: 'var(--p-mute)', marginTop: 2 }}>{k.s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 18 }}>
        <div className="light-card" style={{ padding: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
            <div>
              <div className="p-eyebrow">Inspeções recentes</div>
              <div className="p-display" style={{ fontSize: 20, marginTop: 4 }}>ÚLTIMAS 6 AMOSTRAGENS</div>
            </div>
          </div>
          <table className="p-tbl p-tbl-zebra">
            <thead><tr>
              <th>Hora</th><th>OP</th><th>Modelo</th><th>Cor</th>
              <th>Inspetor</th><th className="num">Am.</th><th className="num">OK</th><th className="num">Def.</th><th className="num">FPY</th>
            </tr></thead>
            <tbody>
              {insp.map((r, i) => (
                <tr key={i}>
                  <td className="p-mono" style={{ fontSize: 10.5, color: 'var(--p-mute)' }}>{r.h}</td>
                  <td className="p-mono" style={{ fontWeight: 700, fontSize: 11 }}>{r.op}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 11.5 }}>{r.m.name}</span>
                      <RefChip code={r.m.ref} size="sm"/>
                    </div>
                  </td>
                  <td><ColorChips swatches={r.m.swatches} size="xs" showLabels={false} showNames={false}/></td>
                  <td style={{ fontSize: 11 }}>{r.insp}</td>
                  <td className="num">{r.am}</td>
                  <td className="num" style={{ color: 'var(--p-ok)' }}>{r.ok}</td>
                  <td className="num" style={{ color: r.df ? 'var(--p-red)' : 'var(--p-mute)', fontWeight: 600 }}>{r.df}</td>
                  <td className="num" style={{ fontWeight: 700, color: r.fpy === 100 ? 'var(--p-ok)' : r.fpy >= 95 ? 'var(--p-ink)' : 'var(--p-warn)' }}>{r.fpy}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="light-card" style={{ padding: 22 }}>
          <div className="p-eyebrow" style={{ marginBottom: 10 }}>Top defeitos · semana</div>
          {[
            { n: 'Costura aberta',     v: 78, p: 33.8, red: true },
            { n: 'Cola má aplicação',  v: 44, p: 19.0 },
            { n: 'Risco no verniz',    v: 38, p: 16.5 },
            { n: 'Furo descentrado',   v: 31, p: 13.4 },
            { n: 'Solado solto',       v: 22, p: 9.5 },
            { n: 'Embalagem trocada',  v: 12, p: 5.2 },
            { n: 'Outros',             v: 6,  p: 2.6 },
          ].map((d, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 11 }}>
                <span style={{ fontWeight: 500 }}>{d.n}</span>
                <span className="p-mono" style={{ color: 'var(--p-mute)' }}>{d.v} · {d.p}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--p-soft)', border: '1px solid var(--p-line)' }}>
                <div style={{ height: '100%', width: d.p * 2.5 + '%', background: d.red ? 'var(--p-red)' : 'var(--p-ink)' }}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </LightShell>
  );
}
window.ProducaoQualidade = ProducaoQualidade;
