// ETIQUETAS FÍSICAS — formatos reais (mm → px @ 96dpi)
// Foco: impressora térmica · caixa individual + caixa externa
// B&W com vermelho de destaque · barcode grande · alta legibilidade

// ═══════════════════════════════════════════════════════════════
// MODELOS — dados consistentes usados em etiquetas + fichas
// ═══════════════════════════════════════════════════════════════
const MODELOS = {
  'I901': {
    ref: 'I901',
    name: 'MOCASSIM VERONA',
    cor: 'ADOCICADO',
    sku: 'MV-ADC',
    categoria: 'Mocassim',
    type: 'unico',
    swatches: [
    { h: '#5C2F1E', label: 'CAB', name: 'Adocicado', material: 'Verniz' },
    { h: '#F2E6D3', label: 'FOR', name: 'Creme', material: 'Pelica' }],

    numeracao: [34, 35, 36, 37, 38, 39]
  },
  'I905': {
    ref: 'I905',
    name: 'SANDÁLIA LEILA',
    cor: 'CARAMELO · CRU · CARAMELO',
    sku: 'SL-3T-CCC',
    categoria: 'Sandália de tiras',
    type: 'tiras',
    swatches: [
    { h: '#8E5326', label: 'T1', name: 'Caramelo', material: 'Couro' },
    { h: '#E8DCC8', label: 'T2', name: 'Cru', material: 'Couro' },
    { h: '#8E5326', label: 'T3', name: 'Caramelo', material: 'Couro' },
    { h: '#1A1A1A', label: 'SL', name: 'Preto', material: 'TR sola' }],

    numeracao: [34, 35, 36, 37, 38]
  },
  'I918': {
    ref: 'I918',
    name: 'SCARPIN BIANCA',
    cor: 'PRETO VERNIZ',
    sku: 'SB-PRT',
    categoria: 'Scarpin',
    type: 'unico',
    swatches: [
    { h: '#0E0E0E', label: 'CAB', name: 'Preto', material: 'Verniz' },
    { h: '#F0EAE0', label: 'FOR', name: 'Creme', material: 'Pelica' }],

    numeracao: [33, 34, 35, 36, 37, 38, 39]
  }
};

// ─── RefChip — badge preto com REF (uso global). USA prop "code" — não "ref" (reservado pelo React)
function RefChip({ code, size = 'sm', dark = false }) {
  const sz = size === 'lg' ? { fs: 12, py: 3, px: 10 } : size === 'md' ? { fs: 10, py: 2, px: 8 } : { fs: 9, py: 1, px: 6 };
  return (
    <span style={{
      display: 'inline-block',
      background: dark ? 'var(--p-red)' : 'var(--p-ink)',
      color: '#fff',
      padding: `${sz.py}px ${sz.px}px`,
      fontFamily: 'JetBrains Mono', fontSize: sz.fs, fontWeight: 700, letterSpacing: '0.08em',
      lineHeight: 1,
    }}>REF {code}</span>
  );
}

// ─── Cores nomeadas (para mapear tira→hex) ──
const COR_HEX = {
  'ADOCICADO':  '#5C2F1E',
  'CHAMPAGNE':  '#D9C9A8',
  'OFF WHITE':  '#F2E9D8',
  'MILK':       '#F4ECDC',
  'CARAMELO':   '#8E5326',
  'CRU':        '#E8DCC8',
  'PRETO':      '#0E0E0E',
  'CREME':      '#F2E6D3',
  'DOURADO':    '#C9A35A',
};
function hexFor(name) { return COR_HEX[String(name || '').toUpperCase()] || '#999'; }
function tiraSwatches(item) {
  return (item.tiras || []).map((t, i) => ({
    label: `T${i+1}`, name: t, h: hexFor(t), material: item.material,
  }));
}

// ColorChips — exibe sequência de cores com label (T1, T2, T3 para tiras)
function ColorChips({ swatches, size = 'md', showLabels = true, showNames = true, dark = false }) {
  const dim = { xs: 12, sm: 16, md: 22, lg: 30 }[size];
  const labelFs = { xs: 6.5, sm: 7, md: 7.5, lg: 9 }[size];
  const nameFs = { xs: 7, sm: 8, md: 9, lg: 10.5 }[size];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: size === 'xs' ? 3 : 6, flexWrap: 'wrap' }}>
      {swatches.map((s, i) =>
      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
          {showLabels &&
        <div style={{
          fontFamily: 'JetBrains Mono', fontSize: labelFs,
          letterSpacing: '0.16em', fontWeight: 700,
          color: dark ? 'rgba(255,255,255,0.7)' : 'var(--p-mute)'
        }}>{s.label}</div>
        }
          <div style={{
          width: dim, height: dim,
          background: s.h,
          border: dark ? '1px solid rgba(255,255,255,0.6)' : '1px solid #000',
          boxShadow: '0 0 0 2px #fff inset'
        }} />
          {showNames &&
        <div style={{
          fontSize: nameFs, fontWeight: 600,
          color: dark ? '#fff' : 'var(--p-ink)',
          textAlign: 'center', lineHeight: 1.1,
          maxWidth: dim + 18
        }}>{s.name}</div>
        }
        </div>
      )}
    </div>);

}

// ─── helpers ──────
function Barcode({ value = '7891234567890', height = 38, scale = 1, dense = false }) {
  // Pseudo-Code128 — visual only; bar widths derived from a hash of value
  // so repeated values look identical and different values differ.
  const seed = [...value].reduce((a, c) => a * 31 + c.charCodeAt(0) >>> 0, 0);
  const rand = (i) => (seed + i * 2654435761 >>> 0) / 0xffffffff;
  const bars = [];
  let n = dense ? 80 : 60;
  for (let i = 0; i < n; i++) {
    const w = Math.floor(rand(i) * 3) + 1; // 1-3 units
    const isBar = rand(i + 100) > 0.45;
    bars.push({ w, bar: isBar });
  }
  return (
    <div style={{ display: 'inline-block', lineHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'stretch', height, gap: 0 }}>
        {bars.map((b, i) =>
        <div key={i} style={{
          width: b.w * scale, height: '100%',
          background: b.bar ? '#000' : 'transparent'
        }} />
        )}
      </div>
      <div style={{
        fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10 * scale,
        letterSpacing: '0.3em', textAlign: 'center', marginTop: 4, color: '#000'
      }}>{value}</div>
    </div>);

}

