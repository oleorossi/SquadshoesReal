/**
 * Cartãozinho do montador — acompanha a ficha para o montador guardar
 * e devolver no fim do pedido. Envelope do Fardo (~96 mm, 15/folha A4 paisagem).
 */
import type { CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { formatFichaCounter } from '@/lib/fichaCartoes';

export interface CartaoMontadorProps {
  codigo: string;
  opNumber: string;
  pvLabel?: string | null;
  clientName?: string | null;
  referenceLabel?: string | null;
  color?: string | null;
  fichaIndex: number;
  totalFichas: number;
  pares: number;
  isSobra: boolean;
}

const RED = '#C00000';
const MONO = "'Fira Code', monospace";
const DISPLAY = "'Anton', Impact, sans-serif";
const SANS = "'Fira Sans', sans-serif";

const lbl: CSSProperties = {
  fontFamily: MONO,
  fontSize: 5.5,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#555',
  display: 'block',
  lineHeight: 1.15,
};

export function CartaoMontador({
  codigo,
  opNumber,
  pvLabel,
  clientName,
  referenceLabel,
  color,
  fichaIndex,
  totalFichas,
  pares,
  isSobra,
}: CartaoMontadorProps) {
  const pv = String(pvLabel || '').trim();
  const client = String(clientName || '').trim();
  const ref = String(referenceLabel || '').trim();
  const cor = String(color || '').trim();
  const identity = [ref, cor].filter(Boolean).join(' · ');
  const counter = formatFichaCounter(fichaIndex, totalFichas);

  return (
    <div
      className="cartao-lote cartao-montador"
      style={{
        width: '96mm',
        background: '#fff',
        color: '#000',
        border: '0.3mm dashed #888',
        padding: '0.5mm',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          border: '1.5px solid #000',
          padding: '1.1mm 1.4mm',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5mm',
          fontFamily: SANS,
          minHeight: '37mm',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.5mm' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={lbl}>Código</span>
            <div
              style={{
                fontFamily: DISPLAY,
                fontSize: 20,
                lineHeight: 0.95,
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
              }}
            >
              {codigo}
            </div>
          </div>
          <div style={{ flex: 'none', width: '16mm', height: '16mm' }} aria-hidden={!codigo}>
            {codigo ? (
              <QRCodeSVG
                value={codigo}
                size={60}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
                style={{ width: '16mm', height: '16mm', display: 'block' }}
                title={codigo}
              />
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '1.5mm',
            borderTop: '1.5px solid #000',
            paddingTop: '0.6mm',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 11, lineHeight: 1 }}>{opNumber || '—'}</div>
            {client && (
              <div
                style={{
                  fontFamily: SANS,
                  fontSize: 7,
                  fontWeight: 700,
                  lineHeight: 1.15,
                  textTransform: 'uppercase',
                  marginTop: '0.2mm',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '52mm',
                }}
              >
                {client}
              </div>
            )}
          </div>
          {pv && (
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <span style={lbl}>Pedido</span>
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 14,
                  lineHeight: 0.95,
                  color: RED,
                  textTransform: 'uppercase',
                }}
              >
                {pv}
              </div>
            </div>
          )}
        </div>

        {identity && (
          <div
            style={{
              fontFamily: DISPLAY,
              fontSize: 12,
              lineHeight: 1,
              color: RED,
              textTransform: 'uppercase',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {identity}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: '1.5mm',
            borderTop: '1px solid #000',
            paddingTop: '0.5mm',
          }}
        >
          <div>
            <span style={lbl}>Ficha</span>
            <div style={{ fontFamily: DISPLAY, fontSize: 16, lineHeight: 1 }}>{counter}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {isSobra ? (
              <div
                style={{
                  fontFamily: DISPLAY,
                  fontSize: 13,
                  lineHeight: 1,
                  color: RED,
                  textTransform: 'uppercase',
                }}
              >
                Sobra · {pares.toLocaleString('pt-BR')} pares
              </div>
            ) : (
              <>
                <span style={{ fontFamily: DISPLAY, fontSize: 18, lineHeight: 1 }}>
                  {pares.toLocaleString('pt-BR')}
                </span>
                <span style={{ ...lbl, fontSize: 5.5 }}>pares</span>
              </>
            )}
          </div>
        </div>

        <div
          style={{
            borderTop: '1px solid #000',
            paddingTop: '0.6mm',
            fontFamily: SANS,
            fontSize: 8,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: '#222',
          }}
        >
          Montador: _______________
        </div>
      </div>
    </div>
  );
}

export default CartaoMontador;
