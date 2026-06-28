import React from 'react';
import { SignedImage } from '@/components/ui/signed-image';
import { adaptiveFontSize } from '@/lib/adaptiveFontSize';
import { adaptiveTableFont } from './worksheet/adaptiveFont';
import { PaginatedSheet, type SheetBlock } from './worksheet/PaginatedSheet';

export interface ReportStage {
  stage_name: string;
  status: 'pendente' | 'em_andamento' | 'concluido' | string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ReportStrap {
  label?: string;
  color?: string;
  group_name?: string;
}

export interface ReportOrder {
  id: string;
  op_number?: string;
  reference_code?: string;
  reference_name?: string;
  color?: string;
  sole_name?: string | null;
  total_pairs: number;
  status?: string;
  due_date?: string | null;
  stages?: ReportStage[];
  /** URL da foto principal da ref+cor (signed). */
  image_url?: string | null;
  /** URL/nome do silk aplicado (cliente OU solado OU Squad). */
  silk_url?: string | null;
  silk_name?: string | null;
  /** Grade de tamanhos {35: 12, 36: 12, ...}. */
  grade?: Record<string, number> | null;
  /** Tiras configuradas no item de venda. */
  straps?: ReportStrap[];
  /** Materiais principais (cabedal, forro, palmilha) — opcional. */
  upper_material?: string | null;
  lining_material?: string | null;
  insole_material?: string | null;
  /** Caixas (pares por caixa). */
  pairs_per_box?: number | null;
  // (cost/order_costs REMOVIDO em 2026-06-12 — pedido do dono: o Relatório
  //  Gerencial não exibe mais Custos & Margem; KPIs são só operacionais.)
}

export interface ReportSaleOrder {
  id: string;
  order_number?: string | null;
  client_order_number?: string | null;
  client_name?: string | null;
  client_cnpj?: string | null;
  client_ie?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  client_address?: string | null;
  client_city?: string | null;
  client_state?: string | null;
  client_logo_url?: string | null;
  representative?: string | null;
  payment_condition?: string | null;
  delivery_deadline?: string | null;
  status?: string | null;
  total_value?: number | null;
  notes?: string | null;
}

interface Props {
  saleOrder: ReportSaleOrder;
  orders: ReportOrder[];
  date?: string;
  /** Rótulo da faixa de cabeçalho de página (PaginatedSheet) —
   *  ex.: "Relatório Gerencial · PV-00123". */
  sectorLabel?: string;
}

// Setores canônicos da produção (PR Costura / PR 3 paralelismo).
// IMPORTANTE: o DB grava `Mesa` em order_stages.stage_name (legacy), mas a UI
// sempre mostra "Aviamento". A normalização stage→Aviamento acontece no
// `normalizeStageName()` abaixo.
const STAGE_ORDER = [
  'Corte Palmilha', 'Corte Forração', 'Costura',
  'Aviamento',
  'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento', 'Expedição',
];

// Mapa stage_name (DB) → label exibido. Casos onde DB e UI divergem.
function normalizeStageName(name: string): string {
  if (name === 'Mesa') return 'Aviamento';
  return name;
}

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('pt-BR');
  } catch {
    return d;
  }
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return d;
  }
}

/**
 * Relatório gerencial — uma ficha A4 por PV, com info COMPLETA pra
 * acompanhamento gerencial (cliente, deadline, status por OP, status por
 * setor, custos, margem). Não substitui a ficha do operador (essa é
 * minimalista pra execução); este é o "olho de gestor" sobre o pedido.
 *
 * Design language: Print Editorial (FT/WSJ-style). White-dominant,
 * hairlines, big display type pra hierarquia, números em mono.
 */
