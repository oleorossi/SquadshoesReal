import { SignedImage } from '@/components/ui/signed-image';
import { thumbUrl } from '@/lib/imageThumb';
import { TallyBox } from './worksheet/TallyBox';

/**
 * ReducedWorkSheet — ficha de operador REDUZIDA.
 *
 * Layout compacto para economizar folha: sem consumo previsto.
 * Foto do produto é opcional — ativada via `showImage` (ex.: Aviamento).
 *
 * Print component: inline styles + cores hardcoded (#000) — NÃO usar tokens
 * com alpha aqui (regra CLAUDE.md pra worksheets).
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
  /** Título grande (ex.: nome do solado/referência). */
  title: string;
  /** Metadados curtos no topo direito (Lote / OPs / Solado). */
  meta?: Array<{ label: string; value: string }>;
  /** URL da foto do produto (Supabase). Quando presente, a foto é exibida ao
   *  lado da grade — mesmos setores que mostram foto na ficha completa. */
  imageUrl?: string | null;
  /** @deprecated a foto agora aparece sempre que houver `imageUrl`. */
  showImage?: boolean;
  /** Grade do grupo: numeração → pares. */
  grade: Record<string, number>;
  /** Ordem das numerações a exibir. */
  allSizes: string[];
  totalPairs: number;
  /** Preenchido ⇒ variante POR COR; vazio/ausente ⇒ variante TOTAL. */
  colors?: ReducedColor[];
  /** Nota da variante total (ex.: "6 fichas de 12"). */
  totalNote?: string;
  /** @deprecated mantido pra compat — consumo previsto não é exibido na versão compacta */
  consumption?: unknown[];
  /** @deprecated mantido pra compat */
  consumptionSector?: string;
  /** Nº de fichas fechadas do grupo (Controle de Fichas). */
  fichas?: number;
  /** Pares por ficha fechada (= baseGradeSum). Default 12. */
  pairsPerFicha?: number;
}

