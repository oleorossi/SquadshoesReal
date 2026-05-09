import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle } from 'lucide-react';
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

      {/* Grade input */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
        {sizes.map((size) => (
          <div key={size} className="space-y-1 text-center">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">{size}</label>
            <Input
              type="number"
              min={0}
              className="text-center font-mono"
              value={grid[size] || ''}
              onChange={(e) =>
                setGrid((prev) => ({ ...prev, [size]: parseInt(e.target.value) || 0 }))
              }
            />
          </div>
        ))}
      </div>

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
