/**
 * Cartão físico por corrugado — acompanha o fardo na saída do setor emissor.
 *
 * Spec: specs/cartao-fisico-corrugado.md
 * Envelope físico ≈ CartaoLote (~95,5 mm, A4 paisagem, vários por folha).
 * Conteúdo: origem · OP · PV · identidade · grade · total · k/N.
 * Sem destino, sem QR/barcode (v1).
 */
import React from 'react';

export interface CartaoFisicoProps {
  sectorName: string;
  opNumber: string;
  pvLabel?: string;
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
  fontFamily: MONO, fontSize: 6.5, letterSpacing: '0.16em',
  textTransform: 'uppercase', color: '#555', display: 'block', lineHeight: 1.2,
};

export function CartaoFisico({
  sectorName, opNumber, pvLabel, title, subtitle, imageUrl,
  sizes, grade, totalPairs, lotLabel, lotCode,
}: CartaoFisicoProps) {
  return (
    <div
      className="cartao-lote cartao-fisico"
      style={{
        width: '95.5mm', background: '#fff', color: '#000',
        border: '1.5px solid #000', padding: '2mm',
        display: 'flex', flexDirection: 'column', gap: '0.8mm',
        fontFamily: SANS,
      }}
    >
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1.5px solid #000', paddingBottom: '1mm', gap: '2mm',
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={lbl}>Origem</span>
          <div style={{ fontFamily: DISPLAY, fontSize: 15, lineHeight: 1, textTransform: 'uppercase' }}>
            {sectorName}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none', fontFamily: MONO, fontSize: 8, fontWeight: 700, lineHeight: 1.35 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: 1 }}>{opNumber}</div>
          {pvLabel && <div style={{ fontWeight: 400 }}>{pvLabel}</div>}
          {lotLabel && <div style={{ fontWeight: 400 }}>{lotLabel}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2.5mm' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2mm', minWidth: 0 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '9mm', height: '9mm', flex: 'none', objectFit: 'cover',
                border: '1px solid #000', background: '#F2F0EB', display: 'block',
              }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: DISPLAY, fontSize: 20, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontFamily: DISPLAY, fontSize: 10, lineHeight: 1.1, textTransform: 'uppercase' }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 25, lineHeight: 1 }}>
            {totalPairs.toLocaleString('pt-BR')}
          </span>
          <span style={{ ...lbl, fontSize: 6.5 }}>pares</span>
        </div>
      </div>

      {sizes.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {sizes.map((s) => (
                <th key={s} style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 7.5, fontWeight: 700, padding: '0.5mm 0',
                }}>{s}</th>
              ))}
              <th style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 7.5, fontWeight: 700, padding: '0.5mm 0',
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
                  fontSize: 12, fontWeight: 700, padding: '0.6mm 0',
                  fontVariantNumeric: 'tabular-nums',
                }}>{grade[s] || 0}</td>
              ))}
              <td style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 12, fontWeight: 700, padding: '0.6mm 0',
                fontVariantNumeric: 'tabular-nums',
                background: '#000', color: '#fff',
                WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
              } as React.CSSProperties}>{totalPairs.toLocaleString('pt-BR')}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{
        borderTop: '1.5px solid #000', paddingTop: '1mm',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '2mm',
      }}>
        {lotCode && (
          <span style={{ fontFamily: DISPLAY, fontSize: 14, lineHeight: 1, flex: 'none' }}>
            {lotCode}
          </span>
        )}
      </div>
    </div>
  );
}

export default CartaoFisico;
