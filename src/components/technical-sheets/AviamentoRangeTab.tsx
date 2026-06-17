import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Paperclip, FloppyDisk, DownloadSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseSizes } from '@/lib/labelUtils';
import {
  expandPmgByBoundaries,
  boundariesFromPmgBuckets,
  type PmgBoundary,
  type PmgBucket,
} from '@/lib/aviamentoSizeRanges';
import { useAviamentoPmgDefault, useSaveAviamentoPmgDefault } from '@/hooks/useAviamentoPmgDefault';

interface Props {
  /** Form da ficha técnica (lê/escreve aviamento_size_ranges). */
  form: any;
  /** Propaga a edição pro form (saveAll persiste). */
  updateField: (key: any, value: any) => void;
}

type Mode = 'inherit' | 'custom' | 'none';
const REST = '__rest__';

const modeFromValue = (v: PmgBucket[] | null | undefined): Mode =>
  v == null ? 'inherit' : (Array.isArray(v) && v.length === 0 ? 'none' : 'custom');

/**
 * Aba "Range Aviamento" da ficha técnica — define as faixas P/M/G PRÓPRIAS do
 * setor de Aviamento (segmento independente das facas de Corte Cabedal).
 *
 * O motor de Aviamento soma as numerações por faixa na ficha de operador: ex.
 * P={34,35,36} → coluna "P" com a soma dos pares. A numeração continua sendo
 * calculada por tamanho no PV; aqui é só a agregação de exibição.
 *
 * Modos:
 *  - Herdar padrão: usa o padrão global (faixas) — sem recadastrar.
 *  - Personalizar:  define a faixa de cada P/M/G SÓ nesta referência (override).
 *  - Sem faixa:     mostra numeração individual (opt-out).
 */
