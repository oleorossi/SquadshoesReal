import React, { useState, useEffect, useRef, useMemo } from 'react';
import { T, Btn, StatusPill, KpiCard, ProgressBar, DataTable, LineCard, Alert, Panel, BarChart, StockBar, Timeline } from './Components';

// Squad Shoes Factory OS — Painel
function Dashboard() {
  const lines = [
    { line: 'LINHA-A1', model: 'Sandália 04 — Caramelo', sku: 'SD04-CRM-36', status: 'running', current: 287, target: 420, operator: 'Maria S.', eta: '16:40', stage: 'Costura' },
    { line: 'LINHA-A2', model: 'Scarpin 02 — Preto',     sku: 'SC02-PRT-37', status: 'running', current: 354, target: 380, operator: 'André P.', eta: '15:20', stage: 'Acabamento' },
    { line: 'LINHA-B1', model: 'Bota 03 — Bordô',        sku: 'BT03-BRD-38', status: 'paused',  current: 142, target: 300, operator: 'Sofia R.', eta: '—',    stage: 'Montagem', alert: true },
    { line: 'LINHA-B2', model: 'Sapatilha 01 — Nude',    sku: 'SP01-NUD-35', status: 'queued',  current: 0,   target: 200, operator: 'Bruno C.', eta: '17:00', stage: 'Corte' },
  ];

  const woColumns = [
    { key: 'id',      label: 'OP',       sortable: true, render: r => <span style={{ fontFamily: T.mono, fontWeight: 700, color: T.foreground }}>{r.id}</span> },
    { key: 'sku',     label: 'Modelo / SKU', render: r => <div><div style={{ fontWeight: 600 }}>{r.model}</div><div style={{ fontFamily: T.mono, fontSize: 11, color: T.mutedFg }}>{r.sku}</div></div> },
    { key: 'qty',     label: 'Pares', align: 'right', render: r => <span style={{ fontFamily: T.mono, fontWeight: 600 }}>{r.qty}</span> },
    { key: 'progress',label: 'Progresso', render: r => <div style={{ minWidth: 140 }}><ProgressBar value={r.done} max={r.qty} showLabel/></div> },
    { key: 'due',     label: 'Vence',  render: r => <span style={{ fontFamily: T.mono, fontSize: 12, color: r.late ? T.destructive : T.foreground, fontWeight: r.late ? 700 : 500 }}>{r.due}</span> },
    { key: 'status',  label: 'Status', render: r => <StatusPill status={r.status}/> },
    { key: 'a',       label: '',       render: () => <i data-lucide="more-horizontal" style={{ width: 16, height: 16, color: T.mutedFg }}></i> },
  ];
  const woRows = [
    { id: 'OP-2847', model: 'Sandália 04 — Caramelo',  sku: 'SD04-CRM-36', qty: 420, done: 287, due: 'Hoje, 18:00', status: 'running' },
    { id: 'OP-2846', model: 'Scarpin 02 — Preto',      sku: 'SC02-PRT-37', qty: 380, done: 354, due: 'Hoje, 17:30', status: 'running' },
    { id: 'OP-2845', model: 'Bota 03 — Bordô',         sku: 'BT03-BRD-38', qty: 300, done: 142, due: 'Hoje, 19:00', status: 'blocked', late: true },
    { id: 'OP-2844', model: 'Sapatilha 01 — Nude',     sku: 'SP01-NUD-35', qty: 200, done: 0,   due: 'Amanhã, 12:00', status: 'queued' },
    { id: 'OP-2843', model: 'Mule 02 — Off-white',     sku: 'ML02-OFF-37', qty: 600, done: 600, due: 'Ontem',     status: 'done' },
    { id: 'OP-2842', model: 'Tênis 01 — Verde militar',sku: 'TN01-VRD-38', qty: 250, done: 250, due: '12/04',     status: 'qc' },
  ];

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }} className="page-enter">
      <Alert kind="danger"
        title="Linha B1 parada — temperatura da cola fora da faixa"
        body="Sensor em 142°C (alvo 168°C ± 4°C). Produção pausada há 18 min. Chamado #M-1284 aberto para manutenção."
        action="Ver chamado →"/>

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard kind="featured" icon="trending-up" label="Pares hoje" value="2.847" unit="pares" delta="+8,4%" deltaLabel="vs ontem" spark={[2400, 2520, 2380, 2610, 2580, 2710, 2847]}/>
        <KpiCard icon="gauge" label="OEE" value="84,2" unit="%" delta="+1,6%" deltaLabel="vs sem. ant." spark={[78, 80, 82, 81, 83, 82, 84]}/>
        <KpiCard icon="shield-check" label="FPY" value="96,4" unit="%" delta="-0,8%" deltaLabel="vs alvo" spark={[97, 97, 96, 96, 97, 96, 96]}/>
        <KpiCard icon="calendar-check" label="No prazo" value="92" unit="%" delta="+3,1%" deltaLabel="este mês" spark={[88, 89, 90, 88, 91, 92, 92]}/>
      </div>

      {/* Linhas de produção */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: T.sans, fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em' }}>Linhas de produção · ao vivo</div>
            <div style={{ fontFamily: T.sans, fontSize: 12, color: T.mutedFg, marginTop: 2 }}>4 linhas ativas · turno A — atualizado há 12s</div>
          </div>
          <Btn variant="ghost" size="sm" iconRight="external-link">Ver mapa do chão</Btn>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {lines.map(l => <LineCard key={l.line} {...l}/>)}
        </div>
      </div>

      {/* OPs + widgets */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <Panel title="Ordens de produção ativas" subtitle="Atualizado há 1 min"
          action={<div style={{ display: 'flex', gap: 6 }}><Btn variant="ghost" size="sm" icon="filter">Filtrar</Btn><Btn variant="primary" size="sm" icon="plus">Nova OP</Btn></div>}
          padding={0}>
          <DataTable columns={woColumns} rows={woRows} selectable/>
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Panel title="Pares por dia" subtitle="Últimos 7 dias">
            <BarChart data={[2400, 2520, 2380, 2610, 2580, 2710, 2847]} labels={['Seg','Ter','Qua','Qui','Sex','Sáb','Hoje']} highlightLast/>
          </Panel>
          <Panel title="Atividade do turno" subtitle="Hoje · Planta 02">
            <Timeline events={[
              { kind: 'alert',   time: '14:32', title: 'Linha B1 pausada', body: 'Alerta de temperatura da cola' },
              { kind: 'success', time: '13:45', title: 'OP-2842 enviada para QC', body: '250 pares · Tênis 01 verde militar' },
              { kind: 'shift',   time: '12:00', title: 'Pausa do turno A', body: '30 min · 142 colaboradores' },
              { kind: 'event',   time: '10:14', title: 'OP-2848 criada', body: 'Sandália 02 — preta · 350 pares' },
              { kind: 'shift',   time: '06:00', title: 'Início do turno A', body: 'Linhas A1, A2, B1, B2' },
            ]}/>
          </Panel>
        </div>
      </div>

      {/* Materiais em risco */}
      <Panel title="Materiais em risco" subtitle="Abaixo do ponto de pedido ou em queda" padding={0}
        action={<Btn variant="ghost" size="sm" iconRight="arrow-right">Ver todos os materiais</Btn>}>
        <DataTable
          columns={[
            { key: 'sku',     label: 'Material', render: r => <div><div style={{ fontWeight: 600 }}>{r.name}</div><div style={{ fontFamily: T.mono, fontSize: 11, color: T.mutedFg }}>{r.sku}</div></div> },
            { key: 'stock',   label: 'Estoque', render: r => <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><StockBar value={r.qty} min={r.min} max={r.max}/><span style={{ fontFamily: T.mono, fontSize: 12 }}>{r.qty} {r.unit}</span></div> },
            { key: 'days',    label: 'Dias rest.', align: 'right', render: r => <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: r.days < 3 ? T.destructive : r.days < 7 ? T.warning : T.foreground }}>{r.days}d</span> },
            { key: 'supplier',label: 'Fornecedor', render: r => <span style={{ fontFamily: T.sans, fontSize: 12 }}>{r.supplier}</span> },
            { key: 'lead',    label: 'Lead time', render: r => <span style={{ fontFamily: T.mono, fontSize: 12 }}>{r.lead}</span> },
            { key: 'status',  label: '', render: r => <StatusPill status={r.status}/> },
            { key: 'act',     label: '', render: () => <Btn variant="ghost" size="sm">Pedir</Btn> },
          ]}
          rows={[
            { id: 1, sku: 'COU-CRM-001', name: 'Couro caramelo (1.4 mm)',     qty: 142,  min: 200,  max: 1000, unit: 'm²',    days: 2, supplier: 'Curtume Bahia',     lead: '4 dias', status: 'low' },
            { id: 2, sku: 'SLT-PRT-002', name: 'Solado TR preto nº 35-40',   qty: 38,   min: 80,   max: 400,  unit: 'pares', days: 1, supplier: 'Borrachas Franca', lead: '7 dias', status: 'out' },
            { id: 3, sku: 'PLM-EVA-STD', name: 'Palmilha EVA — padrão',       qty: 480,  min: 300,  max: 1500, unit: 'unid',  days: 9, supplier: 'EVA Brasil',       lead: '5 dias', status: 'ok' },
            { id: 4, sku: 'FIV-AUR-001', name: 'Fivela dourada — 18 mm',      qty: 1240, min: 2000, max: 8000, unit: 'unid',  days: 4, supplier: 'Metais Caxias',    lead: '3 dias', status: 'low' },
          ]}/>
      </Panel>
    </div>
  );
}

export { Dashboard };
