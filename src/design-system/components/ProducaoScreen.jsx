import React, { useState, useEffect, useRef, useMemo } from 'react';
import { T, Btn, ProgressBar, Panel } from './Components';

// Squad Shoes Factory OS — Tela: Produção (linhas em tempo real, etapas)
function ProducaoScreen() {
  const linhas = [
    { line: 'A1', model: 'Sandália 04 — Caramelo', sku: 'SD04-CRM-36', op: 'OP-2847', status: 'running', current: 287, target: 420, op_pct: 68, operator: 'Maria S.', shift: 'A', stages: [{n:'Corte',d:100},{n:'Costura',d:78},{n:'Montagem',d:32},{n:'Acabamento',d:0},{n:'Embalagem',d:0}] },
    { line: 'A2', model: 'Scarpin 02 — Preto',     sku: 'SC02-PRT-37', op: 'OP-2846', status: 'running', current: 354, target: 380, op_pct: 93, operator: 'André P.', shift: 'A', stages: [{n:'Corte',d:100},{n:'Costura',d:100},{n:'Montagem',d:100},{n:'Acabamento',d:88},{n:'Embalagem',d:30}] },
    { line: 'B1', model: 'Bota 03 — Bordô',        sku: 'BT03-BRD-38', op: 'OP-2845', status: 'paused',  current: 142, target: 300, op_pct: 47, operator: 'Sofia R.', shift: 'A', alert: 'Cola fora da temperatura', stages: [{n:'Corte',d:100},{n:'Costura',d:80},{n:'Montagem',d:14},{n:'Acabamento',d:0},{n:'Embalagem',d:0}] },
    { line: 'B2', model: 'Sapatilha 01 — Nude',    sku: 'SP01-NUD-35', op: 'OP-2844', status: 'queued',  current: 0,   target: 200, op_pct: 0,  operator: 'Bruno C.', shift: 'A', stages: [{n:'Corte',d:0},{n:'Costura',d:0},{n:'Montagem',d:0},{n:'Acabamento',d:0},{n:'Embalagem',d:0}] },
  ];

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }} className="page-enter">
      {/* Header da tela com filtros */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {['Todas as linhas','Em produção','Pausadas','Bloqueadas','Na fila'].map((l, i) => (
            <Chip key={l} label={l} count={i===0?4:i===1?2:i===2?1:i===3?1:0} active={i===0}/>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          <Btn variant="ghost" size="sm" icon="layout-grid">Grid</Btn>
          <Btn variant="ghost" size="sm" icon="rows-3">Lista</Btn>
          <Btn variant="primary" size="sm" icon="play">Iniciar OP</Btn>
        </div>
      </div>

      {/* Linhas com detalhe de etapa */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {linhas.map(l => <LineDetailCard key={l.line} {...l}/>)}
      </div>

      {/* Heatmap por turno */}
      <Panel title="Eficiência por turno · 7 dias" subtitle="Pares produzidos por hora" padding={20}>
        <Heatmap/>
      </Panel>
    </div>
  );
}

function Chip({ label, count, active }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '7px 13px', borderRadius: 999,
        background: active ? T.primary : hov ? T.mutedSoft : 'white',
        color: active ? 'white' : T.foreground,
        border: active ? 'none' : `1px solid ${T.border}`,
        fontFamily: T.sans, fontSize: 12, fontWeight: 600,
        cursor: 'pointer', transition: T.transitionFast,
        boxShadow: active ? '0 4px 12px hsl(162 90% 15% / 0.2)' : 'none',
      }}>
      {label}
      {count !== undefined && (
        <span style={{ fontFamily: T.mono, fontSize: 10, padding: '1px 6px', borderRadius: 999, background: active ? 'rgba(255,255,255,0.18)' : T.mutedSoft, color: active ? 'white' : T.mutedFg }}>{count}</span>
      )}
    </button>
  );
}

