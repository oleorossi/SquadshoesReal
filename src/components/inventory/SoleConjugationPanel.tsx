import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { X, Plus, MagicWand as Wand2, Link as Link2 } from '@phosphor-icons/react';
import {
  useSoleConjugations,
  useUpsertSoleConjugation,
  useDeleteSoleConjugation,
} from '@/hooks/useSoleConjugations';

interface SoleConjugationPanelProps {
  soleGroupId: string | null;
  soleName?: string;
}

const AUTO_GENERATE_PRESETS = [
  {
    label: 'Infantil (23–32)',
    generate: () => [
      { size_key: '23/24', sizes: [23, 24] },
      { size_key: '25/26', sizes: [25, 26] },
      { size_key: '27/28', sizes: [27, 28] },
      { size_key: '29/30', sizes: [29, 30] },
      { size_key: '31/32', sizes: [31, 32] },
    ],
  },
  {
    label: 'Misto (33/34 e 39/40)',
    generate: () => [
      { size_key: '33/34', sizes: [33, 34] },
      { size_key: '39/40', sizes: [39, 40] },
    ],
  },
  {
    label: 'Adulto (33/34 conjugado)',
    generate: () => [
      { size_key: '33/34', sizes: [33, 34] },
      { size_key: '35', sizes: [35] },
      { size_key: '36', sizes: [36] },
      { size_key: '37', sizes: [37] },
      { size_key: '38', sizes: [38] },
      { size_key: '39', sizes: [39] },
      { size_key: '40', sizes: [40] },
    ],
  },
  {
    label: 'Adulto todo conjugado',
    generate: () => [
      { size_key: '33/34', sizes: [33, 34] },
      { size_key: '35/36', sizes: [35, 36] },
      { size_key: '37/38', sizes: [37, 38] },
      { size_key: '39/40', sizes: [39, 40] },
    ],
  },
];

