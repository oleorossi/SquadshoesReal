import React, { useState, useEffect, useRef, useMemo } from 'react';
import { T, Btn, StatusPill, KpiCard, ProgressBar, DataTable, Panel, StageBadge } from './Components';

// Squad Shoes Factory OS — Tela: Ordens de Produção
function OrdensScreen() {
  const ops = [
    { id: 'OP-2847', model: 'Sandália 04 — Caramelo', sku: 'SD04-CRM-36', qty: 420, done: 287, due: '30/04 · 18:00', priority: 'urgent', status: 'running', stage: 'COSTURA', line: 'A1', client: 'Rede Bella' },
    { id: 'OP-2846', model: 'Scarpin 02 — Preto',     sku: 'SC02-PRT-37', qty: 380, done: 354, due: '30/04 · 17:30', priority: 'high',   status: 'running', stage: 'ACABAMENTO', line: 'A2', client: 'Lojas Carmen' },
    { id: 'OP-2845', model: 'Bota 03 — Bordô',        sku: 'BT03-BRD-38', qty: 300, done: 142, due: '30/04 · 19:00', priority: 'urgent', status: 'blocked', stage: 'MONTAGEM',   line: 'B1', client: 'Couro & Cia' },
    { id: 'OP-2844', model: 'Sapatilha 01 — Nude',    sku: 'SP01-NUD-35', qty: 200, done: 0,   due: '01/05 · 12:00', priority: 'medium', status: 'queued',  stage: 'CORTE',      line: 'B2', client: 'Atacado SP' },
    { id: 'OP-2843', model: 'Mule 02 — Off-white',    sku: 'ML02-OFF-37', qty: 600, done: 600, due: '29/04',         priority: 'low',    status: 'done',    stage: 'EMBALAGEM',  line: '—',  client: 'Rede Bella' },
    { id: 'OP-2842', model: 'Tênis 01 — Verde mil.',  sku: 'TN01-VRD-38', qty: 250, done: 250, due: '12/04',         priority: 'low',    status: 'qc',      stage: 'EMBALAGEM',  line: '—',  client: 'Lojas Carmen' },
    { id: 'OP-2841', model: 'Anabela 01 — Caramelo',  sku: 'AN01-CRM-36', qty: 480, done: 0,   due: '03/05 · 14:00', priority: 'medium', status: 'queued',  stage: 'CORTE',      line: '—',  client: 'Atacado SP' },
    { id: 'OP-2840', model: 'Coturno 01 — Preto',     sku: 'CT01-PRT-37', qty: 320, done: 0,   due: '04/05 · 10:00', priority: 'low',    status: 'queued',  stage: 'CORTE',      line: '—',  client: 'Couro & Cia' },
  ];

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }} className="page-enter">
      {/* KPIs resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard icon="clipboard-list" label="OPs ativas"   value="12"  delta="+2"  deltaLabel="vs ontem"/>
        <KpiCard icon="alert-triangle" label="Atrasadas"    value="3"   delta="+1"  deltaLabel="hoje" />
        <KpiCard icon="package"        label="Pares totais" value="3.450" unit="pares" delta="+8%" deltaLabel="semana"/>
        <KpiCard icon="calendar"       label="Para hoje"    value="5"   delta="—"  deltaLabel="OPs"/>
      </div>

      {/* Filtros + ações */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {[
            { l: 'Todas',     n: 12, a: true },
            { l: 'Urgentes',  n: 2 },
            { l: 'Em produção', n: 4 },
            { l: 'Bloqueadas',  n: 1 },
            { l: 'Na fila',     n: 5 },
            { l: 'Concluídas',  n: 0 },
          ].map(f => <Chip key={f.l} label={f.l} count={f.n} active={f.a}/>)}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 'auto' }}>
          <Btn variant="ghost" size="sm" icon="download">Exportar</Btn>
          <Btn variant="ghost" size="sm" icon="filter">Filtros</Btn>
          <Btn variant="primary" size="sm" icon="plus">Nova OP</Btn>
        </div>
      </div>

      {/* Kanban resumido + tabela detalhada */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <KanbanColumn title="Na fila"      count={5} accent={T.info}        items={ops.filter(o => o.status === 'queued').slice(0,3)}/>
        <KanbanColumn title="Em produção"  count={4} accent={T.success} live items={ops.filter(o => o.status === 'running')}/>
        <KanbanColumn title="Bloqueadas"   count={1} accent={T.destructive} items={ops.filter(o => o.status === 'blocked')}/>
        <KanbanColumn title="QC"           count={1} accent={'hsl(269 60% 55%)'} items={ops.filter(o => o.status === 'qc')}/>
        <KanbanColumn title="Concluídas"   count={1} accent={T.mutedFg}     items={ops.filter(o => o.status === 'done')}/>
      </div>

      {/* Tabela com prioridade + cliente */}
      <Panel title="Lista detalhada" subtitle={`${ops.length} ordens · ordenado por prioridade`} padding={0}>
        <DataTable
          columns={[
            { key: 'id', label: 'OP', sortable: true, render: r => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PriorityIndicator level={r.priority}/>
                <span style={{ fontFamily: T.mono, fontWeight: 700 }}>{r.id}</span>
              </div>
            )},
            { key: 'model', label: 'Modelo / SKU', render: r => <div><div style={{ fontWeight: 600 }}>{r.model}</div><div style={{ fontFamily: T.mono, fontSize: 11, color: T.mutedFg }}>{r.sku}</div></div> },
            { key: 'client',label: 'Cliente', render: r => <span style={{ fontFamily: T.sans, fontSize: 12 }}>{r.client}</span> },
            { key: 'stage', label: 'Etapa', render: r => <StageBadge stage={r.stage}/> },
            { key: 'line',  label: 'Linha', align: 'center', render: r => <span style={{ fontFamily: T.mono, fontWeight: 600, fontSize: 12, color: r.line === '—' ? T.mutedFg : T.foreground }}>{r.line}</span> },
            { key: 'progress', label: 'Progresso', render: r => <div style={{ minWidth: 140 }}><ProgressBar value={r.done} max={r.qty} showLabel/></div> },
            { key: 'due',   label: 'Vence', render: r => <span style={{ fontFamily: T.mono, fontSize: 12 }}>{r.due}</span> },
            { key: 'status',label: 'Status', render: r => <StatusPill status={r.status}/> },
          ]}
          rows={ops}
          selectable/>
      </Panel>
    </div>
  );
}

