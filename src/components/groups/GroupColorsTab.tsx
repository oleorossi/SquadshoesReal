import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SearchInput } from '@/components/ui/search-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, X, WarningCircle as AlertTriangle, ArrowsMerge, CircleNotch as Loader2, Palette, Package, CheckCircle } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UNITS, UNIT_LABELS, type Product } from '@/types/inventory';
import { useProducts } from '@/hooks/useProducts';
import { useColors } from '@/hooks/useColors';
import { findDuplicate, levenshtein, type DuplicateHit } from '@/lib/duplicateDetection';
import { DuplicateSuggestion } from '@/components/inventory/DuplicateSuggestion';
import { ColorsMultiSelect } from '@/components/references/ColorsMultiSelect';
import { createGroupColorProducts } from '@/lib/groupColorProducts';

interface Props {
  groupId: string;
  groupName: string;
  /** Produtos ATIVOS deste grupo (o pai já filtra por group_id). */
  products: Product[];
  /** Largura canônica do grupo (mm) — o item herda e só diverge de propósito. */
  groupWidth?: number | null;
}

const norm = (s: string) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

type StockFilter = 'all' | 'available' | 'zero' | 'review';

/** Distância de edição — mesma régua do detector de duplicata do item. */

/**
 * Aba "Cores" do grupo: o único lugar que enxerga as cores como CONJUNTO.
 *
 * Existe porque o bloco de cor tinha sido tirado do formulário de item
 * apontando pra um "GroupColorsManager" que nunca foi construído — não havia
 * onde ver as cores lado a lado, nem corrigir uma cor duplicada. Daí
 * CAPUCCINO × CAPPUCCINO convivendo no NAPA SOFT, com o débito escolhendo por
 * "maior estoque".
 */
