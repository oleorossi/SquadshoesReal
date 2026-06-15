import { useMemo, useState } from 'react';
import { Scissors, Warning, ArrowCounterClockwise, Info } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/ui/panel';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ArtisanalRecipe } from '@/hooks/useArtisanalRecipes';
import {
  planRollCutting,
  ROLO_COMPRIMENTO_M,
  ROLO_LARGURA_MM,
  METROS_UTEIS_POR_BANDA,
  type RollCutDemand,
} from '@/lib/cuttingOptimizer';

/**
 * Otimizador de Corte do Rolo — empacota VÁRIAS tiras da mesma cor/base num rolo.
 *
 * O Leonardo dedica 1 rolo de NAPA (1370mm × 40m) por cor. Daquela cor ele corta tiras
 * diferentes (chata 8mm + overlock 5mm + chata 25mm…). Esta tela recebe os metros de
 * cada tira e empacota tudo via First-Fit-Decreasing (`planRollCutting`), mostrando
 * quantos rolos são precisos e como ficam dispostas as bandas.
 *
 * Escopo: tela Receitas → Produtos Artesanais. NÃO mexe na fórmula `computeStrapRollCut`
 * nem nos painéis do PV (reusa só as constantes do rolo).
 */

/** Paleta determinística por receita (índice). HSL inline — fora do check de tokens. */
const SEGMENT_HUES = [347, 210, 28, 152, 265, 45, 320, 174, 96, 230, 12, 290];
const segmentColor = (i: number) => `hsl(${SEGMENT_HUES[i % SEGMENT_HUES.length]} 68% 50%)`;

const fmtMm = (mm: number) => `${Math.round(mm).toLocaleString('pt-BR')} mm`;

