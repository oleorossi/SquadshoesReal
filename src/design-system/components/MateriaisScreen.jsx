import React, { useState, useEffect, useRef, useMemo } from 'react';
import { T, Btn, StatusPill, KpiCard, DataTable, Panel, StockBar } from './Components';

// Squad Shoes Factory OS — Tela: Estoque de Materiais
function MateriaisScreen() {
  const cats = [
    { name: 'Couro',         icon: 'square-stack',     count: 14, low: 2, color: 'hsl(28 70% 50%)' },
    { name: 'Sintético',     icon: 'layers-2',         count: 9,  low: 0, color: 'hsl(217 91% 55%)' },
    { name: 'Solado',        icon: 'footprints',       count: 22, low: 1, color: 'hsl(269 60% 55%)' },
    { name: 'Palmilha',      icon: 'package-2',        count: 8,  low: 0, color: 'hsl(162 80% 35%)' },
    { name: 'Aviamentos',    icon: 'gem',              count: 36, low: 1, color: 'hsl(50 70% 45%)' },
    { name: 'Embalagem',     icon: 'box',              count: 5,  low: 0, color: 'hsl(215 30% 40%)' },
  ];

  const materiais = [
    { id: 1, sku: 'COU-CRM-001', name: 'Couro caramelo (1.4 mm)',         cat: 'Couro',      qty: 142,  min: 200,  max: 1000, unit: 'm²',    days: 2,  supplier: 'Curtume Bahia',     lead: '4 dias', status: 'low' },
    { id: 2, sku: 'COU-PRT-002', name: 'Couro preto (1.6 mm)',            cat: 'Couro',      qty: 920,  min: 200,  max: 1000, unit: 'm²',    days: 28, supplier: 'Curtume Bahia',     lead: '4 dias', status: 'ok' },
    { id: 3, sku: 'SLT-PRT-035', name: 'Solado TR preto · 33-40',         cat: 'Solado',     qty: 38,   min: 80,   max: 400,  unit: 'pares', days: 1,  supplier: 'Borrachas Franca', lead: '7 dias', status: 'out' },
    { id: 4, sku: 'SLT-CRM-036', name: 'Solado anabela caramelo · 33-40', cat: 'Solado',     qty: 280,  min: 100,  max: 500,  unit: 'pares', days: 18, supplier: 'Borrachas Franca', lead: '7 dias', status: 'ok' },
    { id: 5, sku: 'PLM-EVA-STD', name: 'Palmilha EVA — padrão',           cat: 'Palmilha',   qty: 480,  min: 300,  max: 1500, unit: 'unid',  days: 9,  supplier: 'EVA Brasil',       lead: '5 dias', status: 'ok' },
    { id: 6, sku: 'FIV-AUR-018', name: 'Fivela dourada · 18 mm',          cat: 'Aviamentos', qty: 1240, min: 2000, max: 8000, unit: 'unid',  days: 4,  supplier: 'Metais Caxias',    lead: '3 dias', status: 'low' },
    { id: 7, sku: 'FIO-PRT-040', name: 'Linha poliéster preta · 40g',     cat: 'Aviamentos', qty: 320,  min: 100,  max: 500,  unit: 'cones', days: 22, supplier: 'TexFio',           lead: '2 dias', status: 'ok' },
    { id: 8, sku: 'CXP-PRD-001', name: 'Caixa pardelão 33×22×12',         cat: 'Embalagem',  qty: 2400, min: 1500, max: 8000, unit: 'unid',  days: 14, supplier: 'CartonSul',        lead: '5 dias', status: 'ok' },
  ];

  const [selectedCat, setSelectedCat] = useState(null);

  return (
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }} className="page-enter">
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <KpiCard kind="featured" icon="package" label="Itens cadastrados" value="94" unit="SKUs" delta="+3" deltaLabel="este mês"/>
        <KpiCard icon="alert-triangle" label="Em alerta"  value="4"   delta="+1"  deltaLabel="hoje"/>
        <KpiCard icon="x-circle"       label="Esgotados"  value="1"   delta="—"   deltaLabel=""/>
        <KpiCard icon="dollar-sign"    label="Valor estoq." value="R$ 1,84M" delta="+2,1%" deltaLabel="vs sem. ant."/>
      </div>

      {/* Categorias */}
      <div>
        <div style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 700, marginBottom: 10, letterSpacing: '-0.01em' }}>Categorias</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          {cats.map(c => (
            <CategoryCard key={c.name} {...c} active={selectedCat === c.name} onClick={() => setSelectedCat(selectedCat === c.name ? null : c.name)}/>
          ))}
        </div>
      </div>

      {/* Filtros + tabela */}
      <Panel title="Inventário" subtitle={`${materiais.length} materiais${selectedCat ? ` · ${selectedCat}` : ''}`} padding={0}
        action={<div style={{ display: 'flex', gap: 8 }}>
          <Btn variant="ghost" size="sm" icon="filter">Filtrar</Btn>
          <Btn variant="ghost" size="sm" icon="download">Exportar</Btn>
          <Btn variant="primary" size="sm" icon="plus">Adicionar material</Btn>
        </div>}>
        <DataTable
          columns={[
            { key: 'name', label: 'Material', render: r => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: T.mutedSoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <i data-lucide={cats.find(c => c.name === r.cat)?.icon || 'package'} style={{ width: 16, height: 16, color: cats.find(c => c.name === r.cat)?.color || T.mutedFg }}></i>
                </div>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 11, color: T.mutedFg }}>{r.sku} · {r.cat}</div>
                </div>
              </div>
            )},
            { key: 'stock', label: 'Estoque atual', render: r => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <StockBar value={r.qty} min={r.min} max={r.max}/>
                <span style={{ fontFamily: T.mono, fontSize: 12 }}>{r.qty.toLocaleString('pt-BR')} <span style={{ color: T.mutedFg }}>{r.unit}</span></span>
              </div>
            )},
            { key: 'days', label: 'Dias restantes', align: 'right', render: r => (
              <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: r.days < 3 ? T.destructive : r.days < 7 ? T.warning : T.foreground }}>{r.days} d</span>
            )},
            { key: 'supplier', label: 'Fornecedor', render: r => <span style={{ fontFamily: T.sans, fontSize: 12 }}>{r.supplier}</span> },
            { key: 'lead', label: 'Lead time', render: r => <span style={{ fontFamily: T.mono, fontSize: 12, color: T.mutedFg }}>{r.lead}</span> },
            { key: 'status', label: 'Status', render: r => <StatusPill status={r.status}/> },
            { key: 'act', label: '', render: r => r.status === 'ok' ? <Btn variant="ghost" size="sm">Detalhes</Btn> : <Btn variant="primary" size="sm" icon="shopping-cart">Pedir</Btn> },
          ]}
          rows={selectedCat ? materiais.filter(m => m.cat === selectedCat) : materiais}
          selectable/>
      </Panel>
    </div>
  );
}

