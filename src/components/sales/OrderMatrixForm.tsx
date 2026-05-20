import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle, Warning as AlertTriangle, Link as Link2, Info, Baby, User } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import {
  getAvailableToPromise,
  calculateGradedConsumption,
  DEFAULT_SIZE_MULTIPLIERS,
} from '@/lib/inventoryIntelligence';

interface MaterialSpec {
  id: string;
  baseConsumption: number;
  wastePct?: number;
  material: {
    id: string;
    name: string;
    color?: string;
    production_unit: string;
    quantity: number;
    reserved_stock: number;
    safety_stock: number;
  };
}

interface Props {
  variantName: string;
  colorName: string;
  imageUrl?: string;
  specifications: MaterialSpec[];
  sizes?: string[];
  sizeMultipliers?: Record<string, number>;
  onConfirm?: (grid: Record<string, number>, totalPairs: number) => void;
  disabled?: boolean;
}

// Detecta se um tamanho é conjugado (ex.: "33/34") — convenção do projeto
// é separar com '/'. Conjugado significa que 1 par desse tamanho corresponde
// a 1 par único do estoque (não 0.5).
function isConjugated(size: string): boolean {
  return /^\d{1,2}\/\d{1,2}$/.test(size);
}

// Faixa: até 32 = infantil, ≥33 = adulto. Conjugados encaixam pelo menor.
function sizeBand(size: string): 'infantil' | 'adulto' {
  const first = parseInt(size.split('/')[0], 10);
  return first < 33 ? 'infantil' : 'adulto';
}