export const ManagementReport = ({ saleOrder, orders, date, sectorLabel }: Props) => {
  const totalPairs = orders.reduce((s, o) => s + (o.total_pairs || 0), 0);

  // (Custos & Margem REMOVIDOS em 2026-06-12 — pedido do dono. O relatório
  //  mantém apenas KPIs operacionais: OPs, pares, prazos e status.)

  // ── Progresso operacional (% de stages concluídos) ──
  // F-M1 (2026-06-17): setores que o MODELO não percorre (ex.: palmilha
  // pronta na cor PULA Corte Palmilha/Corte Forração) geram order_stages com
  // status 'skipped' (várias funções SQL inserem stages assim). Esses stages
  // NUNCA viram 'concluido', então o denominador antigo (todos os stages)
  // travava o progresso < 100% pra sempre e `opsConcluidas` (.every concluído)
  // nunca era atingido. Regra: stages pulados/não-aplicáveis NÃO entram no
  // denominador nem bloqueiam a conclusão da OP. Só stages "aplicáveis"
  // (pendente/em_andamento/concluido) contam.
  const SKIPPED_STATUSES = new Set(['skipped', 'pulado', 'nao_aplicavel', 'n/a', 'na', 'cancelado', 'cancelled']);
  const isApplicable = (st: string | undefined | null) => !SKIPPED_STATUSES.has(String(st || '').toLowerCase());
  const stageStats = orders.reduce(
    (acc, o) => {
      for (const s of o.stages || []) {
        if (!isApplicable(s.status)) continue; // pula stages de setores não percorridos
        acc.total += 1;
        if (s.status === 'concluido') acc.done += 1;
      }
      return acc;
    },
    { total: 0, done: 0 },
  );
  const progressPct = stageStats.total > 0 ? Math.round((stageStats.done / stageStats.total) * 100) : 0;
  // OP concluída = tem ao menos 1 stage aplicável E todos os aplicáveis estão
  // concluídos (stages pulados são ignorados, não impedem a conclusão).
  const opsConcluidas = orders.filter(o => {
    const applicable = (o.stages || []).filter(s => isApplicable(s.status));
    return applicable.length > 0 && applicable.every(s => s.status === 'concluido');
  }).length;

  // Setores únicos presentes (normalizando Mesa → Aviamento)
  const sectorsPresent = new Set<string>();
  for (const o of orders) {
    for (const s of (o.stages || [])) sectorsPresent.add(normalizeStageName(s.stage_name));
  }
  const sectorsOrdered = STAGE_ORDER.filter(s => sectorsPresent.has(s));

  // Galeria de imagens únicas (ref+cor) — máximo 12 thumbnails
  const galleryItems = orders
    .filter(o => o.image_url)
    .reduce<Array<{ key: string; url: string; label: string }>>((acc, o) => {
      const key = `${o.reference_code || o.reference_name || ''}-${o.color || ''}`;
      if (!acc.some(x => x.key === key)) {
        acc.push({
          key,
          url: o.image_url!,
          label: `${o.reference_name || o.reference_code || '?'} · ${o.color || 'sem cor'}`,
        });
      }
      return acc;
    }, [])
    .slice(0, 12);

  // Silks únicos (por nome) + QUAIS referências levam cada silk (pedido do
  // dono 2026-06-12): abaixo da imagem de cada silk, a lista de modelos/refs
  // que a recebem — agregado silk → referências a partir das OPs do PV.
  const silksUnique = orders
    .filter(o => o.silk_url)
    .reduce<Array<{ name: string; url: string; refs: string[] }>>((acc, o) => {
      const name = o.silk_name || 'Silk';
      let entry = acc.find(s => s.name === name);
      if (!entry) {
        entry = { name, url: o.silk_url!, refs: [] };
        acc.push(entry);
      }
      const refLabel = o.reference_name || o.reference_code || '';
      if (refLabel && !entry.refs.includes(refLabel)) entry.refs.push(refLabel);
      return acc;
    }, [])
    .slice(0, 6);

  // Auditoria visual 11/06/2026: numeração de seção dinâmica — seções
  // condicionais (cliente/galeria/silks/timeline) escondidas faziam a
  // numeração pular (ex: 06 → 08). Contador incrementa só no que renderiza.
  let sectionNo = 0;
  const nextSection = () => String(++sectionNo).padStart(2, '0');

  // ── Fontes adaptativas (2026-06-12) ────────────────────────────────────────
  // O CSS de print força table-layout:fixed + overflow:hidden nas células —
  // fonte fixa CORTAVA linhas quando havia muitas colunas (status por setor)
  // ou conteúdo longo (valores monetários). Cada tabela dimensiona a fonte
  // pela própria densidade via adaptiveTableFont.
  // Status por setor: 4 colunas fixas + 1 por setor presente.
  const stF = adaptiveTableFont(4 + sectorsOrdered.length);
  const sectorColWidth = sectorsOrdered.length > 8 ? 28 : 34;

  // ── Blocos atômicos pro PaginatedSheet (2026-06-12) ──
  // Cada seção do relatório vira um bloco; cada card de OP do detalhamento
  // também. Tabelas longas (status/timeline/custos) são blocos únicos — se
  // excederem 1 página inteira, fluem no browser (tr atômico, thead repete).

  // ─────────────────────────────── 01 / MASTHEAD ───────────────────────────────
  const headerBlock = (
    <>
      <header className="mb-6">
        <div className="flex items-baseline justify-between gap-4 mb-3">
          <span className="section-label" style={{ color: '#000' }}>
            Squad Shoes · Relatório Gerencial
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            {date || new Date().toLocaleDateString('pt-BR')}
          </span>
        </div>

        <div className="rule-line-thick mb-4" style={{ backgroundColor: '#000' }} />

        <div className="grid grid-cols-12 gap-4 items-end">
          <div className="col-span-8">
            <p className="section-label mb-2" style={{ color: '#000' }}>
              Pedido de Venda
            </p>
            {(() => {
              const pvText = saleOrder.order_number || 'PV —';
              // Base 104px ≈ 78pt original. Anton charWidthRatio ≈ 0.45.
              const fontPx = adaptiveFontSize(pvText, { maxWidthPx: 480, baseFontPx: 104, minFontPx: 56, charWidthRatio: 0.45 });
              return (
                <h1
                  className="font-display leading-none tracking-tight"
                  style={{
                    fontFamily: "'Anton', Impact, sans-serif",
                    fontSize: `${fontPx}px`,
                    lineHeight: 0.82,
                    letterSpacing: '-0.025em',
                    color: '#000',
                    textTransform: 'uppercase',
                  }}
                >
                  {pvText}
                </h1>
              );
            })()}
            {saleOrder.client_order_number && (
              <p className="mt-3 text-[9pt] text-black">
                <span className="section-label" style={{ color: '#555' }}>Pedido cliente</span>{' '}
                <span className="font-mono font-semibold ml-1">{saleOrder.client_order_number}</span>
              </p>
            )}
          </div>

          <div className="col-span-4 border-l border-black pl-4 space-y-2">
            <div>
              <p className="section-label" style={{ color: '#555' }}>Cliente</p>
              <p className="font-semibold text-[10pt] text-black leading-tight mt-0.5">
                {saleOrder.client_name || 'Sem cliente'}
              </p>
            </div>
            {saleOrder.client_cnpj && (
              <div>
                <p className="section-label" style={{ color: '#555' }}>CNPJ</p>
                <p className="font-mono text-[9pt] text-black mt-0.5">{saleOrder.client_cnpj}</p>
              </div>
            )}
            {saleOrder.client_city && (
              <div>
                <p className="section-label" style={{ color: '#555' }}>Praça</p>
                <p className="text-[9pt] text-black mt-0.5">{saleOrder.client_city}</p>
              </div>
            )}
            {saleOrder.delivery_deadline && (
              <div>
                <p className="section-label" style={{ color: '#555' }}>Faturar até</p>
                <p className="font-mono font-semibold text-[10pt] text-black mt-0.5">
                  {fmtDate(saleOrder.delivery_deadline)}
                </p>
              </div>
            )}
            {saleOrder.status && (
              <div>
                <p className="section-label" style={{ color: '#555' }}>Status</p>
                <p className="text-[9pt] font-semibold text-black mt-0.5 uppercase tracking-wider">
                  {saleOrder.status}
                </p>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="rule-line-double mb-6" style={{ borderColor: '#000' }} />
    </>
  );

  // ─────────────────────────────── 02 / INDICADORES ───────────────────────────────
  const indicadoresBlock = (
      <section className="keep-together mb-6">
        <div className="flex items-baseline gap-3 mb-4">
          <span
            className="font-display"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '14pt',
              color: '#000',
            }}
          >
            {nextSection()}
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            Indicadores do Pedido
          </span>
          <div className="flex-1 h-px bg-black" />
        </div>

        <div className="grid grid-cols-4 gap-0 border-t border-b border-black">
          <KpiBlock label="OPs" value={String(orders.length)} />
          <KpiBlock label="OPs concluídas" value={`${opsConcluidas} / ${orders.length}`} bordered />
          <KpiBlock label="Pares" value={totalPairs.toLocaleString('pt-BR')} bordered />
          <KpiBlock label="Progresso" value={`${progressPct}%`} sub={`${stageStats.done} / ${stageStats.total} setores`} bordered />
        </div>
      </section>
  );

  // ─────────────────────────────── 03 / STATUS POR SETOR ───────────────────────────────
  // Bloco único no paginador; se exceder 1 página inteira, flui no browser
  // (linhas atômicas + thead repetindo fazem a quebra limpa).
  const statusBlock = (
      <section className="mb-6">
        <div className="flex items-baseline gap-3 mb-4 keep-together keep-with-next">
          <span
            className="font-display"
            style={{
              fontFamily: "'Anton', Impact, sans-serif",
              fontSize: '14pt',
              color: '#000',
            }}
          >
            {nextSection()}
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            Ordens de Produção · Status por Setor
          </span>
          <div className="flex-1 h-px bg-black" />
        </div>

        <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead>
            <tr style={{ borderBottom: '1.5px solid #000' }}>
              <th className="text-left py-2 pr-2 section-label" style={{ width: 56, color: '#000' }}>OP</th>
              <th className="text-left py-2 pr-2 section-label" style={{ color: '#000' }}>Ref · Cor</th>
              <th className="text-left py-2 pr-2 section-label" style={{ width: 84, color: '#000' }}>Solado</th>
              <th className="text-right py-2 pr-2 section-label" style={{ width: 40, color: '#000' }}>Pares</th>
              {sectorsOrdered.map(s => (
                <th
                  key={s}
                  className="font-mono text-black uppercase"
                  // Cabeçalho ROTACIONADO 90° (lê de baixo pra cima): numa
                  // coluna estreita (~30px) o nome horizontal quebrava letra a
                  // letra ("C-P-A-L-M-I-L-H-A"). Vertical, o nome inteiro lê
                  // limpo. writing-mode + rotate(180deg) = ascendente, padrão
                  // de matriz industrial.
                  style={{
                    width: sectorColWidth,
                    textAlign: 'center',
                    verticalAlign: 'bottom',
                    height: 78,
                    padding: '4px 0 6px',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      writingMode: 'vertical-rl',
                      transform: 'rotate(180deg)',
                      whiteSpace: 'nowrap',
                      fontSize: '8px',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      lineHeight: 1,
                    }}
                  >
                    {s.replace('Corte ', 'C. ')}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map(o => {
              // F6: chaves do mapa normalizadas (igual à coluna). Garante que
              // OPs antigas com stage_name='Mesa'/'Forração' batem com coluna
              // 'Aviamento'/'Corte Forração' canônica.
              const stageByName = new Map(
                (o.stages || []).map(s => [normalizeStageName(s.stage_name), s])
              );
              return (
                <tr key={o.id} style={{ borderBottom: '1px solid #333' }}>
                  <td className="py-1.5 pr-2 font-mono text-black" style={{ fontSize: `${stF.cellPx}px`, lineHeight: 1.25 }}>{o.op_number || '—'}</td>
                  <td className="py-1.5 pr-2 text-black" style={{ fontSize: `${stF.textPx + 1}px`, lineHeight: 1.25 }}>
                    <span className="font-semibold">{o.reference_name || o.reference_code || '—'}</span>
                    {o.color && <span className="text-black"> · {o.color}</span>}
                  </td>
                  <td className="py-1.5 pr-2" style={{ fontSize: `${stF.textPx}px`, lineHeight: 1.25, color: '#333' }}>{o.sole_name || '—'}</td>
                  <td className="py-1.5 pr-2 text-right font-mono font-bold text-black" style={{ fontSize: `${stF.cellPx + 1}px`, lineHeight: 1.25 }}>{o.total_pairs}</td>
                  {sectorsOrdered.map(s => {
                    // s já é canônico (Aviamento/Costura/etc). Mapa usa chaves normalizadas.
                    const stage = stageByName.get(s) || null;
                    const status = stage?.status || 'pendente';
                    // F-M1 (2026-06-17): setor pulado pelo modelo (palmilha
                    // pronta etc.) → '–' neutro, não '○ pendente' enganoso.
                    const skipped = !isApplicable(status);
                    const symbol = skipped ? '–' : status === 'concluido' ? '●' : status === 'em_andamento' ? '◐' : '○';
                    // F-A1 (2026-06-17): pendente em #777 (não #bababa, que
                    // desbotava no papel). Concluído preto, andamento vermelho,
                    // pulado #777.
                    const color = skipped ? '#777' : status === 'concluido' ? '#000' : status === 'em_andamento' ? '#C00000' : '#777';
                    return (
                      <td
                        key={s}
                        className="py-1.5 text-center font-mono"
                        style={{ color, fontSize: `${Math.max(12, stF.displayPx)}px`, lineHeight: 1 }}
                      >
                        {symbol}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-3 flex items-center gap-4 text-[8pt]" style={{ color: '#333' }}>
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-black" style={{ fontSize: '11pt' }}>●</span> concluído
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono" style={{ fontSize: '11pt', color: '#C00000' }}>◐</span> em andamento
          </span>
          <span className="flex items-center gap-1.5">
            {/* símbolo pendente em #777 (cinza-escuro legível no papel, não o
                #bababa antigo que sumia na impressão) — F-A1 2026-06-17. */}
            <span className="font-mono" style={{ fontSize: '11pt', color: '#777' }}>○</span> pendente
          </span>
          <span className="flex items-center gap-1.5">
            <span className="font-mono" style={{ fontSize: '11pt', color: '#777' }}>–</span> não percorre
          </span>
        </div>
      </section>
  );

  // ─────────────────────────────── 04 / DADOS DO CLIENTE ───────────────────────────────
  const clienteBlock = (saleOrder.client_ie || saleOrder.client_phone || saleOrder.client_email
    || saleOrder.client_address || saleOrder.representative
    || saleOrder.payment_condition || saleOrder.notes) ? (
        <section className="keep-together mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              {nextSection()}
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Dados do Cliente
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-3 gap-x-6 gap-y-3 text-[9pt] text-black border-t border-b border-black py-3">
            {saleOrder.client_ie && (
              <Field label="Inscrição Estadual" value={saleOrder.client_ie} mono />
            )}
            {saleOrder.client_phone && <Field label="Telefone" value={saleOrder.client_phone} mono />}
            {saleOrder.client_email && <Field label="E-mail" value={saleOrder.client_email} />}
            {(saleOrder.client_address || saleOrder.client_city || saleOrder.client_state) && (
              <Field
                label="Endereço"
                value={[saleOrder.client_address, saleOrder.client_city, saleOrder.client_state]
                  .filter(Boolean).join(' · ')}
              />
            )}
            {saleOrder.representative && (
              <Field label="Representante" value={saleOrder.representative} />
            )}
            {saleOrder.payment_condition && (
              <Field label="Condição de pagamento" value={saleOrder.payment_condition} />
            )}
          </div>

          {saleOrder.notes && (
            <div className="mt-3 border-l-2 border-black pl-3">
              <p className="section-label mb-1" style={{ color: '#555' }}>Observações</p>
              <p className="text-[9pt] text-black whitespace-pre-wrap leading-snug">{saleOrder.notes}</p>
            </div>
          )}
        </section>
  ) : null;

  // ─────────────────────────────── 05 / GALERIA PRODUTOS ───────────────────────────────
  const galeriaBlock = galleryItems.length > 0 ? (
        <section className="mb-6">
          <div className="flex items-baseline gap-3 mb-4 keep-together keep-with-next">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              {nextSection()}
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Produtos · Galeria
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-6 gap-3">
            {galleryItems.map(g => (
              <div key={g.key} className="keep-together">
                <div
                  className="w-full aspect-square border border-black bg-white overflow-hidden"
                  style={{ printColorAdjust: 'exact' }}
                >
                  <SignedImage
                    src={g.url}
                    alt={g.label}
                    loading="eager"
                    className="w-full h-full object-cover"
                  />
                </div>
                <p className="mt-1 text-[7pt] text-black leading-tight">{g.label}</p>
              </div>
            ))}
          </div>
        </section>
  ) : null;

  // ─────────────────────────────── 06 / SILKS · ARTES ───────────────────────────────
  const silksBlock = silksUnique.length > 0 ? (
        <section className="mb-6">
          <div className="flex items-baseline gap-3 mb-4 keep-together keep-with-next">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              {nextSection()}
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Silks · Artes Aplicadas
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {silksUnique.map(s => (
              <div key={s.name} className="keep-together border border-black p-2">
                <div className="w-full aspect-[4/3] bg-white overflow-hidden mb-1">
                  <SignedImage src={s.url} alt={s.name} loading="eager" className="w-full h-full object-contain" />
                </div>
                <p className="text-[8pt] text-black font-semibold leading-tight">{s.name}</p>
                {/* Referências que levam esta silk (2026-06-12). */}
                {s.refs.length > 0 && (
                  <div className="mt-1 pt-1" style={{ borderTop: '1px solid #333' }}>
                    <p className="section-label" style={{ color: '#555' }}>
                      Referência{s.refs.length > 1 ? 's' : ''}
                    </p>
                    <p className="text-[7.5pt] text-black leading-snug mt-0.5">
                      {s.refs.join(' · ')}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
  ) : null;

  // ─────────────────────────────── 07 / DETALHAMENTO DAS OPs ───────────────────────────────
  // Heading anexado ao 1º card (nunca órfão); cada card de OP é um bloco.
  const detalheHeading = (
        <div className="flex items-baseline gap-3 mb-4">
          <span
            className="font-display"
            style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
          >
            {nextSection()}
          </span>
          <span className="section-label" style={{ color: '#000' }}>
            Detalhamento das Ordens · Grade · Tiras · Materiais
          </span>
          <div className="flex-1 h-px bg-black" />
        </div>
  );

  const detalheCards = orders.map(o => {
            const gradeEntries = o.grade
              ? Object.entries(o.grade)
                  .filter(([, v]) => v && Number(v) > 0)
                  .sort(([a], [b]) => Number(a) - Number(b))
              : [];
            const hasStraps = (o.straps?.length ?? 0) > 0;
            const hasMats = o.upper_material || o.lining_material || o.insole_material;
            return (
              <div
                key={o.id}
                className="keep-together border-t border-black pt-2"
              >
                <div className="flex items-baseline justify-between gap-2 mb-1.5">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[9pt] text-black font-bold">
                      OP {o.op_number || '—'}
                    </span>
                    <span className="text-[9pt] text-black font-semibold">
                      {o.reference_name || o.reference_code || '—'}
                      {o.color && <span style={{ color: '#333' }}> · {o.color}</span>}
                    </span>
                  </div>
                  <span className="font-mono text-[9pt] text-black font-bold">
                    {o.total_pairs} pares
                  </span>
                </div>

                {o.sole_name && (
                  <p className="text-[8pt] mb-1.5" style={{ color: '#333' }}>
                    <span className="section-label" style={{ color: '#555' }}>Solado</span>
                    <span className="ml-1.5">{o.sole_name}</span>
                    {o.pairs_per_box != null && (
                      <span className="ml-3">
                        <span className="section-label" style={{ color: '#555' }}>Pares/cx</span>
                        <span className="font-mono ml-1.5">{o.pairs_per_box}</span>
                      </span>
                    )}
                  </p>
                )}

                {gradeEntries.length > 0 && (() => {
                  // Fonte/largura adaptativas: grade mista (16+ numerações)
                  // estourava a largura A4 com 26px fixos por célula.
                  const gF = adaptiveTableFont(gradeEntries.length);
                  const cellW = gradeEntries.length > 16 ? 20 : 26;
                  return (
                  <div className="mb-1.5">
                    <p className="section-label mb-1" style={{ color: '#555' }}>Grade</p>
                    <table style={{ borderCollapse: 'collapse' }}>
                      <tbody>
                        <tr>
                          {gradeEntries.map(([size]) => (
                            <td
                              key={`s-${size}`}
                              className="font-mono text-center"
                              style={{ minWidth: cellW, fontSize: `${gF.cellPx}px`, padding: `${gF.padY}px ${gF.padX}px`, lineHeight: 1.2, border: '1px solid #000', color: '#333' }}
                            >
                              {size}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          {gradeEntries.map(([size, qty]) => (
                            <td
                              key={`q-${size}`}
                              className="font-mono font-bold text-center text-black"
                              style={{ minWidth: cellW, fontSize: `${gF.cellPx}px`, padding: `${gF.padY}px ${gF.padX}px`, lineHeight: 1.2, border: '1px solid #000' }}
                            >
                              {qty}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  );
                })()}

                {hasStraps && (
                  <div className="mb-1.5">
                    <p className="section-label mb-1" style={{ color: '#555' }}>Tiras</p>
                    <div className="flex flex-wrap gap-1.5">
                      {o.straps!.map((st, i) => (
                        <span
                          key={`${o.id}-strap-${i}`}
                          className="text-[8pt] text-black px-1.5 py-0.5"
                          style={{ border: '1px solid #000' }}
                        >
                          {st.label || st.group_name || `Tira ${i + 1}`}
                          {st.color && <span style={{ color: '#333' }}> · {st.color}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {hasMats && (
                  <div className="grid grid-cols-3 gap-x-4 text-[8pt] text-black">
                    {o.upper_material && (
                      <div>
                        <span className="section-label" style={{ color: '#555' }}>Cabedal</span>
                        <span className="ml-1.5">{o.upper_material}</span>
                      </div>
                    )}
                    {o.lining_material && (
                      <div>
                        <span className="section-label" style={{ color: '#555' }}>Forração</span>
                        <span className="ml-1.5">{o.lining_material}</span>
                      </div>
                    )}
                    {o.insole_material && (
                      <div>
                        <span className="section-label" style={{ color: '#555' }}>Palmilha</span>
                        <span className="ml-1.5">{o.insole_material}</span>
                      </div>
                    )}
                  </div>
                )}

                {o.due_date && (
                  <p className="text-[8pt] mt-1" style={{ color: '#333' }}>
                    <span className="section-label" style={{ color: '#555' }}>Prazo</span>
                    <span className="font-mono ml-1.5">{fmtDate(o.due_date)}</span>
                  </p>
                )}
              </div>
            );
  });

  const detalheBlocks: React.ReactNode[] = detalheCards.length > 0
    ? detalheCards.map((card, i) => (
        <React.Fragment key={`det-${i}`}>
          {i === 0 ? detalheHeading : null}
          {card}
        </React.Fragment>
      ))
    : [detalheHeading];

  // ─────────────────────────────── 08 / LINHA DO TEMPO ───────────────────────────────
  const timelineBlock = orders.some(o => (o.stages || []).some(s => s.started_at || s.completed_at)) ? (
        <section className="mb-6">
          <div className="flex items-baseline gap-3 mb-4 keep-together keep-with-next">
            <span
              className="font-display"
              style={{ fontFamily: "'Anton', Impact, sans-serif", fontSize: '14pt', color: '#000' }}
            >
              {nextSection()}
            </span>
            <span className="section-label" style={{ color: '#000' }}>
              Linha do Tempo · Setores
            </span>
            <div className="flex-1 h-px bg-black" />
          </div>

          <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: '8pt' }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #000' }}>
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 56, color: '#000' }}>OP</th>
                <th className="text-left py-1.5 pr-2 section-label" style={{ color: '#000' }}>Setor</th>
                {/* 108px: "12/05/2026, 14:30" (17 chars) em 8pt mono ocupa
                    ~106px — os 100px antigos cortavam o minuto no papel. */}
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 108, color: '#000' }}>Início</th>
                <th className="text-left py-1.5 pr-2 section-label" style={{ width: 108, color: '#000' }}>Conclusão</th>
                <th className="text-left py-1.5 section-label" style={{ width: 76, color: '#000' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.flatMap(o =>
                (o.stages || [])
                  .filter(s => s.started_at || s.completed_at)
                  .map((s, i) => (
                    <tr key={`${o.id}-${s.stage_name}-${i}`} style={{ borderBottom: '1px solid #333' }}>
                      <td className="py-1 pr-2 font-mono text-black">{o.op_number || '—'}</td>
                      <td className="py-1 pr-2 text-black">{normalizeStageName(s.stage_name)}</td>
                      <td className="py-1 pr-2 font-mono" style={{ color: '#333' }}>{fmtDateTime(s.started_at)}</td>
                      <td className="py-1 pr-2 font-mono" style={{ color: '#333' }}>{fmtDateTime(s.completed_at)}</td>
                      <td className="py-1 text-[7.5pt] uppercase tracking-wider text-black">
                        {s.status === 'concluido' ? 'concluído'
                          : s.status === 'em_andamento' ? 'em andamento'
                          : 'pendente'}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </section>
  ) : null;

  // (Seção "Custos & Margem" — tabela material/MO/overhead/custo/receita/
  //  margem + aviso "custos não calculados" — REMOVIDA em 2026-06-12 a
  //  pedido do dono. O relatório é operacional: OPs, pares, prazos, status.)

  // ─────────────────────────────── FOOTER · ASSINATURAS ───────────────────────────────
  // Bloco atômico próprio no paginador (assinaturas nunca quebram no meio).
  const footerBlock = (
      <footer className="mt-8 pt-8 keep-together">
        <div className="rule-line mb-6" style={{ backgroundColor: '#000' }} />
        <div className="grid grid-cols-3 gap-8">
          {['PCP', 'Comercial', 'Financeiro'].map(label => (
            <div key={label} className="text-center">
              <div className="border-t border-black pt-2">
                <p className="section-label" style={{ color: '#000' }}>{label}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-baseline justify-between text-[7pt]" style={{ color: '#555' }}>
          <span className="section-label" style={{ color: '#555' }}>Squad Shoes · Sistema de Gestão</span>
          <span className="font-mono">{saleOrder.order_number || 'PV —'} · {date || new Date().toLocaleDateString('pt-BR')}</span>
        </div>
      </footer>
  );

  const blocks: SheetBlock[] = [
    headerBlock,
    indicadoresBlock,
    statusBlock,
    ...(clienteBlock ? [clienteBlock] : []),
    ...(galeriaBlock ? [galeriaBlock] : []),
    ...(silksBlock ? [silksBlock] : []),
    ...detalheBlocks,
    ...(timelineBlock ? [timelineBlock] : []),
    // Assinaturas com keepWithPrev: nunca abrem página sozinhas.
    { node: footerBlock, keepWithPrev: true },
  ];

  return (
    <PaginatedSheet
      sectorLabel={sectorLabel || `Relatório Gerencial · ${saleOrder.order_number || 'PV —'}`}
      blocks={blocks}
      pageStyle={{ fontFamily: "'Fira Sans', 'Inter', system-ui, sans-serif", fontSize: '10pt' }}
    />
  );
};

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="section-label mb-0.5" style={{ color: '#555' }}>{label}</p>
      <p className={`text-[9pt] text-black ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

// (prop `accent: 'negative'` removida em 2026-06-12 junto com os KPIs
//  financeiros — só os KPIs operacionais usam este bloco agora.)
function KpiBlock({
  label,
  value,
  sub,
  bordered,
}: {
  label: string;
  value: string;
  sub?: string;
  bordered?: boolean;
}) {
  return (
    <div
      className="px-3 py-4"
      style={{
        borderLeft: bordered ? '1px solid #000' : 'none',
      }}
    >
      <p className="section-label mb-2" style={{ color: '#000' }}>{label}</p>
      {/* Auditoria visual 11/06/2026: 22pt fixo estourava a célula com valores
          monetários longos (ex: "R$ 3.600,00" invadia o KPI vizinho e "Margem"
          colidia com "Margem %"). Fonte agora escala pelo tamanho do texto. */}
      <p
        className="font-mono font-bold leading-none"
        style={{
          fontFamily: "'Fira Code', monospace",
          // Célula do grid-cols-4 em A4 tem ~156px úteis; "R$ 123.456,78" em
          // 22pt mono ≈ 230px — estourava por cima do KPI vizinho no papel.
          // Usa o helper canônico (diretriz adaptiveFontSize) em vez de
          // breakpoints manuais por nº de chars.
          fontSize: `${adaptiveFontSize(value, { maxWidthPx: 156, baseFontPx: 29, minFontPx: 13, charWidthRatio: 0.6 })}px`,
          letterSpacing: '-0.03em',
          overflowWrap: 'anywhere',
          color: '#000',
        }}
      >
        {value}
      </p>
      {sub && (
        <p className="font-mono mt-1 text-[9pt]" style={{ color: '#666' }}>
          {sub}
        </p>
      )}
    </div>
  );
}