export default function CuttingOptimizerPanel({ recipes }: { recipes: ArtisanalRecipe[] }) {
  const [selectedBase, setSelectedBase] = useState<string>('');
  const [color, setColor] = useState('');
  const [meters, setMeters] = useState<Record<string, string>>({});

  // Bases distintas das receitas (matéria-prima). Cada cor usa um rolo dedicado.
  const bases = useMemo(() => {
    const set = new Set<string>();
    recipes.forEach((r) => {
      if (r.base_product_name?.trim()) set.add(r.base_product_name.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [recipes]);

  // Receitas que usam a base escolhida (ativas primeiro, depois por nome).
  const recipesForBase = useMemo(() => {
    if (!selectedBase) return [];
    return recipes
      .filter((r) => r.base_product_name?.trim() === selectedBase)
      .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'pt-BR'));
  }, [recipes, selectedBase]);

  // Cor consistente por receita (índice estável na lista filtrada).
  const colorByRecipe = useMemo(() => {
    const map = new Map<string, string>();
    recipesForBase.forEach((r, i) => map.set(r.id, segmentColor(i)));
    return map;
  }, [recipesForBase]);

  const demands: RollCutDemand[] = useMemo(
    () =>
      recipesForBase.map((r) => ({
        recipe_id: r.id,
        recipe_name: r.artisanal_product_name || r.name,
        cut_width_mm: r.cut_width_mm,
        m_needed: Number(meters[r.id]) || 0,
      })),
    [recipesForBase, meters],
  );

  const plan = useMemo(() => planRollCutting(demands), [demands]);

  // Em quais rolos cada receita aparece (pra coluna "rolo #" da tabela).
  const rollsByRecipe = useMemo(() => {
    const map = new Map<string, number[]>();
    plan.rolls.forEach((roll) => {
      roll.segments.forEach((seg) => {
        if (!seg.recipe_id) return;
        const arr = map.get(seg.recipe_id) || [];
        if (!arr.includes(roll.index)) arr.push(roll.index);
        map.set(seg.recipe_id, arr);
      });
    });
    return map;
  }, [plan]);

  const hasDemand = demands.some((d) => d.m_needed > 0);

  const clearAll = () => {
    setMeters({});
    setColor('');
  };

  return (
    <div className="space-y-4">
      {/* Explicação */}
      <Panel
        eyebrow="ENGENHARIA · CORTE"
        title="Otimizador de Corte do Rolo"
        subtitle={`Empacota várias tiras da mesma cor num rolo padrão (${ROLO_COMPRIMENTO_M}m × ${ROLO_LARGURA_MM}mm) — First-Fit-Decreasing.`}
        actions={
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={clearAll}>
            <ArrowCounterClockwise className="h-3.5 w-3.5" /> Limpar
          </Button>
        }
      >
        <div className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Dedique 1 rolo por <strong>cor/base</strong>. Informe os metros de cada tira que
            será cortada dessa cor; o otimizador calcula quantos rolos são necessários e como
            distribuir as bandas (largura × {METROS_UTEIS_POR_BANDA.toFixed(0)}m úteis cada).
          </span>
        </div>

        {/* Inputs: base + cor */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Base / matéria-prima *
            </Label>
            <Select value={selectedBase} onValueChange={(v) => { setSelectedBase(v); setMeters({}); }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Selecione a base do rolo..." />
              </SelectTrigger>
              <SelectContent>
                {bases.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Nenhuma base cadastrada nas receitas
                  </SelectItem>
                ) : (
                  bases.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">
              Cor do rolo (opcional)
            </Label>
            <Input
              placeholder="Ex: Caramelo"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="h-9"
            />
          </div>
        </div>
      </Panel>

      {/* Receitas da base + metros */}
      {selectedBase && (
        <Panel
          title="Tiras desta base"
          subtitle={
            recipesForBase.length > 0
              ? `${recipesForBase.length} receita(s) usam ${selectedBase}${color ? ` · ${color}` : ''}`
              : undefined
          }
          flush
        >
          {recipesForBase.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Scissors}
                title="Nenhuma receita usa esta base"
                description="Cadastre receitas com esta matéria-prima para empacotá-las no rolo."
                size="sm"
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recipesForBase.map((r) => {
                const noWidth = !r.cut_width_mm || r.cut_width_mm <= 0;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ background: colorByRecipe.get(r.id) }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground truncate">{r.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">{r.artisanal_product_name}</span>
                        {noWidth ? (
                          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-600 text-[10px]">
                            sem largura
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            {r.cut_width_mm} mm
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="relative w-28 shrink-0">
                      <Input
                        type="number"
                        min={0}
                        step="1"
                        inputMode="decimal"
                        placeholder="0"
                        value={meters[r.id] ?? ''}
                        onChange={(e) =>
                          setMeters((p) => ({ ...p, [r.id]: e.target.value }))
                        }
                        className="h-9 pr-7 text-right font-mono"
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        m
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      )}

      {/* Resultado */}
      {selectedBase && hasDemand && (
        <Panel flush>
          {/* Total de rolos — destaque vermelho consistente com o bloco do PV */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-t-lg bg-red-500/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-red-600 dark:text-red-400" weight="fill" />
              <span className="text-sm font-semibold text-red-600 dark:text-red-400">
                Total de rolos necessários
                {color && <span className="text-red-600/70 dark:text-red-400/70"> · {color}</span>}
              </span>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold leading-none text-red-600 dark:text-red-400">
                {plan.total_rolls}
              </span>
              <span className="text-sm text-red-600/70 dark:text-red-400/70">
                rolo{plan.total_rolls === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Avisos */}
          {plan.warnings.length > 0 && (
            <div className="space-y-1 border-b border-border bg-amber-500/5 px-4 py-2.5">
              {plan.warnings.map((w) => (
                <div key={w.recipe_id} className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                  <Warning className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    <strong>{w.recipe_name}:</strong> {w.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Visualização dos rolos */}
          <div className="space-y-4 p-4">
            {plan.rolls.map((roll) => (
              <div key={roll.index} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-foreground">Rolo {roll.index}</span>
                  <span className="font-mono text-muted-foreground">
                    {fmtMm(roll.used_mm)} usados · {fmtMm(roll.leftover_mm)} sobra ({roll.leftover_pct.toFixed(0)}%)
                  </span>
                </div>
                {/* Barra do rolo (largura total = 1370mm) */}
                <div className="flex h-8 w-full overflow-hidden rounded-md border border-border bg-card">
                  {roll.segments.map((seg, i) => {
                    const pct = (seg.width_mm / plan.roll_width_mm) * 100;
                    if (seg.recipe_id === null) {
                      // Sobra — hachura cinza.
                      return (
                        <div
                          key={`leftover-${i}`}
                          className="flex items-center justify-center"
                          style={{
                            width: `${pct}%`,
                            backgroundImage:
                              'repeating-linear-gradient(45deg, hsl(var(--muted)) 0, hsl(var(--muted)) 5px, hsl(var(--muted-foreground)/0.18) 5px, hsl(var(--muted-foreground)/0.18) 10px)',
                          }}
                          title={`Sobra: ${fmtMm(seg.width_mm)}`}
                        >
                          {pct > 14 && (
                            <span className="px-1 text-[10px] font-medium text-muted-foreground">
                              Sobra {fmtMm(seg.width_mm)}
                            </span>
                          )}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={seg.recipe_id}
                        className="flex items-center justify-center overflow-hidden border-r border-card/40 text-[10px] font-medium text-white"
                        style={{ width: `${pct}%`, minWidth: 2, background: colorByRecipe.get(seg.recipe_id) }}
                        title={`${seg.recipe_name}: ${seg.count}× ${seg.cut_width_mm}mm = ${fmtMm(seg.width_mm)}`}
                      >
                        {pct > 12 && <span className="truncate px-1">{fmtMm(seg.width_mm)}</span>}
                      </div>
                    );
                  })}
                </div>
                {/* Legenda do rolo */}
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {roll.segments
                    .filter((s) => s.recipe_id !== null)
                    .map((seg) => (
                      <span key={seg.recipe_id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <span
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ background: colorByRecipe.get(seg.recipe_id!) }}
                        />
                        {seg.recipe_name}
                        <span className="font-mono text-foreground">
                          {seg.count}×{seg.cut_width_mm}mm
                        </span>
                      </span>
                    ))}
                </div>
              </div>
            ))}
          </div>

          {/* Tabela detalhada */}
          <div className="border-t border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                  <TableHead>Receita</TableHead>
                  <TableHead className="text-right">m necessários</TableHead>
                  <TableHead className="text-right">bandas</TableHead>
                  <TableHead className="text-right">largura usada</TableHead>
                  <TableHead className="text-right">rolo #</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.breakdown
                  .filter((b) => b.n_bandas > 0)
                  .map((b) => {
                    const rollNums = rollsByRecipe.get(b.recipe_id) || [];
                    return (
                      <TableRow key={b.recipe_id}>
                        <TableCell className="text-sm">
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ background: colorByRecipe.get(b.recipe_id) }}
                            />
                            {b.recipe_name}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {b.m_needed.toLocaleString('pt-BR')} m
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{b.n_bandas}</TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {b.cut_width_mm > 0 ? fmtMm(b.total_width_mm) : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">
                          {rollNums.length > 0 ? rollNums.join(', ') : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>

          {/* Rodapé: sobras */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              Sobra total:{' '}
              <strong className="font-mono text-foreground">{fmtMm(plan.total_leftover_mm)}</strong>{' '}
              <span className="text-emerald-600 dark:text-emerald-400">
                ({fmtMm(plan.reusable_leftover_mm)} reaproveitáveis
              </span>
              {plan.last_roll_leftover_mm > 0 && (
                <span className="text-muted-foreground">
                  {' '}· {plan.last_roll_leftover_pct.toFixed(0)}% do último rolo
                </span>
              )}
              <span className="text-emerald-600 dark:text-emerald-400">)</span>
            </span>
            <span className="text-muted-foreground">
              Desperdício potencial:{' '}
              <strong
                className={`font-mono ${plan.waste_leftover_mm > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}
              >
                {fmtMm(plan.waste_leftover_mm)}
              </strong>
            </span>
          </div>
        </Panel>
      )}

      {/* Estado vazio: base escolhida mas sem metros */}
      {selectedBase && recipesForBase.length > 0 && !hasDemand && (
        <Panel>
          <EmptyState
            icon={Scissors}
            title="Informe os metros de cada tira"
            description="Preencha quantos metros de cada tira serão cortados desta cor para calcular o plano de corte."
            size="sm"
          />
        </Panel>
      )}
    </div>
  );
}