function LineDetailCard({ line, model, sku, op, status, current, target, op_pct, operator, shift, alert, stages }) {
  const c = status === 'running' ? T.success : status === 'paused' ? T.warning : status === 'blocked' ? T.destructive : 'hsl(215 12% 60%)';
  return (
    <div style={{ background: 'white', borderRadius: T.r, padding: 0, overflow: 'hidden', boxShadow: T.shadowCard, border: `1px solid ${alert ? T.destructive : T.border}` }}>
      {/* Header */}
      <div style={{
        background: status === 'running' ? `linear-gradient(135deg, ${T.primary} 0%, hsl(162 90% 12%) 100%)` :
                    status === 'paused' ? `linear-gradient(135deg, hsl(38 60% 30%) 0%, hsl(38 80% 24%) 100%)` :
                    status === 'blocked' ? `linear-gradient(135deg, hsl(0 60% 35%) 0%, hsl(0 70% 28%) 100%)` :
                    `linear-gradient(135deg, hsl(215 20% 30%) 0%, hsl(215 25% 22%) 100%)`,
        color: 'white', padding: '16px 20px', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap', rowGap: 4 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', opacity: 0.7, whiteSpace: 'nowrap' }}>LINHA-{line}</span>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'white', opacity: 0.4, flexShrink: 0 }}/>
              <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700, opacity: 0.7, whiteSpace: 'nowrap' }}>TURNO {shift}</span>
              {status === 'running' && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: T.sans, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'hsl(160 80% 75%)', animation: 'pulse-slow 2s cubic-bezier(0.4, 0, 0.2, 1) infinite', boxShadow: '0 0 8px hsl(160 80% 75%)' }}/>
                  Ao vivo
                </span>
              )}
            </div>
            <div style={{ fontFamily: T.sans, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>{model}</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, opacity: 0.7, marginTop: 3 }}>{op} · {sku} · op. {operator}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {status === 'running' && <IconButton icon="pause" tone="light"/>}
            {status === 'paused' && <IconButton icon="play" tone="light"/>}
            <IconButton icon="more-horizontal" tone="light"/>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: 18 }}>
        {alert && (
          <div style={{ marginBottom: 14, padding: '8px 12px', borderRadius: 8, background: T.destructiveSoft, border: `1px solid hsl(0 84% 88%)`, display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.sans, fontSize: 12, color: T.destructiveFg, fontWeight: 600 }}>
            <i data-lucide="alert-octagon" style={{ width: 14, height: 14 }}></i>
            {alert}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={{ fontFamily: T.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mutedFg }}>OP — Progresso</span>
          <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.foreground }}>{current} / {target} <span style={{ color: T.mutedFg, fontWeight: 500 }}>pares</span></span>
        </div>
        <ProgressBar value={current} max={target} color={c} height={8}/>

        {/* Etapas */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontFamily: T.sans, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.mutedFg, marginBottom: 10 }}>Etapas</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {stages.map((s, i) => {
              const done = s.d === 100;
              const active = s.d > 0 && s.d < 100;
              return (
                <div key={s.n} style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
                    <div style={{ width: 16, height: 16, borderRadius: '50%', background: done ? T.success : active ? T.primary : T.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {done && <i data-lucide="check" style={{ width: 10, height: 10, color: 'white' }}></i>}
                      {active && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'white', animation: 'pulse-slow 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}/>}
                    </div>
                    <span style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, color: done || active ? T.foreground : T.mutedFg }}>{s.n}</span>
                  </div>
                  <div style={{ height: 3, background: T.muted, borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${s.d}%`, background: done ? T.success : T.primary, transition: 'width 600ms' }}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function IconButton({ icon, tone = 'default' }) {
  const [hov, setHov] = useState(false);
  const styles = tone === 'light'
    ? { bg: hov ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.1)', fg: 'white', bd: 'rgba(255,255,255,0.18)' }
    : { bg: hov ? T.mutedSoft : 'white', fg: T.foreground, bd: T.border };
  return (
    <button onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ width: 30, height: 30, borderRadius: 8, background: styles.bg, color: styles.fg, border: `1px solid ${styles.bd}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: T.transitionFast }}>
      <i data-lucide={icon} style={{ width: 14, height: 14 }}></i>
    </button>
  );
}

// Heatmap: turno x dia
function Heatmap() {
  const turnos = ['A · 06–14', 'B · 14–22', 'C · 22–06'];
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  // valores 0-100 (eficiência %)
  const data = [
    [88, 91, 89, 84, 92, 76, 0],
    [82, 85, 87, 79, 86, 70, 0],
    [74, 78, 75, 72, 80, 65, 0],
  ];
  const colorFor = (v) => {
    if (v === 0) return T.muted;
    if (v < 70) return 'hsl(0 84% 90%)';
    if (v < 80) return 'hsl(38 92% 88%)';
    if (v < 88) return 'hsl(162 50% 80%)';
    return 'hsl(162 80% 55%)';
  };
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '90px repeat(7, 1fr)', gap: 6, alignItems: 'center' }}>
        <div/>
        {dias.map(d => <div key={d} style={{ fontFamily: T.sans, fontSize: 10, fontWeight: 600, color: T.mutedFg, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{d}</div>)}
        {turnos.map((t, ti) => (
          <React.Fragment key={t}>
            <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.foreground }}>{t}</div>
            {data[ti].map((v, di) => (
              <div key={di} style={{ aspectRatio: '1.6/1', borderRadius: 8, background: colorFor(v), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: v === 0 ? T.mutedFg : v < 70 ? T.destructiveFg : v < 80 ? T.warningFg : v < 88 ? T.successFg : 'white', cursor: 'pointer', transition: 'transform 150ms cubic-bezier(0.4, 0, 0.2, 1)', position: 'relative' }}
                title={`${t} · ${dias[di]} · ${v}%`}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.06)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                {v === 0 ? '—' : `${v}`}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 14, fontFamily: T.sans, fontSize: 11, color: T.mutedFg }}>
        <span>Eficiência:</span>
        <Legend color="hsl(0 84% 90%)" label="<70%"/>
        <Legend color="hsl(38 92% 88%)" label="70–80%"/>
        <Legend color="hsl(162 50% 80%)" label="80–88%"/>
        <Legend color="hsl(162 80% 55%)" label=">88%"/>
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 12, height: 12, borderRadius: 4, background: color }}/>
      {label}
    </span>
  );
}

export { ProducaoScreen };
