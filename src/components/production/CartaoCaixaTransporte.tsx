/**
 * Cartão de caixa de transporte — acompanha a caixa na saída do setor.
 *
 * Spec: specs/cartao-caixa-transporte.md
 * Envelope: A4 paisagem, **6/folha** (3×2, ~96 × ~100 mm).
 * Conteúdo: OP · PV (destaque) · cliente · (destino opcional) · identidade · grade · fichas · pares · k/N do maço.
 * Caixa Palmilha: sem Origem/Destino.
 */
import React from 'react';

export interface CartaoCaixaTransporteProps {
  /** Origem (setor emissor). Vazio = não imprime bloco Origem. */
  sectorName?: string;
  /** Destino. Vazio = não imprime bloco Destino. */
  destinoLabel?: string;
  opNumber: string;
  /** Número do pedido (PV) — destaque. */
  pvLabel?: string;
  /** Razão social do cliente. */
  clientName?: string;
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  sizes?: string[];
  grade?: Record<string, number>;
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
  fontFamily: MONO, fontSize: 6, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#555', display: 'block', lineHeight: 1.15,
};

export function CartaoCaixaTransporte({
  sectorName, destinoLabel, opNumber, pvLabel, clientName, title, subtitle, imageUrl,
  sizes = [], grade = {},
  fichasNaCaixa, capacidade, totalPairs, lotCode, parcial,
}: CartaoCaixaTransporteProps) {
  const fichasLabel = parcial
    ? `${fichasNaCaixa}/${capacidade}`
    : String(fichasNaCaixa);
  const showOrigem = Boolean(String(sectorName || '').trim());
  const showDestino = Boolean(String(destinoLabel || '').trim());
  const pv = String(pvLabel || '').trim();
  const client = String(clientName || '').trim();
  const gradeTot = Object.values(grade).reduce((a, b) => a + (Number(b) || 0), 0);

  return (
    <div
      className="caixa-transporte-card"
      style={{
        width: '96mm',
        flex: '0 0 96mm',
        minHeight: '98mm',
        background: '#fff',
        color: '#000',
        border: '1.5px solid #000',
        padding: '2mm',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.2mm',
        fontFamily: SANS,
        boxSizing: 'border-box',
      }}
    >
      {/* OP · cliente · PV destaque */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1.5px solid #000', paddingBottom: '1mm', gap: '2mm',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {showOrigem && (
            <>
              <span style={lbl}>Origem</span>
              <div style={{
                fontFamily: DISPLAY, fontSize: 12, lineHeight: 1,
                textTransform: 'uppercase', marginBottom: '0.5mm',
              }}>
                {sectorName}
              </div>
            </>
          )}
          <div style={{ fontFamily: DISPLAY, fontSize: 13, lineHeight: 1 }}>{opNumber}</div>
          {client && (
            <div style={{
              fontFamily: SANS, fontSize: 8.5, fontWeight: 700, lineHeight: 1.15,
              textTransform: 'uppercase', marginTop: '0.5mm',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {client}
            </div>
          )}
        </div>
        {pv && (
          <div style={{ textAlign: 'right', flex: 'none' }}>
            <span style={lbl}>Pedido</span>
            <div style={{
              fontFamily: DISPLAY, fontSize: 18, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase',
            }}>
              {pv}
            </div>
          </div>
        )}
      </div>

      {showDestino && (
        <div style={{ borderBottom: '1px solid #000', paddingBottom: '0.8mm' }}>
          <span style={lbl}>Destino</span>
          <div style={{
            fontFamily: DISPLAY, fontSize: 18, lineHeight: 0.95, color: RED,
            textTransform: 'uppercase',
          }}>
            {destinoLabel}
          </div>
        </div>
      )}

      {/* Identidade + fichas */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2mm',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', minWidth: 0 }}>
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
              fontFamily: DISPLAY, fontSize: 15, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {title}
            </div>
            {subtitle && (
              <div style={{
                fontFamily: DISPLAY, fontSize: 9, lineHeight: 1.05,
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
            fontFamily: DISPLAY, fontSize: 26, lineHeight: 0.9,
            color: parcial ? RED : '#000',
          }}>
            {fichasLabel}
          </div>
        </div>
      </div>

      {/* Grade — preenche o corpo */}
      {sizes.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', flex: 1 }}>
          <thead>
            <tr>
              {sizes.map((s) => (
                <th key={s} style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 8, fontWeight: 700, padding: '0.6mm 0',
                }}>{s}</th>
              ))}
              <th style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 8, fontWeight: 700, padding: '0.6mm 0',
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
                  fontSize: 12, fontWeight: 700, padding: '1mm 0',
                  fontVariantNumeric: 'tabular-nums',
                }}>{grade[s] || 0}</td>
              ))}
              <td style={{
                border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                fontSize: 12, fontWeight: 700, padding: '1mm 0',
                fontVariantNumeric: 'tabular-nums',
                background: '#000', color: '#fff',
                WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact',
              } as React.CSSProperties}>
                {gradeTot.toLocaleString('pt-BR')}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <div style={{
        borderTop: '1.5px solid #000', paddingTop: '1mm',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2mm',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.5mm' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 20, lineHeight: 1 }}>
            {totalPairs.toLocaleString('pt-BR')}
          </span>
          <span style={{ ...lbl, fontSize: 6.5 }}>pares</span>
        </div>
        {lotCode && (
          <span style={{ fontFamily: DISPLAY, fontSize: 16, lineHeight: 1 }}>
            {lotCode}
          </span>
        )}
      </div>
    </div>
  );
}

export default CartaoCaixaTransporte;