function KanbanColumn({ title, count, accent, live, items }) {
  return (
    <div style={{ background: 'white', borderRadius: T.r, border: `1px solid ${T.border}`, padding: 12, boxShadow: T.shadowCard, minHeight: 260, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.borderSoft}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, ...(live ? { boxShadow: `0 0 8px ${accent}`, animation: 'pulse-slow 2s cubic-bezier(0.4, 0, 0.2, 1) infinite' } : {}) }}/>
          <span style={{ fontFamily: T.sans, fontSize: 12, fontWeight: 700, color: T.foreground }}>{title}</span>
        </div>
        <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: T.mutedSoft, color: T.foreground }}>{count}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {items.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.sans, fontSize: 11, color: T.mutedFg, fontStyle: 'italic' }}>Sem itens</div>
        ) : items.map(it => <KanbanCard key={it.id} {...it}/>)}
      </div>
    </div>
  );
}

function KanbanCard({ id, model, sku, qty, done, priority, due }) {
  const pct = (done / qty) * 100;
  return (
    <div style={{ background: T.mutedSoft, borderRadius: 10, padding: 10, border: `1px solid ${T.borderSoft}`, cursor: 'grab', transition: T.transitionFast }}
      onMouseEnter={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.boxShadow = T.shadowCard; e.currentTarget.style.transform = 'translateY(-1px)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = T.mutedSoft; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)'; }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
        <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.foreground, letterSpacing: '0.04em', flexShrink: 0 }}>{id}</span>
        <span style={{ flexShrink: 0 }}><PriorityIndicator level={priority}/></span>
      </div>
      <div style={{ fontFamily: T.sans, fontSize: 12, fontWeight: 600, color: T.foreground, lineHeight: 1.3 }}>{model}</div>
      <div style={{ fontFamily: T.mono, fontSize: 10, color: T.mutedFg, marginTop: 2 }}>{sku}</div>
      <div style={{ marginTop: 8 }}>
        <ProgressBar value={done} max={qty} height={4}/>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontFamily: T.mono, fontSize: 10, color: T.mutedFg }}>
          <span>{done}/{qty}</span>
          <span>{due}</span>
        </div>
      </div>
    </div>
  );
}

function PriorityIndicator({ level }) {
  const map = {
    urgent:  { color: T.destructive, label: 'Urgente', bars: 4 },
    high:    { color: T.warning,     label: 'Alta',    bars: 3 },
    medium:  { color: T.info,        label: 'Média',   bars: 2 },
    low:     { color: 'hsl(215 12% 60%)', label: 'Baixa', bars: 1 },
  };
  const c = map[level] || map.low;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 1.5, height: 11 }} title={c.label}>
      {[1,2,3,4].map(i => (
        <span key={i} style={{ width: 2.5, height: i * 2.5 + 'px', background: i <= c.bars ? c.color : T.muted, borderRadius: 1 }}/>
      ))}
    </span>
  );
}

export { OrdensScreen };
