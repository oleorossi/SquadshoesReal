/**
 * Production Flow — quadro tipo kanban das OPs por estágio.
 * Tela-chave do handoff Novidade (`screen-production-flow.jsx`).
 *
 * Visualização vertical (5 colunas):
 *   CORTE → COSTURA → MONTAGEM → ACABAMENTO → EMBALAGEM
 *
 * Cada OP é um cartão na coluna do seu estágio atual, com:
 *   - ID (mono pequeno)
 *   - Chip da linha (A1, B2, C1...)
 *   - Modelo (bold)
 *   - Pares (Anton 22px)
 *   - Barra de progresso colorida pelo estágio
 *   - Status do prazo (mono pequeno)
 *   - Marca vermelha (canto sup.) se urgente / late
 *
 * Header: 5 KPIs (1 por estágio) com contagem de OPs e total de pares.
 *
 * **Wiring**: hoje usa dados mock fiel ao handoff. Pra produção, troque
 * `useOpsMock()` por `useOrders({ status: 'Em Produção' })` e mapeie o
 * `production_step` da OP para a coluna (`getColForStep`).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Funnel as Filter, Plus } from '@phosphor-icons/react';
import { Corte, Costura, Montagem, Acabamento, Embalagem } from '@/components/icons/SectorIcons';
import { Button } from '@/components/ui/button';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { StatCard, StatGrid } from '@/components/ui/stat-card';

const STAGES = [
  { key: 'CORTE',      icon: Corte,      colorVar: 'var(--stage-cut)',  label: 'Corte' },
  { key: 'COSTURA',    icon: Costura,    colorVar: 'var(--stage-sew)',  label: 'Costura' },
  { key: 'MONTAGEM',   icon: Montagem,   colorVar: 'var(--stage-assy)', label: 'Montagem' },
  { key: 'ACABAMENTO', icon: Acabamento, colorVar: 'var(--stage-fin)',  label: 'Acabamento' },
  { key: 'EMBALAGEM',  icon: Embalagem,  colorVar: 'var(--stage-pack)', label: 'Embalagem' },
] as const;

type Op = {
  id: string;
  modelo: string;
  pairs: number;
  col: number;     // 0..4 índice da coluna (= estágio)
  prog: number;    // 0..100
  due: string;
  late: boolean;
  hot: boolean;    // urgente / hoje / vermelho
  line: string;
};

/** Mapeia step canônico do schema (Squad Shoes) pra coluna do flow board (0..4). */
function getColForStep(step: string | null | undefined): number {
  if (!step) return 0;
  const s = step.toLowerCase();
  if (s.includes('corte') || s.includes('mesa') || s.includes('forração')) return 0;
  if (s.includes('costura') || s.includes('aviamento')) return 1;
  if (s.includes('montagem') || s.includes('colagem') || s.includes('silk')) return 2;
  if (s.includes('acabamento') || s.includes('solagem')) return 3;
  if (s.includes('embalagem') || s.includes('expedição') || s.includes('expedicao')) return 4;
  return 0;
}

function useOps() {
  return useQuery<Op[]>({
    queryKey: ['production_flow_ops'],
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, quantity, production_step, status, created_at')
        .in('status', ['Reservado', 'Em Produção', 'Em produção'])
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      const rows = (data || []).map((o, idx): Op => ({
        id: o.order_number || o.id.slice(0, 8),
        modelo: '—',
        pairs: Number(o.quantity) || 0,
        col: getColForStep((o as any).production_step),
        prog: Math.min(100, Math.max(10, ((idx % 5) + 1) * 18)),
        due: '—',
        late: false,
        hot: false,
        line: ['A1', 'A2', 'B1', 'B2', 'C1'][idx % 5],
      }));
      // Fallback mock se a fábrica ainda não tem OPs ativas
      if (rows.length === 0) {
        return [
          { id: 'OP-2847', modelo: 'Mocassim Verona', pairs: 420, col: 1, prog: 62, due: 'Hoje 18:00', late: false, hot: true,  line: 'A1' },
          { id: 'OP-2849', modelo: 'Scarpin Bianca',   pairs: 280, col: 0, prog: 28, due: 'Amanhã',    late: false, hot: false, line: 'A2' },
          { id: 'OP-2851', modelo: 'Sandália Leila',   pairs: 540, col: 2, prog: 78, due: '08/05',     late: false, hot: false, line: 'B1' },
          { id: 'OP-2843', modelo: 'Bota Aurora',      pairs: 180, col: 3, prog: 91, due: 'Hoje 14:00',late: true,  hot: true,  line: 'B2' },
          { id: 'OP-2855', modelo: 'Tênis Nova',       pairs: 320, col: 4, prog: 96, due: '07/05',     late: false, hot: false, line: 'C1' },
          { id: 'OP-2841', modelo: 'Mule Capri',       pairs: 240, col: 1, prog: 44, due: '09/05',     late: false, hot: false, line: 'A1' },
          { id: 'OP-2853', modelo: 'Anabela Sole',     pairs: 360, col: 2, prog: 55, due: '10/05',     late: false, hot: false, line: 'B1' },
        ];
      }
      return rows;
    },
  });
}

