import { useEffect, useState } from 'react';
import { Plus, X, Knife } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { parseSizes } from '@/lib/labelUtils';

export interface KnifeBucket {
  label: string;
  sizes: string[];
}

interface Props {
  /** Range de numerações da ficha (ex: "33-41"). Usado pra mostrar as opções. */
  sheetSizes: string;
  /** Valor atual (NULL = sem cadastro). */
  value: KnifeBucket[] | null | undefined;
  onChange: (next: KnifeBucket[] | null) => void;
}

/**
 * Editor de facas de Corte Cabedal por referência.
 *
 * Cada faca tem um label (P/M/G/PP/GG/...) e cobre um conjunto de numerações.
 * Regras:
 *   - Cada size só pode estar em 1 faca (validado ao clicar).
 *   - Labels devem ser únicos.
 *   - Pode ter de 0 a N facas (configurável).
 *
 * Usado APENAS no setor Corte Cabedal: no print da ficha de operador, as
 * quantidades são somadas por faca (P=34+35+36) em vez de mostrar número-a-número.
 * Refs sem cadastro caem no comportamento atual (mostra sizes individuais).
 */
export function KnifeSizeRangesEditor({ sheetSizes, value, onChange }: Props) {
  const allSizes = parseSizes(sheetSizes);
  const [buckets, setBuckets] = useState<KnifeBucket[]>(value || []);

  useEffect(() => {
    setBuckets(value || []);
  }, [value]);

  const sizeToBucketIdx = new Map<string, number>();
  buckets.forEach((b, i) => {
    for (const s of b.sizes) sizeToBucketIdx.set(s, i);
  });

  const updateBuckets = (next: KnifeBucket[]) => {
    setBuckets(next);
    onChange(next.length === 0 ? null : next);
  };

  const addBucket = () => {
    const used = new Set(buckets.map(b => b.label.toUpperCase()));
    const defaults = ['P', 'M', 'G', 'PP', 'GG', 'GGG'];
    const nextLabel = defaults.find(d => !used.has(d)) || `F${buckets.length + 1}`;
    updateBuckets([...buckets, { label: nextLabel, sizes: [] }]);
  };

  const removeBucket = (idx: number) => {
    updateBuckets(buckets.filter((_, i) => i !== idx));
  };

  const updateLabel = (idx: number, newLabel: string) => {
    const sanitized = newLabel.toUpperCase().trim().slice(0, 4);
    const next = [...buckets];
    next[idx] = { ...next[idx], label: sanitized };
    updateBuckets(next);
  };

  const toggleSize = (bucketIdx: number, size: string) => {
    const next = [...buckets];
    // Remove de qualquer outro bucket antes (size só em 1 faca).
    for (let i = 0; i < next.length; i++) {
      if (i !== bucketIdx && next[i].sizes.includes(size)) {
        next[i] = { ...next[i], sizes: next[i].sizes.filter(s => s !== size) };
      }
    }
    // Toggle no bucket alvo.
    const bucket = next[bucketIdx];
    const has = bucket.sizes.includes(size);
    next[bucketIdx] = {
      ...bucket,
      sizes: has
        ? bucket.sizes.filter(s => s !== size)
        : [...bucket.sizes, size].sort((a, b) => parseInt(a) - parseInt(b)),
    };
    updateBuckets(next);
  };

  // Validação visual: labels duplicados
  const labelCounts = new Map<string, number>();
  for (const b of buckets) {
    const key = b.label.toUpperCase();
    labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
  }
  const hasDuplicates = Array.from(labelCounts.values()).some(c => c > 1);

  // Cobertura: quantos sizes da ficha estão mapeados
  const mappedCount = sizeToBucketIdx.size;
  const totalSizes = allSizes.length;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Knife className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold">Facas de Corte Cabedal</h4>
            <p className="text-xs text-muted-foreground mt-0.5">
              Define como as numerações são agrupadas por faca no relatório de Corte Cabedal.
              {' '}Ex: faca <strong>P</strong> = 34/35/36, faca <strong>M</strong> = 37/38, faca <strong>G</strong> = 39/40.
              {' '}Cada numeração só pode estar em 1 faca. Sem cadastro, a ficha mostra as numerações individuais.
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addBucket} className="gap-1 shrink-0">
          <Plus className="h-3.5 w-3.5" />
          Adicionar faca
        </Button>
      </div>

      {totalSizes === 0 && (
        <div className="text-xs italic text-muted-foreground py-2">
          Cadastre o campo "Numerações" da ficha primeiro (ex: 33-41) pra liberar a configuração das facas.
        </div>
      )}

      {totalSizes > 0 && buckets.length === 0 && (
        <div className="text-xs italic text-muted-foreground py-2 border-l-2 border-muted-foreground/30 pl-3">
          Sem facas cadastradas — a ficha de Corte Cabedal mostrará as numerações individuais (34, 35, 36...).
        </div>
      )}

      {buckets.length > 0 && (
        <>
          <div className="space-y-2">
            {buckets.map((bucket, idx) => (
              <div key={idx} className="rounded-md border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">Faca</Label>
                  <Input
                    value={bucket.label}
                    onChange={(e) => updateLabel(idx, e.target.value)}
                    className="h-8 text-sm font-mono font-bold uppercase w-24"
                    maxLength={4}
                    placeholder="P"
                  />
                  <span className="text-xs text-muted-foreground">
                    {bucket.sizes.length} numeraç{bucket.sizes.length === 1 ? 'ão' : 'ões'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => removeBucket(idx)}
                    title="Remover faca"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {allSizes.map((size) => {
                    const inThisBucket = bucket.sizes.includes(size);
                    const inOtherBucket = sizeToBucketIdx.has(size) && sizeToBucketIdx.get(size) !== idx;
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => toggleSize(idx, size)}
                        className={`text-xs px-2.5 py-1 rounded-md border font-mono font-bold transition-colors ${
                          inThisBucket
                            ? 'bg-amber-500 text-white border-amber-600'
                            : inOtherBucket
                            ? 'bg-muted/40 text-muted-foreground border-muted-foreground/20'
                            : 'bg-background text-foreground border-border hover:border-amber-500/40'
                        }`}
                        title={inOtherBucket ? `Já está na faca ${buckets[sizeToBucketIdx.get(size)!].label}` : ''}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {hasDuplicates && (
            <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
              ⚠ Há facas com labels duplicados. Renomeie pra continuar.
            </div>
          )}

          {mappedCount < totalSizes && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 flex items-center gap-2">
              <Badge variant="outline" className="font-mono">{mappedCount}/{totalSizes}</Badge>
              {totalSizes - mappedCount} numeraç{totalSizes - mappedCount === 1 ? 'ão' : 'ões'} sem faca atribuída — aparecerão individualmente no relatório.
            </div>
          )}
        </>
      )}
    </div>
  );
}
