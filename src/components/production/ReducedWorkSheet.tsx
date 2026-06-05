import { SignedImage } from '@/components/ui/signed-image';
import { SignatureFooter } from './worksheet/SignatureFooter';

/**
 * ReducedWorkSheet — ficha de operador REDUZIDA (aprovada em 2026-06-04).
 *
 * Só o essencial pro chão de fábrica: FOTO do produto + GRADE (numeração × pares)
 * + QUANTIDADES. Em 2 variantes automáticas:
 *   · POR COR  → quando `colors` vier preenchido (cada cor com total + mini-grade).
 *   · TOTAL    → quando não há separação por cor (só o total a cortar).
 *
 * Print component: inline styles + cores hardcoded (#000) por garantia visual em
 * papel A4 — NÃO usar tokens com alpha aqui (regra do CLAUDE.md pra worksheets).
 */

const DISPLAY = { fontFamily: "'Anton', Impact, sans-serif" } as const;
const fmtInt = (n: number) => (Number(n) || 0).toLocaleString('pt-BR');

export interface ReducedColor {
  name: string;
  /** swatch (hex). Default branco. */
  hex?: string | null;
  qty: number;
  /** mini-grade por número (opcional) — numeração → pares dessa cor. */
  grade?: Record<string, number>;
}

export interface ReducedWorkSheetProps {
  /** Eyebrow do setor (ex.: "Corte Palmilha"). */
  sectorLabel: string;
  /** Título grande em Anton (ex.: nome do solado / "Placa de Palmilha"). */
  title: string;
  /** Metadados curtos no topo direito (Lote / OPs / Solado). */
  meta?: Array<{ label: string; value: string }>;
  /** Foto do produto (URL Supabase — assinada via SignedImage). */
  imageUrl?: string | null;
  /** Grade do grupo: numeração → pares. */
  grade: Record<string, number>;
  /** Ordem das numerações a exibir. */
  allSizes: string[];
  totalPairs: number;
  /** Preenchido ⇒ variante POR COR; vazio/ausente ⇒ variante TOTAL. */
  colors?: ReducedColor[];
  /** Nota da variante total (ex.: "6 fichas de 12"). */
  totalNote?: string;
}