export default function GroupColorsTab({ groupId, groupName, products, groupWidth }: Props) {
  const qc = useQueryClient();

  // Largura POR ITEM: a query do dialog pai busca por group_id e não distingue
  // item a item. Aqui é justamente a divergência entre eles que interessa.
  const { data: widthByProductId } = useQuery({
    queryKey: ['component_sheets_by_product', groupId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('component_sheets')
        .select('product_id, dimensions_width')
        .in('product_id', products.map(p => p.id));
      if (error) throw error;
      const m = new Map<string, number | null>();
      for (const r of (data || []) as any[]) m.set(r.product_id, r.dimensions_width);
      return m;
    },
    enabled: products.length > 0,
    staleTime: 60_000,
  });
  const [bulk, setBulk] = useState('');
  const [firstStockUnit, setFirstStockUnit] = useState('');
  /** Fila de cores a criar. Cada linha carrega o próprio veredito: linha
   *  suspeita não entra no insert até ser resolvida, e as demais seguem (R4.4). */
  const [pending, setPending] = useState<{ cor: string; hit: DuplicateHit | null; liberada: boolean }[]>([]);
  const { data: todosOsProdutos = [] } = useProducts();
  const { data: catalogColors = [] } = useColors();
  const [creating, setCreating] = useState(false);
  const [mergeSource, setMergeSource] = useState<string>('');
  const [mergeTarget, setMergeTarget] = useState<string>('');
  const [merging, setMerging] = useState(false);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const colorHexByName = useMemo(
    () => new Map(catalogColors.map((color) => [norm(color.nome), color.referencia_hex || ''])),
    [catalogColors],
  );

  const colored = useMemo(
    () => products.filter(p => (p.color || '').trim() !== '').sort((a, b) => (a.color || '').localeCompare(b.color || '')),
    [products],
  );
  const semCor = useMemo(() => products.filter(p => (p.color || '').trim() === ''), [products]);

  /** Cores exatamente iguais e cores quase iguais (typo) — as duas quebram o débito. */
  const problemas = useMemo(() => {
    const exatas = new Map<string, Product[]>();
    for (const p of colored) {
      const k = norm(p.color || '');
      exatas.set(k, [...(exatas.get(k) || []), p]);
    }
    const duplicadas = [...exatas.values()].filter(g => g.length > 1);

    const parecidas: Array<[Product, Product]> = [];
    for (let i = 0; i < colored.length; i++) {
      for (let j = i + 1; j < colored.length; j++) {
        const a = norm(colored[i].color || ''), b = norm(colored[j].color || '');
        if (a === b || a.length < 4 || b.length < 4) continue;
        if (Math.abs(a.length - b.length) > 2) continue;
        if (levenshtein(a, b) <= 2) parecidas.push([colored[i], colored[j]]);
      }
    }
    return { duplicadas, parecidas };
  }, [colored]);

  const larguraDivergente = useMemo(() => {
    if (!groupWidth || !widthByProductId) return [];
    return colored.filter(p => {
      const w = widthByProductId.get(p.id);
      return w != null && Number(w) > 0 && Number(w) !== Number(groupWidth);
    });
  }, [colored, groupWidth, widthByProductId]);

  const problemIds = useMemo(() => {
    const ids = new Set<string>();
    problemas.duplicadas.forEach((items) => items.forEach((item) => ids.add(item.id)));
    problemas.parecidas.forEach(([first, second]) => { ids.add(first.id); ids.add(second.id); });
    larguraDivergente.forEach((item) => ids.add(item.id));
    return ids;
  }, [larguraDivergente, problemas]);

  const stats = useMemo(() => ({
    total: colored.length,
    available: colored.filter((item) => Number(item.quantity || 0) - Number(item.reserved_stock || 0) > 0).length,
    zero: colored.filter((item) => Number(item.quantity || 0) - Number(item.reserved_stock || 0) <= 0).length,
    review: problemIds.size + semCor.length,
  }), [colored, problemIds, semCor.length]);

  const visibleColored = useMemo(() => colored.filter((item) => {
    const available = Number(item.quantity || 0) - Number(item.reserved_stock || 0);
    const matchesSearch = !search.trim() || [item.color, item.name, item.sku].some((value) => norm(value || '').includes(norm(search)));
    if (!matchesSearch) return false;
    if (stockFilter === 'available') return available > 0;
    if (stockFilter === 'zero') return available <= 0;
    if (stockFilter === 'review') return problemIds.has(item.id);
    return true;
  }), [colored, problemIds, search, stockFilter]);

  const addPending = () => {
    const novas = bulk.split(/[,;\n]/).map(c => c.trim().toUpperCase()).filter(Boolean);
    const jaExiste = new Set(colored.map(p => norm(p.color || '')));
    const jaNaFila = new Set(pending.map(x => norm(x.cor)));
    const aceitas = novas.filter(c => !jaExiste.has(norm(c)) && !jaNaFila.has(norm(c)));
    const recusadas = novas.length - aceitas.length;
    if (aceitas.length) {
      setPending(prev => [...prev, ...aceitas.map(cor => ({
        cor,
        hit: findDuplicate({ name: groupName, color: cor, group_id: groupId }, todosOsProdutos),
        liberada: false,
      }))]);
    }
    if (recusadas > 0) toast.info(`${recusadas} cor(es) já existem neste grupo — ignoradas`);
    setBulk('');
  };

  const criar = async () => {
    if (!pending.some(x => !x.hit || x.liberada)) { toast.info('Resolva as cores marcadas antes de criar'); return; }
    setCreating(true);
    try {
      const aCriar = pending.filter(x => !x.hit || x.liberada);
      const results = await createGroupColorProducts(aCriar.map(({ cor }) => ({
        groupId,
        groupName,
        color: cor,
        stockUnit: products.length === 0 ? firstStockUnit : undefined,
      })));
      const created = results.filter((result) => result.status === 'created');
      const failed = results.filter((result) => result.status === 'error');
      if (created.length > 0) toast.success(`${created.length} ${created.length === 1 ? 'variante criada' : 'variantes criadas'} em ${groupName}`);
      if (failed.length > 0) toast.error(`${failed.length} ${failed.length === 1 ? 'cor não foi criada' : 'cores não foram criadas'}`, { description: failed.map((result) => `${result.color}: ${result.error}`).join(' · ') });
      const failedNames = new Set(failed.map((result) => norm(result.color)));
      // Suspeitas não resolvidas e falhas permanecem na fila.
      setPending(prev => prev.filter((entry) => (entry.hit && !entry.liberada) || failedNames.has(norm(entry.cor))));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
      qc.invalidateQueries({ queryKey: ['product_groups_colors'] });
    } catch (e: any) {
      toast.error('Não foi possível criar as cores', { description: e?.message });
    } finally {
      setCreating(false);
    }
  };

  const fundir = async () => {
    if (!mergeSource || !mergeTarget || mergeSource === mergeTarget) return;
    setMerging(true);
    try {
      const { error } = await (supabase as any).rpc('merge_product_into', {
        p_source: mergeSource,
        p_target: mergeTarget,
      });
      if (error) throw error;
      toast.success('Cores fundidas', {
        description: 'O estoque e as referências de ficha foram para o item que ficou. O duplicado foi desativado.',
      });
      setMergeSource(''); setMergeTarget('');
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['products_for_colors'] });
      qc.invalidateQueries({ queryKey: ['product_groups_colors'] });
    } catch (e: any) {
      toast.error('Fusão não concluída', { description: e?.message });
    } finally {
      setMerging(false);
    }
  };

  const temProblema = problemas.duplicadas.length > 0 || problemas.parecidas.length > 0
    || semCor.length > 0 || larguraDivergente.length > 0;

  return (
    <div className="space-y-4">
      {/* ── Criar variantes pelo catálogo de cores ── */}
      <div className="space-y-3 border border-foreground/20 bg-muted/20 p-3">
        <div className="flex items-start gap-2">
          <Palette className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <Label className="text-xs font-semibold">Criar variantes de cor</Label>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">Escolha no catálogo para evitar grafias duplicadas. Cada cor comprável vira um SKU com saldo, custo e código de fornecedor próprios.</p>
          </div>
        </div>
        {products.length === 0 && (
          <div className="space-y-1.5 border border-foreground/20 bg-background p-2.5">
            <Label className="text-xs">Unidade de estoque da primeira cor</Label>
            <Select value={firstStockUnit} onValueChange={setFirstStockUnit}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione a unidade física" />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map(unit => (
                  <SelectItem key={unit} value={unit} className="text-xs">
                    {UNIT_LABELS[unit] || unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Para dublados em rolo, escolha metro linear (m). O consumo da ficha continua em dm²/par.
            </p>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <ColorsMultiSelect
            value={bulk}
            onChange={setBulk}
            excluded={colored.map((item) => item.color || '')}
            placeholder="Buscar no catálogo ou cadastrar cor…"
          />
          <Button type="button" size="sm" variant="outline" className="h-10 shrink-0 gap-1" disabled={!bulk.trim()} onClick={addPending}>
            <Plus className="h-3.5 w-3.5" /> Revisar seleção
          </Button>
        </div>
        {pending.length > 0 && (
          <>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {pending.map(({ cor, hit, liberada }) => (
                <Badge
                  key={cor}
                  variant="secondary"
                  className={`gap-1 text-[11px] ${hit && !liberada ? 'bg-warning/15 text-warning border-warning/30' : ''}`}
                >
                  {cor}
                  <button type="button" aria-label={`Remover ${cor}`} onClick={() => setPending(prev => prev.filter(x => x.cor !== cor))}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>

            {/* Uma sugestão por vez: a primeira linha suspeita ainda não resolvida. */}
            {(() => {
              const suspeita = pending.find(x => x.hit && !x.liberada);
              if (!suspeita?.hit) return null;
              return (
                <DuplicateSuggestion
                  hit={suspeita.hit}
                  onSameProduct={() => setPending(prev => prev.filter(x => x.cor !== suspeita.cor))}
                  onDifferent={() => setPending(prev => prev.map(x => x.cor === suspeita.cor ? { ...x, liberada: true } : x))}
                />
              );
            })()}

            <Button
              type="button"
              size="sm"
              className="h-8 gap-1"
              disabled={creating || (products.length === 0 && !firstStockUnit)}
              onClick={criar}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Criar {pending.filter(x => !x.hit || x.liberada).length} cor(es)
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {([
          { key: 'all' as const, label: 'Variantes', value: stats.total, icon: Palette },
          { key: 'available' as const, label: 'Com saldo livre', value: stats.available, icon: CheckCircle },
          { key: 'zero' as const, label: 'Sem saldo livre', value: stats.zero, icon: Package },
          { key: 'review' as const, label: 'Em revisão', value: stats.review, icon: AlertTriangle },
        ]).map((metric) => {
          const Icon = metric.icon;
          return (
            <button
              key={metric.key}
              type="button"
              onClick={() => setStockFilter(metric.key)}
              className={`border-l-2 px-3 py-2 text-left ${stockFilter === metric.key ? 'border-primary bg-primary/5' : 'border-foreground/20 bg-muted/20'}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{metric.label}</span>
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <span className="mt-1 block font-mono text-lg font-semibold tabular-nums">{metric.value}</span>
            </button>
          );
        })}
      </div>

      <SearchInput
        value={search}
        onChange={setSearch}
        placeholder="Buscar por cor, item ou SKU…"
        resultCount={visibleColored.length}
        totalCount={colored.length}
      />

      {/* ── Precisa de revisão ── */}
      {temProblema && (
        <div className="space-y-2 border border-warning/30 bg-warning/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-warning">
            <AlertTriangle className="h-3.5 w-3.5" weight="fill" /> Precisa de revisão
          </p>
          <ul className="space-y-1 text-[11px] text-foreground">
            {problemas.duplicadas.map((g, i) => (
              <li key={`d${i}`}>
                <strong>{g[0].color}</strong> aparece em {g.length} itens ({g.map(p => p.name).join(' · ')}) —
                o débito escolhe pelo maior estoque, então baixa de um e a compra repõe o outro.
              </li>
            ))}
            {problemas.parecidas.map(([a, b], i) => (
              <li key={`p${i}`}>
                <strong>{a.color}</strong> × <strong>{b.color}</strong> são quase iguais — provável erro de digitação.
              </li>
            ))}
            {semCor.length > 0 && (
              <li>{semCor.length} item(ns) sem cor num grupo que varia por cor: {semCor.map(p => p.name).join(', ')}.</li>
            )}
            {larguraDivergente.length > 0 && (
              <li>
                {larguraDivergente.length} item(ns) com largura diferente da do grupo ({groupWidth} mm):{' '}
                {larguraDivergente.map(p => `${p.color} (${widthByProductId?.get(p.id)} mm)`).join(', ')} —
                confira se o rolo é mesmo de outra largura.
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ── Fundir duplicata ── */}
      {colored.length > 1 && (
        <div className="rounded-md border border-border/60 p-3 space-y-2">
          <Label className="text-xs font-medium flex items-center gap-1.5">
            <ArrowsMerge className="h-3.5 w-3.5" /> Fundir cor duplicada
          </Label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Item que SAI (vira inativo)</p>
              <Select value={mergeSource} onValueChange={setMergeSource}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {colored.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.color} — {p.name} ({p.quantity} {p.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Item que FICA (recebe tudo)</p>
              <Select value={mergeTarget} onValueChange={setMergeTarget}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar…" /></SelectTrigger>
                <SelectContent>
                  {colored.filter(p => p.id !== mergeSource).map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.color} — {p.name} ({p.quantity} {p.unit})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            O estoque e as referências de ficha vão pro item que fica. Movimentos, notas e pedidos
            do item que sai <strong>não</strong> são reescritos — ele só é desativado.
          </p>
          <Button
            type="button" size="sm" variant="outline"
            className="h-8 gap-1"
            disabled={merging || !mergeSource || !mergeTarget || mergeSource === mergeTarget}
            onClick={fundir}
          >
            {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowsMerge className="h-3.5 w-3.5" />}
            Fundir
          </Button>
        </div>
      )}

      {/* ── Cores do grupo ── */}
      <div className="max-h-80 overflow-x-auto overflow-y-auto border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-xs">Cor</TableHead>
              <TableHead className="text-xs">SKU / fornecedor</TableHead>
              <TableHead className="text-right text-xs">Bruto</TableHead>
              <TableHead className="text-right text-xs">Reservado</TableHead>
              <TableHead className="text-right text-xs">Disponível</TableHead>
              <TableHead className="text-right text-xs">Mínimo / status</TableHead>
              <TableHead className="text-right text-xs">Custo</TableHead>
              <TableHead className="text-xs text-right">Largura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleColored.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-5 text-center text-xs text-muted-foreground">
                  {colored.length === 0 ? 'Nenhuma cor cadastrada neste grupo.' : 'Nenhuma variante corresponde à busca e ao filtro.'}
                </TableCell>
              </TableRow>
            ) : visibleColored.map(p => {
              const w = widthByProductId?.get(p.id);
              const diverge = groupWidth && w != null && Number(w) > 0 && Number(w) !== Number(groupWidth);
              const quantity = Number(p.quantity || 0);
              const reserved = Number(p.reserved_stock || 0);
              const available = quantity - reserved;
              const minimum = Number(p.min_stock || 0);
              const belowMinimum = minimum > 0 && available < minimum;
              const hex = colorHexByName.get(norm(p.color || ''));
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-xs font-medium">
                    <span className="flex items-center gap-2">
                      <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-foreground/20 bg-muted" style={hex ? { backgroundColor: hex } : undefined} />
                      {p.color}
                      {problemIds.has(p.id) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" weight="fill" />}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs">
                    <span className="block font-mono text-[10px] text-foreground">{p.sku}</span>
                    <span className="block text-[10px] text-muted-foreground">{p.supplier_color_code || p.name}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{quantity.toLocaleString('pt-BR')} {p.unit}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-primary">{reserved.toLocaleString('pt-BR')}</TableCell>
                  <TableCell className={`text-right font-mono text-xs font-semibold ${available < 0 ? 'text-destructive' : ''}`}>{available.toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-right text-xs">
                    <span className="mr-2 font-mono text-muted-foreground">{minimum.toLocaleString('pt-BR')}</span>
                    <Badge variant={!p.active ? 'outline' : belowMinimum ? 'warning-soft' : 'success-soft'} className="h-4 px-1 text-[8px]">
                      {!p.active ? 'inativa' : belowMinimum ? 'repor' : 'normal'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{Number(p.unit_price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 })}</TableCell>
                  <TableCell className={`text-xs text-right font-mono ${diverge ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {w != null && Number(w) > 0 ? `${w} mm` : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
