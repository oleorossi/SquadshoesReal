import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Knife, FloppyDisk, DownloadSimple } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseSizes } from '@/lib/labelUtils';
import {
  expandFacasByBoundaries,
  boundariesFromBuckets,
  type FacaBoundary,
  type KnifeBucket,
} from '@/lib/knifeFacas';
import { useKnifeFacasDefault, useSaveKnifeFacasDefault } from '@/hooks/useKnifeFacasDefault';

// Mantém o import existente do OperationsTab (`type KnifeBucket`).
export type { KnifeBucket } from '@/lib/knifeFacas';

interface Props {
  /** Range de numerações da ficha (ex: "33-41"). Usado pras opções de faixa. */
  sheetSizes: string;
  /** Override por ficha: null/undefined = herda o padrão; [] = sem faca
   *  (numeração individual); array com itens = faca própria desta referência. */
  value: KnifeBucket[] | null | undefined;
  onChange: (next: KnifeBucket[] | null) => void;
}

type Mode = 'inherit' | 'custom' | 'none';
const REST = '__rest__';

const modeFromValue = (v: KnifeBucket[] | null | undefined): Mode =>
  v == null ? 'inherit' : (Array.isArray(v) && v.length === 0 ? 'none' : 'custom');

/**
 * Editor de Facas de Corte Cabedal (P/M/G) por referência, com PADRÃO GLOBAL
 * reutilizável e preenchimento rápido por FAIXA ("P vai até 36").
 *
 * Modos:
 *  - Herdar padrão: usa o padrão global (faixas) — sem recadastrar.
 *  - Personalizar:  define a faixa de cada faca SÓ nesta referência (override).
 *  - Sem faca:      mostra numeração individual (opt-out).
 *
 * O motor de Corte Cabedal soma as numerações por faca. (User 2026-06-16.)
 */
