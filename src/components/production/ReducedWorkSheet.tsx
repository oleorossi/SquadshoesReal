import { SignedImage } from '@/components/ui/signed-image';
import { thumbUrl } from '@/lib/imageThumb';
import { SignatureFooter } from './worksheet/SignatureFooter';
import { filterConsumptionForSector, formatConsumptionLine, type ConsumptionRow } from '@/hooks/useBulkOrderConsumption';

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
  /** Consumo de materiais por par (filtra pelo setor). Exibido em formato compacto
   *  no rodapé da ficha — espelha o card de Consumo da ficha tradicional. */
  consumption?: ConsumptionRow[];
  /** Nome do setor pra filtrar consumo (ex.: "Corte Forração", "Aviamento"). */
  consumptionSector?: string;
}

export function ReducedWorkSheet({
  sectorLabel, title, meta, imageUrl, grade, allSizes, totalPairs, colors, totalNote,
  consumption, consumptionSector,
}: ReducedWorkSheetProps) {
  const sizes = allSizes;
  const byColor = !!(colors && colors.length > 0);
  // Consumo filtrado pelo setor — só itens RELEVANTES pra esse passo (ex.:
  // Aviamento vê fivelas/elásticos; Corte Forração vê só forração).
  const sectorConsumption = consumption && consumption.length > 0
    ? (consumptionSector ? filterConsumptionForSector(consumption, consumptionSector) : consumption)
    : [];

  return (
    <div
      className="w-[210mm] p-[10mm] print:w-full print:p-0 flex flex-col"
      style={{ boxSizing: 'border-box', fontFamily: "'Fira Sans', sans-serif", color: '#000', background: '#fff' }}
    >
      {/* ── Header ── */}
      <div className="keep-together flex items-end justify-between" style={{ borderBottom: '2px solid #000', paddingBottom: 5 }}>
        <div className="min-w-0">
          <span className="font-mono uppercase block" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: '#555' }}>
            Ficha reduzida
          </span>
          {/* SETOR em foco (headline Anton). O produto/solado vira subtítulo —
             antes o solado ("SOLADO INFANTIL") roubava o destaque do setor. */}
          <h1 className="uppercase truncate" style={{ ...DISPLAY, fontSize: 30, lineHeight: 0.9, letterSpacing: '0.01em', marginTop: 1 }} title={sectorLabel}>
            {sectorLabel}
          </h1>
          <span className="uppercase truncate block" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '0.02em', marginTop: 2 }} title={title}>
            {title}
          </span>
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
            <SignedImage src={thumbUrl(imageUrl, 130) || imageUrl} alt={title} className="w-full h-full object-contain mix-blend-multiply" />
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
            {/* Layout em tabela alinhada com a grade do topo — cada cor é
                uma linha com mini-colunas idênticas em largura à header. Antes
                era texto inline ("25·8 26·8 27·8...") que comprimia tudo no
                limite direito e ficava ilegível no chão de fábrica. Agora é
                column-aligned: bater o olho na coluna 27 e ver imediatamente
                quanto cada cor consome desse número. */}
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginTop: 4 }}>
              <colgroup>
                {/* swatch + nome ficam num bloco fixo à esquerda; sizes preenchem o meio; total à direita. */}
                <col style={{ width: '38mm' }} />
                {sizes.map(s => <col key={s} />)}
                <col style={{ width: '18mm' }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 4px', textAlign: 'left', letterSpacing: '0.1em' }}>COR</th>
                  {sizes.map(s => (
                    <th key={s} className="font-mono" style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 0', textAlign: 'center' }}>{s}</th>
                  ))}
                  <th className="font-mono" style={{ border: '1px solid #000', background: '#000', color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 4px', textAlign: 'center', letterSpacing: '0.1em' }}>TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {colors!.map((c, i) => (
                  <tr key={`${c.name}-${i}`}>
                    <td style={{ border: '1px solid #000', padding: '3px 4px', verticalAlign: 'middle' }}>
                      <div className="flex items-center" style={{ gap: 6 }}>
                        <span className="shrink-0" style={{ width: 11, height: 11, border: '1.5px solid #000', background: c.hex || '#fff' }} />
                        <span className="uppercase truncate" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.02em', color: '#C00000' }} title={c.name}>{c.name}</span>
                      </div>
                    </td>
                    {sizes.map(s => {
                      const q = c.grade?.[s] || 0;
                      return (
                        <td key={s} style={{ border: '1px solid #000', textAlign: 'center', padding: '2px 0', ...(q > 0 ? { ...DISPLAY, fontSize: 16, lineHeight: 1 } : { color: '#ccc', fontSize: 10 }) }}>
                          {q > 0 ? q : '–'}
                        </td>
                      );
                    })}
                    <td style={{ border: '1px solid #000', textAlign: 'center', padding: '2px 4px', ...DISPLAY, fontSize: 18, lineHeight: 1 }}>{fmtInt(c.qty)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ border: '1.5px solid #000', borderTop: '2.5px solid #000', padding: '3px 4px', verticalAlign: 'middle' }}>
                    <div className="flex items-center" style={{ gap: 6 }}>
                      <span className="shrink-0" style={{ width: 11, height: 11, border: '1.5px solid #000', background: '#fff' }} />
                      <span className="uppercase" style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.02em' }}>Total</span>
                    </div>
                  </td>
                  {sizes.map(s => {
                    // Soma vertical: total daquele número somando todas as cores.
                    // Bate com grade[s] do topo (que já é o total agregado).
                    const colSum = colors!.reduce((acc, c) => acc + (c.grade?.[s] || 0), 0);
                    const fallback = grade[s] || 0;
                    const q = colSum > 0 ? colSum : fallback;
                    return (
                      <td key={s} style={{ border: '1.5px solid #000', borderTop: '2.5px solid #000', textAlign: 'center', padding: '2px 0', ...(q > 0 ? { ...DISPLAY, fontSize: 16, lineHeight: 1 } : { color: '#ccc', fontSize: 10 }) }}>
                        {q > 0 ? q : '–'}
                      </td>
                    );
                  })}
                  <td style={{ border: '1.5px solid #000', borderTop: '2.5px solid #000', textAlign: 'center', padding: '2px 4px', ...DISPLAY, fontSize: 20, lineHeight: 1 }}>{fmtInt(totalPairs)}</td>
                </tr>
              </tbody>
            </table>
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

      {/* Consumo de materiais COMPACTO — só os itens relevantes pro setor.
          Espelha o card de Consumo do worksheet tradicional, mas numa linha
          enxuta: "Couro Marrom · 3.2 dm²/par · 460 dm² total". Operador valida
          a quantidade entregue contra essa estimativa antes de cortar. */}
      {sectorConsumption.length > 0 && (
        <div className="keep-together" style={{ marginTop: 8 }}>
          <span className="font-mono uppercase block" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', borderBottom: '1px solid #000', paddingBottom: 2 }}>
            Consumo previsto
          </span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {sectorConsumption.map((r, i) => (
              <li key={`${r.product_id}-${i}`} style={{ fontSize: 10, padding: '2px 0', borderBottom: i < sectorConsumption.length - 1 ? '1px dashed #999' : 'none', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span className="truncate" style={{ fontWeight: 600 }}>
                  {r.product_name}{r.color ? <span style={{ color: '#555', fontWeight: 400 }}> · {r.color}</span> : null}
                </span>
                <span className="font-mono shrink-0" style={{ color: '#333' }}>{formatConsumptionLine(r)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SignatureFooter compact />
    </div>
  );
}
