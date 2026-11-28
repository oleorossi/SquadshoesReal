/**
 * Cartão físico por corrugado — acompanha o fardo na saída do setor emissor.
 *
 * Spec: specs/cartao-fisico-corrugado.md
 * Envelope ~96 mm · A4 paisagem · 15/folha (3×5).
 * Conteúdo: OP · PV (destaque) · cliente · (destino opcional) · identidade ·
 * grade · ordem de número individual · total · k/N do maço.
 * Sem Origem/setor no papel. Sem QR/barcode.
 *
 * Altura fixa no slot de 5 fileiras (~40,5 mm) para a ordem de numeração
 * ocupar o espaço que antes ficava em branco no pé do cartão.
 */
import React from 'react';
import { SizeOrderStrip } from './worksheet/SizeOrderStrip';

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
/** (210mm − 2mm padding − 4×0,8mm gap) / 5 fileiras, com 0,4 mm de folga. */
const CARD_HEIGHT = '40.5mm';

const lbl: React.CSSProperties = {
  fontFamily: MONO, fontSize: 5.5, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#3a3a3a', display: 'block', lineHeight: 1.15,
};

export function CartaoFisico({
  destinoLabel, opNumber, pvLabel, clientName, title, subtitle, imageUrl,
  sizes, grade, totalPairs, lotCode,
}: CartaoFisicoProps) {
  const showDestino = Boolean(String(destinoLabel || '').trim());
  const pv = String(pvLabel || '').trim();
  const client = String(clientName || '').trim();
  const printColor = {
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  } as React.CSSProperties;

  return (
    <div
      className="cartao-lote cartao-fisico ficha-viz-fardo"
      style={{
        width: '96mm',
        height: CARD_HEIGHT,
        minHeight: CARD_HEIGHT,
        background: '#fff',
        color: '#000',
        border: '1px solid #000',
        padding: '1mm 1.2mm',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.45mm',
        fontFamily: SANS,
        boxSizing: 'border-box',
        ...printColor,
      }}
    >
      {/* OP · cliente · PV destaque — sem setor/origem */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1px solid #000', paddingBottom: '0.5mm', gap: '1.5mm',
        flex: 'none',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: 1 }}>{opNumber}</div>
          {client && (
            <div style={{
              fontFamily: SANS, fontSize: 7, fontWeight: 700, lineHeight: 1.15,
              textTransform: 'uppercase', marginTop: '0.2mm',
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
              ...printColor,
            }}>
              {pv}
            </div>
          </div>
        )}
      </div>

      {showDestino && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          borderBottom: '1px solid #000', paddingBottom: '0.35mm', gap: '1.5mm',
          flex: 'none',
        }}>
          <div style={{ minWidth: 0 }}>
            <span style={lbl}>Destino</span>
            <div style={{
              fontFamily: DISPLAY, fontSize: 13, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase',
              ...printColor,
            }}>
              {destinoLabel}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5mm', flex: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.4mm', minWidth: 0 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '9mm', height: '9mm', flex: 'none', objectFit: 'cover',
                border: '1px solid #000', background: '#F2F0EB', display: 'block',
                ...printColor,
              }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: DISPLAY, fontSize: 14, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              ...printColor,
            }}>
              {title}
            </div>
            {subtitle && (
              <div style={{ fontFamily: DISPLAY, fontSize: 8, lineHeight: 1.05, textTransform: 'uppercase' }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 16, lineHeight: 1 }}>
            {totalPairs.toLocaleString('pt-BR')}
          </span>
          <span style={{ ...lbl, fontSize: 5.5 }}>pares</span>
        </div>
      </div>

      {sizes.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', flex: 'none' }}>
          <thead>
            <tr>
              {sizes.map((s) => (
                <th key={s} style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 6.5, fontWeight: 700, padding: '0.25mm 0',
                  background: '#efeee9',
                  ...printColor,
                }}>{s}</th>
              ))}
              <th style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 6.5, fontWeight: 700, padding: '0.25mm 0',
                background: '#000', color: '#fff',
                ...printColor,
              }}>TOT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {sizes.map((s) => (
                <td key={s} style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 10, fontWeight: 700, padding: '0.35mm 0',
                  fontVariantNumeric: 'tabular-nums',
                }}>{grade[s] || 0}</td>
              ))}
              <td style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 10, fontWeight: 700, padding: '0.35mm 0',
                fontVariantNumeric: 'tabular-nums',
                background: '#000', color: '#fff',
                ...printColor,
              }}>{totalPairs.toLocaleString('pt-BR')}</td>
            </tr>
          </tbody>
        </table>
      )}

      {sizes.length > 0 && (
        <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <SizeOrderStrip
            sizes={sizes}
            grade={grade}
            label="Ordem"
            compact
          />
        </div>
      )}

      <div style={{
        borderTop: '1px solid #000', paddingTop: '0.35mm',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: '1.5mm',
        flex: 'none',
      }}>
        {lotCode && (
          <span style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: 1, flex: 'none' }}>
            {lotCode}
          </span>
        )}
      </div>
    </div>
  );
}

export default CartaoFisico;
