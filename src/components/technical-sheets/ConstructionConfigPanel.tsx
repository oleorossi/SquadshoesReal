import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Badge } from '@/components/ui/badge';
import { Scissors, Sparkles, Info, Package, Layers, Printer } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

export type ConstructionType = 'corte_fio' | 'corte_costura' | 'tiras' | 'misto';
export type ColoredLiningMode = 'standard' | 'follows_variant' | 'manual_mapping';
export type InsoleColorMode = 'single' | 'follows_lining' | 'restricted_palette' | 'free';

// The 3 user-facing production models
type ProductionModel = 'cabedal' | 'cabedal_forrado' | 'tiras';

interface ConstructionConfigPanelProps {
  construction_type: ConstructionType;
  requires_cutting: boolean;
  requires_cutting_cabedal?: boolean;
  requires_sewing: boolean;
  has_straps: boolean;
  corte_a_faca?: boolean;
  has_colored_lining: boolean;
  colored_lining_mode: ColoredLiningMode;
  insole_color_mode: InsoleColorMode;
  max_insole_colors: number;
  insole_ready_made: boolean;
  mesa_daily_capacity: number;
  /** Current persisted production_sectors. Used to warn before overwriting custom routing. */
  current_production_sectors?: string[] | null;
  onChange: (field: string, value: any) => void;
  /** Called immediately when a model switch changes the production routing — triggers a direct DB save of sectors. */
  onProductionSectorsChange?: (sectors: string[]) => void;
}

