import React, { useState, useEffect, useRef, useMemo } from 'react';

// Squad Shoes Factory OS — Componentes compartilhados
// Tokens HSL alinhados ao design system: verde + creme + slate sidebar
// ── TOKENS ───────────────────────────────────────────────
const T = {
  // Base
  background: 'hsl(210 20% 98.5%)',
  foreground: 'hsl(224 71.4% 4.1%)',
  card: 'hsl(0 0% 100%)',
  cardFg: 'hsl(220 25% 10%)',

  // Primary — verde escuro elegante
  primary: 'hsl(162 90% 15%)',
  primaryFg: 'hsl(210 40% 98%)',
  primaryHover: 'hsl(162 90% 12%)',
  primarySoft: 'hsl(162 30% 94%)',
  primarySoftFg: 'hsl(162 90% 15%)',

  // Accent — creme F5F5DC
  accent: 'hsl(50 55% 80%)',
  accentSoft: 'hsl(50 55% 92%)',
  accentFg: 'hsl(222.2 47.4% 11.2%)',

  // Semantic
  success: 'hsl(142.1 76.2% 36.3%)',
  successSoft: 'hsl(142 60% 94%)',
  successFg: 'hsl(142 80% 22%)',
  warning: 'hsl(38 92% 50%)',
  warningSoft: 'hsl(38 92% 95%)',
  warningFg: 'hsl(28 80% 30%)',
  destructive: 'hsl(0 84.2% 60.2%)',
  destructiveSoft: 'hsl(0 84% 96%)',
  destructiveFg: 'hsl(0 70% 38%)',
  info: 'hsl(217 91% 55%)',
  infoSoft: 'hsl(217 91% 95%)',
  infoFg: 'hsl(217 80% 38%)',

  // Borders / muted
  border: 'hsl(214 14% 89%)',
  borderSoft: 'hsl(214 14% 94%)',
  input: 'hsl(214 14% 89%)',
  ring: 'hsl(160 55% 24%)',
  muted: 'hsl(210 12% 93%)',
  mutedSoft: 'hsl(210 16% 96%)',
  mutedFg: 'hsl(215 12% 46%)',

  // Sidebar slate
  sidebarBg: 'hsl(222 47% 7%)',
  sidebarGradFrom: 'hsl(222 24% 7%)',
  sidebarGradTo: 'hsl(225 22% 10%)',
  sidebarFg: 'hsl(210 20% 90%)',
  sidebarMuted: 'hsl(215 15% 55%)',
  sidebarPrimary: 'hsl(162 80% 45%)',
  sidebarAccent: 'hsl(217 32% 12%)',
  sidebarBorder: 'hsl(217 32% 14%)',

  // Type
  sans: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', monospace",

  // Radius (14px)
  r: 14,
  rSm: 10,
  rXs: 6,

   // Sombras
   shadowCard: '0 2px 8px -1px rgb(0 0 0 / 0.05), 0 1px 3px -1px rgb(0 0 0 / 0.03)',
   shadowHover: '0 12px 24px -4px rgb(0 0 0 / 0.08), 0 4px 12px -2px rgb(0 0 0 / 0.04)',
   shadowElev: '0 20px 40px -8px rgb(0 0 0 / 0.1), 0 12px 20px -6px rgb(0 0 0 / 0.05)',
   shadowSidebar: '4px 0 24px -4px rgba(0,0,0,0.25)',

   // Gradientes prontos
   gradientPrimary: 'linear-gradient(135deg, hsl(162 90% 15%) 0%, hsl(162 90% 10%) 100%)',
   gradientAccent:  'linear-gradient(135deg, hsl(50 55% 80%) 0%, hsl(45 60% 72%) 100%)',
   gradientSuccess: 'linear-gradient(135deg, hsl(142 76% 36%) 0%, hsl(162 90% 15%) 100%)',

   // Transições padrão (300ms duration, standard easing)
   transition: 'all 300ms cubic-bezier(0.4, 0, 0.2, 1)',
   transitionFast: 'all 150ms cubic-bezier(0.4, 0, 0.2, 1)',
   transitionSlow: 'all 500ms cubic-bezier(0.4, 0, 0.2, 1)',

   // Overlay
   overlay: 'rgba(13, 16, 24, 0.45)',
 };

