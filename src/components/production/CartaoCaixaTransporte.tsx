/**
 * Cartão de caixa de transporte — acompanha a caixa na saída do setor.
 *
 * Spec: specs/cartao-caixa-transporte.md
 * Envelope: A4 paisagem, 6/folha (3×2, 96 × 102,5 mm) com linhas de recorte.
 * Conteúdo: OP · PV (destaque) · cliente · (destino opcional) · identidade ·
 * grade · fichas na caixa · pares · k/N do maço.
 * Caixa Palmilha: sem Origem/Destino; 15 fichas por caixa.
 */
import React from 'react';
import { CAIXA_LAYOUT } from '@/lib/cartaoCaixaTransporte';

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
const CARD_WIDTH = `${CAIXA_LAYOUT.cardWmm}mm`;
const CARD_HEIGHT = `${CAIXA_LAYOUT.cardHmm}mm`;

const lbl: React.CSSProperties = {
  fontFamily: MONO, fontSize: 5.5, letterSpacing: '0.12em',
  textTransform: 'uppercase', color: '#3a3a3a', display: 'block', lineHeight: 1.15,
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
  const printColor = {
    WebkitPrintColorAdjust: 'exact',
    printColorAdjust: 'exact',
  } as React.CSSProperties;

  return (
    <div
      className="caixa-transporte-card ficha-viz-caixa"
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        minHeight: CARD_HEIGHT,
        background: '#fff',
        color: '#000',
        border: '1px solid #000',
        padding: '2mm 2.2mm',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.4mm',
        fontFamily: SANS,
        boxSizing: 'border-box',
        ...printColor,
      }}
    >
      {/* OP · cliente · PV destaque */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1px solid #000', paddingBottom: '1mm', gap: '2mm',
        flex: 'none',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {showOrigem && (
            <>
              <span style={lbl}>Origem</span>
              <div style={{
                fontFamily: DISPLAY, fontSize: 12, lineHeight: 1,
                textTransform: 'uppercase', marginBottom: '0.4mm',
              }}>
                {sectorName}
              </div>
            </>
          )}
          <div style={{ fontFamily: DISPLAY, fontSize: 14, lineHeight: 1 }}>{opNumber}</div>
          {client && (
            <div style={{
              fontFamily: SANS, fontSize: 8, fontWeight: 700, lineHeight: 1.15,
              textTransform: 'uppercase', marginTop: '0.4mm',
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
              fontFamily: DISPLAY, fontSize: 20, lineHeight: 0.95, color: RED,
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
          borderBottom: '1px solid #000', paddingBottom: '0.8mm', flex: 'none',
        }}>
          <span style={lbl}>Destino</span>
          <div style={{
            fontFamily: DISPLAY, fontSize: 16, lineHeight: 0.95, color: RED,
            textTransform: 'uppercase',
            ...printColor,
          }}>
            {destinoLabel}
          </div>
        </div>
      )}

      {/* Identidade + fichas na caixa */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2mm',
        flex: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.6mm', minWidth: 0 }}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '14mm', height: '14mm', flex: 'none', objectFit: 'cover',
                border: '1px solid #000', background: '#F2F0EB', display: 'block',
                ...printColor,
              }}
            />
          ) : null}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: DISPLAY, fontSize: 16, lineHeight: 0.95, color: RED,
              textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              ...printColor,
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
          <span style={lbl}>{parcial ? 'Fichas · parcial' : 'Fichas na caixa'}</span>
          <div style={{
            fontFamily: DISPLAY, fontSize: 28, lineHeight: 0.9,
            color: parcial ? RED : '#000',
            ...printColor,
          }}>
            {fichasLabel}
          </div>
        </div>
      </div>

      {/* Grade da curva do corrugado — preenche o corpo da folha */}
      {sizes.length > 0 && (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <table style={{
            borderCollapse: 'collapse', width: '100%', height: '100%',
            tableLayout: 'fixed',
          }}>
            <thead>
              <tr>
                {sizes.map((s) => (
                  <th key={s} style={{
                    border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                    fontSize: 7, fontWeight: 700, padding: '0.6mm 0',
                    background: '#efeee9', height: '7mm',
                    ...printColor,
                  }}>{s}</th>
                ))}
                <th style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 7, fontWeight: 700, padding: '0.6mm 0',
                  background: '#000', color: '#fff', height: '7mm',
                  ...printColor,
                }}>TOT</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {sizes.map((s) => (
                  <td key={s} style={{
                    border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                    fontSize: 16, fontWeight: 700, padding: '1mm 0',
                    fontVariantNumeric: 'tabular-nums', height: '100%',
                    verticalAlign: 'middle',
                  }}>{grade[s] || 0}</td>
                ))}
                <td style={{
                  border: '1px solid #000', textAlign: 'center', fontFamily: MONO,
                  fontSize: 16, fontWeight: 700, padding: '1mm 0',
                  fontVariantNumeric: 'tabular-nums', height: '100%',
                  verticalAlign: 'middle',
                  background: '#000', color: '#fff',
                  ...printColor,
                }}>
                  {gradeTot.toLocaleString('pt-BR')}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div style={{
        borderTop: '1px solid #000', paddingTop: '1mm',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '2mm',
        flex: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '1.5mm' }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 22, lineHeight: 1 }}>
            {totalPairs.toLocaleString('pt-BR')}
          </span>
          <span style={{ ...lbl, fontSize: 6.5 }}>pares</span>
        </div>
        {lotCode && (
          <span style={{ fontFamily: DISPLAY, fontSize: 18, lineHeight: 1 }}>
            {lotCode}
          </span>
        )}
      </div>
    </div>
  );
}

export default CartaoCaixaTransporte;