export function AviamentoRangeTab({ form, updateField }: Props) {
  const value: PmgBucket[] | null | undefined = Array.isArray(form?.aviamento_size_ranges)
    ? (form.aviamento_size_ranges as PmgBucket[])
    : (form?.aviamento_size_ranges ?? null);
  const allSizes = useMemo(() => parseSizes(form?.sizes), [form?.sizes]);
  const { data: defaultBoundaries } = useAviamentoPmgDefault();
  const saveDefault = useSaveAviamentoPmgDefault();

  const [mode, setMode] = useState<Mode>(() => modeFromValue(value));
  const [boundaries, setBoundaries] = useState<PmgBoundary[]>(() =>
    modeFromValue(value) === 'custom' ? boundariesFromPmgBuckets(value as PmgBucket[]) : [],
  );

  // Evita resync do nosso próprio "eco" (updateField → value volta) — só
  // resincroniza quando o valor muda DE FORA (ex.: ficha recarregada).
  const lastEmitted = useRef<string | null>(null);
  const emit = (v: PmgBucket[] | null) => {
    lastEmitted.current = JSON.stringify(v ?? null);
    updateField('aviamento_size_ranges', v);
  };
  useEffect(() => {
    if (JSON.stringify(value ?? null) === lastEmitted.current) return;
    const m = modeFromValue(value);
    setMode(m);
    if (m === 'custom') setBoundaries(boundariesFromPmgBuckets(value as PmgBucket[]));
  }, [value]);

  // Buckets resultantes da faixa atual (preview + valor emitido).
  const expanded = useMemo(() => expandPmgByBoundaries(allSizes, boundaries), [allSizes, boundaries]);

  const applyBoundaries = (next: PmgBoundary[]) => {
    setBoundaries(next);
    emit(expandPmgByBoundaries(allSizes, next));
  };

  const goInherit = () => { setMode('inherit'); emit(null); };
  const goNone = () => { setMode('none'); emit([]); };
  const goCustom = () => {
    setMode('custom');
    // Semeia: override atual → padrão global → 1 faixa cobrindo tudo.
    let seed: PmgBoundary[] = boundaries;
    if (seed.length === 0) {
      seed = (defaultBoundaries && defaultBoundaries.length > 0)
        ? defaultBoundaries.map(b => ({ ...b }))
        : [{ label: 'P', upTo: null }];
    }
    applyBoundaries(seed);
  };

  const addFaixa = () => {
    const used = new Set(boundaries.map(b => b.label.toUpperCase()));
    const nextLabel = ['P', 'M', 'G', 'PP', 'GG', 'GGG'].find(d => !used.has(d)) || `F${boundaries.length + 1}`;
    // Nova faixa entra como "resto".
    applyBoundaries([...boundaries, { label: nextLabel, upTo: null }]);
  };
  const removeFaixa = (idx: number) => applyBoundaries(boundaries.filter((_, i) => i !== idx));
  const setLabel = (idx: number, v: string) => {
    const next = [...boundaries];
    next[idx] = { ...next[idx], label: v.toUpperCase().trim().slice(0, 4) };
    applyBoundaries(next);
  };
  const setUpTo = (idx: number, v: string) => {
    const next = [...boundaries];
    next[idx] = { ...next[idx], upTo: v === REST ? null : v };
    applyBoundaries(next);
  };

  const applyGlobalDefault = () => {
    if (!defaultBoundaries || defaultBoundaries.length === 0) return;
    setMode('custom');
    applyBoundaries(defaultBoundaries.map(b => ({ ...b })));
  };
  const saveAsGlobalDefault = () => {
    const b = boundaries.length > 0 ? boundaries : boundariesFromPmgBuckets(expanded);
    if (b.length === 0) return;
    saveDefault.mutate(b);
  };

  // Validações visuais.
  const labelCounts = new Map<string, number>();
  for (const b of boundaries) labelCounts.set(b.label.toUpperCase(), (labelCounts.get(b.label.toUpperCase()) || 0) + 1);
  const hasDuplicates = Array.from(labelCounts.values()).some(c => c > 1);
  const mappedCount = expanded.reduce((s, b) => s + b.sizes.length, 0);
  const totalSizes = allSizes.length;

  const ModeBtn = ({ m, children }: { m: Mode; children: React.ReactNode }) => (
    <button
      type="button"
      onClick={() => (m === 'inherit' ? goInherit() : m === 'none' ? goNone() : goCustom())}
      className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${
        mode === m ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border hover:border-primary/40'
      }`}
    >
      {children}
    </button>
  );

  const defaultPreview = useMemo(
    () => (defaultBoundaries && defaultBoundaries.length > 0 ? expandPmgByBoundaries(allSizes, defaultBoundaries) : []),
    [allSizes, defaultBoundaries],
  );

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Paperclip className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Range Aviamento — Faixas P/M/G</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Agrupa numerações por faixa (P/M/G) na ficha de operador de <strong>Aviamento</strong> — ex.:{' '}
            <strong>P</strong> = 34/35/36 → soma as quantidades. Defina a <strong>faixa</strong> que cada P/M/G cobre.
            O <strong>padrão global</strong> é herdado por todas as referências; personalize só onde mudar. Segmento
            próprio, independente das facas de Corte Cabedal.
          </p>
        </div>
      </div>

      {totalSizes === 0 && (
        <div className="text-xs italic text-muted-foreground py-2">
          Cadastre o campo "Numerações" da ficha primeiro (ex: 33-41) na aba Identificação pra configurar as faixas.
        </div>
      )}

      {totalSizes > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Nesta referência:</span>
            <ModeBtn m="inherit">Herdar padrão</ModeBtn>
            <ModeBtn m="custom">Personalizar</ModeBtn>
            <ModeBtn m="none">Sem faixa</ModeBtn>
          </div>

          {mode === 'inherit' && (
            <div className="text-xs rounded px-3 py-2 bg-muted/30 border-l-2 border-primary/40">
              {defaultPreview.length > 0 ? (
                <>
                  <span className="text-muted-foreground">Usando o padrão global: </span>
                  {defaultPreview.map(b => (
                    <Badge key={b.label} variant="outline" className="mr-1 font-mono">
                      {b.label}: {b.sizes.join('·')}
                    </Badge>
                  ))}
                </>
              ) : (
                <span className="text-muted-foreground">
                  Nenhum padrão global definido ainda — esta ficha mostra numerações individuais no Aviamento.
                  Use "Personalizar" e clique <strong>Salvar como padrão</strong> pra criar o padrão.
                </span>
              )}
            </div>
          )}

          {mode === 'none' && (
            <div className="text-xs italic text-muted-foreground py-1 border-l-2 border-muted-foreground/30 pl-3">
              Sem faixa — a ficha de Aviamento mostra as numerações individuais (34, 35, 36...).
            </div>
          )}

          {mode === 'custom' && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addFaixa} className="gap-1 h-7 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Adicionar faixa
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={applyGlobalDefault}
                  disabled={!defaultBoundaries || defaultBoundaries.length === 0}
                  className="gap-1 h-7 text-xs" title="Carrega o padrão global como ponto de partida">
                  <DownloadSimple className="h-3.5 w-3.5" /> Aplicar padrão
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={saveAsGlobalDefault}
                  disabled={expanded.length === 0 || saveDefault.isPending}
                  className="gap-1 h-7 text-xs" title="Salva a faixa atual como padrão global (todas as fichas herdam)">
                  <FloppyDisk className="h-3.5 w-3.5" /> Salvar como padrão
                </Button>
              </div>

              <div className="space-y-2">
                {boundaries.map((b, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/20 p-2.5">
                    <Label className="text-xs shrink-0">Faixa</Label>
                    <Input value={b.label} onChange={e => setLabel(idx, e.target.value)}
                      className="h-8 text-sm font-mono font-bold uppercase w-20" maxLength={4} placeholder="P" />
                    <Label className="text-xs shrink-0">vai até</Label>
                    <Select value={b.upTo == null ? REST : b.upTo} onValueChange={v => setUpTo(idx, v)}>
                      <SelectTrigger className="h-8 w-32 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {allSizes.map(s => <SelectItem key={s} value={s} className="font-mono">{s}</SelectItem>)}
                        <SelectItem value={REST}>resto (até o fim)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="sm"
                      className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => removeFaixa(idx)} title="Remover faixa">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Preview do resultado */}
              {expanded.length > 0 && (
                <div className="text-xs rounded px-3 py-2 bg-primary/5 border border-primary/20">
                  <span className="text-muted-foreground mr-1">Resultado:</span>
                  {expanded.map(b => (
                    <Badge key={b.label} variant="outline" className="mr-1 font-mono">
                      {b.label}: {b.sizes.join('·')}
                    </Badge>
                  ))}
                </div>
              )}

              {hasDuplicates && (
                <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
                  ⚠ Há faixas com labels duplicados. Renomeie pra continuar.
                </div>
              )}
              {mappedCount < totalSizes && (
                <div className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-500/10 rounded px-3 py-2 flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">{mappedCount}/{totalSizes}</Badge>
                  {totalSizes - mappedCount} numeração(ões) fora das faixas — aparecerão individualmente.
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