export function OrderMatrixForm({
  variantName,
  colorName,
  imageUrl,
  specifications,
  sizes = ['33', '34', '35', '36', '37', '38', '39', '40'],
  sizeMultipliers,
  onConfirm,
  disabled,
}: Props) {
  const [grid, setGrid] = useState<Record<string, number>>({});
  const totalPairs = Object.values(grid).reduce((a, b) => a + b, 0);

  const status = useMemo(() => {
    return specifications.map((spec) => {
      const { totalNeeded } = calculateGradedConsumption(
        spec.baseConsumption,
        grid,
        sizeMultipliers ?? DEFAULT_SIZE_MULTIPLIERS,
        spec.wastePct ?? 1.0
      );
      const atp = getAvailableToPromise({
        physical: spec.material.quantity,
        reserved: spec.material.reserved_stock,
        safety: spec.material.safety_stock,
      });
      return {
        id: spec.id,
        name: spec.material.name,
        color: spec.material.color,
        unit: spec.material.production_unit,
        needed: totalNeeded,
        atp,
        isOk: atp >= totalNeeded,
      };
    });
  }, [specifications, grid, sizeMultipliers]);

  const allOk = status.every((s) => s.isOk);

  // Agrupa tamanhos por faixa (Infantil/Adulto)
  const bands = useMemo(() => {
    const inf: string[] = [];
    const ad: string[] = [];
    for (const s of sizes) (sizeBand(s) === 'infantil' ? inf : ad).push(s);
    return { inf, ad };
  }, [sizes]);

  const hasInfantil = bands.inf.length > 0;
  const hasAdulto = bands.ad.length > 0;
  const hasConjugated = sizes.some(isConjugated);

  // Default tab: a faixa que tem mais tamanhos
  const defaultTab = hasAdulto && bands.ad.length >= bands.inf.length ? 'adulto' : 'infantil';

  const renderSizeGrid = (sizesInBand: string[]) => (
    <ScrollArea className="w-full">
      <div className="flex gap-2 pb-3 min-w-max">
        {sizesInBand.map((size) => {
          const conjugated = isConjugated(size);
          return (
            <div key={size} className="flex flex-col items-center gap-1 min-w-[60px]">
              <div className="flex items-center gap-1 h-4">
                <label className={cn(
                  'text-xs font-bold uppercase',
                  conjugated ? 'text-blue-700 dark:text-blue-400' : 'text-muted-foreground',
                )}>
                  {size}
                </label>
                {conjugated && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Link2 className="h-2.5 w-2.5 text-blue-600 dark:text-blue-400" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] text-xs">
                      <strong>Conjugado:</strong> 1 par {size} consome <strong>1 par</strong> do
                      estoque conjugado, não 0,5+0,5.
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                className={cn(
                  'text-center font-mono w-14 h-9',
                  conjugated && 'border-blue-500/40 focus-visible:ring-blue-500',
                )}
                value={grid[size] || ''}
                onChange={(e) =>
                  setGrid((prev) => ({ ...prev, [size]: parseInt(e.target.value) || 0 }))
                }
              />
            </div>
          );
        })}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );

  return (
    <div className="space-y-6 p-6 bg-card rounded-2xl shadow-sm border">
      <div className="flex items-center gap-4">
        {imageUrl ? (
          <img src={imageUrl} className="w-24 h-24 rounded-xl object-cover border" alt="Produto" />
        ) : (
          <div className="w-24 h-24 rounded-xl border bg-muted flex items-center justify-center text-muted-foreground text-xs">
            Sem foto
          </div>
        )}
        <div>
          <h2 className="display text-xl text-foreground">{variantName}</h2>
          <p className="text-sm text-muted-foreground uppercase tracking-wider">{colorName}</p>
        </div>
      </div>

      {/* Conjugadas — banner explicativo (só aparece se houver) */}
      {hasConjugated && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-snug">
            <p className="font-medium text-foreground">Tamanhos conjugados ({bands.inf.concat(bands.ad).filter(isConjugated).join(', ')})</p>
            <p className="text-muted-foreground mt-0.5">
              1 par de tamanho conjugado (ex.: <strong>33/34</strong>) corresponde a <strong>1 par</strong> do estoque,
              não 0,5 + 0,5. O cliente recebe os 2 tamanhos no mesmo par.
            </p>
          </div>
        </div>
      )}

      {/* Grade input — tabs Infantil/Adulto se ambos existirem, senão só uma */}
      {hasInfantil && hasAdulto ? (
        <Tabs defaultValue={defaultTab} className="space-y-3">
          <TabsList>
            <TabsTrigger value="infantil" className="gap-1.5">
              <Baby className="h-3.5 w-3.5" />
              Infantil ({bands.inf.length})
            </TabsTrigger>
            <TabsTrigger value="adulto" className="gap-1.5">
              <User className="h-3.5 w-3.5" />
              Adulto ({bands.ad.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="infantil">{renderSizeGrid(bands.inf)}</TabsContent>
          <TabsContent value="adulto">{renderSizeGrid(bands.ad)}</TabsContent>
        </Tabs>
      ) : (
        renderSizeGrid(hasInfantil ? bands.inf : bands.ad)
      )}

      {totalPairs > 0 && (
        <Badge variant="secondary" className="text-xs">
          Total: {totalPairs} pares
        </Badge>
      )}

      {/* Material viability */}
      {totalPairs > 0 && (
        <div className="bg-muted/50 rounded-xl p-4 space-y-3">
          <h3 className="text-xs font-bold text-muted-foreground uppercase">Validação de Insumos</h3>
          {status.map((s) => (
            <div key={s.id} className="flex justify-between items-center text-sm">
              <span className="text-foreground">
                {s.name} {s.color && <span className="text-muted-foreground">({s.color})</span>}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted-foreground">
                  {s.needed.toFixed(1)} / {s.atp.toFixed(1)} {s.unit}
                </span>
                {s.isOk ? (
                  <CheckCircle className="h-3.5 w-3.5 text-primary" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive animate-pulse" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Button
        disabled={disabled || !allOk || totalPairs === 0}
        className="w-full"
        onClick={() => onConfirm?.(grid, totalPairs)}
      >
        {totalPairs === 0
          ? 'Informe a Grade'
          : allOk
          ? `Confirmar Pedido e Reservar Materiais (${totalPairs} pares)`
          : 'Materiais Insuficientes'}
      </Button>
    </div>
  );
}