export function SoleConjugationPanel({ soleGroupId, soleName }: SoleConjugationPanelProps) {
  const { data: conjugations = [], isLoading } = useSoleConjugations(soleGroupId);
  const upsert = useUpsertSoleConjugation();
  const remove = useDeleteSoleConjugation();

  const [newKey, setNewKey] = useState('');
  const [newSizes, setNewSizes] = useState('');
  const [generatingPreset, setGeneratingPreset] = useState(false);

  const handleAdd = async () => {
    if (!soleGroupId) return;
    const trimmedKey = newKey.trim();
    if (!trimmedKey) {
      toast.error('Informe o rótulo da conjugação (ex: "23/24")');
      return;
    }
    const parsedSizes = newSizes
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n) && n >= 10 && n <= 60);
    if (parsedSizes.length === 0) {
      toast.error('Informe ao menos uma numeração válida (10–60)');
      return;
    }

    // Reject overlap with existing conjugations: a single size must map to at
    // most one bucket per sole group, otherwise debit_sole_stock_by_grade can't
    // resolve which bucket to debit (audit B3/B4).
    const overlapping = parsedSizes.filter(s =>
      conjugations.some(c => c.sizes.includes(s)),
    );
    if (overlapping.length > 0) {
      const conflicts = overlapping.map(s => {
        const conj = conjugations.find(c => c.sizes.includes(s))!;
        return `${s} (já em "${conj.size_key}")`;
      }).join(', ');
      toast.error(`Numeração já está em outra conjugação: ${conflicts}`);
      return;
    }

    const nextOrder =
      conjugations.length > 0
        ? Math.max(...conjugations.map(c => c.display_order)) + 1
        : 0;

    await upsert.mutateAsync({
      sole_group_id: soleGroupId,
      size_key: trimmedKey,
      sizes: parsedSizes,
      display_order: nextOrder,
    });

    toast.success(`Conjugação "${trimmedKey}" adicionada`);
    setNewKey('');
    setNewSizes('');
  };

  const handleDelete = async (id: string) => {
    if (!soleGroupId) return;
    await remove.mutateAsync({ id, soleGroupId });
    toast.success('Conjugação removida');
  };

  const handleAutoGenerate = async (preset: typeof AUTO_GENERATE_PRESETS[number]) => {
    if (!soleGroupId) return;
    const rows = preset.generate();
    const newKeys = new Set(rows.map(r => r.size_key));
    // Conjugations from a previous preset that are NOT in the new preset would
    // remain in DB and corrupt debit_sole_stock_by_grade. Confirm + delete them.
    const stale = conjugations.filter(c => !newKeys.has(c.size_key));
    if (stale.length > 0) {
      const ok = window.confirm(
        `Aplicar padrão "${preset.label}" irá remover ${stale.length} conjugação(ões) existente(s) que não estão neste preset:\n` +
        stale.map(c => `• ${c.size_key}`).join('\n') +
        `\n\nDeseja continuar?`
      );
      if (!ok) return;
    }
    setGeneratingPreset(true);
    try {
      for (const c of stale) {
        await remove.mutateAsync({ id: c.id, soleGroupId });
      }
      for (let i = 0; i < rows.length; i++) {
        await upsert.mutateAsync({
          sole_group_id: soleGroupId,
          size_key: rows[i].size_key,
          sizes: rows[i].sizes,
          display_order: i,
        });
      }
      toast.success(`Padrão "${preset.label}" aplicado com ${rows.length} regras`);
    } finally {
      setGeneratingPreset(false);
    }
  };

  if (!soleGroupId) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            Selecione um solado para configurar conjugações de numeração.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="h-4 w-4 text-primary" />
          Conjugação de Numeração
          {soleName && (
            <span className="text-sm font-normal text-muted-foreground">— {soleName}</span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Configure quais tamanhos compartilham o mesmo pool de estoque. Ex: o solado "238"
          usa 33/34 e 39/40 conjugados — adicione só esses pares. Os tamanhos individuais
          (35, 36, 37, 38) são inferidos automaticamente pela faixa configurada no estoque.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Auto-generate presets */}
        <div className="space-y-2">
          <Label className="text-xs font-semibold flex items-center gap-1">
            <Wand2 className="h-3.5 w-3.5" /> Gerar automaticamente
          </Label>
          <div className="flex flex-wrap gap-2">
            {AUTO_GENERATE_PRESETS.map(preset => (
              <Button
                key={preset.label}
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={generatingPreset || upsert.isPending}
                onClick={() => handleAutoGenerate(preset)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Add rule form */}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-4">
          <Label className="text-xs font-semibold flex items-center gap-1">
            <Plus className="h-3.5 w-3.5" /> Adicionar regra
          </Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">Rótulo (ex: 23/24)</Label>
              <Input
                placeholder="23/24"
                value={newKey}
                onChange={e => setNewKey(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-muted-foreground">Tamanhos (separados por vírgula)</Label>
              <Input
                placeholder="23, 24"
                value={newSizes}
                onChange={e => setNewSizes(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                className="h-8 gap-1"
                disabled={upsert.isPending || generatingPreset}
                onClick={handleAdd}
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </Button>
            </div>
          </div>
        </div>

        {/* Current conjugation rules */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : conjugations.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Nenhuma conjugação configurada. Use os botões acima para adicionar regras.
          </div>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Regras configuradas</Label>
            <div className="rounded-md border border-border overflow-hidden">
              {conjugations.map((conj, idx) => (
                <div
                  key={conj.id}
                  className={`flex items-center justify-between px-3 py-2 gap-3 ${idx < conjugations.length - 1 ? 'border-b border-border/50' : ''} hover:bg-muted/40`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {conj.size_key}
                    </Badge>
                    <div className="flex flex-wrap gap-1">
                      {conj.sizes.map(s => (
                        <span
                          key={s}
                          className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => handleDelete(conj.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Summary card */}
            <div className="rounded-md bg-muted/30 border border-border/60 p-3">
              <p className="text-xs font-semibold text-muted-foreground mb-2">Resumo da conjugação</p>
              <div className="flex flex-wrap gap-2">
                {conjugations.map(conj => (
                  <div key={conj.id} className="text-xs bg-card border border-border rounded px-2 py-1">
                    <span className="font-mono font-semibold">{conj.size_key}</span>
                    <span className="text-muted-foreground"> → [{conj.sizes.join(', ')}]</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