function MiniMark({ size = 22, on = 'white' }) {
  return (
    <div style={{
      width: size, height: size, border: '1.5px solid currentColor',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', flexShrink: 0
    }}>
      <div style={{ fontFamily: 'Anton', fontSize: size * 0.55, lineHeight: 1, letterSpacing: '0.02em' }}>S</div>
      <div style={{ position: 'absolute', top: -2, right: -2, width: 5, height: 5, background: 'var(--p-red)' }} />
    </div>);

}

// Thermal-look shell: pure white, black borders, no soft shadows
function ThermalShell({ w, h, children }) {
  return (
    <div style={{
      width: w, height: h,
      background: 'var(--p-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20, boxSizing: 'border-box'
    }}>
      <div style={{
        width: w - 40, height: h - 40,
        background: '#fff',
        border: '1px solid #000',
        boxShadow: '0 10px 24px -12px rgba(0,0,0,0.25)',
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Inter Tight', sans-serif",
        color: '#000'
      }}>
        {/* Roll perforation indicator */}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: -2, width: 4, backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 4px, rgba(0,0,0,0.25) 4px 6px)' }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, right: -2, width: 4, backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 4px, rgba(0,0,0,0.25) 4px 6px)' }} />
        {children}
      </div>
    </div>);

}

// Generic "soft" shell (the cartão A5 and tags use this; not thermal)
function LabelShell({ w, h, children }) {
  return (
    <div style={{
      width: w, height: h,
      background: 'var(--p-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, boxSizing: 'border-box'
    }}>
      <div style={{
        width: w - 48, height: h - 48,
        background: '#fff',
        boxShadow: '0 1px 0 #e5e0d8, 0 16px 40px -16px rgba(20,17,14,0.25)',
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Inter Tight', sans-serif",
        color: 'var(--p-ink)'
      }}>
        {children}
      </div>
    </div>);

}

// ─── SilkMark — "marca" estampada (definida pelo solado do produto)
// Renderiza um logo/estampa pequena que vai impresso no calçado.
// silk='HOST' | 'NOVA' | 'PRIME' | 'ICON' — cada solado mapeia para um silk.
function SilkMark({ silk = 'HOST', height = 22, dark = true }) {
  const fg = dark ? '#FFE94A' : '#000';
  const bg = dark ? '#000' : 'transparent';
  if (silk === 'HOST') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, color: fg, padding: `2px 8px`, height, boxSizing: 'border-box' }}>
        <svg width={height - 4} height={height - 4} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M 4 12 L 9 4 L 14 12 L 9 20 Z" fill={fg}/>
          <circle cx="17" cy="12" r="3" fill={fg}/>
        </svg>
        <span style={{ fontFamily: 'Anton', fontSize: height * 0.7, letterSpacing: '0.06em', lineHeight: 1 }}>HOST</span>
      </div>
    );
  }
  if (silk === 'NOVA') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, color: fg, padding: `2px 8px`, height, boxSizing: 'border-box' }}>
        <svg width={height - 4} height={height - 4} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <path d="M 12 2 L 14 10 L 22 12 L 14 14 L 12 22 L 10 14 L 2 12 L 10 10 Z" fill={fg}/>
        </svg>
        <span style={{ fontFamily: 'Anton', fontSize: height * 0.7, letterSpacing: '0.06em', lineHeight: 1 }}>NOVA</span>
      </div>
    );
  }
  if (silk === 'PRIME') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, color: fg, padding: `2px 8px`, height, boxSizing: 'border-box' }}>
        <svg width={height - 4} height={height - 4} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
          <circle cx="12" cy="12" r="9" fill="none" stroke={fg} strokeWidth="2.5"/>
          <circle cx="12" cy="12" r="3.5" fill={fg}/>
        </svg>
        <span style={{ fontFamily: 'Anton', fontSize: height * 0.7, letterSpacing: '0.06em', lineHeight: 1 }}>PRIME</span>
      </div>
    );
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: bg, color: fg, padding: `2px 8px`, height, boxSizing: 'border-box' }}>
      <span style={{ fontFamily: 'Anton', fontSize: height * 0.7, letterSpacing: '0.06em', lineHeight: 1 }}>{silk}</span>
    </div>
  );
}
window.SilkMark = SilkMark;

// Mapeamento solado → silk (regra de negócio: solado define qual marca é estampada)
const SOLADO_TO_SILK = {
  'TR-04':  'HOST',
  'TR-PR':  'HOST',
  'TR-12':  'NOVA',
  'EVA-22': 'NOVA',
  'PU-08':  'PRIME',
  'COURO-A':'PRIME',
  'TR-09':  'HOST',
  'TR-14':  'HOST',
  'TR-21':  'NOVA',
};
function silkBySolado(solado) { return SOLADO_TO_SILK[solado] || 'HOST'; }
window.silkBySolado = silkBySolado;