function CategoryCard({ name, icon, count, low, color, active, onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        background: active ? `linear-gradient(135deg, ${color} 0%, hsl(from ${color} h s calc(l - 8%)) 100%)` : 'white',
        border: `1px solid ${active ? 'transparent' : T.border}`,
        borderRadius: T.r,
        padding: 14,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 220ms cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: active ? `0 12px 28px -6px ${color}66` : hov ? T.shadowHover : T.shadowCard,
        transform: hov && !active ? 'translateY(-2px)' : 'translateY(0)',
        color: active ? 'white' : T.foreground,
        position: 'relative', overflow: 'hidden',
      }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: active ? 'rgba(255,255,255,0.2)' : `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i data-lucide={icon} style={{ width: 18, height: 18, color: active ? 'white' : color }}></i>
        </div>
        {low > 0 && (
          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: active ? 'rgba(255,255,255,0.2)' : T.destructiveSoft, color: active ? 'white' : T.destructiveFg, letterSpacing: '0.05em' }}>{low} BAIXO</span>
        )}
      </div>
      <div style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 700 }}>{name}</div>
      <div style={{ fontFamily: T.mono, fontSize: 11, color: active ? 'rgba(255,255,255,0.7)' : T.mutedFg, marginTop: 2 }}>{count} SKUs</div>
    </button>
  );
}

export { MateriaisScreen };
