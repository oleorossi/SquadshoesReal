/**
 * Cartão de caixa de transporte — acompanha a caixa na saída do setor.
 *
 * Spec: specs/cartao-caixa-transporte.md
 * Envelope: A4 paisagem, 2/folha (~147 × ≥100 mm).
 * Destaque: DESTINO + N fichas (Anton); parcial óbvio como 3/10.
 * Sem grade, sem QR/barcode.
 */
import React from 'react';

export interface CartaoCaixaTransporteProps {
  /** Origem (setor emissor). */
  sectorName: string;
  destinoLabel: string;
  opNumber: string;
  pvLabel?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  fichasNaCaixa: number;
  capacidade: number;
  totalPairs: number;
  lotLabel?: string;
  lotCode?: string;
  parcial?: boolean;
}

const RED = '#C00000';
const MONO = "'Fira Code', monospace";
const DISPLAY = "'Anton', Impact, sans-serif";
const SANS = "'Fira Sans', sans-serif";

const lbl: React.CSSProperties = {
  fontFamily: MONO, fontSize: 7.5, letterSpacing: '0.16em',
  textTransform: 'uppercase', color: '#555', display: 'block', lineHeight: 1.2,
};

export function CartaoCaixaTransporte({
  sectorName, destinoLabel, opNumber, pvLabel, title, subtitle, imageUrl,
  fichasNaCaixa, capacidade, totalPairs, lotLabel, lotCode, parcial,
}: CartaoCaixaTransporteProps) {
  const fichasLabel = parcial
    ? `${fichasNaCaixa}/${capacidade}`
    : String(fichasNaCaixa);

  return (
    <div
      className="caixa-transporte-card"
      style={{
        width: '146.5mm',
        flex: '1 1 146.5mm',
        minHeight: '100mm',
        background: '#fff',
        color: '#000',
        border: '2px solid #000',
        padding: '3.5mm',
        display: 'flex',
        flexDirection: 'column',
        gap: '2mm',
        fontFamily: SANS,
        boxSizing: 'border-box',
      }}
    >
      {/* Origem · OP/PV */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '2px solid #000', paddingBottom: '2mm', gap: '3mm',
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={lbl}>Origem</span>
          <div style={{ fontFamily: DISPLAY, fontSize: 18, lineHeight: 1, textTransform: 'uppercase' }}>
            {sectorName}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none', fontFamily: MONO, fontSize: 10, fontWeight: 700, lineHeight: 1.35 }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 18, lineHeight: 1 }}>{opNumber}</div>
          {pvLabel && <div style={{ fontWeight: 400 }}>{pvLabel}</div>}
        </div>
      </div>

      {/* DESTINO em destaque */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '3mm', borderBottom: '1.5px solid #000', paddingBottom: '2mm',
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={lbl}>Destino</span>
          <div style={{
            fontFamily: DISPLAY, fontSize: 36, lineHeight: 0.95, color: RED,
            textTransform: 'uppercase',
          }}>
            {destinoLabel}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          {lotLabel && (
            <div style={{
              fontFamily: DISPLAY, fontSize: 16, lineHeight: 1, color: RED,
              textTransform: 'uppercase', marginBottom: '1mm',
            }}>
              Caixa {lotLabel}
            </div>
          )}
          {lotCode && (
            <div style={{ fontFamily: DISPLAY, fontSize: 20, lineHeight: 1 }}>
              {lotCode}
            </div>
          )}
        </div>
      </div>

      {/* Identidade + contagem de fichas */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '3mm', flex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2.5mm', minWidth: 0 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '14mm', height: '14mm', flex: 'none', objectFit: 'cover',
                border: '1.5px solid #000', background: '#F2F0EB', display: 'block',
              }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: DISPLAY, fontSize: 24, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {title}
            </div>
            {subtitle && (
              <div style={{
                fontFamily: DISPLAY, fontSize: 14, lineHeight: 1.1,
                textTransform: 'uppercase',
              }}>
                {subtitle}
              </div>
            )}
          </div>
        </div>

        <div style={{ textAlign: 'right', flex: 'none' }}>
          <span style={lbl}>{parcial ? 'Fichas (parcial)' : 'Fichas'}</span>
          <div style={{
            fontFamily: DISPLAY, fontSize: 48, lineHeight: 0.9,
            color: parcial ? RED : '#000',
          }}>
            {fichasLabel}
          </div>
        </div>
      </div>

      {/* Total de pares */}
      <div style={{
        borderTop: '2px solid #000', paddingTop: '2mm',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: '2mm',
      }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 32, lineHeight: 1 }}>
          {totalPairs.toLocaleString('pt-BR')}
        </span>
        <span style={{ ...lbl, fontSize: 8 }}>pares</span>
      </div>
    </div>
  );
}

export default CartaoCaixaTransporte;