export function ReducedWorkSheet({
  sectorLabel, title, meta, imageUrl, grade, allSizes, totalPairs,
  colors, totalNote, fichas, pairsPerFicha,
}: ReducedWorkSheetProps) {
  const sizes = allSizes;
  const byColor = !!(colors && colors.length > 0);
  // Foto aparece sempre que houver imageUrl — espelha a ficha completa, que
  // mostra foto em todos os setores. Sem imageUrl ⇒ no-op (layout compacto).
  const withPhoto = !!imageUrl;

  const tallyPerCard = pairsPerFicha && pairsPerFicha > 0 ? pairsPerFicha : 12;
  const tallyCount = fichas && fichas > 0
    ? fichas
    : Math.max(1, Math.ceil(totalPairs / tallyPerCard));
  const tallyTitle = fichas && fichas > 0 && !(pairsPerFicha && pairsPerFicha > 0)
    ? 'Controle de Fichas · corrugados mistos'
    : undefined;

  return (
    <div
      className="w-[210mm] p-[6mm] print:w-full print:p-0 flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000', background: '#fff' }}
    >
      {/* ── Header ── */}
      <div className="keep-together flex items-end justify-between" style={{ borderBottom: '2px solid #000', paddingBottom: 3 }}>
        <div className="min-w-0">
          <span className="font-mono uppercase block" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.18em', color: '#555' }}>
            Ficha reduzida
          </span>
          <h1 className="uppercase truncate" style={{ ...DISPLAY, fontSize: 22, lineHeight: 0.9, letterSpacing: '0.01em', marginTop: 1 }} title={sectorLabel}>
            {sectorLabel}
          </h1>
          <span className="uppercase truncate block" style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.02em', marginTop: 1, color: '#C00000' }} title={title}>
            {title}
          </span>
        </div>
        {meta && meta.length > 0 && (
          <div className="flex shrink-0" style={{ gap: 12, textAlign: 'right' }}>
            {meta.map(m => (
              <div key={m.label} className="uppercase" style={{ fontSize: 8, letterSpacing: '0.1em' }}>
                {m.label}
                <b className="font-mono block" style={{ fontSize: 13, letterSpacing: 0, marginTop: 1, fontWeight: 700 }}>{m.value}</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Grade (com foto opcional ao lado) ── */}
      <div className="keep-together" style={{ marginTop: 5 }}>
        <div className="flex" style={{ gap: withPhoto ? 10 : 0 }}>
          {/* Foto — só Aviamento (e setores futuros com showImage=true) */}
          {withPhoto && (
            <div
              className="shrink-0 relative flex items-center justify-center"
              style={{ width: '26mm', height: '26mm', border: '1.5px solid #000', background: '#fff' }}
            >
              <span
                className="absolute font-mono uppercase"
                style={{ top: 0, left: 0, background: '#fff', borderRight: '1.5px solid #000', borderBottom: '1.5px solid #000', fontSize: 7, fontWeight: 700, letterSpacing: '0.12em', padding: '1px 4px' }}
              >
                Ref.
              </span>
              <SignedImage
                src={thumbUrl(imageUrl!, 100) || imageUrl!}
                alt={title}
                loading="eager"
                className="w-full h-full object-contain mix-blend-multiply"
              />
            </div>
          )}

          {/* Grade */}
          <div className="flex-1 min-w-0 flex flex-col">
            <span className="font-mono uppercase flex items-baseline justify-between" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', borderBottom: '1px solid #000', paddingBottom: 2, marginBottom: 4 }}>
              <span>Grade · Numeração</span>
              <span style={{ fontWeight: 400, color: '#444', letterSpacing: '0.05em' }}>pares por número</span>
            </span>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <thead>
                <tr>
                  {sizes.map(s => (
                    <th key={s} className="font-mono" style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 0', textAlign: 'center' }}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {sizes.map(s => {
                    const q = grade[s] || 0;
                    return (
                      <td key={s} style={{ border: '1px solid #000', textAlign: 'center', padding: '1px 0', ...(q > 0 ? { ...DISPLAY, fontSize: 17, lineHeight: 1 } : { color: '#bbb', fontSize: 10 }) }}>
                        {q > 0 ? q : 0}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
            <div className="flex items-baseline justify-end" style={{ gap: 6, borderTop: '2px solid #000', marginTop: 1, paddingTop: 3 }}>
              <span className="uppercase" style={{ fontSize: 10, letterSpacing: '0.14em', fontWeight: 700 }}>Total da grade</span>
              <span style={{ ...DISPLAY, fontSize: 22, lineHeight: 0.8 }}>{fmtInt(totalPairs)}</span>
              <span className="font-mono" style={{ fontSize: 10, letterSpacing: '0.1em' }}>pares</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quantidades: por cor OU total ── */}
      <div className="keep-together" style={{ marginTop: 5 }}>
        <span className="font-mono uppercase block" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', borderBottom: '1px solid #000', paddingBottom: 2 }}>
          {byColor ? 'Quantidades por cor' : 'Quantidade total'}
          {!byColor && totalNote && <span style={{ fontWeight: 400, color: '#444', letterSpacing: '0.05em' }}> · {totalNote}</span>}
        </span>

        {byColor ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 3 }}>
            <colgroup>
              <col style={{ width: '34mm' }} />
              {sizes.map(s => <col key={s} />)}
              <col style={{ width: '15mm' }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 4px', textAlign: 'left', letterSpacing: '0.1em' }}>COR</th>
                {sizes.map(s => (
                  <th key={s} className="font-mono" style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 0', textAlign: 'center' }}>{s}</th>
                ))}
                <th className="font-mono" style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 8, fontWeight: 700, padding: '1px 4px', textAlign: 'center', letterSpacing: '0.1em' }}>TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {colors!.map((c, i) => (
                <tr key={`${c.name}-${i}`}>
                  <td style={{ border: '1px solid #000', padding: '2px 4px', verticalAlign: 'middle' }}>
                    <div className="flex items-center" style={{ gap: 5 }}>
                      <span className="shrink-0" style={{ width: 9, height: 9, border: '1.5px solid #000', background: c.hex || '#fff' }} />
                      <span className="uppercase truncate" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.02em', color: '#C00000' }} title={c.name}>{c.name}</span>
                    </div>
                  </td>
                  {sizes.map(s => {
                    const q = c.grade?.[s] || 0;
                    return (
                      <td key={s} style={{ border: '1px solid #000', textAlign: 'center', padding: '1px 0', ...(q > 0 ? { ...DISPLAY, fontSize: 14, lineHeight: 1 } : { color: '#ccc', fontSize: 9 }) }}>
                        {q > 0 ? q : '–'}
                      </td>
                    );
                  })}
                  <td style={{ border: '1px solid #000', textAlign: 'center', padding: '1px 4px', ...DISPLAY, fontSize: 16, lineHeight: 1 }}>{fmtInt(c.qty)}</td>
                </tr>
              ))}
              <tr>
                <td style={{ border: '1.5px solid #000', borderTop: '2.5px solid #000', padding: '2px 4px', verticalAlign: 'middle' }}>
                  <div className="flex items-center" style={{ gap: 5 }}>
                    <span className="shrink-0" style={{ width: 9, height: 9, border: '1.5px solid #000', background: '#fff' }} />
                    <span className="uppercase" style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.02em' }}>Total</span>
                  </div>
                </td>
                {sizes.map(s => {
                  const colSum = colors!.reduce((acc, c) => acc + (c.grade?.[s] || 0), 0);
                  const q = colSum > 0 ? colSum : (grade[s] || 0);
                  return (
                    <td key={s} style={{ border: '1.5px solid #000', borderTop: '2.5px solid #000', textAlign: 'center', padding: '1px 0', ...(q > 0 ? { ...DISPLAY, fontSize: 14, lineHeight: 1 } : { color: '#ccc', fontSize: 9 }) }}>
                      {q > 0 ? q : '–'}
                    </td>
                  );
                })}
                <td style={{ border: '1.5px solid #000', borderTop: '2.5px solid #000', textAlign: 'center', padding: '1px 4px', ...DISPLAY, fontSize: 18, lineHeight: 1 }}>{fmtInt(totalPairs)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="flex items-center" style={{ gap: 8, borderTop: '2.5px solid #000', paddingTop: 4 }}>
            <span className="shrink-0" style={{ width: 11, height: 11, border: '1.5px solid #000', background: '#fff' }} />
            <span className="uppercase flex-1" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.02em' }}>Total a cortar</span>
            <span style={{ ...DISPLAY, fontSize: 22, lineHeight: 0.8 }}>{fmtInt(totalPairs)}</span>
            <span className="font-mono shrink-0" style={{ fontSize: 10, color: '#555', marginLeft: 3 }}>pares</span>
          </div>
        )}
      </div>

      {/* Controle de Fichas — caixinhas sm (16px) para compactar */}
      {totalPairs > 0 && (
        <div className="keep-together" style={{ marginTop: 5 }}>
          <TallyBox count={tallyCount} pairsPerCard={tallyPerCard} totalUnits={totalPairs} title={tallyTitle} size="sm" />
        </div>
      )}
    </div>
  );
}
