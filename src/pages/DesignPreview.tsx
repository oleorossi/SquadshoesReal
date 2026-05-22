/**
 * Design Preview — Industrial Editorial Pro
 *
 * Mockups visuais pra validar direção estética antes de aplicar
 * no Technical Sheets / Operator Worksheets de verdade.
 *
 * Rota: /design-preview (standalone, sem AppLayout)
 *
 * Princípios da direção:
 *   - Tipografia: Anton (display uppercase) + Inter Tight (body) + JetBrains Mono (numeric)
 *   - Bordas decisivas 1-2px em vez de shadow-sm / gradients
 *   - Accent: vermelho squad SÓ pra estados ativos / ações primárias
 *   - Eyebrow labels 10px tracking-widest uppercase
 *   - Grid assimétrico (cols 3/5/8)
 *   - Mono tabular pra códigos, OPs, datas, valores
 *   - Sem rounded-xl arredondado demais (max rounded-sm)
 *
 * Atalhos visuais usados nesse arquivo:
 *   - .ed-display  → fonte Anton
 *   - .ed-body     → fonte Inter Tight
 *   - .ed-mono     → fonte JetBrains Mono (tabular)
 *   - .ed-eyebrow  → label categoria
 */
import { useState } from 'react';
import {
  Scissors,
  Hammer,
  Footprints,
  Stack as Layers,
  PaintBrush,
  GridFour,
  Sparkle,
  Wind,
  Truck,
  Pen,
  Pencil,
  Plus,
  ArrowUpRight,
  Funnel,
  MagnifyingGlass,
  Printer,
  CheckCircle,
  Warning,
  Eye,
  CaretRight,
  Tag,
  Package,
  Ruler,
  Calculator,
  Hash,
  Download,
} from '@phosphor-icons/react';

