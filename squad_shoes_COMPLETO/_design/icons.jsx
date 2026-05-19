// Custom SVG icons — sectors of footwear factory
// Designed bespoke at 24×24, stroke 1.5, geometric premium feel

const Icon = {
  // ── SECTOR ICONS (custom, bespoke) ───────────────────────
  Corte: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <circle cx="6" cy="17" r="2.2"/>
      <circle cx="18" cy="17" r="2.2"/>
      <path d="M7.5 15.6 L18 5"/>
      <path d="M16.5 15.6 L6 5"/>
      <path d="M11 11.5 L13 13.5"/>
    </svg>
  ),
  Costura: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M3 12 L21 12"/>
      <path d="M3 12 L5 9 M5 9 L7 12 M7 12 L9 9 M9 9 L11 12 M11 12 L13 9 M13 9 L15 12 M15 12 L17 9 M17 9 L19 12 M19 12 L21 9" strokeDasharray="0" strokeWidth="1.2"/>
      <circle cx="4" cy="6" r="0.6" fill="currentColor"/>
      <circle cx="20" cy="6" r="0.6" fill="currentColor"/>
    </svg>
  ),
  Montagem: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M4 18 C 4 14, 7 11, 11 11 L 17 11 C 19 11, 20 12.5, 20 14 L 20 16 C 20 17.5, 18.5 18, 17 18 Z"/>
      <path d="M11 11 L 11 8 C 11 6.5, 12 5.5, 13.5 5.5 L 16 5.5"/>
      <line x1="6.5" y1="18" x2="6.5" y2="20.5"/>
      <line x1="17.5" y1="18" x2="17.5" y2="20.5"/>
    </svg>
  ),
  Acabamento: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M4 17 L9 6 L 15 6 L 20 17 Z"/>
      <path d="M7 14 L17 14"/>
      <path d="M11 6 L11 14"/>
      <path d="M9 17 L9 20 M15 17 L15 20"/>
    </svg>
  ),
  Embalagem: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M4 8 L12 4 L20 8 L20 17 L12 21 L4 17 Z"/>
      <path d="M4 8 L12 12 L20 8"/>
      <path d="M12 12 L12 21"/>
      <path d="M8 6 L16 10" strokeOpacity="0.5"/>
    </svg>
  ),
  Qualidade: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M12 3 L20 7 L20 13 C 20 17, 16 20, 12 21 C 8 20, 4 17, 4 13 L 4 7 Z"/>
      <path d="M9 12 L11.5 14.5 L16 9.5"/>
    </svg>
  ),
  Expedicao: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <rect x="2" y="8" width="12" height="9" rx="1"/>
      <path d="M14 11 L18 11 L21 14 L21 17 L14 17"/>
      <circle cx="7" cy="18.5" r="1.8"/>
      <circle cx="17" cy="18.5" r="1.8"/>
    </svg>
  ),
  Materiais: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <rect x="3" y="9" width="8" height="6" rx="0.5"/>
      <rect x="13" y="5" width="8" height="6" rx="0.5"/>
      <rect x="13" y="13" width="8" height="6" rx="0.5"/>
      <line x1="3" y1="20" x2="21" y2="20"/>
    </svg>
  ),
  PCP: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <rect x="3" y="4" width="18" height="16" rx="1"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="8" y1="9" x2="8" y2="20"/>
      <rect x="9.5" y="11" width="4" height="3" fill="currentColor" stroke="none" opacity="0.4"/>
      <rect x="14.5" y="14" width="5" height="3" fill="currentColor" stroke="none" opacity="0.4"/>
    </svg>
  ),
  Dashboard: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M3 13 C 3 7, 7 3, 12 3 C 17 3, 21 7, 21 13"/>
      <line x1="3" y1="13" x2="6" y2="13"/>
      <line x1="18" y1="13" x2="21" y2="13"/>
      <line x1="12" y1="3" x2="12" y2="6"/>
      <path d="M12 13 L16 8" strokeWidth="2"/>
      <circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none"/>
    </svg>
  ),
  Equipe: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <circle cx="9" cy="8" r="3"/>
      <path d="M3 19 C 3 15, 5.5 13, 9 13 C 12.5 13, 15 15, 15 19"/>
      <circle cx="17" cy="9.5" r="2.2"/>
      <path d="M15 19 C 15 16.5, 17 15, 19 15 C 20 15, 21 15.4, 21 16"/>
    </svg>
  ),
  Relatorios: (p) => (
    <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}>
      <path d="M5 21 L5 9 L9 9 L9 21"/>
      <path d="M11 21 L11 5 L15 5 L15 21"/>
      <path d="M17 21 L17 13 L21 13 L21 21"/>
      <line x1="3" y1="21" x2="22" y2="21"/>
    </svg>
  ),

  // ── UI / GENERIC ───────────────────────────
  Search: (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><circle cx="11" cy="11" r="6"/><path d="M16 16 L20 20"/></svg>,
  Bell:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><path d="M6 16 L6 11 C 6 7.5, 8.5 5, 12 5 C 15.5 5, 18 7.5, 18 11 L 18 16 L 20 18 L 4 18 Z"/><path d="M10 21 C 10 21.5, 11 22, 12 22 C 13 22, 14 21.5, 14 21"/></svg>,
  Plus:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Sun:    (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="6.5" y2="6.5"/><line x1="17.5" y1="17.5" x2="19" y2="19"/><line x1="5" y1="19" x2="6.5" y2="17.5"/><line x1="17.5" y1="6.5" x2="19" y2="5"/></svg>,
  Moon:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><path d="M20 14.5 A 8 8 0 0 1 9.5 4 A 8 8 0 1 0 20 14.5 Z"/></svg>,
  Play:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none"/></svg>,
  Pause:  (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none"/></svg>,
  Stop:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none"/></svg>,
  Alert:  (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><path d="M12 3 L22 20 L2 20 Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.8" fill="currentColor"/></svg>,
  Check:  (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><polyline points="4,12 10,18 20,6"/></svg>,
  ArrowUp:(p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><line x1="12" y1="20" x2="12" y2="4"/><polyline points="6,10 12,4 18,10"/></svg>,
  ArrowDown:(p)=><svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><line x1="12" y1="4" x2="12" y2="20"/><polyline points="6,14 12,20 18,14"/></svg>,
  Menu:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>,
  Filter: (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><path d="M3 5 L21 5 L14 13 L14 20 L10 18 L10 13 Z"/></svg>,
  Dot3:   (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/></svg>,
  Calendar:(p)=><svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><rect x="3" y="5" width="18" height="16" rx="1"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>,
  Cmd:    (p) => <svg viewBox="0 0 24 24" {...p} className={`icon ${p.className||''}`}><path d="M9 9 L9 15 L15 15 L15 9 Z"/><path d="M9 9 C 9 6.5, 7.5 5, 6 5 C 4.5 5, 3 6.5, 3 8 C 3 9.5, 4.5 9, 6 9 L 9 9"/><path d="M15 9 L18 9 C 19.5 9, 21 9.5, 21 8 C 21 6.5, 19.5 5, 18 5 C 16.5 5, 15 6.5, 15 9"/><path d="M9 15 C 9 17.5, 7.5 19, 6 19 C 4.5 19, 3 17.5, 3 16 C 3 14.5, 4.5 15, 6 15 L 9 15"/><path d="M15 15 L18 15 C 19.5 15, 21 14.5, 21 16 C 21 17.5, 19.5 19, 18 19 C 16.5 19, 15 17.5, 15 15"/></svg>,
  Brand:  (p) => (
    <svg viewBox="0 0 32 32" {...p}>
      <rect x="1" y="1" width="30" height="30" rx="4" fill="#0A0A0A" stroke="#E11D2E" strokeWidth="1.5"/>
      <path d="M8 22 L8 14 L 13 14 L 16 10 L 24 10 L 24 18 L 19 22 Z" fill="none" stroke="#E11D2E" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="11" cy="22.5" r="1.5" fill="#FFFFFF"/>
      <circle cx="21" cy="22.5" r="1.5" fill="#FFFFFF"/>
    </svg>
  ),
};

window.Icon = Icon;