// ── HOOK responsive ──────────────────────────────────────
function useIsMobile(bp = 900) {
  const [m, setM] = useState(typeof window !== 'undefined' ? window.innerWidth < bp : false);
  useEffect(() => {
    const r = () => setM(window.innerWidth < bp);
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, [bp]);
  return m;
}

// ── SIDEBAR ──────────────────────────────────────────────
const NAV_SECTIONS = [
  { title: null, items: [
    { key: 'dashboard', label: 'Painel', icon: 'layout-dashboard' },
  ]},
  { title: 'Operações', items: [
    { key: 'producao', label: 'Produção', icon: 'factory', badge: 4, badgeKind: 'live' },
    { key: 'ordens',   label: 'Ordens (OPs)', icon: 'clipboard-list', badge: 12 },
    { key: 'qualidade',label: 'Qualidade',    icon: 'shield-check' },
    { key: 'expedicao',label: 'Expedição',    icon: 'truck' },
  ]},
  { title: 'Estoque', items: [
    { key: 'materiais',label: 'Materiais',     icon: 'package', badge: 3, badgeKind: 'warn' },
    { key: 'acabados', label: 'Acabados',      icon: 'boxes' },
    { key: 'fornec',   label: 'Fornecedores',  icon: 'building-2' },
  ]},
  { title: 'Insights', items: [
    { key: 'reports',  label: 'Relatórios',    icon: 'bar-chart-3' },
    { key: 'team',     label: 'Equipe',        icon: 'users' },
  ]},
];

function Sidebar({ active, onNav, collapsed, onToggle, glass }) {
  const w = collapsed ? 72 : 248;
  return (
    <aside style={{
      position: 'fixed', top: 0, left: 0, bottom: 0, width: w,
      background: glass ? 'hsl(222 47% 7% / 0.95)'
        : `linear-gradient(180deg, ${T.sidebarGradFrom} 0%, ${T.sidebarGradTo} 100%)`,
      backdropFilter: glass ? 'blur(16px)' : undefined,
      color: T.sidebarFg, display: 'flex', flexDirection: 'column', zIndex: 90,
      transition: 'width 250ms cubic-bezier(0.4, 0, 0.2, 1)',
      borderRight: `1px solid ${T.sidebarBorder}`,
    }}>
      {/* Logo */}
      <div style={{ padding: collapsed ? '20px 0' : '20px 18px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', borderBottom: `1px solid ${T.sidebarBorder}`, height: 68 }}>
        {!collapsed ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, ${T.sidebarPrimary} 0%, hsl(162 90% 30%) 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: T.sans, fontWeight: 800, fontSize: 13, letterSpacing: '-0.02em', boxShadow: '0 4px 12px hsl(162 80% 30% / 0.4)', flexShrink: 0 }}>SS</div>
            <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
              <div style={{ fontFamily: T.sans, fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Squad Shoes</div>
              <div style={{ fontFamily: T.sans, fontWeight: 600, fontSize: 9, color: T.sidebarMuted, letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap', marginTop: 1 }}>Factory OS</div>
            </div>
          </div>
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: 8, background: `linear-gradient(135deg, ${T.sidebarPrimary} 0%, hsl(162 90% 30%) 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontFamily: T.sans, fontWeight: 800, fontSize: 13, boxShadow: '0 4px 12px hsl(162 80% 30% / 0.4)' }}>SS</div>
        )}
      </div>

      {/* Plant selector */}
      {!collapsed && (
        <div style={{ padding: '14px 14px 8px' }}>
          <div style={{ fontFamily: T.sans, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.sidebarMuted, marginBottom: 6, paddingLeft: 4 }}>Planta</div>
          <button style={{ width: '100%', background: T.sidebarAccent, border: `1px solid ${T.sidebarBorder}`, borderRadius: 10, padding: '9px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', color: T.sidebarFg, transition: 'all 140ms' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ position: 'relative', display: 'inline-flex', width: 8, height: 8 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: T.sidebarPrimary, animation: 'pulseRing 2s ease-in-out infinite' }}/>
                <span style={{ position: 'relative', borderRadius: '50%', background: T.sidebarPrimary, width: 8, height: 8, boxShadow: `0 0 8px ${T.sidebarPrimary}` }}/>
              </span>
              <span style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 600 }}>Franca · Planta 02</span>
            </div>
            <i data-lucide="chevrons-up-down" style={{ width: 12, height: 12, opacity: 0.5 }}></i>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '12px 8px' : '8px 12px' }} className="scrollbar-thin">
        {NAV_SECTIONS.map((sec, si) => (
          <div key={si} style={{ marginTop: si === 0 ? 4 : 18 }}>
            {sec.title && !collapsed && (
              <div style={{ fontFamily: T.sans, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: T.sidebarMuted, padding: '6px 10px' }}>{sec.title}</div>
            )}
            {sec.items.map(it => {
              const a = active === it.key;
              return (
                <NavItem key={it.key} item={it} active={a} collapsed={collapsed} onClick={() => onNav(it.key)}/>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User */}
      <div style={{ borderTop: `1px solid ${T.sidebarBorder}`, padding: collapsed ? 10 : 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, background: `linear-gradient(135deg, ${T.sidebarPrimary} 0%, hsl(162 90% 30%) 100%)`, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.sans, fontWeight: 700, fontSize: 13, flexShrink: 0 }}>JM</div>
        {!collapsed && (
          <>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 600, color: T.sidebarFg, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Joana Martins</div>
              <div style={{ fontFamily: T.sans, fontSize: 11, color: T.sidebarMuted }}>Gerente da planta</div>
            </div>
            <button onClick={onToggle} title="Recolher sidebar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.sidebarMuted, padding: 4, display: 'flex' }}>
              <i data-lucide="panel-left-close" style={{ width: 16, height: 16 }}></i>
            </button>
          </>
        )}
        {collapsed && (
          <button onClick={onToggle} title="Expandir sidebar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.sidebarMuted, padding: 0, display: 'none' }}>
            <i data-lucide="panel-left-open" style={{ width: 14, height: 14 }}></i>
          </button>
        )}
      </div>
      <style>{`
        @keyframes pulseRing { 0%, 100% { opacity: 0.4; transform: scale(1.6); } 50% { opacity: 0; transform: scale(2.4); } }
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(0.92); }
        }

        /* Scrollbar global */
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
        .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }

        /* Page enter animation */
        .page-enter {
          animation: pageEnter 220ms cubic-bezier(0.4, 0, 0.2, 1) both;
        }

        @keyframes pageEnter {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* Card hover elevation */
        .card-hover-elevation:hover {
          transform: translateY(-2px);
          box-shadow: 0 12px 24px -4px rgba(0,0,0,0.08), 0 4px 12px -2px rgba(0,0,0,0.04);
        }
      `}</style>
    </aside>
  );
}

function NavItem({ item, active, collapsed, onClick }) {
  const [hov, setHov] = useState(false);
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0 });

  useEffect(() => {
    if (collapsed && hov && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.top + (r.height / 2) - 13 });
    }
  }, [collapsed, hov]);

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef} onClick={onClick}
        onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
        style={{
          width: '100%',
          background: active ? T.sidebarAccent : hov ? 'hsl(217 32% 10%)' : 'transparent',
          border: 'none',
          borderLeft: active && !collapsed ? `3px solid ${T.sidebarPrimary}` : '3px solid transparent',
          borderRadius: collapsed ? 10 : '0 10px 10px 0',
          padding: collapsed ? '11px 0' : '9px 10px 9px 7px',
          display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 10,
          cursor: 'pointer',
          color: active ? 'white' : T.sidebarFg,
          fontFamily: T.sans, fontSize: 13, fontWeight: active ? 600 : 500,
          marginBottom: 2, transition: T.transitionFast,
          transform: active ? 'translateX(2px)' : hov ? 'translateX(1px)' : 'translateX(0)',
        }}
        title={collapsed ? item.label : undefined}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <i data-lucide={item.icon} style={{ width: 16, height: 16, color: active ? T.sidebarPrimary : 'inherit' }}></i>
          {!collapsed && <span>{item.label}</span>}
        </div>
        {!collapsed && item.badge && (
          item.badgeKind === 'live' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: T.mono, fontSize: 10, fontWeight: 700, padding: '2px 7px', background: 'hsl(162 80% 45% / 0.15)', color: T.sidebarPrimary, borderRadius: 999, border: `1px solid hsl(162 80% 45% / 0.3)` }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.sidebarPrimary, animation: 'pulse-slow 2s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}/>
              {item.badge}
            </span>
          ) : item.badgeKind === 'warn' ? (
            <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, padding: '1px 7px', background: 'hsl(38 92% 50% / 0.15)', color: 'hsl(38 92% 65%)', borderRadius: 999 }}>{item.badge}</span>
          ) : (
            <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, padding: '1px 7px', background: T.sidebarAccent, color: T.sidebarFg, borderRadius: 999 }}>{item.badge}</span>
          )
        )}
      </button>
      {collapsed && hov && (
        <div style={{
          position: 'fixed',
          left: 80,
          top: pos.top,
          background: T.foreground,
          color: 'white',
          fontFamily: T.sans,
          fontSize: 12,
          fontWeight: 600,
          padding: '5px 10px',
          borderRadius: 7,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 200,
          boxShadow: T.shadowElev,
        }}>{item.label}</div>
      )}
    </div>
  );
}

// ── TOPBAR ───────────────────────────────────────────────
function Topbar({ title, subtitle, actions, breadcrumbs }) {
  return (
    <div style={{ minHeight: 76, borderBottom: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 28px', position: 'sticky', top: 0, zIndex: 50, gap: 16 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        {breadcrumbs && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontFamily: T.sans, fontSize: 11, color: T.mutedFg, marginBottom: 4 }}>
            {breadcrumbs.map((b, i) => (
              <React.Fragment key={i}>
                <span style={{ cursor: 'pointer', color: i === breadcrumbs.length - 1 ? T.foreground : T.mutedFg, fontWeight: i === breadcrumbs.length - 1 ? 500 : 400, whiteSpace: 'nowrap' }}>{b}</span>
                {i < breadcrumbs.length - 1 && <span style={{ color: T.border }}>/</span>}
              </React.Fragment>
            ))}
          </div>
        )}
         <div style={{ display: 'flex', alignItems: 'center' }}>
           <div style={{ fontFamily: T.sans, fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: T.foreground, lineHeight: 1.2 }}>{title}</div>
           <span style={{
             display: 'inline-flex',
             alignItems: 'center',
             gap: 5,
             fontFamily: T.sans,
             fontSize: 11,
             fontWeight: 600,
             color: T.success,
             background: T.successSoft,
             padding: '3px 9px',
             borderRadius: 999,
             marginLeft: 10,
             verticalAlign: 'middle',
           }}>
             <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.success }}/>
             Sistema ok
           </span>
         </div>
        {subtitle && <div style={{ fontFamily: T.sans, fontSize: 12, color: T.mutedFg, marginTop: 3 }}>{subtitle}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SearchBox/>
        <NotifButton count={3}/>
        {actions}
      </div>
    </div>
  );
}

function SearchBox() {
  const [focus, setFocus] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <i data-lucide="search" style={{ width: 14, height: 14, position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: T.mutedFg }}></i>
      <input placeholder="Buscar OP, modelo, lote, SKU…"
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{ fontFamily: T.sans, fontSize: 13, padding: '9px 12px 9px 34px', border: `1px solid ${focus ? T.primary : T.border}`, borderRadius: 10, outline: 'none', width: 320, background: focus ? 'white' : T.mutedSoft, transition: T.transitionFast, boxShadow: focus ? `0 0 0 3px hsl(160 55% 24% / 0.1)` : 'none' }}/>
      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontFamily: T.mono, fontSize: 10, padding: '2px 5px', border: `1px solid ${T.border}`, borderRadius: 4, background: 'white', color: T.mutedFg }}>⌘K</span>
    </div>
  );
}

function NotifButton({ count }) {
  return (
    <button style={{ position: 'relative', background: 'white', border: `1px solid ${T.border}`, borderRadius: 10, width: 38, height: 38, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 140ms' }}>
      <i data-lucide="bell" style={{ width: 15, height: 15, color: T.foreground }}></i>
      {count > 0 && (
        <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: T.destructive, color: 'white', fontFamily: T.mono, fontSize: 9, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white' }}>{count}</span>
      )}
    </button>
  );
}

// ── BUTTON ───────────────────────────────────────────────
function Btn({ children, variant = 'primary', size = 'md', onClick, icon, iconRight, disabled, full }) {
  const [hov, setHov] = useState(false);
  const styles = {
    primary: {
      background: hov ? T.primaryHover : T.primary,
      color: T.primaryFg, border: 'none',
      boxShadow: hov ? '0 6px 16px hsl(162 90% 15% / 0.25)' : '0 2px 4px hsl(162 90% 15% / 0.12)',
    },
    accent: {
      background: hov ? 'hsl(50 55% 75%)' : T.accent,
      color: T.accentFg, border: 'none',
      boxShadow: hov ? '0 6px 16px hsl(50 30% 50% / 0.2)' : '0 2px 4px hsl(50 30% 50% / 0.1)',
    },
    ghost: {
      background: hov ? T.mutedSoft : 'white',
      color: T.foreground, border: `1px solid ${T.border}`,
      boxShadow: hov ? T.shadowCard : 'none',
    },
    subtle: {
      background: hov ? T.muted : T.mutedSoft, color: T.foreground, border: 'none',
    },
    danger: {
      background: hov ? 'hsl(0 84% 53%)' : T.destructive, color: 'white', border: 'none',
      boxShadow: hov ? '0 6px 16px hsl(0 84% 60% / 0.3)' : '0 2px 4px hsl(0 84% 60% / 0.15)',
    },
    success: {
      background: hov ? 'hsl(142 76% 30%)' : T.success, color: 'white', border: 'none',
      boxShadow: hov ? '0 6px 16px hsl(142 76% 36% / 0.3)' : '0 2px 4px hsl(142 76% 36% / 0.15)',
    },
  }[variant];
  const pad = size === 'sm' ? '7px 13px' : size === 'lg' ? '13px 22px' : '9px 16px';
  const fs = size === 'sm' ? 12 : size === 'lg' ? 14 : 13;
  return (
    <button onClick={!disabled ? onClick : undefined}
      onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        fontFamily: T.sans, fontSize: fs, fontWeight: 600, padding: pad,
        borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
        ...styles, display: 'inline-flex', alignItems: 'center', gap: 7,
        transition: 'all 180ms cubic-bezier(0.4, 0, 0.2, 1)',
        width: full ? '100%' : undefined, justifyContent: 'center',
        opacity: disabled ? 0.5 : 1, whiteSpace: 'nowrap',
      }}>
      {icon && <i data-lucide={icon} style={{ width: 14, height: 14 }}></i>}
      {children}
      {iconRight && <i data-lucide={iconRight} style={{ width: 14, height: 14 }}></i>}
    </button>
  );
}

// ── STATUS PILL ──────────────────────────────────────────
function StatusPill({ status, label, dot, size = 'md' }) {
  const map = {
    running:   { bg: T.successSoft, fg: T.successFg,    dot: T.success, lbl: 'Em produção' },
    queued:    { bg: T.infoSoft,    fg: T.infoFg,       dot: T.info,    lbl: 'Na fila' },
    paused:    { bg: T.warningSoft, fg: T.warningFg,    dot: T.warning, lbl: 'Pausada' },
    blocked:   { bg: T.destructiveSoft, fg: T.destructiveFg, dot: T.destructive, lbl: 'Bloqueada' },
    done:      { bg: T.muted,       fg: T.mutedFg,      dot: 'hsl(215 12% 60%)', lbl: 'Concluída' },
    qc:        { bg: 'hsl(269 50% 96%)', fg: 'hsl(269 60% 38%)', dot: 'hsl(269 60% 55%)', lbl: 'QC' },
    low:       { bg: T.warningSoft, fg: T.warningFg,    dot: T.warning, lbl: 'Baixo' },
    ok:        { bg: T.successSoft, fg: T.successFg,    dot: T.success, lbl: 'Em estoque' },
    out:       { bg: T.destructiveSoft, fg: T.destructiveFg, dot: T.destructive, lbl: 'Esgotado' },
    urgent:    { bg: T.destructiveSoft, fg: T.destructiveFg, dot: T.destructive, lbl: 'Urgente' },
    high:      { bg: T.warningSoft, fg: T.warningFg,    dot: T.warning, lbl: 'Alta' },
    medium:    { bg: T.infoSoft,    fg: T.infoFg,       dot: T.info,    lbl: 'Média' },
    low_pri:   { bg: T.muted,       fg: T.mutedFg,      dot: 'hsl(215 12% 60%)', lbl: 'Baixa' },
    late:      { bg: T.destructiveSoft, fg: T.destructiveFg, dot: T.destructive, lbl: 'Atrasada' },
  };
  const c = map[status] || map.done;
  const pad = size === 'sm' ? '2px 7px' : '3px 9px';
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: pad, borderRadius: 999, background: c.bg, color: c.fg, fontFamily: T.sans, fontSize: fs, fontWeight: 600, letterSpacing: '0.01em', whiteSpace: 'nowrap', ...(status === 'running' ? { boxShadow: `0 0 0 3px ${T.successSoft}` } : {}) }}>
      {dot !== false && <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.dot, ...(status === 'running' ? { boxShadow: `0 0 0 3px ${c.dot}33`, animation: 'pulse-slow 2s ease-in-out infinite' } : {}) }}/>}
      {label || c.lbl}
    </span>
  );
}

// ── KPI CARD ─────────────────────────────────────────────
function KpiCard({ label, value, unit, delta, deltaLabel, spark, kind, icon }) {
  const [hov, setHov] = useState(false);
  const positive = delta && delta.startsWith('+');
  const featured = kind === 'featured';
  return (
    <div style={{
      background: featured ? `linear-gradient(135deg, ${T.primary} 0%, hsl(162 90% 12%) 100%)` : 'white',
      border: featured ? 'none' : `1px solid ${T.border}`,
      borderTop: !featured ? `2px solid ${T.primarySoft}` : 'none',
      borderRadius: T.r, padding: 20,
      display: 'flex', flexDirection: 'column', gap: 12,
      position: 'relative', overflow: 'hidden',
      boxShadow: hov
        ? (featured ? '0 20px 40px -8px hsl(162 90% 15% / 0.45)' : T.shadowHover)
        : (featured ? '0 12px 28px -6px hsl(162 90% 15% / 0.35)' : T.shadowCard),
      color: featured ? 'white' : T.foreground,
      transform: hov ? 'translateY(-2px)' : 'translateY(0)',
      transition: T.transition,
      cursor: 'default',
    }}
    onMouseEnter={() => setHov(true)}
    onMouseLeave={() => setHov(false)}>
      {featured && (
        <div style={{ position: 'absolute', top: -40, right: -40, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, hsl(162 80% 45% / 0.25) 0%, transparent 70%)' }}/>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          {icon && (
            <div style={{ width: 28, height: 28, borderRadius: 8, background: featured ? 'rgba(255,255,255,0.12)' : T.primarySoft, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i data-lucide={icon} style={{ width: 14, height: 14, color: featured ? 'white' : T.primary }}></i>
            </div>
          )}
          <div style={{ fontFamily: T.sans, fontSize: 11, fontWeight: 600, color: featured ? 'rgba(255,255,255,0.7)' : T.mutedFg, letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{label}</div>
        </div>
        <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: featured ? 'rgba(255,255,255,0.5)' : T.mutedFg, padding: 0, display: 'flex', flexShrink: 0 }}>
          <i data-lucide="more-horizontal" style={{ width: 14, height: 14 }}></i>
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, position: 'relative' }}>
        <span style={{ fontFamily: T.mono, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', color: featured ? 'white' : T.foreground }}>{value}</span>
        {unit && <span style={{ fontFamily: T.sans, fontSize: 13, color: featured ? 'rgba(255,255,255,0.6)' : T.mutedFg, fontWeight: 500 }}>{unit}</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
        {delta && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: T.sans, fontSize: 11, fontWeight: 600, color: positive ? (featured ? 'hsl(160 80% 75%)' : T.success) : T.destructive }}>
            <i data-lucide={positive ? "trending-up" : "trending-down"} style={{ width: 12, height: 12 }}></i>
            {delta}
            <span style={{ color: featured ? 'rgba(255,255,255,0.55)' : T.mutedFg, fontWeight: 500, marginLeft: 2 }}>{deltaLabel}</span>
          </div>
        )}
        {spark && <Sparkline data={spark} positive={positive} featured={featured}/>}
      </div>
    </div>
  );
}

function Sparkline({ data, positive, featured }) {
  const max = Math.max(...data), min = Math.min(...data);
  const w = 80, h = 24;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / (max - min || 1)) * h}`).join(' ');
  const color = featured ? 'hsl(160 80% 75%)' : positive ? T.success : T.destructive;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <defs>
        <linearGradient id={`spark-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polyline points={`0,${h} ${pts} ${w},${h}`} fill={`url(#spark-${color.replace(/[^a-z0-9]/gi, '')})`} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ── PROGRESS BAR ─────────────────────────────────────────
function ProgressBar({ value, max = 100, color, height = 6, showLabel, segments }) {
  const pct = Math.min(100, (value / max) * 100);
  const c = color || (pct < 40 ? T.warning : pct < 80 ? T.info : T.success);
  return (
    <div>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: T.mono, fontSize: 11, color: T.mutedFg, marginBottom: 4 }}>
          <span>{value}/{max}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      )}
      <div style={{ height, background: T.muted, borderRadius: 999, overflow: 'hidden', position: 'relative' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: typeof c === 'string' ? c : `linear-gradient(90deg, ${T.primary}, ${T.success})`, borderRadius: 999, transition: 'width 600ms cubic-bezier(0.4, 0, 0.2, 1)' }}/>
        {segments && segments.map((s, i) => (
          <div key={i} style={{ position: 'absolute', top: -1, left: `${s}%`, width: 1, height: height + 2, background: 'white' }}/>
        ))}
      </div>
    </div>
  );
}

// ── DATA TABLE ───────────────────────────────────────────
function DataTable({ columns, rows, onRowClick, selectable, dense, footer = true }) {
  const [sel, setSel] = useState(new Set());
  const [hover, setHover] = useState(null);
  const toggle = (id) => {
    const n = new Set(sel);
    n.has(id) ? n.delete(id) : n.add(id);
    setSel(n);
  };
  return (
    <div style={{ background: 'white', border: `1px solid ${T.border}`, borderRadius: T.r, overflow: 'hidden', boxShadow: T.shadowCard }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.sans }}>
          <thead>
            <tr style={{ background: 'hsl(210 12% 96%)', borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 10 }}>
              {selectable && (
                <th style={{ padding: '11px 14px', width: 36 }}>
                  <input type="checkbox" onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} style={{ accentColor: T.primary }}/>
                </th>
              )}
              {columns.map(c => (
                <th key={c.key} style={{ textAlign: c.align || 'left', padding: dense ? '9px 14px' : '11px 14px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.mutedFg, whiteSpace: 'nowrap' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {c.label}
                    {c.sortable && <i data-lucide="chevrons-up-down" style={{ width: 11, height: 11, opacity: 0.4 }}></i>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} onClick={() => onRowClick && onRowClick(r)}
                onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)}
                style={{
                  borderBottom: i < rows.length - 1 ? `1px solid ${T.borderSoft}` : 'none',
                  cursor: onRowClick ? 'pointer' : 'default',
                  background: sel.has(r.id) ? T.primarySoft : hover === r.id ? T.mutedSoft : 'white',
                  transition: 'background 100ms ease',
                }}>
                {selectable && (
                  <td style={{ padding: '11px 14px' }} onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} style={{ accentColor: T.primary }}/>
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} style={{ padding: dense ? '9px 14px' : '13px 14px', fontSize: 13, color: T.foreground, textAlign: c.align || 'left', verticalAlign: 'middle' }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footer && (
        <div style={{ padding: '11px 16px', borderTop: `1px solid ${T.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: T.sans, fontSize: 12, color: T.mutedFg, background: T.mutedSoft }}>
          <span>{sel.size > 0 ? `${sel.size} selecionados` : `${rows.length} linhas`}</span>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <button style={{ background: 'white', border: `1px solid ${T.border}`, borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i data-lucide="chevron-left" style={{ width: 12, height: 12 }}></i></button>
            <span style={{ fontFamily: T.mono, fontSize: 11, padding: '0 8px' }}>1 / 4</span>
            <button style={{ background: 'white', border: `1px solid ${T.border}`, borderRadius: 6, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><i data-lucide="chevron-right" style={{ width: 12, height: 12 }}></i></button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── LINHA DE PRODUÇÃO (CARD) ─────────────────────────────
function LineCard({ line, model, sku, status, current, target, operator, eta, alert, stage }) {
  const c = status === 'running' ? T.success : status === 'paused' ? T.warning : status === 'blocked' ? T.destructive : 'hsl(215 12% 60%)';
  const stages = ['Corte', 'Costura', 'Montagem', 'Acabamento', 'Embalagem'];
  const stageIdx = stages.indexOf(stage);
  return (
    <div style={{ background: 'white', border: `1px solid ${alert ? T.destructive : T.border}`, borderRadius: T.r, padding: 18, position: 'relative', overflow: 'hidden', boxShadow: alert ? `0 0 0 3px hsl(0 84% 60% / 0.08), ${T.shadowCard}` : T.shadowCard, transition: 'box-shadow 220ms' }}>
      {alert && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: T.destructive }}/>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, color: T.mutedFg, letterSpacing: '0.08em' }}>{line}</div>
            {status === 'running' && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: T.sans, fontSize: 9, fontWeight: 700, color: T.success, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.success, boxShadow: `0 0 6px ${T.success}`, animation: 'pulse-slow 2s ease-in-out infinite' }}/>
                Ao vivo
              </span>
            )}
          </div>
          <div style={{ fontFamily: T.sans, fontSize: 15, fontWeight: 700, color: T.foreground, marginTop: 3 }}>{model}</div>
          {sku && <div style={{ fontFamily: T.mono, fontSize: 11, color: T.mutedFg, marginTop: 2 }}>{sku}</div>}
        </div>
        <StatusPill status={status}/>
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
          <span style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 700 }}>
            <span style={{ color: T.foreground }}>{current}</span>
            <span style={{ color: T.mutedFg, fontSize: 14 }}>/{target}</span>
          </span>
          <span style={{ fontFamily: T.sans, fontSize: 11, color: T.mutedFg }}>pares hoje</span>
        </div>
        <ProgressBar value={current} max={target} color={c} height={5}/>
      </div>
      <div style={{
        position: 'absolute',
        top: 16,
        right: 16,
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 700,
        color: status === 'running' ? T.success : T.mutedFg,
        background: status === 'running' ? T.successSoft : T.muted,
        padding: '2px 7px',
        borderRadius: 6,
      }}>
        {Math.round((current / target) * 100)}%
      </div>
      {stage && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {stages.map((s, i) => (
            <div key={s} style={{ flex: 1, height: 3, borderRadius: 999, background: i <= stageIdx ? c : T.muted, transition: 'background 300ms' }} title={s}/>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: T.sans, fontSize: 11, color: T.mutedFg, paddingTop: 11, borderTop: `1px solid ${T.borderSoft}` }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <i data-lucide="user" style={{ width: 11, height: 11 }}></i>
          {operator}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: T.mono }}>
          <i data-lucide="clock" style={{ width: 11, height: 11 }}></i>
          {eta}
        </span>
      </div>
    </div>
  );
}

// ── ALERT BANNER ─────────────────────────────────────────
function Alert({ kind = 'warn', title, body, action, onDismiss }) {
  const map = {
    warn:    { bg: T.warningSoft, bd: 'hsl(38 92% 75%)',  ic: 'alert-triangle', col: T.warningFg, accent: T.warning },
    danger:  { bg: T.destructiveSoft, bd: 'hsl(0 84% 80%)', ic: 'alert-octagon',  col: T.destructiveFg, accent: T.destructive },
    info:    { bg: T.infoSoft, bd: 'hsl(217 91% 80%)',    ic: 'info',           col: T.infoFg, accent: T.info },
    success: { bg: T.successSoft, bd: 'hsl(142 60% 75%)', ic: 'check-circle',   col: T.successFg, accent: T.success },
  }[kind];
  return (
    <div style={{ background: map.bg, border: `1px solid ${map.bd}`, borderRadius: T.rSm, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: map.accent }}/>
      <i data-lucide={map.ic} style={{ width: 16, height: 16, color: map.col, marginTop: 2, flexShrink: 0 }}></i>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 700, color: map.col }}>{title}</div>
        {body && <div style={{ fontFamily: T.sans, fontSize: 12, color: T.foreground, marginTop: 3, opacity: 0.85 }}>{body}</div>}
      </div>
      {action && <span style={{ fontFamily: T.sans, fontSize: 12, fontWeight: 600, color: map.col, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, whiteSpace: 'nowrap' }}>{action}</span>}
      {onDismiss && (
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: map.col, padding: 0, display: 'flex', opacity: 0.6 }}>
          <i data-lucide="x" style={{ width: 14, height: 14 }}></i>
        </button>
      )}
    </div>
  );
}

// ── PANEL ────────────────────────────────────────────────
function Panel({ title, subtitle, action, children, padding = 18, hover }) {
  return (
    <div className={hover ? 'card-hover-elevation' : ''} style={{ background: 'white', border: `1px solid ${T.border}`, borderRadius: T.r, overflow: 'hidden', boxShadow: T.shadowCard, transition: 'all 220ms' }}>
      {(title || action) && (
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.borderSoft}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {title && <div style={{ fontFamily: T.sans, fontSize: 14, fontWeight: 700, color: T.foreground, letterSpacing: '-0.01em' }}>{title}</div>}
            {subtitle && <div style={{ fontFamily: T.sans, fontSize: 12, color: T.mutedFg, marginTop: 2 }}>{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}

// ── BAR CHART ────────────────────────────────────────────
function BarChart({ data, labels, height = 140, highlightLast }) {
  const max = Math.max(...data);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height, paddingBottom: 4 }}>
        {data.map((v, i) => {
          const h = (v / max) * 100;
          const last = i === data.length - 1;
          return (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.mutedFg, fontWeight: 500 }}>{v}</span>
              <div style={{
                width: '100%', maxWidth: 32, height: `${h}%`,
                background: last && highlightLast ? `linear-gradient(180deg, ${T.success} 0%, ${T.primary} 100%)` : `linear-gradient(180deg, hsl(162 30% 80%) 0%, hsl(162 50% 60%) 100%)`,
                borderRadius: '6px 6px 0 0',
                transition: 'height 600ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}/>
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: `1px solid ${T.borderSoft}` }}>
        {labels.map((l, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontFamily: T.sans, fontSize: 10, color: T.mutedFg, fontWeight: 500 }}>{l}</div>
        ))}
      </div>
    </div>
  );
}

// ── STOCK BAR ────────────────────────────────────────────
function StockBar({ value, min, max }) {
  const pct = (value / max) * 100;
  const minPct = (min / max) * 100;
  const c = value < min ? T.destructive : value < min * 1.5 ? T.warning : T.success;
  return (
    <div style={{ position: 'relative', height: 6, background: T.muted, borderRadius: 999, width: 120 }}>
      <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 999, transition: 'width 400ms' }}/>
      <div style={{ position: 'absolute', top: -2, left: `${minPct}%`, width: 1, height: 10, background: T.foreground, opacity: 0.5 }} title={`Mínimo: ${min}`}/>
    </div>
  );
}

// ── TIMELINE ─────────────────────────────────────────────
function Timeline({ events }) {
  return (
    <div style={{ position: 'relative', paddingLeft: 20 }}>
      <div style={{ position: 'absolute', left: 5, top: 5, bottom: 5, width: 1, background: T.border }}/>
      {events.map((e, i) => {
        const dot = e.kind === 'alert' ? T.destructive : e.kind === 'shift' ? T.primary : e.kind === 'success' ? T.success : 'white';
        const ring = e.kind === 'alert' ? T.destructive : e.kind === 'shift' ? T.primary : e.kind === 'success' ? T.success : T.border;
        return (
          <div key={i} style={{ position: 'relative', paddingBottom: 14 }}>
            <div style={{ position: 'absolute', left: -19, top: 4, width: 11, height: 11, borderRadius: '50%', background: dot, border: `2px solid ${ring}`, boxShadow: e.kind === 'alert' ? `0 0 0 3px hsl(0 84% 60% / 0.15)` : 'none' }}/>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <div style={{ fontFamily: T.sans, fontSize: 13, fontWeight: 600, color: T.foreground }}>{e.title}</div>
              <div style={{ fontFamily: T.mono, fontSize: 11, color: T.mutedFg, whiteSpace: 'nowrap' }}>{e.time}</div>
            </div>
            {e.body && <div style={{ fontFamily: T.sans, fontSize: 12, color: T.mutedFg, marginTop: 2 }}>{e.body}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── GLASS CARD (componente novo) ────────────────────────
function GlassCard({ children, gradient, padding = 20 }) {
  return (
    <div style={{
      background: gradient ? `linear-gradient(135deg, ${T.primary} 0%, hsl(162 90% 12%) 100%)` : 'rgba(255, 255, 255, 0.7)',
      backdropFilter: 'blur(12px)',
      border: gradient ? 'none' : '1px solid rgba(255, 255, 255, 0.3)',
      boxShadow: gradient ? '0 12px 28px -6px hsl(162 90% 15% / 0.35)' : T.shadowElev,
      borderRadius: T.r,
      padding,
      color: gradient ? 'white' : T.foreground,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {children}
    </div>
  );
}

// ── BREADCRUMB COM AÇÃO RÁPIDA ──────────────────────────
function StageBadge({ stage }) {
  const stages = {
    'CORTE':       { bg: 'hsl(217 91% 95%)', fg: 'hsl(217 80% 38%)' },
    'COSTURA':     { bg: 'hsl(269 50% 96%)', fg: 'hsl(269 60% 38%)' },
    'MONTAGEM':    { bg: 'hsl(38 92% 95%)', fg: 'hsl(28 80% 30%)' },
    'ACABAMENTO':  { bg: 'hsl(162 30% 94%)', fg: 'hsl(162 90% 18%)' },
    'EMBALAGEM':   { bg: 'hsl(50 55% 92%)', fg: 'hsl(45 50% 25%)' },
  };
  const c = stages[stage] || { bg: T.muted, fg: T.mutedFg };
  return (
    <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: c.bg, color: c.fg, letterSpacing: '0.1em' }}>{stage}</span>
  );
}

export { T, useIsMobile, Sidebar, NavItem, Topbar, SearchBox, NotifButton, Btn, StatusPill, KpiCard, Sparkline, ProgressBar, DataTable, LineCard, Alert, Panel, BarChart, StockBar, Timeline, GlassCard, StageBadge };