// Placeholder de foto do calçado — usado em várias etiquetas/fichas
// variant: 'soft' (cinza claro) | 'photo' (foto realista placeholder com sombra) | 'photo-yellow' (sobre fundo amarelo)
function ShoePhoto({ w, h, label = 'Foto do par', variant = 'soft', framed = false }) {
  const isPhoto = variant === 'photo' || variant === 'photo-yellow';
  const bg = variant === 'photo-yellow' ? '#FFE94A' : variant === 'photo' ? '#F2EEE5' : 'var(--p-soft)';
  return (
    <div style={{
      width: w, height: h,
      background: bg,
      border: framed ? '2px solid #000' : '1px solid var(--p-line-2)',
      position: 'relative', overflow: 'hidden', flexShrink: 0,
    }}>
      <svg viewBox="0 0 200 130" preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%' }}>
        {isPhoto ? (
          <g>
            {/* Sombra elíptica */}
            <ellipse cx="100" cy="118" rx="78" ry="6" fill="#000" opacity="0.18"/>
            {/* Sola */}
            <path d="M 24 100 Q 26 86 40 84 L 150 84 Q 174 84 180 96 Q 184 104 184 110 Q 184 114 180 114 L 32 114 Q 24 114 24 108 Z"
              fill="#1A1A1A" stroke="#000" strokeWidth="0.8"/>
            <path d="M 24 110 L 184 110 L 184 114 L 24 114 Z" fill="#0A0A0A"/>
            {/* Cabedal principal */}
            <path d="M 40 84 Q 44 56 70 50 L 124 50 Q 156 52 168 70 Q 178 80 180 96 L 40 96 Z"
              fill="#2A2A2A" stroke="#000" strokeWidth="0.8"/>
            {/* Listras laterais (3 listras Adidas-like) */}
            {[78, 92, 106].map((x, i) => (
              <path key={i} d={`M ${x} 80 L ${x + 10} 50 L ${x + 22} 50 L ${x + 12} 84 Z`}
                fill="#FFE94A" stroke="#000" strokeWidth="0.6"/>
            ))}
            {/* Gola/abertura traseira */}
            <path d="M 124 50 Q 138 48 148 56 Q 158 64 162 76 L 158 80 Q 152 64 142 60 Q 132 56 124 56 Z" fill="#1A1A1A"/>
            {/* Cadarço */}
            <g stroke="#fff" strokeWidth="1" fill="none">
              <line x1="48" y1="72" x2="60" y2="68"/>
              <line x1="52" y1="80" x2="64" y2="76"/>
              <line x1="56" y1="86" x2="68" y2="82"/>
            </g>
            {/* Reflexo cabedal */}
            <path d="M 48 60 Q 60 56 80 56" fill="none" stroke="#fff" strokeWidth="1" opacity="0.18"/>
          </g>
        ) : (
          <g>
            <path d="M 16 76 Q 20 60 36 60 L 112 60 Q 140 60 160 72 Q 184 80 184 92 L 184 100 Q 184 104 180 104 L 20 104 Q 16 104 16 100 Z"
              fill="var(--p-line-2)" stroke="var(--p-dim)" strokeWidth="0.6"/>
            <path d="M 56 60 Q 60 44 76 44 L 100 44 Q 112 44 112 60" fill="var(--p-line-2)" stroke="var(--p-dim)" strokeWidth="0.6"/>
            <line x1="72" y1="60" x2="72" y2="100" stroke="var(--p-dim)" strokeWidth="0.4" strokeDasharray="1 1"/>
          </g>
        )}
      </svg>
      {label && (
        <div style={{
          position: 'absolute', bottom: 4, left: 4, right: 4,
          textAlign: 'center', fontFamily: 'JetBrains Mono', fontSize: 7,
          letterSpacing: '0.16em', color: isPhoto ? 'rgba(0,0,0,0.55)' : 'var(--p-mute)', textTransform: 'uppercase',
          fontWeight: 700,
        }}>{label}</div>
      )}
    </div>
  );
}

// ─── 1. ETIQUETA CAIXA INDIVIDUAL · A (100×60mm) ─────────
// Impressora térmica · adesivo na lateral da caixa · destaque MODELO+REF+COR + foto enorme
function EtqCxInd() {
  const m = MODELOS['I901'];
  return (
    <ThermalShell w={378} h={227}>
      <div style={{ height: '100%', display: 'flex' }}>
        {/* FOTO ENORME — ocupa altura inteira da etiqueta */}
        <div style={{ width: 138, borderRight: '1px solid #000', display: 'flex', flexDirection: 'column' }}>
          <ShoePhoto w={138} h={227} variant="photo" framed={false} label=""/>
        </div>

        {/* Direita — dados completos */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* faixa brand + ref */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #000', background: '#000', color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MiniMark size={12}/>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.16em', fontWeight: 700 }}>SQUAD SHOES · CX IND</div>
            </div>
            <div style={{ background: '#fff', color: '#000', padding: '2px 7px', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>REF {m.ref}</div>
          </div>

          {/* modelo + cor */}
          <div style={{ padding: '6px 10px 4px' }}>
            <div style={{ fontFamily: 'Anton', fontSize: 18, lineHeight: 0.95, letterSpacing: '0.01em' }}>{m.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              <ColorChips swatches={m.swatches} size="xs" showLabels={false} showNames={false}/>
              <div style={{ fontSize: 9, fontWeight: 600 }}>{m.cor}</div>
            </div>
          </div>

          {/* Numeração massiva + barcode */}
          <div style={{ flex: 1, display: 'flex' }}>
            <div style={{ flex: 1, padding: '4px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid #000' }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 6.5, letterSpacing: '0.18em', textTransform: 'uppercase' }}>NUM</div>
              <div style={{ fontFamily: 'Anton', fontSize: 56, lineHeight: 0.85, color: 'var(--p-red)' }}>37</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, fontWeight: 700, letterSpacing: '0.16em' }}>PAR 1/1</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: '#000', marginTop: 4 }}/>
            <div style={{ width: 86, padding: '4px 6px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', borderTop: '1px solid #000' }}>
              <div style={{ fontSize: 7.5 }}>
                {[
                  ['SKU', `${m.sku}-37`],
                  ['OP',  'OP-2847'],
                  ['LT',  'L26-0190'],
                ].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 4, borderBottom: '1px dotted #000', padding: '1px 0' }}>
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 6, letterSpacing: '0.1em' }}>{r[0]}</span>
                    <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 7 }}>{r[1]}</span>
                  </div>
                ))}
              </div>
              <Barcode value="7891234567890" height={18} scale={0.75} dense/>
            </div>
          </div>
        </div>
      </div>
    </ThermalShell>
  );
}

