/**
 * Cartão de OP — A5 (148×210mm = 559×794px @ 96dpi)
 *
 * Documento de chão de fábrica que acompanha a OP fisicamente entre postos.
 * Diferente das fichas de operador (A4, uma por setor), o Cartão de OP é
 * único por OP e mostra a foto/cor/grade/etapa atual em formato compacto
 * pra circular grudado na grade de produção.
 *
 * Estrutura:
 *   ┌────────────────────────────────────────────┐
 *   │ HEADER preto (logo + impressão)            │
 *   ├────────────────────────────────────────────┤
 *   │ HERO: OP + Modelo + REF + Foto + QR        │
 *   │ Cores (tiras) + SKU                        │
 *   │ Pares / Entrega / Linha (3 cols)           │
 *   │ ETAPA ATUAL (banda vermelha)               │
 *   │ Grade do lote (tabela compacta)            │
 *   │ Trajeto (6 quadrados CT→CO→MT→AC→EM→EX)    │
 *   │ FOOTER: barcode + aviso "vire pra apontar" │
 *   └────────────────────────────────────────────┘
 *
 * Recebe props — não faz fetch. Wiring fica com a página chamadora
 * (ex.: ProductionFlow ou PrintWorkSheets).
 */
import { BarcodeSVG } from '@/components/ui/barcode-svg';

const STAGE_KEYS = ['CORTE', 'COSTURA', 'MONTAGEM', 'ACABAMENTO', 'EMBALAGEM', 'EXPEDICAO'] as const;
export type CartaoOPStage = typeof STAGE_KEYS[number];

const STAGE_SHORT: Record<CartaoOPStage, string> = {
  CORTE: 'CT',
  COSTURA: 'CO',
  MONTAGEM: 'MT',
  ACABAMENTO: 'AC',
  EMBALAGEM: 'EM',
  EXPEDICAO: 'EX',
};

export type CartaoOPProps = {
  opNumber: string;
  modelName: string;
  ref: string;
  category?: string;
  colorLabel?: string;
  /** Lista de cores em hex pra render dos chips (sequência das tiras) */
  swatches?: { hex: string; name?: string }[];
  sku?: string;
  pairs: number;
  deliveryDate: string;
  line?: string;
  currentStage: CartaoOPStage;
  stageStart?: string;
  stageEnd?: string;
  /** Grade do lote — colunas de numeração + qty */
  sizes: { size: string; qty: number }[];
  printedAt?: string;
  barcodeValue: string;
  shoePhotoUrl?: string;
  qrShortUrl?: string;
};

function MiniLogo() {
  return (
    <div
      style={{
        width: 22, height: 22,
        border: '1.5px solid #fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
        fontFamily: 'Anton, Impact, sans-serif',
        fontSize: 11, lineHeight: 1, color: '#fff',
      }}
    >
      S
      <span
        style={{
          position: 'absolute', top: -3, right: -3,
          width: 6, height: 6, background: 'var(--p-red)',
        }}
      />
    </div>
  );
}

function ShoeBox({ photoUrl, ref: refCode }: { photoUrl?: string; ref: string }) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`REF ${refCode}`}
        style={{
          width: 110, height: 92, objectFit: 'cover',
          border: '1px solid var(--p-line-2)', background: 'var(--p-soft)',
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: 110, height: 92,
        border: '1px solid var(--p-line-2)', background: 'var(--p-soft)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 8,
        letterSpacing: '0.14em', color: 'var(--p-mute)',
        flexShrink: 0,
      }}
    >
      REF {refCode}
    </div>
  );
}

function QRPlaceholder({ shortUrl }: { shortUrl?: string }) {
  return (
    <div style={{ textAlign: 'center', flexShrink: 0 }}>
      <div
        style={{
          width: 80, height: 80,
          background: `repeating-linear-gradient(0deg, var(--p-ink) 0 2px, transparent 2px 4px), repeating-linear-gradient(90deg, var(--p-ink) 0 2px, transparent 2px 4px)`,
          border: '1px solid var(--p-ink)',
        }}
      />
      {shortUrl && (
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 7.5,
            color: 'var(--p-mute)', marginTop: 4,
          }}
        >
          {shortUrl}
        </div>
      )}
    </div>
  );
}