const ed = {
  display: { fontFamily: "'Anton', Impact, sans-serif", letterSpacing: '-0.02em', textTransform: 'uppercase' as const },
  body: { fontFamily: "'Inter Tight', system-ui, sans-serif" },
  mono: { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' as const },
};

const SQUAD_RED = '#D9264E';
const INK = '#0A0A0A';
const PAPER = '#FAFAF7';
const RULE = '#0A0A0A';

export default function DesignPreview() {
  const [tab, setTab] = useState<'lista' | 'editor' | 'operator'>('lista');

  return (
    <div className="min-h-screen" style={{ background: PAPER, color: INK, ...ed.body }}>
      {/* Fixed nav between mockups */}
      <DesignNav active={tab} onChange={setTab} />

      <div className="max-w-[1400px] mx-auto px-6 py-10">
        {tab === 'lista' && <MockupListaFichas />}
        {tab === 'editor' && <MockupEditorFicha />}
        {tab === 'operator' && <MockupOperatorPrint />}
      </div>

      <FooterMarker />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top navigation between mockups
// ---------------------------------------------------------------------------
function DesignNav({
  active,
  onChange,
}: {
  active: 'lista' | 'editor' | 'operator';
  onChange: (t: 'lista' | 'editor' | 'operator') => void;
}) {
  const tabs: Array<{ key: typeof active; n: string; label: string }> = [
    { key: 'lista', n: '01', label: 'Lista · Fichas Técnicas' },
    { key: 'editor', n: '02', label: 'Editor · Ficha Técnica' },
    { key: 'operator', n: '03', label: 'Operador · Print Worksheet' },
  ];

  return (
    <header
      className="sticky top-0 z-50 border-b-2 px-6 py-3 flex items-center gap-6 backdrop-blur"
      style={{ background: 'rgba(250,250,247,0.92)', borderColor: RULE }}
    >
      <div className="flex items-baseline gap-3">
        <span style={ed.display} className="text-[26px] leading-none">
          Squad<span style={{ color: SQUAD_RED }}>·</span>Design
        </span>
        <span style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">
          v0 · industrial editorial pro
        </span>
      </div>

      <div className="flex-1 flex items-stretch gap-0 border-l border-r" style={{ borderColor: RULE }}>
        {tabs.map((t, i) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              className="flex-1 px-4 py-1.5 text-left transition-colors border-r last:border-r-0 group"
              style={{
                borderColor: RULE,
                background: isActive ? INK : 'transparent',
                color: isActive ? PAPER : INK,
              }}
            >
              <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-70">
                {t.n}
              </div>
              <div style={ed.display} className="text-[15px] leading-tight">
                {t.label}
              </div>
            </button>
          );
        })}
      </div>

      <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">
        2026 · SQS
      </div>
    </header>
  );
}

function FooterMarker() {
  return (
    <footer
      className="border-t-2 px-6 py-4 flex items-center justify-between text-[10px] tracking-widest uppercase"
      style={{ borderColor: RULE, ...ed.mono }}
    >
      <span>FICHA · OPERADOR · GESTÃO</span>
      <span>SQUADSHOES · FÁBRICA DE CALÇADOS</span>
      <span>VERSÃO PREVIEW · NÃO PRODUTIVA</span>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Mockup 1 — Lista de Fichas Técnicas
// ---------------------------------------------------------------------------
function MockupListaFichas() {
  const stats = [
    { label: 'Fichas Ativas', value: '127', delta: '+3 esta semana' },
    { label: 'Em Revisão', value: '08', delta: '2 vencendo' },
    { label: 'Sem custo', value: '14', delta: 'Calcular' },
    { label: 'Custo Médio', value: 'R$ 38,72', delta: 'Mês corrente' },
  ];

  const fichas = [
    { ref: 'SP 10', name: 'Plataforma Casual', group: 'Plataforma', revisao: 'v4', updated: '21/05/26', cost: 'R$ 42,80', status: 'ok' },
    { ref: 'CF 07', name: 'Sandália Boneca',   group: 'Boneca',     revisao: 'v2', updated: '18/05/26', cost: 'R$ 36,90', status: 'warn' },
    { ref: 'SS 22', name: 'Mocassim Couro',    group: 'Mocassim',   revisao: 'v1', updated: '14/05/26', cost: 'R$ 28,40', status: 'ok' },
    { ref: 'BT 03', name: 'Bota Coturno Cano Curto', group: 'Bota', revisao: 'v6', updated: '12/05/26', cost: 'R$ 64,20', status: 'ok' },
    { ref: 'CF 09', name: 'Anabela Cordão',    group: 'Anabela',    revisao: 'v1', updated: '09/05/26', cost: '—',        status: 'pending' },
    { ref: 'SP 14', name: 'Tamanco Esportivo', group: 'Tamanco',    revisao: 'v3', updated: '06/05/26', cost: 'R$ 31,10', status: 'ok' },
  ];

  return (
    <section className="space-y-8">
      {/* Page header */}
      <div className="grid grid-cols-12 gap-6 items-end">
        <div className="col-span-12 md:col-span-7">
          <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60 mb-2">
            CATÁLOGO · 03 / 24 · ENGENHARIA DE PRODUTO
          </div>
          <h1 style={ed.display} className="text-[68px] leading-[0.88]">
            FICHAS<br />
            <span style={{ color: SQUAD_RED }}>TÉCNICAS</span>
          </h1>
          <p className="mt-3 max-w-[480px] text-[14px] leading-relaxed opacity-80">
            Cadastro de receitas de produção. Toda OP herda os parâmetros de consumo,
            capacidades por setor e estrutura de embalagem definidos aqui.
          </p>
        </div>

        <div className="col-span-12 md:col-span-5 grid grid-cols-2 gap-px"
             style={{ background: RULE, border: `2px solid ${RULE}` }}>
          {stats.map((s) => (
            <div key={s.label} className="p-4" style={{ background: PAPER }}>
              <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">
                {s.label}
              </div>
              <div style={ed.display} className="text-[42px] leading-none mt-1">
                {s.value}
              </div>
              <div className="text-[11px] mt-2 opacity-70">{s.delta}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-stretch border-y-2" style={{ borderColor: RULE }}>
        <div className="flex items-center gap-2 flex-1 px-3 py-2 border-r" style={{ borderColor: RULE }}>
          <MagnifyingGlass className="h-4 w-4" weight="bold" />
          <input
            placeholder="Buscar por referência, nome ou grupo…"
            className="bg-transparent outline-none flex-1 text-[14px]"
          />
          <span style={ed.mono} className="text-[10px] tracking-widest opacity-50 uppercase">
            ⌘K
          </span>
        </div>
        <button className="px-4 flex items-center gap-2 text-[12px] uppercase tracking-widest border-r"
                style={{ borderColor: RULE, ...ed.mono }}>
          <Funnel weight="bold" className="h-3.5 w-3.5" /> Filtros · 2
        </button>
        <button className="px-4 flex items-center gap-2 text-[12px] uppercase tracking-widest border-r"
                style={{ borderColor: RULE, ...ed.mono }}>
          <Download weight="bold" className="h-3.5 w-3.5" /> CSV
        </button>
        <button className="px-5 flex items-center gap-2 text-[13px] uppercase tracking-widest font-semibold"
                style={{ background: SQUAD_RED, color: PAPER, ...ed.mono }}>
          <Plus weight="bold" className="h-3.5 w-3.5" /> Nova Ficha
        </button>
      </div>

      {/* Table */}
      <div className="border-2" style={{ borderColor: RULE }}>
        <div className="grid grid-cols-[80px_1.4fr_1fr_80px_110px_120px_120px] items-center px-4 py-2 border-b-2"
             style={{ borderColor: RULE, background: INK, color: PAPER, ...ed.mono, fontSize: 10, letterSpacing: '0.14em' }}>
          <span>REF</span>
          <span>PRODUTO</span>
          <span>GRUPO</span>
          <span className="text-right">REV</span>
          <span className="text-right">ATUALIZADO</span>
          <span className="text-right">CUSTO</span>
          <span className="text-right pr-2">AÇÕES</span>
        </div>

        {fichas.map((f, i) => (
          <div
            key={f.ref}
            className="grid grid-cols-[80px_1.4fr_1fr_80px_110px_120px_120px] items-center px-4 py-3 border-b last:border-b-0 group hover:bg-black/[0.03] transition-colors"
            style={{ borderColor: 'rgba(10,10,10,0.10)' }}
          >
            <span style={ed.mono} className="text-[14px] font-bold">
              {f.ref}
            </span>
            <div>
              <div className="text-[15px] leading-tight font-medium">{f.name}</div>
              <div className="text-[11px] opacity-50">Ficha #{(2000 + i).toString().padStart(4, '0')}</div>
            </div>
            <span className="text-[13px] opacity-80">{f.group}</span>
            <span style={ed.mono} className="text-[12px] text-right opacity-80">{f.revisao}</span>
            <span style={ed.mono} className="text-[12px] text-right opacity-80">{f.updated}</span>
            <div className="text-right">
              <div style={ed.mono} className="text-[14px] font-semibold">
                {f.cost}
              </div>
              {f.status === 'warn' && (
                <span className="text-[9px] tracking-widest uppercase" style={{ color: SQUAD_RED }}>
                  preço zerado
                </span>
              )}
              {f.status === 'pending' && (
                <span className="text-[9px] tracking-widest uppercase opacity-60">aguardando</span>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 pr-2">
              <button className="text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 inline-flex items-center gap-1"
                      style={ed.mono}>
                <Eye className="h-3 w-3" weight="bold" /> ver
              </button>
              <button className="text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 inline-flex items-center gap-1"
                      style={ed.mono}>
                <ArrowUpRight className="h-3 w-3" weight="bold" /> abrir
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-2 text-[11px] opacity-60" style={ed.mono}>
        <span className="uppercase tracking-widest">Mostrando 6 de 127 · Pág 1 / 22</span>
        <div className="flex items-center gap-3 uppercase tracking-widest">
          <button className="hover:opacity-100 opacity-60">← Anterior</button>
          <span>·</span>
          <button className="hover:opacity-100 opacity-100">Próximo →</button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Mockup 2 — Editor de Ficha Técnica
// ---------------------------------------------------------------------------
function MockupEditorFicha() {
  const tabs = ['Identificação', 'Materiais', 'Variantes', 'Setores', 'Capacidades', 'Versões'];

  return (
    <section>
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between border-b py-3 mb-4" style={{ borderColor: 'rgba(10,10,10,0.15)' }}>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest opacity-60" style={ed.mono}>
          <span>FICHAS TÉCNICAS</span>
          <CaretRight className="h-3 w-3" />
          <span>SP 10 · PLATAFORMA CASUAL</span>
          <CaretRight className="h-3 w-3" />
          <span style={{ color: SQUAD_RED }}>EDITAR</span>
        </div>

        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-[11px] uppercase tracking-widest border" style={{ borderColor: RULE, ...ed.mono }}>
            Descartar
          </button>
          <button className="px-4 py-1.5 text-[11px] uppercase tracking-widest font-semibold border" style={{ borderColor: RULE, background: INK, color: PAPER, ...ed.mono }}>
            Salvar Ficha
          </button>
        </div>
      </div>

      {/* Hero header */}
      <div className="grid grid-cols-12 gap-0 border-2 mb-6" style={{ borderColor: RULE }}>
        <div className="col-span-12 md:col-span-8 p-6 border-r" style={{ borderColor: RULE }}>
          <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60 mb-2">
            REF · SP 10 · v4 · ATUALIZADA 21/05/26
          </div>
          <h2 style={ed.display} className="text-[64px] leading-[0.88]">
            PLATAFORMA<br />
            <span className="opacity-60">CASUAL</span>
          </h2>

          <div className="mt-4 flex flex-wrap gap-2">
            {['Plataforma', 'Adulto', 'Linha Conforto', 'Verão 27'].map(t => (
              <span key={t} className="text-[10px] uppercase tracking-widest px-2 py-1 border" style={{ borderColor: RULE, ...ed.mono }}>
                {t}
              </span>
            ))}
          </div>
        </div>

        <div className="col-span-12 md:col-span-4 grid grid-cols-2 gap-px" style={{ background: RULE }}>
          {[
            { label: 'Custo Total', value: 'R$ 42,80', mono: true },
            { label: 'Pares / Dia', value: '320', mono: true },
            { label: 'Setores', value: '07', mono: true },
            { label: 'Variantes', value: '12', mono: true },
          ].map(s => (
            <div key={s.label} className="p-4" style={{ background: PAPER }}>
              <div style={ed.mono} className="text-[9px] tracking-widest uppercase opacity-60">
                {s.label}
              </div>
              <div style={s.mono ? { ...ed.display } : { ...ed.body }} className="text-[32px] leading-none mt-1">
                {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex items-stretch border-b-2 mb-8" style={{ borderColor: RULE }}>
        {tabs.map((t, i) => {
          const isActive = i === 1;
          return (
            <button
              key={t}
              className="px-5 py-2 text-[12px] uppercase tracking-widest relative"
              style={{
                ...ed.mono,
                color: isActive ? SQUAD_RED : INK,
                opacity: isActive ? 1 : 0.55,
              }}
            >
              <span className="opacity-50 mr-2" style={ed.mono}>
                0{i + 1}
              </span>
              {t}
              {isActive && (
                <span className="absolute left-0 right-0 -bottom-[2px] h-[3px]" style={{ background: SQUAD_RED }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Editor body — 2-col layout */}
      <div className="grid grid-cols-12 gap-8">
        {/* Left rail — sections list */}
        <aside className="col-span-3 sticky top-24 self-start">
          <div className="text-[10px] tracking-widest uppercase opacity-60 mb-3 border-b pb-2"
               style={{ ...ed.mono, borderColor: 'rgba(10,10,10,0.15)' }}>
            ÍNDICE · MATERIAIS
          </div>
          <ul className="space-y-1.5">
            {[
              { n: 'A', label: 'Cabedal', count: 3, active: true },
              { n: 'B', label: 'Forro', count: 1 },
              { n: 'C', label: 'Palmilha', count: 2 },
              { n: 'D', label: 'Solado', count: 1 },
              { n: 'E', label: 'Embalagem', count: 4 },
              { n: 'F', label: 'Aviamentos', count: 6 },
            ].map(it => (
              <li key={it.n}>
                <button
                  className="w-full flex items-center justify-between text-left px-2 py-1.5 border-l-2 transition-colors"
                  style={{
                    borderColor: it.active ? SQUAD_RED : 'transparent',
                    background: it.active ? 'rgba(217,38,78,0.06)' : 'transparent',
                  }}
                >
                  <span className="flex items-baseline gap-3">
                    <span style={ed.mono} className="text-[10px] tracking-widest opacity-50">
                      {it.n}
                    </span>
                    <span className="text-[14px]">{it.label}</span>
                  </span>
                  <span style={ed.mono} className="text-[10px] opacity-60">×{it.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Main editor */}
        <main className="col-span-9 space-y-8">
          <SectionA />
          <SectionB />
        </main>
      </div>
    </section>
  );
}

function SectionA() {
  return (
    <div className="border-2" style={{ borderColor: RULE }}>
      <div className="flex items-center justify-between px-5 py-3 border-b-2" style={{ borderColor: RULE, background: INK, color: PAPER }}>
        <div className="flex items-center gap-4">
          <span style={ed.mono} className="text-[10px] tracking-widest opacity-70">SEÇÃO A</span>
          <h3 style={ed.display} className="text-[24px] leading-none">CABEDAL</h3>
        </div>
        <button className="text-[10px] uppercase tracking-widest inline-flex items-center gap-1" style={ed.mono}>
          <Plus className="h-3 w-3" weight="bold" /> adicionar variante
        </button>
      </div>

      <div>
        {[
          { mat: 'Napa Santorine', cor: 'Caramelo', conv: '12,4 dm²/par', unit: 'dm²' },
          { mat: 'Napa Santorine', cor: 'Preto', conv: '12,4 dm²/par', unit: 'dm²' },
          { mat: 'Verniz Glamour', cor: 'Vermelho', conv: '13,1 dm²/par', unit: 'dm²' },
        ].map((m, i) => (
          <div key={i}
               className="grid grid-cols-[36px_1.6fr_1fr_120px_80px_50px] items-center px-5 py-3 border-b last:border-b-0 hover:bg-black/[0.03] transition-colors"
               style={{ borderColor: 'rgba(10,10,10,0.10)' }}>
            <span style={ed.mono} className="text-[12px] opacity-50">
              {(i + 1).toString().padStart(2, '0')}
            </span>
            <div>
              <div className="text-[15px] font-medium">{m.mat}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-50 mt-0.5" style={ed.mono}>Material</div>
            </div>
            <div>
              <div className="text-[14px]">{m.cor}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-50 mt-0.5" style={ed.mono}>Cor</div>
            </div>
            <div className="text-right">
              <div style={ed.mono} className="text-[14px]">{m.conv}</div>
              <div className="text-[10px] uppercase tracking-widest opacity-50 mt-0.5" style={ed.mono}>Consumo</div>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase tracking-widest px-1.5 py-0.5 border" style={{ borderColor: RULE, ...ed.mono }}>
                {m.unit}
              </span>
            </div>
            <div className="text-right">
              <button>
                <Pencil className="h-4 w-4 opacity-60" weight="bold" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionB() {
  return (
    <div className="border-2" style={{ borderColor: RULE }}>
      <div className="flex items-center justify-between px-5 py-3 border-b-2" style={{ borderColor: RULE }}>
        <div className="flex items-center gap-4">
          <span style={ed.mono} className="text-[10px] tracking-widest opacity-70">SEÇÃO B</span>
          <h3 style={ed.display} className="text-[24px] leading-none">FORRO</h3>
        </div>
        <span style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">1 ITEM</span>
      </div>

      <div className="grid grid-cols-3 gap-px" style={{ background: 'rgba(10,10,10,0.10)' }}>
        {[
          { label: 'Material', value: 'Forro Sintético Bege', subtitle: 'Group: Forros / Cor única' },
          { label: 'Consumo / par', value: '8,2 dm²', subtitle: 'Padrão calculado' },
          { label: 'Custo / par', value: 'R$ 2,40', subtitle: 'A 0,29 R$/dm²' },
        ].map((c, i) => (
          <div key={i} className="p-5" style={{ background: PAPER }}>
            <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">
              {c.label}
            </div>
            <div className="text-[20px] mt-1 font-medium leading-tight">{c.value}</div>
            <div className="text-[11px] opacity-60 mt-1.5">{c.subtitle}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mockup 3 — Print Worksheets Page (Web)
// ---------------------------------------------------------------------------
function MockupOperatorPrint() {
  const sectors = [
    { key: 'corte-p', name: 'Corte Palmilha',  icon: <Scissors className="h-4 w-4" weight="bold" />, count: 4 },
    { key: 'corte-f', name: 'Corte Forração',  icon: <Layers   className="h-4 w-4" weight="bold" />, count: 3 },
    { key: 'costura', name: 'Costura',         icon: <Pen      className="h-4 w-4" weight="bold" />, count: 2 },
    { key: 'aviam',   name: 'Aviamento',       icon: <GridFour className="h-4 w-4" weight="bold" />, count: 5 },
    { key: 'silk',    name: 'Silk',            icon: <PaintBrush className="h-4 w-4" weight="bold" />, count: 1 },
    { key: 'colagem', name: 'Colagem',         icon: <Wind     className="h-4 w-4" weight="bold" />, count: 3 },
    { key: 'mont',    name: 'Montagem',        icon: <Hammer   className="h-4 w-4" weight="bold" />, count: 7, active: true },
    { key: 'sol',     name: 'Solagem',         icon: <Footprints className="h-4 w-4" weight="bold" />, count: 4 },
    { key: 'acab',    name: 'Acabamento',      icon: <Sparkle  className="h-4 w-4" weight="bold" />, count: 5 },
    { key: 'exped',   name: 'Expedição',       icon: <Truck    className="h-4 w-4" weight="bold" />, count: 2 },
  ];

  return (
    <section className="space-y-8">
      <div className="grid grid-cols-12 gap-6 items-end">
        <div className="col-span-12 md:col-span-7">
          <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60 mb-2">
            IMPRESSÃO · 21/05/26 · CONFIGURAÇÃO
          </div>
          <h1 style={ed.display} className="text-[68px] leading-[0.88]">
            FICHA DE<br />
            <span style={{ color: SQUAD_RED }}>OPERADOR</span>
          </h1>
          <p className="mt-3 max-w-[480px] text-[14px] leading-relaxed opacity-80">
            Selecione o setor e as OPs pra gerar as fichas A4. Cada setor mostra
            só as instruções relevantes pro operador daquela etapa.
          </p>
        </div>

        <div className="col-span-12 md:col-span-5">
          <div className="border-2 p-4" style={{ borderColor: RULE }}>
            <div className="flex items-center justify-between mb-3">
              <span style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">
                Seleção atual
              </span>
              <button className="text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100" style={ed.mono}>
                limpar
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <div style={ed.mono} className="text-[9px] tracking-widest uppercase opacity-60">Setor</div>
                <div className="text-[24px] leading-none mt-1" style={{ color: SQUAD_RED, ...ed.display }}>
                  MONTAGEM
                </div>
              </div>
              <div>
                <div style={ed.mono} className="text-[9px] tracking-widest uppercase opacity-60">OPs</div>
                <div style={ed.display} className="text-[24px] leading-none mt-1">07</div>
              </div>
              <div>
                <div style={ed.mono} className="text-[9px] tracking-widest uppercase opacity-60">Pares</div>
                <div style={ed.display} className="text-[24px] leading-none mt-1">1.284</div>
              </div>
            </div>

            <button className="mt-4 w-full text-center text-[12px] uppercase tracking-widest font-semibold py-2.5 inline-flex items-center justify-center gap-2"
                    style={{ background: INK, color: PAPER, ...ed.mono }}>
              <Printer className="h-3.5 w-3.5" weight="bold" /> Imprimir 7 fichas A4
            </button>
          </div>
        </div>
      </div>

      {/* Sector strip */}
      <div className="border-2" style={{ borderColor: RULE }}>
        <div className="flex items-center justify-between px-4 py-2 border-b-2"
             style={{ borderColor: RULE, background: INK, color: PAPER }}>
          <span style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-80">
            Setores · 10 disponíveis
          </span>
          <span style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-50">
            Clique pra filtrar
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-px" style={{ background: 'rgba(10,10,10,0.10)' }}>
          {sectors.map(s => (
            <button
              key={s.key}
              className="px-4 py-4 text-left transition-colors relative"
              style={{
                background: s.active ? SQUAD_RED : PAPER,
                color: s.active ? PAPER : INK,
              }}
            >
              <div className="flex items-center gap-2">
                {s.icon}
                <span className="text-[10px] uppercase tracking-widest opacity-70" style={ed.mono}>
                  {String(sectors.indexOf(s) + 1).padStart(2, '0')}
                </span>
              </div>
              <div style={ed.display} className="text-[20px] leading-none mt-2">
                {s.name}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span style={ed.mono} className="text-[22px] leading-none">
                  {String(s.count).padStart(2, '0')}
                </span>
                <span className="text-[10px] uppercase tracking-widest opacity-60">OPs</span>
              </div>
              {s.active && (
                <span
                  className="absolute right-3 top-3 inline-block h-2 w-2 rounded-full"
                  style={{ background: PAPER }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* OP table for current sector */}
      <div className="border-2" style={{ borderColor: RULE }}>
        <div className="px-4 py-3 border-b-2 flex items-center justify-between"
             style={{ borderColor: RULE }}>
          <div className="flex items-baseline gap-4">
            <span style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60">
              OPS · MONTAGEM · 07
            </span>
            <h3 style={ed.display} className="text-[24px] leading-none">
              SELECIONE PRA IMPRIMIR
            </h3>
          </div>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest cursor-pointer" style={ed.mono}>
            <input type="checkbox" defaultChecked className="accent-[#D9264E]" />
            Selecionar todas
          </label>
        </div>

        <div>
          {[
            { op: '12345', ref: 'SP 10', cor: 'Caramelo', pares: 240, entrega: '24/05/26', store: 'AGITO DOS PÉS', sel: true },
            { op: '12346', ref: 'CF 07', cor: 'Preto',    pares: 120, entrega: '26/05/26', store: 'ITA SHOES',      sel: true },
            { op: '12347', ref: 'SP 14', cor: 'Vermelho', pares: 180, entrega: '27/05/26', store: 'CALÇ. NOVA YORK', sel: true },
            { op: '12348', ref: 'BT 03', cor: 'Marrom',   pares: 96,  entrega: '28/05/26', store: 'BIG SHOES',       sel: true },
            { op: '12349', ref: 'CF 09', cor: 'Bege',     pares: 144, entrega: '30/05/26', store: 'ITA SHOES',       sel: true },
            { op: '12350', ref: 'SS 22', cor: 'Branco',   pares: 264, entrega: '02/06/26', store: 'PASSO LARGO',     sel: true },
            { op: '12351', ref: 'SP 14', cor: 'Preto',    pares: 240, entrega: '04/06/26', store: 'CALÇ. NOVA YORK', sel: true },
          ].map((o, i) => (
            <div key={o.op}
                 className="grid grid-cols-[40px_90px_100px_100px_80px_90px_1fr_90px] items-center px-4 py-3 border-b last:border-b-0 hover:bg-black/[0.03]"
                 style={{ borderColor: 'rgba(10,10,10,0.10)' }}>
              <input type="checkbox" defaultChecked={o.sel} className="accent-[#D9264E]" />
              <span style={ed.mono} className="text-[14px] font-bold">{o.op}</span>
              <span style={ed.mono} className="text-[13px] opacity-80">{o.ref}</span>
              <span className="text-[13px]">{o.cor}</span>
              <span style={ed.mono} className="text-[14px] text-right">{o.pares}p</span>
              <span style={ed.mono} className="text-[12px] text-right opacity-80">{o.entrega}</span>
              <span className="text-[12px] uppercase opacity-80 tracking-wide pl-3">{o.store}</span>
              <div className="text-right">
                <button className="text-[10px] uppercase tracking-widest opacity-60 hover:opacity-100 inline-flex items-center gap-1" style={ed.mono}>
                  <Eye className="h-3 w-3" weight="bold" /> preview
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Print preview thumbnail */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-4">
          <div style={ed.mono} className="text-[10px] tracking-widest uppercase opacity-60 mb-2">
            PREVIEW · A4 · OP 12345
          </div>
          <h2 style={ed.display} className="text-[36px] leading-[0.9] mb-3">
            COMO VAI<br />SAIR NA IMPRESSORA
          </h2>
          <p className="text-[13px] opacity-80 leading-relaxed">
            A ficha mantém o visual industrial-editorial já em produção: tipografia
            Anton no setor + Pares, mono pra OP/PV/datas, grade pintada por tamanho.
            Vermelho do header só aparece em destaque (não polui no preto-branco).
          </p>
          <div className="mt-4 flex items-center gap-2 text-[11px] uppercase tracking-widest" style={ed.mono}>
            <CheckCircle className="h-3.5 w-3.5" weight="bold" style={{ color: SQUAD_RED }} />
            Mantém print A4 atual (já validado na fábrica)
          </div>
        </div>

        <div className="col-span-12 md:col-span-8">
          <FichaA4Mini />
        </div>
      </div>
    </section>
  );
}

function FichaA4Mini() {
  // Versão miniatura/mockup do print A4 — só pra confirmar consistência visual
  return (
    <div className="border-2 p-4 bg-white text-black" style={{ borderColor: RULE }}>
      <div className="flex items-center gap-3 border-y-2 border-black px-2 py-1.5 mb-2">
        <Hammer className="h-5 w-5" weight="bold" />
        <span style={ed.display} className="text-[28px] leading-none flex-1">MONTAGEM</span>
        <span className="text-[10px] uppercase tracking-widest font-bold" style={ed.mono}>FICHA DE OPERADOR</span>
      </div>

      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest mb-1" style={ed.mono}>
        <span>01 / MONTAGEM</span>
        <span>21/05/2026</span>
      </div>

      <div className="border-t border-b border-black py-2 mb-2 grid grid-cols-[1fr_1fr_1fr_1fr_50px]">
        <div>
          <div style={ed.mono} className="text-[9px] uppercase tracking-widest opacity-70">OP</div>
          <div style={ed.mono} className="text-[24px] font-bold leading-none mt-1">12345</div>
        </div>
        <div className="border-l border-black pl-3">
          <div style={ed.mono} className="text-[9px] uppercase tracking-widest opacity-70">Pedido</div>
          <div style={ed.mono} className="text-[18px] font-bold leading-none mt-1">PV-00122</div>
        </div>
        <div className="border-l border-black pl-3">
          <div style={ed.mono} className="text-[9px] uppercase tracking-widest opacity-70">Pares</div>
          <div style={ed.display} className="text-[36px] leading-none mt-1">240</div>
        </div>
        <div className="border-l border-black pl-3">
          <div style={ed.mono} className="text-[9px] uppercase tracking-widest opacity-70">Entrega</div>
          <div style={ed.mono} className="text-[12px] mt-1">24/05/2026</div>
        </div>
        <div className="border-l border-black flex items-center justify-center">
          <div className="grid grid-cols-3 gap-px w-8 h-8" style={{ background: '#000' }}>
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} style={{ background: i % 2 === 0 ? '#000' : '#fff' }} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-y border-black mb-2">
        {[
          { l: 'Produção / Dia', v: '320 pares' },
          { l: 'Tempo Estimado', v: '1 dia' },
          { l: 'Por ficha',      v: '24 pares' },
          { l: 'Total',          v: '240 pares' },
        ].map((s, i) => (
          <div key={i} className={`py-1.5 px-2 ${i > 0 ? 'border-l border-black' : ''}`}>
            <div style={ed.mono} className="text-[8px] uppercase tracking-widest opacity-70">{s.l}</div>
            <div style={ed.display} className="text-[16px] leading-none mt-1">{s.v}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-1">
          <div className="flex items-baseline gap-3">
            <span style={ed.mono} className="text-[10px] uppercase tracking-widest opacity-70">REF</span>
            <span style={ed.display} className="text-[20px] leading-none">SP 10</span>
            <span style={ed.mono} className="text-[12px] uppercase">· Caramelo</span>
          </div>
          <span style={ed.mono} className="text-[10px] uppercase tracking-widest">Grade — 240p</span>
        </div>
        <div className="border border-black">
          <div className="grid grid-cols-7 text-center text-[10px]" style={ed.mono}>
            {['33', '34', '35', '36', '37', '38', '39'].map(s => (
              <div key={s} className="border-r border-black last:border-r-0 py-1 bg-black text-white font-bold uppercase tracking-widest">{s}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 text-center">
            {[24, 36, 48, 48, 40, 28, 16].map((n, i) => (
              <div key={i} className="border-r border-black last:border-r-0 border-t py-2" style={ed.display}>
                <div className="text-[20px] leading-none">{n}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 text-[9px] uppercase tracking-widest opacity-50" style={ed.mono}>
        Preview reduzido — folha real sai em A4 retrato
      </div>
    </div>
  );
}