// ─── Canonical sector lists (post-rename, migration 20260506120000) ───────────
// Silk sits between Mesa/Corte Forração and Colagem — added per toggle.
const SECTORS_CABEDAL              = ['Corte Palmilha', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'];
const SECTORS_CABEDAL_SILK         = ['Corte Palmilha', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'];
const SECTORS_CABEDAL_FORRADO      = ['Corte Palmilha', 'Corte Forração', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'];
const SECTORS_CABEDAL_FORRADO_SILK = ['Corte Palmilha', 'Corte Forração', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'];
const SECTORS_TIRAS                = ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'];
const SECTORS_TIRAS_SILK           = ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'];

function sectorsForModel(model: ProductionModel, hasSilk: boolean): string[] {
  if (model === 'cabedal')        return hasSilk ? SECTORS_CABEDAL_SILK         : SECTORS_CABEDAL;
  if (model === 'cabedal_forrado') return hasSilk ? SECTORS_CABEDAL_FORRADO_SILK : SECTORS_CABEDAL_FORRADO;
  return hasSilk ? SECTORS_TIRAS_SILK : SECTORS_TIRAS;
}

function arraysEqual(a: string[] | null | undefined, b: string[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Returns true if `current` matches any known canonical routing (any model, with or without Silk).
 * Custom routings return false → we ask before overwriting.
 * Legacy pre-rename lists are also accepted as non-customised.
 */
function isCanonicalRouting(current: string[] | null | undefined): boolean {
  if (!current || current.length === 0) return true;
  const canonicals: string[][] = [
    SECTORS_CABEDAL, SECTORS_CABEDAL_SILK,
    SECTORS_CABEDAL_FORRADO, SECTORS_CABEDAL_FORRADO_SILK,
    SECTORS_TIRAS, SECTORS_TIRAS_SILK,
    // Legacy lists (pre-2026-05-06 rename + pre-2026-05-20 Mesa→Aviamento)
    // — treated as non-customised
    ['Corte', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    ['Corte', 'Costura', 'Forração', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    ['Corte', 'Forração', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    ['Corte', 'Forração', 'Aviamento', 'Mesa', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    // Tiras lists pré-rename (Mesa em vez de Aviamento)
    ['Corte Palmilha', 'Corte Forração', 'Mesa', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    ['Corte Palmilha', 'Corte Forração', 'Mesa', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    ['Corte Palmilha', 'Corte Forração', 'Aviamento', 'Mesa', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
    ['Corte', 'Forração', 'Aviamento', 'Silk', 'Colagem', 'Montagem', 'Solagem', 'Acabamento'],
  ];
  return canonicals.some(d => arraysEqual(current, d));
}

function detectModel(construction_type: ConstructionType, insole_ready_made: boolean): ProductionModel {
  if (construction_type === 'tiras') return 'tiras';
  if (insole_ready_made) return 'cabedal';
  return 'cabedal_forrado';
}

/** Derive from production_sectors whether Silk is active. */
function detectHasSilk(sectors: string[] | null | undefined): boolean {
  return Array.isArray(sectors) && sectors.includes('Silk');
}

function applyModel(
  model: ProductionModel,
  hasSilk: boolean,
  _requires_sewing: boolean,
  onChange: (f: string, v: any) => void,
  onSectors?: (s: string[]) => void,
) {
  const sectors = sectorsForModel(model, hasSilk);
  if (model === 'cabedal') {
    onChange('insole_ready_made', true);
    onChange('construction_type', 'corte_fio');
    onChange('requires_cutting', true);
    onChange('requires_cutting_cabedal', true);
    onChange('requires_sewing', false);
    onChange('has_straps', false);
    onSectors?.(sectors);
  } else if (model === 'cabedal_forrado') {
    onChange('insole_ready_made', false);
    onChange('construction_type', _requires_sewing ? 'corte_costura' : 'corte_fio');
    onChange('requires_cutting', true);
    onChange('requires_cutting_cabedal', true);
    onChange('has_straps', false);
    onSectors?.(sectors);
  } else {
    onChange('insole_ready_made', false);
    onChange('construction_type', 'tiras');
    onChange('requires_cutting', true);
    onChange('requires_cutting_cabedal', false);
    onChange('requires_sewing', false);
    onChange('has_straps', true);
    onSectors?.(sectors);
  }
}

interface ModelCardProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  routing: string;
  children?: React.ReactNode;
}

function ModelCard({ active, onClick, icon, title, subtitle, routing, children }: ModelCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg border-2 p-4 cursor-pointer transition-all space-y-3',
        active
          ? 'border-primary bg-primary/5'
          : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30'
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className={cn('mt-0.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('text-sm font-semibold', active ? 'text-foreground' : 'text-muted-foreground')}>
              {title}
            </span>
            {active && <Badge className="text-[10px] h-4 px-1.5">Selecionado</Badge>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{subtitle}</p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            <span className="font-medium">Roteiro:</span> {routing}
          </p>
        </div>
      </div>
      {active && children && (
        <div className="pt-1 border-t border-border/50" onClick={e => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

function routingLabel(model: ProductionModel, hasSilk: boolean, requires_sewing: boolean): string {
  const silk = hasSilk ? ' → Silk' : '';
  if (model === 'cabedal') {
    return `Corte Palmilha${silk} → Colagem → Montagem → Solagem → Acabamento`;
  }
  if (model === 'cabedal_forrado') {
    const sewing = requires_sewing ? ' (costura inclusa)' : '';
    return `Corte Palmilha → Corte Forração${sewing}${silk} → Colagem → Montagem → Solagem → Acabamento`;
  }
  // tiras
  return `Corte Palmilha → Corte Forração → Mesa${silk} → Colagem → Montagem → Solagem → Acabamento`;
}

export function ConstructionConfigPanel({
  construction_type,
  requires_cutting: _rc,
  requires_cutting_cabedal: _rcc = true,
  requires_sewing,
  has_straps: _hs,
  corte_a_faca = false,
  has_colored_lining,
  colored_lining_mode,
  insole_color_mode,
  max_insole_colors,
  insole_ready_made,
  mesa_daily_capacity,
  current_production_sectors,
  onChange,
  onProductionSectorsChange,
}: ConstructionConfigPanelProps) {
  const activeModel = detectModel(construction_type, insole_ready_made);
  const hasSilk = detectHasSilk(current_production_sectors);

  const guardedSectorChange = (next: string[]) => {
    if (!onProductionSectorsChange) return;
    if (!isCanonicalRouting(current_production_sectors)) {
      const ok = window.confirm(
        `O roteiro de produção foi personalizado (${current_production_sectors?.length ?? 0} setores). ` +
        `Trocar de modelo irá substituí-lo por:\n\n${next.join(' → ')}\n\nDeseja continuar?`,
      );
      if (!ok) return;
    }
    onProductionSectorsChange(next);
  };

  const selectModel = (model: ProductionModel) => {
    if (model === activeModel) return;
    applyModel(model, hasSilk, requires_sewing, onChange, guardedSectorChange);
  };

  const toggleSilk = (enabled: boolean) => {
    const next = sectorsForModel(activeModel, enabled);
    guardedSectorChange(next);
  };

  const hasCabedal = activeModel !== 'tiras';

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Modelo de Construção</h3>
        <Badge variant="outline" className="text-xs ml-auto">
          Define roteiro e consumo
        </Badge>
      </div>

      <div className="space-y-2">
        {/* Model 1: Corte Cabedal — solado e palmilha externos */}
        <ModelCard
          active={activeModel === 'cabedal'}
          onClick={() => selectModel('cabedal')}
          icon={<Package className="h-4 w-4" />}
          title="Corte Cabedal"
          subtitle="Palmilha e solado já vêm prontos. Apenas o cabedal é cortado internamente. Ideal para sapatilhas, scarpin simples, chinela."
          routing={routingLabel('cabedal', hasSilk, requires_sewing)}
        >
          <Alert className="bg-blue-500/5 border-blue-500/20 py-2">
            <Info className="h-3 w-3 text-blue-500" />
            <AlertDescription className="text-[11px]">
              Solado e palmilha são debitados como <strong>1 un por par (por numeração)</strong>.
              No solado, configure as cores de palmilha disponíveis e o vínculo com o cabedal.
            </AlertDescription>
          </Alert>
        </ModelCard>

        {/* Model 2: Corte Cabedal + Palmilha Forrada — scarpin forrado, bota, anabela */}
        <ModelCard
          active={activeModel === 'cabedal_forrado'}
          onClick={() => selectModel('cabedal_forrado')}
          icon={<Scissors className="h-4 w-4" />}
          title="Corte Cabedal + Palmilha Forrada"
          subtitle="Palmilha com forração interna cortada na fábrica. Forração, palmilha e cabedal entram no relatório de corte. Scarpin forrado, bota, anabela."
          routing={routingLabel('cabedal_forrado', hasSilk, requires_sewing)}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="req-sewing"
                checked={requires_sewing}
                onCheckedChange={v => {
                  const sewing = !!v;
                  onChange('requires_sewing', sewing);
                  onChange('construction_type', sewing ? 'corte_costura' : 'corte_fio');
                  guardedSectorChange(sectorsForModel('cabedal_forrado', hasSilk));
                }}
              />
              <Label htmlFor="req-sewing" className="text-xs cursor-pointer">
                Requer costura do cabedal (cabedal costurado)
              </Label>
            </div>

            {/* Forração colorida */}
            <div className="rounded-lg border bg-background p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold">Forração da Palmilha</span>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="colored-lining"
                  checked={has_colored_lining}
                  onCheckedChange={v => {
                    const enabled = !!v;
                    onChange('has_colored_lining', enabled);
                    if (enabled) {
                      onChange('insole_color_mode', 'follows_lining');
                    } else {
                      onChange('insole_color_mode', 'single');
                      onChange('colored_lining_mode', 'standard');
                    }
                  }}
                />
                <Label htmlFor="colored-lining" className="text-xs cursor-pointer">
                  Palmilha tem forração colorida
                </Label>
              </div>
              {has_colored_lining && (
                <div className="pl-6 space-y-2">
                  <Label className="text-[10px] text-muted-foreground">Modo de cor da forração</Label>
                  <div className="space-y-1.5">
                    {(['standard', 'follows_variant', 'manual_mapping'] as ColoredLiningMode[]).map(m => (
                      <label key={m} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          className="accent-primary"
                          checked={colored_lining_mode === m}
                          onChange={() => {
                            onChange('colored_lining_mode', m);
                            if (m === 'standard') onChange('insole_color_mode', 'single');
                            else if (m === 'follows_variant') onChange('insole_color_mode', 'free');
                            else onChange('insole_color_mode', 'restricted_palette');
                          }}
                        />
                        <span className="text-[11px]">
                          {m === 'standard' ? 'Cor única fixa' : m === 'follows_variant' ? 'Segue a cor da variante' : 'Mapeamento manual (paleta restrita)'}
                        </span>
                      </label>
                    ))}
                  </div>
                  {colored_lining_mode === 'manual_mapping' && (
                    <div className="flex items-center gap-2 pt-1">
                      <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Máx. cores:</Label>
                      <NumberInput
                        value={max_insole_colors}
                        onChange={v => onChange('max_insole_colors', v || 3)}
                        min={1}
                        step="1"
                        className="h-7 w-16 text-xs"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </ModelCard>

        {/* Model 3: Tiras — sandália de tiras, rasteirinha, mule */}
        <ModelCard
          active={activeModel === 'tiras'}
          onClick={() => selectModel('tiras')}
          icon={<span className="text-sm">🪢</span>}
          title="Tiras / Sandália"
          subtitle="Sem corte de cabedal. Palmilha e forração cortadas internamente. Tiras/aviamentos montados no Aviamento. Sandália de tiras, rasteirinha, mule, tamanco."
          routing={routingLabel('tiras', hasSilk, requires_sewing)}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/20 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">Capacidade diária no Aviamento</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  Pares processados no Aviamento por dia (montagem de tiras/aviamentos).
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <NumberInput
                  value={mesa_daily_capacity}
                  onChange={v => onChange('mesa_daily_capacity', v)}
                  className="w-16 h-8 text-sm text-center font-mono"
                  placeholder="0"
                  step="1"
                  min={0}
                />
                <span className="text-[10px] text-muted-foreground">pares/dia</span>
              </div>
            </div>
          </div>
        </ModelCard>
      </div>

      {/* ─── Silk / Serigrafia toggle — cross-model optional step ──────────── */}
      <div
        className={cn(
          'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
          hasSilk
            ? 'border-violet-400/60 bg-violet-500/5'
            : 'border-border bg-card hover:bg-muted/30'
        )}
        onClick={() => toggleSilk(!hasSilk)}
      >
        <Printer className={cn('h-4 w-4 shrink-0', hasSilk ? 'text-violet-500' : 'text-muted-foreground')} />
        <div className="flex-1 space-y-0.5">
          <Label className={cn('text-xs font-semibold cursor-pointer', hasSilk ? 'text-violet-700 dark:text-violet-300' : '')}>
            Setor Silk / Serigrafia
          </Label>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Adiciona o setor Silk ao roteiro antes da Colagem — para impressão de logo, estampa ou acabamento serigráfico.
          </p>
        </div>
        <Checkbox
          checked={hasSilk}
          onCheckedChange={v => toggleSilk(!!v)}
          onClick={e => e.stopPropagation()}
        />
      </div>

      {/* ─── Corte a Faca — only when cabedal is cut ───────────────────────── */}
      {hasCabedal && (
        <div className="flex items-center gap-3 p-3 rounded-lg border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
          <Scissors className="h-4 w-4 text-amber-600 shrink-0" />
          <div className="flex-1 space-y-0.5">
            <Label htmlFor="corte-a-faca" className="text-xs font-semibold text-amber-800 dark:text-amber-300 cursor-pointer">
              Corte a Faca
            </Label>
            <p className="text-[10px] text-amber-700 dark:text-amber-400 leading-tight">
              O cabedal é cortado a faca — aparece na seção Cabedal do relatório de Corte, com grade por cor.
            </p>
          </div>
          <Checkbox
            id="corte-a-faca"
            checked={corte_a_faca}
            onCheckedChange={v => onChange('corte_a_faca', !!v)}
          />
        </div>
      )}
    </div>
  );
}
