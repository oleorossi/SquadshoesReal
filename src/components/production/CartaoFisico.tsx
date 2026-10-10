/**
 * Cartão físico por corrugado — acompanha o fardo na saída do setor emissor.
 *
 * Spec: specs/cartao-fisico-corrugado.md
 * Envelope ~96 mm · A4 paisagem · 15/folha (3×5).
 * Conteúdo: OP · PV (destaque) · cliente · (destino opcional) · identidade · grade · total · k/N do maço.
 * Sem Origem/setor no papel. Sem QR/barcode.
 */
import React from 'react';

export interface CartaoFisicoProps {
  /** Mantido por compat; não impresso (setor saiu do papel). */
  sectorName?: string;
  destinoLabel?: string;
  opNumber: string;
  /** Número do pedido (PV) — destaque. */
  pvLabel?: string;
  /** Razão social do cliente. */
  clientName?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  sizes: string[];
  grade: Record<string, number>;
  totalPairs: number;
  lotLabel?: string;
  lotCode?: string;
}

const RED = '#C00000';
const MONO = "'Fira Code', monospace";
const DISPLAY = "'Anton', Impact, sans-serif";
const SANS = "'Fira Sans', sans-serif";

const lbl: React.CSSProperties = {
  fontFamily: MONO, fontSize: 5.5, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#555', display: 'block', lineHeight: 1.15,
};

export function CartaoFisico({
  destinoLabel, opNumber, pvLabel, clientName, title, subtitle, imageUrl,
  sizes, grade, totalPairs, lotCode,
}: CartaoFisicoProps) {
  const showDestino = Boolean(String(destinoLabel || '').trim());
  const pv = String(pvLabel || '').trim();
  const client = String(clientName || '').trim();

  return (
    <div
      className="cartao-lote cartao-fisico"
      style={{
        width: '96mm',
        background: '#fff',
        color: '#000',
        border: '1.5px solid #000',
        padding: '1.2mm 1.5mm',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5mm',
        fontFamily: SANS,
        boxSizing: 'border-box',
      }}
    >
      {/* OP · cliente · PV destaque — sem setor/origem */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1.5px solid #000', paddingBottom: '0.6mm', gap: '1.5mm',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: 1 }}>{opNumber}</div>
          {client && (
            <div style={{
              fontFamily: SANS, fontSize: 7.5, fontWeight: 700, lineHeight: 1.15,
              textTransform: 'uppercase', marginTop: '0.3mm',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {client}
            </div>
          )}
        </div>
        {pv && (
          <div style={{ textAlign: 'right', flex: 'none', minWidth: 0 }}>
            <span style={lbl}>Pedido</span>
            <div style={{
              fontFamily: DISPLAY, fontSize: 15, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase',
            }}>
              {pv}
            </div>
          </div>
        )}
      </div>

      {showDestino && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          borderBottom: '1px solid #000', paddingBottom: '0.4mm', gap: '1.5mm',
        }}>
          <div style={{ minWidth: 0 }}>
            <span style={lbl}>Destino</span>
            <div style={{
              fontFamily: DISPLAY, fontSize: 14, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase',
            }}>
              {destinoLabel}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5mm' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', minWidth: 0 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '7mm', height: '7mm', flex: 'none', objectFit: 'cover',
                border: '1px solid #000', background: '#F2F0EB', display: 'block',
              }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: DISPLAY, fontSize: 15, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontFamily: DISPLAY, fontSize: 8.5, lineHeight: 1.05, textTransform: 'uppercase' }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 18, lineHeight: 1 }}>
            {totalPairs.toLocaleString('pt-BR')}
          </span>
          <span style={{ ...lbl, fontSize: 5.5 }}>pares</span>
        </div>
      </div>

      {sizes.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {sizes.map((s) => (
                <th key={s} style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 7, fontWeight: 700, padding: '0.3mm 0',
                }}>{s}</th>
              ))}
              <th style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 7, fontWeight: 700, padding: '0.3mm 0',
                background: '#000', color: '#fff',
                WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
              } as React.CSSProperties}>TOT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {sizes.map((s) => (
                <td key={s} style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 10, fontWeight: 700, padding: '0.4mm 0',
                  fontVariantNumeric: 'tabular-nums',
                }}>{grade[s] || 0}</td>
              ))}
              <td style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 10, fontWeight: 700, padding: '0.4mm 0',
                fontVariantNumeric: 'tabular-nums',
                background: '#000', color: '#fff',
                WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
              } as React.CSSProperties}>{totalPairs.toLocaleString('pt-BR')}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{
        borderTop: '1.5px solid #000', paddingTop: '0.5mm',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '1.5mm',
      }}>
        {lotCode && (
          <span style={{ fontFamily: DISPLAY, fontSize: 12, lineHeight: 1, flex: 'none' }}>
            {lotCode}
          </span>
        )}
      </div>
    </div>
  );
}

export default CartaoFisico;