// ─── 2. ETIQUETA CAIXA INDIVIDUAL · B (100×100mm) ───
// Sandália de tiras — foto enorme + sequência de cores T1/T2/T3
function EtqCxIndB() {
  const m = MODELOS['I905']; // Sandália Leila com tiras
  return (
    <ThermalShell w={378} h={378}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* faixa preta topo */}
        <div style={{ background: '#000', color: '#fff', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MiniMark size={14}/>
            <div style={{ fontFamily: 'Anton', fontSize: 13, letterSpacing: '0.04em' }}>SQUAD SHOES</div>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em' }}>REF {m.ref}</div>
        </div>

        {/* FOTO ENORME ocupa ~40% da altura */}
        <ShoePhoto w={378} h={154} variant="photo" framed={false} label=""/>

        {/* HERO: modelo + categoria */}
        <div style={{ padding: '6px 12px 2px', borderTop: '1px solid #000' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.18em', textTransform: 'uppercase' }}>{m.categoria}</div>
          <div style={{ fontFamily: 'Anton', fontSize: 20, letterSpacing: '0.01em', lineHeight: 1, marginTop: 2 }}>{m.name}</div>
        </div>

        {/* Cores em sequência */}
        <div style={{ padding: '4px 12px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', border: '1px solid #000', background: '#fafafa' }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.16em', fontWeight: 700 }}>CORES:</span>
            <ColorChips swatches={m.swatches} size="sm" showLabels showNames/>
          </div>
        </div>

        {/* Numeração + meta */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', padding: '4px 12px' }}>
          <div style={{ flex: 1, border: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '4px 8px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 6.5, letterSpacing: '0.18em' }}>NUM</div>
              <div style={{ fontFamily: 'Anton', lineHeight: 0.85, color: 'var(--p-red)', fontSize: 40 }}>37</div>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: '#000' }}/>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 6.5, letterSpacing: '0.18em' }}>PAR</div>
              <div style={{ fontFamily: 'Anton', fontSize: 28, lineHeight: 0.9 }}>1<span style={{ fontSize: 14, verticalAlign: 'super', margin: '0 2px' }}>/</span>1</div>
            </div>
          </div>
        </div>

        {/* Meta */}
        <div style={{ padding: '2px 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px', rowGap: 0, fontSize: 8 }}>
          {[
            ['SKU', `${m.sku}-37`],
            ['Lote', 'L26-0192'],
            ['OP', 'OP-2851'],
            ['Cliente', 'VIP Araruama'],
          ].map((r, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, borderBottom: '1px dotted #000', padding: '1px 0' }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 6.5, letterSpacing: '0.1em' }}>{r[0]}</span>
              <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 7.5 }}>{r[1]}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: '3px 12px 6px', borderTop: '1px solid #000', background: '#fff', marginTop: 2 }}>
          <Barcode value="7891234567893" height={22}/>
        </div>
      </div>
    </ThermalShell>
  );
}

