import React from 'react';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';

/**
 * Faixa de RASTREIO do modelo 'lote' (ver `fichaModel.ts`).
 *
 * Antes esses dados viviam em duas linhas mono de 9px — a `note` do
 * `GroupSubHeader` ("PV-00151 · CLIENTE · Entrega 03/09/2026", com `truncate`)
 * e os `ops` ao lado dos pares. Truncado nesse corpo, o dado existia no papel
 * mas não era lido: quem precisa saber de quem é o lote não conseguia.
 *
 * Aqui vira uma faixa própria, com rótulo por campo e o cliente em Anton
 * vermelho — a mesma hierarquia que o `HeaderIdentification` já dá ao PV.
 *
 * Componente de PRINT (docs/PRINT_SPEC.md + CLAUDE.md): inline styles com
 * cores hardcoded, fontes do `index.css` ('Fira Sans' / 'Fira Code' / 'Anton'),
 * sem primitives shadcn e sem token com alpha.
 */
interface Props {
  /** Números de OP do lote. ≤ 3 lista; acima disso vira contagem. */
  ops?: string[];
  /** Números de PV. Mesma regra de contagem das OPs. */
  pvNumbers?: string[];
  /** Razão social do(s) cliente(s) — destaque vermelho. */
  clientNames?: string[];
  /** Entrega já formatada em pt-BR pelo chamador (a coluna é DATE; formatar
   *  aqui repetiria a armadilha de fuso documentada no OperatorWorkSheet). */
  dueDate?: string;
}

/** ≤ 3 itens lista; acima disso a contagem é mais legível que a lista. */
const summarize = (items: string[], plural: string): string =>
  items.length <= 3 ? items.join(' · ') : `${items.length} ${plural}`;

const Cell = ({
  label, children, grow = false, alignRight = false, first = false,
}: {
  label: string; children: React.ReactNode; grow?: boolean; alignRight?: boolean; first?: boolean;
}) => (
  <div
    style={{
      padding: '5px 10px',
      borderLeft: first ? 'none' : '1px solid #000',
      flexGrow: grow ? 1 : 0,
      minWidth: 0,
      textAlign: alignRight ? 'right' : 'left',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
    }}
  >
    <span className="section-label" style={{ color: '#000' }}>{label}</span>
    <span style={{ display: 'block', marginTop: 3 }}>{children}</span>
  </div>
);

const mono: React.CSSProperties = {
  fontFamily: "'Fira Code', monospace",
  fontSize: '12px',
  fontWeight: 700,
  color: '#000',
  whiteSpace: 'nowrap',
};

export const TraceStrip = ({ ops, pvNumbers, clientNames, dueDate }: Props) => {
  const opList = (ops || []).filter(Boolean);
  const pvList = (pvNumbers || []).filter(Boolean);
  const clients = (clientNames || []).filter(Boolean);
  const clientDisplay = clients.join(' · ');

  // Sem nenhum dos quatro campos a faixa seria uma moldura vazia.
  if (opList.length === 0 && pvList.length === 0 && !clientDisplay && !dueDate) return null;

  // Anton condensado (~0.48) na coluna elástica do cliente (~300px úteis).
  const clientFont = adaptiveFontSize(clientDisplay, {
    maxWidthPx: 300, baseFontPx: 17, minFontPx: 9, charWidthRatio: 0.48,
  });

  return (
    <div
      className="keep-together"
      style={{ border: '1.5px solid #000', display: 'flex', alignItems: 'stretch', background: '#fff' }}
    >
      {opList.length > 0 && (
        <Cell label={opList.length > 1 ? 'Ordens' : 'Ordem'} first>
          <span style={mono}>{summarize(opList, 'OPs')}</span>
        </Cell>
      )}
      {pvList.length > 0 && (
        <Cell label={pvList.length > 1 ? 'Pedidos' : 'Pedido'} first={opList.length === 0}>
          <span style={mono}>{summarize(pvList, 'PVs')}</span>
        </Cell>
      )}
      {clientDisplay && (
        <Cell label="Cliente" grow first={opList.length === 0 && pvList.length === 0}>
          <span
            className="uppercase leading-none block truncate"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: `${clientFont}px`,
              letterSpacing: '-0.01em',
              color: '#C00000',
              WebkitPrintColorAdjust: 'exact',
              printColorAdjust: 'exact',
            } as React.CSSProperties}
            title={clientDisplay}
          >
            {clientDisplay}
          </span>
        </Cell>
      )}
      {dueDate && (
        <Cell label="Entrega" alignRight first={opList.length === 0 && pvList.length === 0 && !clientDisplay}>
          <span style={mono}>{dueDate}</span>
        </Cell>
      )}
    </div>
  );
};
