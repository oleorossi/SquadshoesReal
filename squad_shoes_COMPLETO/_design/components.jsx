// Shared building blocks: Sidebar, Topbar, KPI, Chart primitives, OP rows
const { useEffect, useRef, useState } = React;

// ── COUNT-UP HOOK ───────────────────────────
function useCountUp(target, duration = 1400, deps = []) {
  const [val, setVal] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    let raf, t0;
    const tick = (t) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(startRef.current + (target - startRef.current) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else startRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line
  }, deps);
  return val;
}

function CountNumber({ to, decimals = 0, prefix = '', suffix = '', className = '' }) {
  const v = useCountUp(to, 1500, [to]);
  const formatted = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('pt-BR');
  return <span className={`mono ${className}`}>{prefix}{formatted}{suffix}</span>;
}

// ── SIDEBAR ───────────────────────────
function Sidebar({ active = 'producao', collapsed = false }) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: 'Dashboard', group: 'home' },
    { id: 'producao', label: 'Produção', icon: 'PCP', group: 'ops' },
    { id: 'ordens',   label: 'Ordens',    icon: 'PCP', group: 'ops' },
    { id: 'qc',       label: 'Qualidade', icon: 'Qualidade', group: 'ops' },
    { id: 'expedicao',label: 'Expedição', icon: 'Expedicao', group: 'ops' },
    { id: 'materiais',label: 'Materiais', icon: 'Materiais', group: 'inv' },
    { id: 'acabados', label: 'Acabados',  icon: 'Embalagem', group: 'inv' },
    { id: 'relatorios',label:'Relatórios',icon: 'Relatorios', group: 'insights' },
    { id: 'equipe',   label: 'Equipe',    icon: 'Equipe', group: 'insights' },
  ];
  const groups = [
    { id: 'home', label: '' },
    { id: 'ops', label: 'Operações' },
    { id: 'inv', label: 'Estoque' },
    { id: 'insights', label: 'Insights' },
  ];
  const w = collapsed ? 68 : 232;
  return (
    <aside style={{ width: w, background: '#000', borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ height: 64, padding: '0 18px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--line)' }}>
        <Icon.Brand style={{ width: 26, height: 26 }}/>
        {!collapsed && <div>
          <div className="display" style={{ fontSize: 18, color: '#fff', letterSpacing: '0.04em' }}>SQUAD</div>
          <div className="eyebrow" style={{ fontSize: 8, marginTop: -2, color: 'var(--red-500)' }}>Factory OS</div>
        </div>}
      </div>
      <nav style={{ flex: 1, overflow: 'auto', padding: '14px 10px' }}>
        {groups.map((g) => (
          <div key={g.id} style={{ marginBottom: 14 }}>
            {!collapsed && g.label && (
              <div className="eyebrow" style={{ padding: '6px 10px 8px', fontSize: 9, letterSpacing: '0.22em', color: 'var(--fg-3)' }}>{g.label}</div>
            )}
            {items.filter(i => i.group === g.id).map(it => {
              const Ic = Icon[it.icon];
              const isActive = active === it.id;
              return (
                <div key={it.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: collapsed ? '9px 0' : '9px 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 6, marginBottom: 2,
                    background: isActive ? 'rgba(225,29,46,0.12)' : 'transparent',
                    color: isActive ? '#fff' : 'var(--fg-2)',
                    borderLeft: !collapsed && isActive ? '2px solid var(--red-500)' : '2px solid transparent',
                    cursor: 'pointer', position: 'relative',
                    fontSize: 12.5, fontWeight: isActive ? 600 : 500,
                  }}>
                  <Ic className={isActive ? '' : ''} style={{ color: isActive ? 'var(--red-500)' : 'var(--fg-3)' }}/>
                  {!collapsed && <span>{it.label}</span>}
                  {!collapsed && isActive && <span className="mono" style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--fg-3)' }}>↵</span>}
                </div>
              );
            })}
          </div>
        ))}
      </nav>
      {!collapsed && (
        <div style={{ padding: 14, borderTop: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 4, background: 'var(--red-500)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:700, fontSize: 12 }}>RM</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>Renata Mota</div>
              <div className="t-caption" style={{ color: 'var(--fg-3)', fontSize: 10 }}>Gerente de planta</div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

// ── TOPBAR ───────────────────────────
function Topbar({ title, breadcrumb, onToggleTheme, theme = 'dark', live = true }) {
  return (
    <header style={{
      height: 64, padding: '0 28px',
      display: 'flex', alignItems: 'center', gap: 20,
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg-0)',
    }}>
      <div>
        {breadcrumb && <div className="eyebrow" style={{ fontSize: 9, marginBottom: 2 }}>{breadcrumb}</div>}
        <div className="display" style={{ fontSize: 24, color: 'var(--fg-0)', letterSpacing: '0.02em' }}>{title}</div>
      </div>
      <div style={{ flex: 1 }}/>
      {live && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid var(--line)', borderRadius: 6 }}>
          <span className="live-dot"/>
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: '0.1em', color: 'var(--fg-1)' }}>AO VIVO · TURNO 1</span>
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--fg-3)' }}>14:38:22</span>
        </div>
      )}
      <div style={{ display:'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn-icon" title="Buscar"><Icon.Search/></button>
        <button className="btn-icon" title="Notificações" style={{ position: 'relative' }}>
          <Icon.Bell/>
          <span style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: '50%', background: 'var(--red-500)' }}/>
        </button>
        <button className="btn-icon" onClick={onToggleTheme} title="Tema">
          {theme === 'dark' ? <Icon.Sun/> : <Icon.Moon/>}
        </button>
        <button className="btn btn-red"><Icon.Plus style={{ width:14, height:14 }}/> Nova OP</button>
      </div>
    </header>
  );
}