// ─── 3. ETIQUETA CAIXA EXTERNA · A — YELLOW PATTERN (150×100mm LANDSCAPE) ──
// Inspiração: etiqueta amarela fluorescente padrão da indústria de calçados
// FOTO ENORME à direita, dados estruturados à esquerda, tabela de grade no rodapé
function EtqCxExt() {
  const m = MODELOS['I901'];
  // Grade de tamanhos
  const grade = [
    { num: 34, qtd: 2 },
    { num: 35, qtd: 4 },
    { num: 36, qtd: 6 },
    { num: 37, qtd: 6 },
    { num: 38, qtd: 4 },
    { num: 39, qtd: 2 },
  ];
  return (
    <div style={{
      width: 748, height: 499,
      background: 'var(--p-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 18, boxSizing: 'border-box',
    }}>
      <div style={{
        width: 712, height: 463,
        background: '#FFE94A', /* amarelo fluorescente */
        border: '1.5px solid #000',
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Inter Tight', sans-serif", color: '#000',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 10px 24px -12px rgba(0,0,0,0.25)',
      }}>
        {/* HEADER: NF (DESTAQUE) / PROG */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', borderBottom: '1.5px solid #000' }}>
          <div style={{ padding: '6px 10px', borderRight: '1.5px solid #000', display: 'flex', alignItems: 'baseline', gap: 8, background: '#000', color: '#FFE94A' }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em' }}>NF:</span>
            <span style={{ fontFamily: 'Anton', fontSize: 34, letterSpacing: '0.02em', lineHeight: 1 }}>189.428</span>
          </div>
          <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 11.5, letterSpacing: '0.06em' }}>PROG.:</span>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 14, fontWeight: 700 }}>H26072 / FICHA 0002</span>
          </div>
        </div>

        {/* CORPO PRINCIPAL: 2 colunas */}
        <div style={{ display: 'flex', flex: 1 }}>
          {/* ESQUERDA — dados do destinatário */}
          <div style={{ flex: 1.3, borderRight: '1.5px solid #000', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, fontWeight: 600 }}>
            {[
              ['CLIENTE',     'SAPATARIA PAULO'],
              ['CNPJ',        '28.832.376/0001-81'],
              ['ENDEREÇO',    'PRAÇA PREFEITO ALCINDO SODRE, 06 LOJA 11'],
              ['BAIRRO',      'CENTRO'],
              ['CIDADE',      'PETROPOLIS'],
              ['UF',          'RJ'],
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'baseline', borderBottom: '0.5px solid #000', paddingBottom: 1 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', minWidth: 76 }}>{r[0]}:</span>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{r[1]}</span>
              </div>
            ))}
            <div style={{ height: 4 }}/>
            {[
              ['IDENTIF. CLI', '—'],
              ['PED. COMPRA',  '4108'],
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'baseline', borderBottom: '0.5px solid #000', paddingBottom: 1 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', minWidth: 76 }}>{r[0]}:</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 12 }}>{r[1]}</span>
              </div>
            ))}
          </div>

          {/* DIREITA — FOTO GIGANTE com moldura preta */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 8 }}>
            <div style={{ flex: 1, border: '2px solid #000', background: '#FFE94A', position: 'relative', overflow: 'hidden' }}>
              <ShoePhoto w={310} h={240} variant="photo-yellow" label=""/>
            </div>
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
              <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 9.5, letterSpacing: '0.06em' }}>{m.cor.replace('CARAMELO · CRU · CARAMELO', 'MARINHO/PRETO/VERDE LIMÃO')}</span>
            </div>
          </div>
        </div>

        {/* TABELA DE GRADE — rodapé */}
        <div style={{ display: 'flex', borderTop: '1.5px solid #000' }}>
          {/* Coluna labels esquerda */}
          <div style={{ borderRight: '1.5px solid #000', display: 'flex', flexDirection: 'column' }}>
            {['MARCA:', 'REFERENCIA', 'TAMANHO', 'QUANTIDADE'].map((l, i) => (
              <div key={i} style={{
                padding: '5px 10px', borderBottom: i < 3 ? '1px solid #000' : 'none', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em', minWidth: 110, background: i === 0 ? '#000' : 'transparent', color: i === 0 ? '#FFE94A' : '#000',
              }}>{l}</div>
            ))}
          </div>

          {/* Valores em grid */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${grade.length + 1}, 1fr)` }}>
            {/* Row 1: MARCA — silk image */}
            <div style={{ padding: '3px 8px', borderBottom: '1px solid #000', borderRight: '1px solid #000', background: '#000', gridColumn: 'span 7', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 6 }}>
              <SilkMark silk={silkBySolado('TR-04')} height={22} dark/>
              <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'rgba(255,233,74,0.6)', letterSpacing: '0.1em' }}>SILK DEFINIDO PELO SOLADO TR-04</span>
            </div>
            {/* Row 2: REFERENCIA (full span) */}
            <div style={{ padding: '4px 10px', borderBottom: '1px solid #000', borderRight: '1px solid #000', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 14, gridColumn: 'span 7' }}>H27250</div>
            {/* Row 3: TAMANHO cabeçalho */}
            {grade.map((g, i) => (
              <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #000', borderRight: '1px solid #000', textAlign: 'center', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 13 }}>{g.num}</div>
            ))}
            <div style={{ padding: '4px 0', borderBottom: '1px solid #000', textAlign: 'center', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 13, background: '#000', color: '#FFE94A' }}>TT</div>
            {/* Row 4: QUANTIDADE */}
            {grade.map((g, i) => (
              <div key={i} style={{ padding: '5px 0', borderRight: '1px solid #000', textAlign: 'center', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 16 }}>{g.qtd}</div>
            ))}
            <div style={{ padding: '5px 0', textAlign: 'center', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 18, background: '#000', color: '#FFE94A' }}>{grade.reduce((a, g) => a + g.qtd, 0)}</div>
          </div>
        </div>

        {/* RODAPÉ: PEDIDO + VOLUME */}
        <div style={{ display: 'flex', borderTop: '1.5px solid #000', background: '#000', color: '#FFE94A' }}>
          <div style={{ flex: 1, padding: '6px 10px', borderRight: '1.5px solid #FFE94A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em' }}>PEDIDO:</span>
            <span style={{ fontFamily: 'Anton', fontSize: 28, letterSpacing: '0.02em' }}>00040513</span>
          </div>
          <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 13, letterSpacing: '0.06em' }}>VOLUME:</span>
            <span style={{ fontFamily: 'Anton', fontSize: 28 }}>1<span style={{ fontSize: 16 }}>/</span>12</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 4. ETIQUETA CAIXA EXTERNA · B — YELLOW MANIFESTO (150×100mm) ──
// Mesma estética amarela, mas manifesto multi-modelo com 3 fotos pequenas
function EtqCxExtB() {
  const itens = [
    { mod: MODELOS['I901'], num: '36', qtd: 6 },
    { mod: MODELOS['I901'], num: '37', qtd: 8 },
    { mod: MODELOS['I901'], num: '38', qtd: 4 },
    { mod: MODELOS['I918'], num: '36', qtd: 4 },
    { mod: MODELOS['I918'], num: '37', qtd: 6 },
    { mod: MODELOS['I905'], num: '37', qtd: 8 },
  ];
  const totQtd = itens.reduce((a, it) => a + it.qtd, 0);
  return (
    <div style={{
      width: 748, height: 499,
      background: 'var(--p-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 18, boxSizing: 'border-box',
    }}>
      <div style={{
        width: 712, height: 463,
        background: '#FFE94A',
        border: '1.5px solid #000',
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Inter Tight', sans-serif", color: '#000',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 10px 24px -12px rgba(0,0,0,0.25)',
      }}>
        {/* HEADER: NF (DESTAQUE) / PROG / MANIFESTO */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', borderBottom: '1.5px solid #000' }}>
          <div style={{ padding: '6px 10px', borderRight: '1.5px solid #000', display: 'flex', alignItems: 'baseline', gap: 8, background: '#000', color: '#FFE94A' }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em' }}>NF:</span>
            <span style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: '0.02em', lineHeight: 1 }}>189.428</span>
          </div>
          <div style={{ padding: '4px 10px', borderRight: '1.5px solid #000', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>PROG.:</span>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, fontWeight: 700 }}>H26072</span>
          </div>
          <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, letterSpacing: '0.06em' }}>MANIFESTO:</span>
            <span style={{ fontFamily: 'JetBrains Mono', fontSize: 12, fontWeight: 700 }}>3 MOD.</span>
          </div>
        </div>

        {/* CORPO: 2 colunas */}
        <div style={{ display: 'flex', flex: 1 }}>
          {/* ESQUERDA: destinatário compacto + 3 mini fotos */}
          <div style={{ flex: 1, borderRight: '1.5px solid #000', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 9 }}>
            {[
              ['CLIENTE',     'VIP SHOES ARARUAMA'],
              ['CNPJ',        '11.796.642/0001-65'],
              ['ENDEREÇO',    'R. PALMEIRAS, 4128 · LOJA 03'],
              ['CIDADE',      'ARARUAMA / RJ'],
              ['NF',          '189.428'],
              ['PED. COMPRA', '00040513'],
            ].map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'baseline', borderBottom: '0.5px solid #000', paddingBottom: 1 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 8, letterSpacing: '0.06em', minWidth: 70 }}>{r[0]}:</span>
                <span style={{ fontWeight: 700, fontSize: 9.5 }}>{r[1]}</span>
              </div>
            ))}

            {/* 3 mini fotos dos modelos */}
            <div style={{ marginTop: 'auto', display: 'flex', gap: 4, paddingTop: 6, borderTop: '1px solid #000' }}>
              {[MODELOS['I901'], MODELOS['I918'], MODELOS['I905']].map((mm, i) => (
                <div key={i} style={{ flex: 1, border: '1.5px solid #000', background: '#FFE94A', display: 'flex', flexDirection: 'column' }}>
                  <ShoePhoto w={70} h={42} variant="photo-yellow" label=""/>
                  <div style={{ background: '#000', color: '#FFE94A', textAlign: 'center', padding: '2px 0', fontFamily: 'JetBrains Mono', fontSize: 8, fontWeight: 700, letterSpacing: '0.04em' }}>{mm.ref}</div>
                </div>
              ))}
            </div>
          </div>

          {/* DIREITA: manifesto tabular */}
          <div style={{ flex: 1.05, padding: '6px 10px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em', marginBottom: 4 }}>CONTEÚDO · {totQtd} PARES</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 8.5, flex: 1 }}>
              <thead>
                <tr>
                  {['REF', 'MODELO', 'COR', 'NUM', 'QTD'].map((h, i) => (
                    <th key={i} style={{ background: '#000', color: '#FFE94A', padding: '3px 4px', fontFamily: 'JetBrains Mono', fontSize: 7.5, letterSpacing: '0.06em', textAlign: i < 3 ? 'left' : 'center', border: '1px solid #000' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {itens.map((it, i) => (
                  <tr key={i} style={{ background: i % 2 ? 'rgba(0,0,0,0.04)' : 'transparent' }}>
                    <td style={{ padding: '2px 4px', fontFamily: 'JetBrains Mono', fontWeight: 700, border: '1px solid #000' }}>{it.mod.ref}</td>
                    <td style={{ padding: '2px 4px', fontWeight: 700, fontSize: 8, border: '1px solid #000' }}>{it.mod.name}</td>
                    <td style={{ padding: '2px 4px', border: '1px solid #000' }}>
                      <ColorChips swatches={it.mod.swatches.slice(0, 3)} size="xs" showLabels={false} showNames={false}/>
                    </td>
                    <td style={{ padding: '2px 4px', textAlign: 'center', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, border: '1px solid #000' }}>{it.num}</td>
                    <td style={{ padding: '2px 4px', textAlign: 'center', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 10, border: '1px solid #000' }}>{it.qtd}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan="4" style={{ padding: '3px 4px', background: '#000', color: '#FFE94A', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 9, letterSpacing: '0.08em' }}>TOTAL</td>
                  <td style={{ padding: '3px 4px', background: '#000', color: '#FFE94A', textAlign: 'center', fontFamily: 'Anton', fontSize: 13 }}>{totQtd}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* RODAPÉ: PEDIDO + VOLUME */}
        <div style={{ display: 'flex', borderTop: '1.5px solid #000', background: '#000', color: '#FFE94A' }}>
          <div style={{ flex: 1, padding: '6px 10px', borderRight: '1.5px solid #FFE94A', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em' }}>PEDIDO:</span>
            <span style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: '0.02em' }}>00040513</span>
          </div>
          <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 11, letterSpacing: '0.06em' }}>VOLUME:</span>
            <span style={{ fontFamily: 'Anton', fontSize: 22 }}>2<span style={{ fontSize: 12 }}>/</span>12</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LAYOUT A4 — 2 etiquetas externas por folha (preview de impressão) ──
function EtqExtA4Layout() {
  // A4 portrait: 210×297mm = 794×1123px @96dpi
  // Each label landscape 150×100mm = 567×378px, with side margins
  const margin = 30; // 8mm
  const gap = 30;
  return (
    <div style={{ width: 794, height: 1123, background: 'var(--p-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        width: 794 - 48, height: 1123 - 48, background: '#fff',
        boxShadow: '0 1px 0 #e5e0d8, 0 16px 40px -16px rgba(20,17,14,0.25)',
        position: 'relative', overflow: 'hidden', padding: margin,
      }}>
        {/* Cut marks */}
        <div style={{ position: 'absolute', top: margin/2, left: 0, right: 0, fontFamily: 'JetBrains Mono', fontSize: 8.5, color: 'var(--p-mute)', letterSpacing: '0.18em', textAlign: 'center', textTransform: 'uppercase' }}>A4 · 2 etiquetas externas por folha · pique para destacar</div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap, height: '100%', justifyContent: 'center' }}>
          {/* Etiqueta 1 */}
          <div style={{ transform: 'scale(1.1)', transformOrigin: 'center' }}>
            <EtqCxExt/>
          </div>
          {/* Linha de corte */}
          <div style={{ width: '90%', height: 0, borderTop: '1px dashed var(--p-mute)', position: 'relative' }}>
            <span style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: '0 8px', fontFamily: 'JetBrains Mono', fontSize: 8, color: 'var(--p-mute)', letterSpacing: '0.18em' }}>✂ CORTAR AQUI</span>
          </div>
          {/* Etiqueta 2 */}
          <div style={{ transform: 'scale(1.1)', transformOrigin: 'center' }}>
            <EtqCxExtB/>
          </div>
        </div>
      </div>
    </div>
  );
}
window.EtqExtA4Layout = EtqExtA4Layout;

// ─── 5. ETIQUETA CAIXA INDIVIDUAL · C (compacta 100×50mm) ──
function EtqCxIndMini() {
  const m = MODELOS['I901'];
  return (
    <ThermalShell w={378} h={189}>
      <div style={{ height: '100%', display: 'flex' }}>
        <div style={{ flex: 1, padding: '8px 12px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <MiniMark size={12} />
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.16em' }}>SQUAD SHOES</div>
            <div style={{ background: '#000', color: '#fff', padding: '1px 6px', fontFamily: 'JetBrains Mono', fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', marginLeft: 'auto' }}>REF {m.ref}</div>
          </div>
          <div style={{ fontFamily: 'Anton', fontSize: 18, letterSpacing: '0.01em', marginTop: 6, lineHeight: 1 }}>{m.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <ColorChips swatches={m.swatches} size="xs" showLabels={false} showNames={false} />
            <div style={{ fontSize: 9, fontWeight: 600 }}>{m.cor}</div>
          </div>
          <div style={{ marginTop: 'auto', fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.12em', display: 'flex', justifyContent: 'space-between' }}>
            <span>OP-2847</span><span>L26-0190</span><span>08/05</span>
          </div>
        </div>
        <div style={{ width: 92, borderLeft: '1px solid #000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 4 }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 6.5, letterSpacing: '0.18em' }}>NUM.</div>
          <div style={{ fontFamily: 'Anton', lineHeight: 0.9, color: 'var(--p-red)', fontSize: "50px" }}>37</div>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '4px 12px 6px', background: '#fff', borderTop: '1px solid #000' }}>
        <Barcode value="7891234567" height={20} scale={0.8} dense />
      </div>
    </ThermalShell>);

}

// ─── CARTÃO DE OP — A5 (148×210mm) ──── (DOCUMENTO DE CHÃO, NÃO É ETIQUETA TÉRMICA) ──
function CartaoOP() {
  const m = MODELOS['I905']; // Sandália Leila — mostra tiras
  return (
    <LabelShell w={559} h={794}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* Header band */}
        <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MiniMark size={22} />
            <div>
              <div style={{ fontFamily: 'Anton', fontSize: 16, letterSpacing: '0.04em' }}>SQUAD SHOES</div>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7.5, letterSpacing: '0.18em', opacity: 0.7, marginTop: 2 }}>CARTÃO DE OP · CHÃO DE FÁBRICA</div>
            </div>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, letterSpacing: '0.16em' }}>A5 · IMPRESSO 09/05</div>
        </div>

        {/* HERO: modelo + ref + foto + QR */}
        <div style={{ padding: '18px 22px 8px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, letterSpacing: '0.18em', color: 'var(--p-mute)' }}>ORDEM DE PRODUÇÃO</div>
              <div style={{ fontFamily: 'Anton', fontSize: 56, lineHeight: 0.9, color: 'var(--p-red)', letterSpacing: '0.01em', marginTop: 2 }}>OP-2851</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <div style={{ fontFamily: 'Anton', fontSize: 22, letterSpacing: '0.02em', lineHeight: 1 }}>{m.name}</div>
                <div style={{ background: 'var(--p-ink)', color: '#fff', padding: '2px 8px', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em' }}>REF {m.ref}</div>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--p-mute)', marginTop: 4 }}>{m.categoria} · {m.cor}</div>
            </div>
            <ShoePhoto w={110} h={92} label={`REF ${m.ref}`} />
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <PIcon.QR size={80} />
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7.5, color: 'var(--p-mute)', marginTop: 4 }}>squad.sh/op/2851</div>
            </div>
          </div>
        </div>

        {/* Cores em destaque — sequência de tiras */}
        <div style={{ margin: '6px 22px 0', padding: '10px 14px', border: '1px solid var(--p-line-2)', background: 'var(--p-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>Cores · sequência das tiras</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, color: 'var(--p-red)', fontWeight: 700, letterSpacing: '0.1em' }}>{m.sku}</div>
          </div>
          <div style={{ marginTop: 8 }}>
            <ColorChips swatches={m.swatches} size="md" showLabels showNames />
          </div>
        </div>

        {/* Pares + prazo + linha */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderTop: '1px solid var(--p-line)', borderBottom: '1px solid var(--p-line)', margin: '14px 22px' }}>
          {[
          ['Pares', '540', 'var(--p-ink)'],
          ['Entrega', '12/05', 'var(--p-red)'],
          ['Linha', 'B1 → A2', 'var(--p-ink)']].
          map((r, i) =>
          <div key={i} style={{
            padding: '10px 12px',
            borderRight: i < 2 ? '1px solid var(--p-line)' : 'none'
          }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7.5, letterSpacing: '0.18em', color: 'var(--p-mute)' }}>{r[0]}</div>
              <div style={{ fontFamily: 'Anton', fontSize: 28, lineHeight: 1, color: r[2], marginTop: 4 }}>{r[1]}</div>
            </div>
          )}
        </div>

        {/* Etapa atual */}
        <div style={{ margin: '4px 22px 14px', padding: '10px 14px', background: 'var(--p-red-soft)', border: '2px solid var(--p-red)' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, letterSpacing: '0.18em', color: 'var(--p-red)', fontWeight: 700 }}>VOCÊ ESTÁ AQUI · ETAPA 03</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
            <div style={{ fontFamily: 'Anton', fontSize: 26, color: 'var(--p-red)', lineHeight: 1, letterSpacing: '0.02em' }}>MONTAGEM</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'var(--p-ink)' }}>05/05 → 06/05</div>
          </div>
        </div>

        {/* Grade */}
        <div style={{ margin: '0 22px' }}>
          <div className="p-eyebrow" style={{ marginBottom: 6, fontSize: 8.5 }}>Grade do lote · 540 pares</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
            <thead><tr>
              {[...m.numeracao, 'TOTAL'].map((n, i) =>
                <th key={i} style={{
                  background: i === m.numeracao.length ? 'var(--p-ink)' : 'var(--p-soft)',
                  color: i === m.numeracao.length ? '#fff' : 'var(--p-mute)',
                  border: '1px solid var(--p-line-2)',
                  padding: '6px 0', fontSize: 8.5, letterSpacing: '0.14em', fontWeight: 700
                }}>{n}</th>
                )}
            </tr></thead>
            <tbody><tr>
              {[80, 120, 140, 120, 80, 540].map((v, i) =>
                <td key={i} style={{
                  border: '1px solid var(--p-line-2)',
                  padding: '7px 0', textAlign: 'center',
                  fontWeight: 700, fontSize: 13,
                  background: i === 5 ? 'var(--p-ink)' : 'var(--p-paper)',
                  color: i === 5 ? '#fff' : 'var(--p-ink)'
                }}>{v}</td>
                )}
            </tr></tbody>
          </table>
        </div>

        {/* Trajeto */}
        <div style={{ margin: '14px 22px 0', display: 'flex', alignItems: 'center', gap: 0 }}>
          {[
          { n: 'CT', s: 'done' },
          { n: 'CO', s: 'done' },
          { n: 'MT', s: 'active' },
          { n: 'AC', s: '' },
          { n: 'EM', s: '' },
          { n: 'EX', s: '' }].
          map((s, i) =>
          <React.Fragment key={i}>
              <div style={{
              width: 30, height: 30, borderRadius: 0,
              border: '1.5px solid', borderColor: s.s === 'active' ? 'var(--p-red)' : s.s === 'done' ? 'var(--p-ink)' : 'var(--p-line-2)',
              background: s.s === 'active' ? 'var(--p-red)' : s.s === 'done' ? 'var(--p-ink)' : '#fff',
              color: s.s ? '#fff' : 'var(--p-mute)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'JetBrains Mono', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em'
            }}>{s.n}</div>
              {i < 5 && <div style={{ flex: 1, height: 1.5, background: s.s === 'done' ? 'var(--p-ink)' : 'var(--p-line)' }} />}
            </React.Fragment>
          )}
        </div>

        <div style={{ marginTop: 'auto', padding: '10px 22px', background: 'var(--p-soft)', borderTop: '1px solid var(--p-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Barcode value="2851050620260512" height={26} scale={0.9} />
          <div style={{ textAlign: 'right', fontFamily: 'JetBrains Mono', fontSize: 8, color: 'var(--p-mute)', letterSpacing: '0.14em' }}>
            <div>VIRE PARA APONTAR</div>
            <div style={{ color: 'var(--p-ink)', fontWeight: 700, marginTop: 2 }}>EM CADA POSTO</div>
          </div>
        </div>
      </div>
    </LabelShell>);

}

// ─── TAG DE PAR (50×80mm) ─────────────────────────
function EtqPar() {
  const m = MODELOS['I901'];
  return (
    <LabelShell w={189} h={302}>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', width: 10, height: 10, border: '1px solid var(--p-line-2)', borderRadius: '50%' }}/>

        <div style={{ padding: '22px 10px 6px', textAlign: 'center' }}>
          <MiniMark size={16}/>
          <div style={{ fontFamily: 'Anton', fontSize: 9.5, letterSpacing: '0.16em', marginTop: 4 }}>SQUAD SHOES</div>
        </div>

        <div style={{ padding: '4px 8px 6px', textAlign: 'center', borderTop: '1px solid var(--p-line)', borderBottom: '1px solid var(--p-line)' }}>
          <div style={{ fontFamily: 'Anton', fontSize: 13, letterSpacing: '0.02em', lineHeight: 1 }}>{m.name}</div>
          <div style={{ marginTop: 4, display: 'flex', justifyContent: 'center' }}>
            <RefChip code={m.ref} size="sm"/>
          </div>
          <div style={{ marginTop: 5, display: 'flex', justifyContent: 'center' }}>
            <ColorChips swatches={m.swatches} size="xs" showLabels={false} showNames={false}/>
          </div>
          <div style={{ fontSize: 8.5, color: 'var(--p-mute)', marginTop: 3 }}>{m.cor}</div>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4px 8px' }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.2em', color: 'var(--p-mute)' }}>NUMERAÇÃO</div>
          <div style={{ fontFamily: 'Anton', fontSize: 44, color: 'var(--p-red)', lineHeight: 1 }}>37</div>
          <div style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 9, marginTop: 4 }}>{m.sku}-37</div>
        </div>

        <div style={{ padding: '6px 10px 8px', background: 'var(--p-soft)', borderTop: '1px solid var(--p-line)' }}>
          <Barcode value="789123456" height={20} dense/>
        </div>
      </div>
    </LabelShell>
  );
}

// ─── ETIQUETA DE MATÉRIA-PRIMA (100×70mm) ─────────────
function EtqMP() {
  return (
    <LabelShell w={378} h={265}>
      <div style={{ height: '100%', display: 'flex' }}>
        <div style={{ flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MiniMark size={16} />
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8, letterSpacing: '0.18em', color: 'var(--p-mute)' }}>MATÉRIA-PRIMA · RECEBIMENTO</div>
          </div>
          <div style={{ fontFamily: 'Anton', fontSize: 18, marginTop: 8, letterSpacing: '0.01em', lineHeight: 1 }}>VERNIZ ADOCICADO</div>
          <div style={{ fontSize: 9.5, color: 'var(--p-mute)', marginTop: 3 }}>Couro sintético 1,2mm · cor 4280</div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 9.5 }}>
            {[
            ['Fornecedor', 'Curtume Vale'],
            ['NF-e', '218.412'],
            ['Lote forn.', 'VL-26-018'],
            ['Recebido', '04/05/2026'],
            ['Validade', '04/05/2027'],
            ['Inspeção', <span key="i" className="p-pill p-pill-ok" style={{ height: 14, fontSize: 7.5, padding: '0 5px' }}>OK</span>]].
            map((r, i) =>
            <div key={i} style={{ borderBottom: '1px dashed var(--p-line)', padding: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.14em', color: 'var(--p-mute)', textTransform: 'uppercase' }}>{r[0]}</span>
                <span style={{ fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 9 }}>{r[1]}</span>
              </div>
            )}
          </div>
        </div>

        <div style={{ width: 130, borderLeft: '1px solid var(--p-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0 10px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.18em', color: 'var(--p-mute)' }}>QUANTIDADE</div>
            <div style={{ fontFamily: 'Anton', fontSize: 34, lineHeight: 1, color: 'var(--p-red)' }}>184</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 8.5, letterSpacing: '0.18em', color: 'var(--p-ink)', fontWeight: 700, marginTop: 2 }}>dm²</div>
          </div>
          <div style={{ padding: '0 8px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.18em', color: 'var(--p-mute)', marginBottom: 4 }}>SKU INTERNO</div>
            <Barcode value="MP-VRN-4280" height={24} scale={0.9} />
          </div>
        </div>
      </div>
    </LabelShell>);

}

// ─── MINI-TAG QR DE POSTO (70×50mm) ─────────────────
function EtqMiniQR() {
  const m = MODELOS['I901'];
  return (
    <LabelShell w={265} h={189}>
      <div style={{ height: '100%', display: 'flex', alignItems: 'stretch' }}>
        <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <MiniMark size={14}/>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, letterSpacing: '0.16em', color: 'var(--p-mute)' }}>APONT. RÁPIDO</div>
              </div>
              <RefChip code={m.ref} size="sm"/>
            </div>
            <div style={{ fontFamily: 'Anton', fontSize: 26, color: 'var(--p-red)', lineHeight: 0.9, marginTop: 8, letterSpacing: '0.01em' }}>OP-2847</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <ColorChips swatches={m.swatches} size="xs" showLabels={false} showNames={false}/>
              <div style={{ fontSize: 9, fontWeight: 600 }}>{m.name}</div>
            </div>
            <div style={{ fontSize: 8.5, color: 'var(--p-mute)', marginTop: 2 }}>420 pares · ent. 08/05</div>
          </div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, color: 'var(--p-mute)', letterSpacing: '0.14em' }}>BIPE PRA REGISTRAR</div>
        </div>
        <div style={{ width: 96, background: 'var(--p-soft)', borderLeft: '1px solid var(--p-line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 4px' }}>
          <PIcon.QR size={68}/>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 7, color: 'var(--p-mute)', marginTop: 4, letterSpacing: '0.12em' }}>squad.sh/op/2847</div>
        </div>
      </div>
    </LabelShell>
  );
}

window.EtqCxInd = EtqCxInd;
window.EtqCxIndB = EtqCxIndB;
window.EtqCxIndMini = EtqCxIndMini;
window.EtqCxExt = EtqCxExt;
window.EtqCxExtB = EtqCxExtB;
window.CartaoOP = CartaoOP;
window.EtqPar = EtqPar;
window.EtqMP = EtqMP;
window.EtqMiniQR = EtqMiniQR;
window.ShoePhoto = ShoePhoto;
window.MiniMark = MiniMark;
window.MODELOS = MODELOS;
window.ColorChips = ColorChips;
window.Barcode = Barcode;
window.RefChip = RefChip;
window.COR_HEX = COR_HEX;
window.hexFor = hexFor;
window.tiraSwatches = tiraSwatches;