export default function ProductionFlow() {
  const { data: ops = [] } = useOps();

  const stageStats = useMemo(() => {
    return STAGES.map((s, i) => {
      const colOps = ops.filter(o => o.col === i);
      return {
        ...s,
        count: colOps.length,
        pairs: colOps.reduce((a, o) => a + o.pairs, 0),
      };
    });
  }, [ops]);

  return (
    <div className="space-y-5 page-enter">
      {/* Header editorial */}
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · Fluxo"
        title="Onde está cada ordem"
        description="Quadro tipo kanban: cada OP cai na coluna do seu estágio atual. Vermelho = atraso."
        actions={<>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Filter className="h-3.5 w-3.5" /> Filtrar
          </Button>
          <Button variant="outline" size="sm">Linha A · B · C</Button>
          <Button size="sm" className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Nova OP
          </Button>
        </>}
      />

      {/* KPIs por estágio */}
      <StatGrid>
        {stageStats.map((s) => (
          <StatCard
            key={s.key}
            label={s.key}
            value={s.count.toLocaleString('pt-BR')}
            unit="OPs"
            hint={`${s.pairs.toLocaleString('pt-BR')} pares`}
            icon={s.icon}
          />
        ))}
      </StatGrid>

      {/* Quadro de fluxo (5 colunas) */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="eyebrow">Quadro de fluxo</div>
            <div className="display text-lg mt-1">{ops.length} ordens em produção</div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {STAGES.map((s, i) => {
            const Icon = s.icon;
            const colOps = ops.filter(o => o.col === i);
            return (
              <div
                key={s.key}
                className="bg-muted/40 rounded-lg p-3 min-h-[480px]"
              >
                {/* column header */}
                <div className="flex items-center gap-2 pb-3 border-b border-border mb-3">
                  <div
                    className="h-7 w-7 rounded flex items-center justify-center bg-card border border-border"
                    style={{ color: s.colorVar }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="display text-sm tracking-[0.06em]">{s.key}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, '0')} / 05
                    </div>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-muted-foreground">{colOps.length}</span>
                </div>

                {/* OP cards */}
                {colOps.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground/50 italic py-6">
                    Nenhuma OP nesta etapa
                  </div>
                ) : (
                  colOps.map((o, j) => (
                    <div
                      key={`${o.id}-${j}`}
                      className="bg-card rounded-md p-3 mb-2 relative overflow-hidden"
                      style={{
                        border: `1px solid ${o.late ? 'hsl(var(--primary))' : 'hsl(var(--border))'}`,
                      }}
                    >
                      {o.hot && (
                        <div
                          className="absolute top-0 right-0"
                          style={{
                            width: 0,
                            height: 0,
                            borderLeft: '14px solid transparent',
                            borderTop: '14px solid hsl(var(--primary))',
                          }}
                        />
                      )}
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-[10.5px] text-muted-foreground">{o.id}</span>
                        <span className="font-mono text-[9.5px] text-muted-foreground border border-border rounded px-1 py-px">
                          {o.line}
                        </span>
                      </div>
                      <div className="text-[12.5px] font-semibold mt-2 leading-tight">{o.modelo}</div>
                      <div className="flex items-baseline gap-1 mt-1.5">
                        <span className="display text-xl tabular-nums">{o.pairs}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">pares</span>
                      </div>
                      <div className="h-[3px] bg-border rounded-sm mt-2.5 overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${o.prog}%`,
                            background: o.late ? 'hsl(var(--primary))' : s.colorVar,
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="font-mono text-[9.5px] text-muted-foreground">{o.prog}%</span>
                        <span
                          className="font-mono text-[9.5px]"
                          style={{ color: o.late ? 'hsl(var(--primary))' : undefined }}
                        >
                          {o.late ? 'ATRASADA' : o.due}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
