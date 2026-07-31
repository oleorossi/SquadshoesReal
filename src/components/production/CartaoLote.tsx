import React from 'react';

/**
 * Cartão de Lote de Setor — 99 × ~51mm, 3 colunas por A4 PAISAGEM (12 por folha).
 *
 * É a "Opção B" aprovada pelo dono em 31/07/2026: o cartão pertence ao TRABALHO
 * DO POSTO, não ao pacote que viaja. Ele descreve o lote daquele setor (o mesmo
 * recorte que o `buildColorGroupedSheets` já produz, com todas as peculiaridades
 * por setor) e se desfaz quando o posto termina.
 *
 * ⚠ Por que NÃO é por corrugado: o lote muda de forma a cada posto (medido no
 * PV-00148 — 1 pacote no Corte Palmilha, 7 no Corte Forração, 12 no Silk, 5 na
 * Solagem). O corrugado seria a única unidade constante, mas exigiria que os 12
 * pares já fossem um fardo físico desde o corte — o que não foi confirmado.
 *
 * ⚠ ALTURA PELO CONTEÚDO, nunca fixa. A 1ª versão travava o cartão em A6
 * (148×105mm) e empurrava o rodapé com `margin-top:auto`: 45mm de papel morto,
 * 43% do cartão (defeito apontado pelo dono num print). Aqui o cartão termina
 * onde o conteúdo termina e o empacotamento é do browser (`break-inside: avoid`),
 * igual à ficha reduzida.
 *
 * Componente de PRINT — segue docs/PRINT_SPEC.md §0.2 + CLAUDE.md:
 *   - inline styles com cores hardcoded (#000), sem token com alpha
 *   - sem primitives shadcn
 *   - fontes do index.css: 'Anton' (display), 'Fira Code' (mono), 'Fira Sans'
 *   - tamanhos ACIMA dos pisos: identidade ≥14px, nº de grade ≥12px,
 *     rótulo mono uppercase ≥6.5px, célula de dados ≥8px
 */

export interface CartaoLoteProps {
  /** Índice + nome do setor, ex.: "08" e "Solagem". */
  sectorIndex?: string;
  sectorName: string;
  /** PV(s) do lote — já concatenados pelo chamador. */
  pvLabel?: string;
  /** Data de entrega (dd/MM) — vem de sale_orders.delivery_deadline. */
  dueLabel?: string;
  /** Posição do lote no maço do setor ("3 de 5"). */
  lotLabel?: string;
  /** Identificador curto impresso no rodapé ("S-03/05"). */
  lotCode?: string;
  /** Foto da referência (miniatura ao lado do texto). */
  imageUrl?: string | null;
  /** DESTAQUE em vermelho — cor do lote (identidade nº 1 do chão de fábrica). */
  title: string;
  /** Linha neutra sob o destaque (solado, napa, referência…). */
  subtitle?: string;
  /** Numerações ativas, já ordenadas. */
  sizes: string[];
  /** Grade do lote por numeração. */
  grade: Record<string, number>;
  totalPairs: number;
  /** Referências que compõem o lote (o Corte Forração junta várias). */
  refs?: string[];
  /** Linha extra de contexto do setor (ex.: "15 cx", "Baixa por numeração"). */
  note?: string;
}

const RED = '#C00000';
const MONO = "'Fira Code', monospace";
const DISPLAY = "'Anton', Impact, sans-serif";
const SANS = "'Fira Sans', sans-serif";

/** Rótulo mono uppercase — piso 6.5px (CLAUDE.md). */
const lbl: React.CSSProperties = {
  fontFamily: MONO, fontSize: 6.5, letterSpacing: '0.16em',
  textTransform: 'uppercase', color: '#555', display: 'block', lineHeight: 1.2,
};

export const CartaoLote = ({
  sectorIndex, sectorName, pvLabel, dueLabel, lotLabel, lotCode,
  imageUrl, title, subtitle, sizes, grade, totalPairs, refs, note,
}: CartaoLoteProps) => {
  // A grade é o bloco que define a largura mínima do cartão: 8 colunas
  // (7 numerações + total) em 94mm úteis ≈ 11.7mm cada. Abaixo de 93mm de
  // largura o `table-layout: fixed` do CSS de print CORTA o número (o operador
  // lê "18" onde estava "180") — por isso o cartão não estreita além de 99mm.
  const cols = sizes.length + 1;

  return (
    <div
      className="cartao-lote"
      style={{
        width: '99mm', background: '#fff', color: '#000',
        border: '1.5px solid #000', padding: '2.5mm',
        display: 'flex', flexDirection: 'column', gap: '1mm',
        fontFamily: SANS,
      }}
    >
      {/* Faixa de identificação do posto */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        borderBottom: '1.5px solid #000', paddingBottom: '1mm', gap: '2mm',
      }}>
        <div style={{ minWidth: 0 }}>
          <span style={lbl}>{sectorIndex ? `${sectorIndex} · Setor` : 'Setor'}</span>
          {/* Identidade — piso 14px. Nome do setor lido a 1m. */}
          <div style={{ fontFamily: DISPLAY, fontSize: 15, lineHeight: 1, textTransform: 'uppercase' }}>
            {sectorName}
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none', fontFamily: MONO, fontSize: 8, fontWeight: 700, lineHeight: 1.35 }}>
          {pvLabel && <div>{pvLabel}</div>}
          {(dueLabel || lotLabel) && (
            <div style={{ fontWeight: 400 }}>
              {[dueLabel, lotLabel].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>

      {/* Identidade do lote: foto + cor em VERMELHO + quantidade */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2.5mm' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2mm', minWidth: 0 }}>
          {imageUrl && (
            <img
              src={imageUrl}
              alt=""
              style={{
                width: '9mm', height: '9mm', flex: 'none', objectFit: 'cover',
                border: '1px solid #000', background: '#F2F0EB', display: 'block',
              }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            {/* Vermelho + Anton grande: o destaque sobrevive mesmo quando o
                laser P&B da fábrica converte o vermelho em cinza. */}
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

      {/* Grade por numeração — nº ≥12px (piso do CLAUDE.md) */}
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

      {/* Faixa de contexto — referências do lote + nota do setor. Uma linha só:
          duas faixas custavam 4mm de altura e o operador lê as duas juntas. */}
      {(refs?.length || note) && (
        <div style={{
          border: '1px solid #000', padding: '0.7mm 1.2mm',
          fontFamily: MONO, fontSize: 7, color: '#333', lineHeight: 1.3,
        }}>
          {refs?.length ? (
            <>
              <span style={{ color: '#000', fontWeight: 700 }}>Refs </span>
              <span style={{ color: RED, fontWeight: 700 }}>{refs.join(' · ')}</span>
            </>
          ) : null}
          {refs?.length && note ? <span> · </span> : null}
          {note ? <span style={{ color: '#000', fontWeight: 700 }}>{note}</span> : null}
        </div>
      )}

      {/* Rodapé: campo manuscrito + código do lote */}
      <div style={{
        borderTop: '1.5px solid #000', paddingTop: '1mm',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '2mm',
      }}>
        <div style={{ flex: 1, maxWidth: '55%' }}>
          <span style={lbl}>Executado por</span>
          <div style={{ borderBottom: '1.5px solid #000', height: '4.5mm' }} />
        </div>
        {lotCode && (
          <span style={{ fontFamily: DISPLAY, fontSize: 14, lineHeight: 1, flex: 'none' }}>
            {lotCode}
          </span>
        )}
      </div>
    </div>
  );
};