// ── KPI CARD ───────────────────────────
function KPI({ eyebrow, value, suffix, delta, deltaDir = 'up', spark }) {
  return (
    <div className="card" style={{ padding: 20, position: 'relative', overflow: 'hidden' }}>
      <div className="eyebrow" style={{ fontSize: 9.5 }}>{eyebrow}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 14 }}>
        <span className="display" style={{ fontSize: 56, color: 'var(--fg-0)', letterSpacing: '-0.01em' }}>
          <CountNumber to={value}/>
        </span>
        {suffix && <span className="mono" style={{ fontSize: 14, color: 'var(--fg-2)' }}>{suffix}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
        {delta != null && (
          <div style={{ display:'flex', alignItems:'center', gap: 4, fontSize: 11, fontWeight: 600,
            color: deltaDir === 'up' ? 'var(--ok)' : deltaDir === 'down' ? 'var(--red-500)' : 'var(--fg-2)' }}>
            {deltaDir === 'up' ? <Icon.ArrowUp style={{ width: 12, height: 12 }}/> : deltaDir === 'down' ? <Icon.ArrowDown style={{ width: 12, height: 12 }}/> : null}
            <span className="mono">{delta}</span>
            <span className="t-caption" style={{ color: 'var(--fg-3)', fontWeight: 500, marginLeft: 4 }}>vs. ontem</span>
          </div>
        )}
        {spark}
      </div>
    </div>
  );
}

// ── SPARKLINE ───────────────────────────
function Sparkline({ data = [], color = 'var(--red-500)', w = 90, h = 28 }) {
  const max = Math.max(...data), min = Math.min(...data);
  const r = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / r) * h}`).join(' ');
  const area = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} style={{ display:'block' }}>
      <polygon points={area} fill={color} opacity="0.12"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// ── BARS CHART ───────────────────────────
function Bars({ data, max, w = 320, h = 130, accent = 'var(--red-500)' }) {
  const bw = w / data.length - 6;
  return (
    <svg width={w} height={h} style={{ display:'block' }}>
      {[0.25, 0.5, 0.75].map((p, i) => (
        <line key={i} x1="0" x2={w} y1={h * p} y2={h * p} stroke="var(--line)" strokeDasharray="2 3"/>
      ))}
      {data.map((d, i) => {
        const bh = (d.v / max) * (h - 12);
        return (
          <g key={i}>
            <rect x={i * (bw + 6) + 3} y={h - bh} width={bw} height={bh}
              fill={d.flag ? accent : 'var(--fg-3)'} opacity={d.flag ? 1 : 0.45}/>
            <text x={i * (bw + 6) + 3 + bw / 2} y={h - 2} textAnchor="middle"
              fontSize="8.5" fill="var(--fg-3)" fontFamily="JetBrains Mono">{d.l}</text>
          </g>
        );
      })}
    </svg>
  );
}

window.useCountUp = useCountUp;
window.CountNumber = CountNumber;
window.Sidebar = Sidebar;
window.Topbar = Topbar;
window.KPI = KPI;
window.Sparkline = Sparkline;
window.Bars = Bars;