function ColorChipsRow({ swatches }: { swatches?: CartaoOPProps['swatches'] }) {
  if (!swatches?.length) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {swatches.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 18, height: 18, background: s.hex,
              border: '1px solid var(--p-line-2)', borderRadius: 2,
            }}
          />
          {s.name && (
            <span
              style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                color: 'var(--p-ink-2)', letterSpacing: '0.06em',
              }}
            >
              {s.name}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function CartaoOP(props: CartaoOPProps) {
  const {
    opNumber, modelName, ref, category, colorLabel, swatches, sku,
    pairs, deliveryDate, line, currentStage, stageStart, stageEnd,
    sizes, printedAt, barcodeValue, shoePhotoUrl, qrShortUrl,
  } = props;

  const stageIdx = STAGE_KEYS.indexOf(currentStage);
  const totalQty = sizes.reduce((acc, s) => acc + s.qty, 0);
  const stageLabel = `${String(stageIdx + 1).padStart(2, '0')}`;

  return (
    <div
      className="paper"
      style={{
        width: 559, minHeight: 794,
        background: 'var(--p-paper)',
        boxShadow: '0 1px 0 #e5e0d8, 0 12px 32px -12px rgba(20,17,14,0.18)',
        display: 'flex', flexDirection: 'column',
        color: 'var(--p-ink)',
      }}
    >
      {/* Header band */}
      <div
        style={{
          background: 'var(--p-ink)', color: '#fff',
          padding: '14px 18px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MiniLogo />
          <div>
            <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 16, letterSpacing: '0.04em' }}>
              SQUAD SHOES
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 7.5,
                letterSpacing: '0.18em', opacity: 0.7, marginTop: 2,
              }}
            >
              CARTÃO DE OP · CHÃO DE FÁBRICA
            </div>
          </div>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, letterSpacing: '0.16em' }}>
          A5{printedAt ? ` · IMPRESSO ${printedAt}` : ''}
        </div>
      </div>

      {/* HERO: OP + modelo + foto + QR */}
      <div style={{ padding: '18px 22px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>Ordem de Produção</div>
            <div
              style={{
                fontFamily: 'Anton, sans-serif', fontSize: 56,
                lineHeight: 0.9, color: 'var(--p-red)',
                letterSpacing: '0.01em', marginTop: 2,
              }}
            >
              {opNumber}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
              <div style={{ fontFamily: 'Anton, sans-serif', fontSize: 22, letterSpacing: '0.02em', lineHeight: 1 }}>
                {modelName}
              </div>
              <div
                style={{
                  background: 'var(--p-ink)', color: '#fff',
                  padding: '2px 8px',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
                  fontWeight: 700, letterSpacing: '0.1em',
                }}
              >
                REF {ref}
              </div>
            </div>
            {(category || colorLabel) && (
              <div style={{ fontSize: 11.5, color: 'var(--p-mute)', marginTop: 4 }}>
                {[category, colorLabel].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <ShoeBox photoUrl={shoePhotoUrl} ref={ref} />
          <QRPlaceholder shortUrl={qrShortUrl} />
        </div>
      </div>

      {/* Cores em destaque · tiras */}
      {(swatches?.length || sku) && (
        <div
          style={{
            margin: '6px 22px 0',
            padding: '8px 12px',
            border: '1px solid var(--p-line-2)', background: 'var(--p-soft)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div className="p-eyebrow" style={{ fontSize: 8.5 }}>
              Cores · sequência
            </div>
            {sku && (
              <div
                style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5,
                  color: 'var(--p-red)', fontWeight: 700, letterSpacing: '0.1em',
                }}
              >
                {sku}
              </div>
            )}
          </div>
          {swatches?.length ? (
            <div style={{ marginTop: 8 }}>
              <ColorChipsRow swatches={swatches} />
            </div>
          ) : null}
        </div>
      )}

      {/* Pares / Entrega / Linha */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0,
          borderTop: '1px solid var(--p-line)', borderBottom: '1px solid var(--p-line)',
          margin: '14px 22px',
        }}
      >
        {[
          { lbl: 'Pares', val: pairs.toLocaleString('pt-BR'), color: 'var(--p-ink)' },
          { lbl: 'Entrega', val: deliveryDate, color: 'var(--p-red)' },
          { lbl: 'Linha', val: line ?? '—', color: 'var(--p-ink)' },
        ].map((r, i) => (
          <div
            key={i}
            style={{
              padding: '10px 12px',
              borderRight: i < 2 ? '1px solid var(--p-line)' : 'none',
            }}
          >
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: 7.5,
                letterSpacing: '0.18em', color: 'var(--p-mute)',
                textTransform: 'uppercase',
              }}
            >
              {r.lbl}
            </div>
            <div
              style={{
                fontFamily: 'Anton, sans-serif', fontSize: 28,
                lineHeight: 1, color: r.color, marginTop: 4,
              }}
            >
              {r.val}
            </div>
          </div>
        ))}
      </div>

      {/* Etapa atual */}
      <div
        style={{
          margin: '4px 22px 14px',
          padding: '8px 12px',
          background: 'var(--p-red-soft)', border: '2px solid var(--p-red)',
        }}
      >
        <div
          style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 8.5,
            letterSpacing: '0.18em', color: 'var(--p-red)', fontWeight: 700,
          }}
        >
          VOCÊ ESTÁ AQUI · ETAPA {stageLabel}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 }}>
          <div
            style={{
              fontFamily: 'Anton, sans-serif', fontSize: 26,
              color: 'var(--p-red)', lineHeight: 1, letterSpacing: '0.02em',
            }}
          >
            {currentStage}
          </div>
          {(stageStart || stageEnd) && (
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--p-ink)' }}>
              {[stageStart, stageEnd].filter(Boolean).join(' → ')}
            </div>
          )}
        </div>
      </div>

      {/* Grade */}
      {sizes.length > 0 && (
        <div style={{ margin: '0 22px' }}>
          <div className="p-eyebrow" style={{ marginBottom: 6, fontSize: 8.5 }}>
            Grade do lote · {totalQty.toLocaleString('pt-BR')} pares
          </div>
          <table
            style={{
              width: '100%', borderCollapse: 'collapse',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
            }}
          >
            <thead>
              <tr>
                {sizes.map((s, i) => (
                  <th
                    key={i}
                    style={{
                      background: 'var(--p-soft)', color: 'var(--p-mute)',
                      border: '1px solid var(--p-line-2)',
                      padding: '5px 0', fontSize: 8.5,
                      letterSpacing: '0.14em', fontWeight: 700,
                    }}
                  >
                    {s.size}
                  </th>
                ))}
                <th
                  style={{
                    background: 'var(--p-ink)', color: '#fff',
                    border: '1px solid var(--p-line-2)',
                    padding: '5px 0', fontSize: 8.5,
                    letterSpacing: '0.14em', fontWeight: 700,
                  }}
                >
                  TOTAL
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                {sizes.map((s, i) => (
                  <td
                    key={i}
                    style={{
                      border: '1px solid var(--p-line-2)',
                      padding: '6px 0', textAlign: 'center',
                      fontWeight: 700, fontSize: 13,
                      background: 'var(--p-paper)', color: 'var(--p-ink)',
                    }}
                  >
                    {s.qty}
                  </td>
                ))}
                <td
                  style={{
                    border: '1px solid var(--p-line-2)',
                    padding: '6px 0', textAlign: 'center',
                    fontWeight: 700, fontSize: 13,
                    background: 'var(--p-ink)', color: '#fff',
                  }}
                >
                  {totalQty}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Trajeto */}
      <div style={{ margin: '14px 22px 0', display: 'flex', alignItems: 'center', gap: 0 }}>
        {STAGE_KEYS.map((s, i) => {
          const isDone = i < stageIdx;
          const isActive = i === stageIdx;
          return (
            <div key={s} style={{ display: 'contents' }}>
              <div
                style={{
                  width: 30, height: 30,
                  border: '1.5px solid',
                  borderColor: isActive ? 'var(--p-red)' : isDone ? 'var(--p-ink)' : 'var(--p-line-2)',
                  background: isActive ? 'var(--p-red)' : isDone ? 'var(--p-ink)' : '#fff',
                  color: isActive || isDone ? '#fff' : 'var(--p-mute)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
                  fontWeight: 700, letterSpacing: '0.04em',
                  flexShrink: 0,
                }}
              >
                {STAGE_SHORT[s]}
              </div>
              {i < STAGE_KEYS.length - 1 && (
                <div
                  style={{
                    flex: 1, height: 1.5,
                    background: isDone ? 'var(--p-ink)' : 'var(--p-line)',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: 'auto',
          padding: '10px 22px',
          background: 'var(--p-soft)', borderTop: '1px solid var(--p-line)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
      >
        <BarcodeSVG value={barcodeValue} height={26} fontSize={8} />
        <div
          style={{
            textAlign: 'right',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 8,
            color: 'var(--p-mute)', letterSpacing: '0.14em',
          }}
        >
          <div>VIRE PARA APONTAR</div>
          <div style={{ color: 'var(--p-ink)', fontWeight: 700, marginTop: 2 }}>
            EM CADA POSTO
          </div>
        </div>
      </div>
    </div>
  );
}

export default CartaoOP;