export function KnifeSizeRangesEditor({ sheetSizes, value, onChange }: Props) {
  const allSizes = useMemo(() => parseSizes(sheetSizes), [sheetSizes]);
  const { data: defaultBoundaries } = useKnifeFacasDefault();
  const saveDefault = useSaveKnifeFacasDefault();

  const [mode, setMode] = useState<Mode>(() => modeFromValue(value));
  const [boundaries, setBoundaries] = useState<FacaBoundary[]>(() =>
    modeFromValue(value) === 'custom' ? boundariesFromBuckets(value as KnifeBucket[]) : [],
  );

  // Evita resync do nosso próprio "eco" (onChange → value volta) — só resincroniza
  // quando o valor muda DE FORA (ex.: ficha recarregada).
  const lastEmitted = useRef<string | null>(null);
  const emit = (v: KnifeBucket[] | null) => {
    lastEmitted.current = JSON.stringify(v ?? null);
    onChange(v);
  };
  useEffect(() => {
    if (JSON.stringify(value ?? null) === lastEmitted.current) return;
    const m = modeFromValue(value);
    setMode(m);
    if (m === 'custom') setBoundaries(boundariesFromBuckets(value as KnifeBucket[]));
  }, [value]);

  // Buckets resultantes da faixa atual (preview + valor emitido).
  const expanded = useMemo(() => expandFacasByBoundaries(allSizes, boundaries), [allSizes, boundaries]);

  const applyBoundaries = (next: FacaBoundary[]) => {
    setBoundaries(next);
    emit(expandFacasByBoundaries(allSizes, next));
  };

  const goInherit = () => { setMode('inherit'); emit(null); };
  const goNone = () => { setMode('none'); emit([]); };
  const goCustom = () => {
    setMode('custom');
    // Semeia: override atual → padrão global → 1 faca cobrindo tudo.
    let seed: FacaBoundary[] = boundaries;
    if (seed.length === 0) {
      seed = (defaultBoundaries && defaultBoundaries.length > 0)
        ? defaultBoundaries.map(b => ({ ...b }))
        : [{ label: 'P', upTo: null }];
    }
    applyBoundaries(seed);
  };

  const addFaca = () => {
    const used = new Set(boundaries.map(b => b.label.toUpperCase()));
    const nextLabel = ['P', 'M', 'G', 'PP', 'GG', 'GGG'].find(d => !used.has(d)) || `F${boundaries.length + 1}`;
    // Nova faca entra como "resto"; a anterior que era resto recebe um corte.
    applyBoundaries([...boundaries, { label: nextLabel, upTo: null }]);
  };
  const removeFaca = (idx: number) => applyBoundaries(boundaries.filter((_, i) => i !== idx));
  const setLabel = (idx: number, v: string) => {
    const next = [...boundaries];
    next[idx] = { ...next[idx], label: v.toUpperCase().trim().slice(0, 4) };
    applyBoundaries(next);
  };
  const setCode = (idx: number, v: string) => {
    const c = v.toUpperCase().slice(0, 20).trim();
    const next = [...boundaries];
    next[idx] = { ...next[idx], code: c === '' ? undefined : c };
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
    // Usa as boundaries atuais (preferindo as do editor; senão deriva do expandido).
    const b = boundaries.length > 0 ? boundaries : boundariesFromBuckets(expanded);
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
        mode === m ? 'bg-amber-500 text-white border-amber-600' : 'bg-background text-foreground border-border hover:border-amber-500/40'
      }`}
    >
      {children}
    </button>
  );

  const defaultPreview = useMemo(
    () => (defaultBoundaries && defaultBoundaries.length > 0 ? expandFacasByBoundaries(allSizes, defaultBoundaries) : []),
    [allSizes, defaultBoundaries],
  );

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start gap-2">
        <Knife className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Facas de Corte Cabedal</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Agrupa numerações por faca (P/M/G) no relatório de Corte Cabedal — ex.: <strong>P</strong> = 34/35/36 →
            soma as quantidades. Defina a <strong>faixa</strong> que cada faca cobre. O <strong>padrão global</strong> é
            herdado por todas as referências; personalize só onde mudar.
          </p>
        </div>
      </div>

      {totalSizes === 0 && (
        <div className="text-xs italic text-muted-foreground py-2">
          Cadastre o campo "Numerações" da ficha primeiro (ex: 33-41) pra configurar as facas.
        </div>
      )}

      {totalSizes > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Nesta referência:</span>
            <ModeBtn m="inherit">Herdar padrão</ModeBtn>
            <ModeBtn m="custom">Personalizar</ModeBtn>
            <ModeBtn m="none">Sem faca</ModeBtn>
          </div>

          {mode === 'inherit' && (
            <div className="text-xs rounded px-3 py-2 bg-muted/30 border-l-2 border-amber-500/40">
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
                  Nenhum padrão global definido ainda — esta ficha mostra numerações individuais.
                  Use "Personalizar" e clique <strong>Salvar como padrão</strong> pra criar o padrão.
                </span>
              )}
            </div>
          )}

          {mode === 'none' && (
            <div className="text-xs italic text-muted-foreground py-1 border-l-2 border-muted-foreground/30 pl-3">
              Sem faca — a ficha de Corte Cabedal mostra as numerações individuais (34, 35, 36...).
            </div>
          )}

          {mode === 'custom' && (
            <>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={addFaca} className="gap-1 h-7 text-xs">
                  <Plus className="h-3.5 w-3.5" /> Adicionar faca
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
                    <Label className="text-xs shrink-0">Faca</Label>
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
                    <Label className="text-xs shrink-0">Código</Label>
                    <Input value={b.code || ''} onChange={e => setCode(idx, e.target.value)}
                      className="h-8 text-sm font-mono uppercase w-28" maxLength={20} placeholder="FC-0123"
                      title="Código físico da faca — sai no bloco 'Facas de Corte' da ficha" />
                    <Button type="button" variant="ghost" size="sm"
                      className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => removeFaca(idx)} title="Remover faca">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* Preview do resultado */}
              {expanded.length > 0 && (
                <div className="text-xs rounded px-3 py-2 bg-amber-500/5 border border-amber-500/20">
                  <span className="text-muted-foreground mr-1">Resultado:</span>
                  {expanded.map(b => (
                    <Badge key={b.label} variant="outline" className="mr-1 font-mono">
                      {b.label}{b.code ? ` (${b.code})` : ''}: {b.sizes.join('·')}
                    </Badge>
                  ))}
                </div>
              )}

              {hasDuplicates && (
                <div className="text-xs text-destructive bg-destructive/10 rounded px-3 py-2">
                  ⚠ Há facas com labels duplicados. Renomeie pra continuar.
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