export function ReducedWorkSheet({
  sectorLabel, title, meta, imageUrl, grade, allSizes, totalPairs, colors, totalNote,
}: ReducedWorkSheetProps) {
  const sizes = allSizes;
  const byColor = !!(colors && colors.length > 0);

  return (
    <div
      className="w-[210mm] p-[10mm] print:w-full print:p-0 flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000', background: '#fff' }}
    >
      {/* ── Header ── */}
      <div className="keep-together flex items-end justify-between" style={{ borderBottom: '2px solid #000', paddingBottom: 5 }}>
        <div className="min-w-0">
          <span className="font-mono uppercase block" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em' }}>
            {sectorLabel} · Ficha reduzida
          </span>
          <h1 className="uppercase truncate" style={{ ...DISPLAY, fontSize: 28, lineHeight: 0.9, letterSpacing: '0.01em', marginTop: 2 }} title={title}>
            {title}
          </h1>
        </div>
        {meta && meta.length > 0 && (
          <div className="flex shrink-0" style={{ gap: 16, textAlign: 'right' }}>
            {meta.map(m => (
              <div key={m.label} className="uppercase" style={{ fontSize: 9, letterSpacing: '0.1em' }}>
                {m.label}
                <b className="font-mono block" style={{ fontSize: 15, letterSpacing: 0, marginTop: 1, fontWeight: 700 }}>{m.value}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Foto + grade ── */}
      <div className="keep-together flex" style={{ gap: 12, marginTop: 8 }}>
        <div
          className="shrink-0 relative flex items-center justify-center"
          style={{ width: '34mm', height: '34mm', border: '1.5px solid #000', background: '#fff' }}
        >
          <span
            className="absolute font-mono uppercase"
            style={{ top: 0, left: 0, background: '#fff', borderRight: '1.5px solid #000', borderBottom: '1.5px solid #000', fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', padding: '2px 5px' }}
          >
            Ref.
          </span>
          {imageUrl ? (
            <SignedImage src={imageUrl} alt={title} className="w-full h-full object-contain mix-blend-multiply" />
          ) : (
            <span className="font-mono uppercase text-center" style={{ fontSize: 9, color: '#000', padding: '0 10px', letterSpacing: '0.1em' }}>
              Sem foto cadastrada
            </span>
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <span className="font-mono uppercase flex items-baseline justify-between" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', borderBottom: '1px solid #000', paddingBottom: 3, marginBottom: 6 }}>
            <span>Grade · Numeração</span>
            <span style={{ fontWeight: 400, color: '#444', letterSpacing: '0.05em' }}>pares por número</span>
          </span>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead>
              <tr>
                {sizes.map(s => (
                  <th key={s} className="font-mono" style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 11, fontWeight: 700, padding: '2px 0', textAlign: 'center' }}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {sizes.map(s => {
                  const q = grade[s] || 0;
                  return (
                    <td key={s} style={{ border: '1px solid #000', textAlign: 'center', padding: '2px 0', ...(q > 0 ? { ...DISPLAY, fontSize: 20, lineHeight: 1 } : { color: '#bbb', fontSize: 12 }) }}>
                      {q > 0 ? q : 0}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
          <div className="flex items-baseline justify-end" style={{ gap: 8, borderTop: '2px solid #000', marginTop: 'auto', paddingTop: 5 }}>
            <span className="uppercase" style={{ fontSize: 11, letterSpacing: '0.14em', fontWeight: 700 }}>Total da grade</span>
            <span style={{ ...DISPLAY, fontSize: 26, lineHeight: 0.8 }}>{fmtInt(totalPairs)}</span>
            <span className="font-mono" style={{ fontSize: 12, letterSpacing: '0.1em' }}>pares</span>
          </div>
        </div>
      </div>

      {/* ── Quantidades: por cor OU total ── */}
      <div className="keep-together" style={{ marginTop: 8 }}>
        <span className="font-mono uppercase block" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', borderBottom: '1px solid #000', paddingBottom: 3 }}>
          {byColor ? 'Quantidades por cor' : 'Quantidade total'}
          {!byColor && totalNote && <span style={{ fontWeight: 400, color: '#444', letterSpacing: '0.05em' }}> · {totalNote}</span>}
        </span>

        {byColor ? (
          <>
            {colors!.map((c, i) => (
              <div key={`${c.name}-${i}`} className="flex items-center" style={{ gap: 10, padding: '4px 0', borderTop: i === 0 ? '1.5px solid #000' : '1px solid #000' }}>
                <span className="shrink-0" style={{ width: 14, height: 14, border: '1.5px solid #000', background: c.hex || '#fff' }} />
                <span className="uppercase flex-1 min-w-0 truncate" style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.02em' }} title={c.name}>{c.name}</span>
                {c.grade && (
                  <span className="font-mono shrink-0" style={{ fontSize: 10, color: '#555', letterSpacing: '0.05em' }}>
                    {sizes.filter(s => (c.grade![s] || 0) > 0).map(s => `${s}·${c.grade![s]}`).join('  ')}
                  </span>
                )}
                <span className="shrink-0" style={{ ...DISPLAY, fontSize: 22, lineHeight: 0.8 }}>{fmtInt(c.qty)}</span>
              </div>
            ))}
            <div className="flex items-center" style={{ gap: 10, borderTop: '2.5px solid #000', marginTop: 2, paddingTop: 5 }}>
              <span className="shrink-0" style={{ width: 14, height: 14, border: '1.5px solid #000', background: '#fff' }} />
              <span className="uppercase flex-1" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.02em' }}>Total</span>
              <span style={{ ...DISPLAY, fontSize: 26, lineHeight: 0.8 }}>{fmtInt(totalPairs)}</span>
              <span className="font-mono shrink-0" style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>pares</span>
            </div>
          </>
        ) : (
          <div className="flex items-center" style={{ gap: 10, borderTop: '2.5px solid #000', paddingTop: 5 }}>
            <span className="shrink-0" style={{ width: 14, height: 14, border: '1.5px solid #000', background: '#fff' }} />
            <span className="uppercase flex-1" style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.02em' }}>Total a cortar</span>
            <span style={{ ...DISPLAY, fontSize: 26, lineHeight: 0.8 }}>{fmtInt(totalPairs)}</span>
            <span className="font-mono shrink-0" style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>pares</span>
          </div>
        )}
      </div>

      <SignatureFooter compact />
    </div>
  );
}
