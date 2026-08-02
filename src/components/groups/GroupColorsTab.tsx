import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, X, WarningCircle as AlertTriangle, ArrowsMerge, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Product } from '@/types/inventory';
import { useProducts } from '@/hooks/useProducts';
import { findDuplicate, levenshtein, type DuplicateHit } from '@/lib/duplicateDetection';
import { DuplicateSuggestion } from '@/components/inventory/DuplicateSuggestion';

interface Props {
  groupId: string;
  groupName: string;
  /** Produtos ATIVOS deste grupo (o pai já filtra por group_id). */
  products: Product[];
  /** Largura canônica do grupo (mm) — o item herda e só diverge de propósito. */
  groupWidth?: number | null;
}

const norm = (s: string) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

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
  /** Fila de cores a criar. Cada linha carrega o próprio veredito: linha
   *  suspeita não entra no insert até ser resolvida, e as demais seguem (R4.4). */
  const [pending, setPending] = useState<{ cor: string; hit: DuplicateHit | null; liberada: boolean }[]>([]);
  const { data: todosOsProdutos = [] } = useProducts();
  const [creating, setCreating] = useState(false);
  const [mergeSource, setMergeSource] = useState<string>('');
  const [mergeTarget, setMergeTarget] = useState<string>('');
  const [merging, setMerging] = useState(false);

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
      const modelo = colored[0] || products[0];
      const aCriar = pending.filter(x => !x.hit || x.liberada);
      const rows = aCriar.map(({ cor }) => ({
        name: groupName,
        color: cor,
        sku: `${groupName.replace(/\s+/g, '').slice(0, 8).toUpperCase()}-${cor.replace(/\s+/g, '').slice(0, 6).toUpperCase()}`,
        group_id: groupId,
        // Herda do item existente o que é do MATERIAL, não da cor.
        unit: modelo?.unit || 'un',
        category: modelo?.category || null,
        unit_price: modelo?.unit_price ?? 0,
        location: modelo?.location || null,
        quantity: 0,
        min_stock: 0,
        active: true,
      }));
      const { error } = await (supabase as any).from('products').insert(rows);
      if (error) throw error;
      toast.success(`${rows.length} cor(es) criada(s) em ${groupName}`);
      // Suspeita não resolvida permanece na fila.
      setPending(prev => prev.filter(x => x.hit && !x.liberada));
      qc.invalidateQueries({ queryKey: ['products'] });
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
      {/* ── Criar várias cores de uma vez ── */}
      <div className="rounded-md border border-dashed border-border/70 bg-muted/20 p-3 space-y-2">
        <Label className="text-xs font-medium">Adicionar cores a este grupo</Label>
        <div className="flex gap-2">
          <Input
            value={bulk}
            onChange={e => setBulk(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPending(); } }}
            placeholder="PRETO, CARAMELO, OFF WHITE"
            className="h-8 text-xs uppercase"
          />
          <Button type="button" size="sm" variant="outline" className="h-8 gap-1 shrink-0" onClick={addPending}>
            <Plus className="h-3.5 w-3.5" /> Somar
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Separe por vírgula. O nome do item fica sendo o do grupo — a cor mora só no campo Cor.
        </p>
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

            <Button type="button" size="sm" className="h-8 gap-1" disabled={creating} onClick={criar}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Criar {pending.filter(x => !x.hit || x.liberada).length} cor(es)
            </Button>
          </>
        )}
      </div>

      {/* ── Precisa de revisão ── */}
      {temProblema && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" weight="fill" /> Precisa de revisão
          </p>
          <ul className="space-y-1 text-[11px] text-amber-700 dark:text-amber-400">
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
      <div className="rounded-md border overflow-x-auto max-h-72 overflow-y-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-xs">Cor</TableHead>
              <TableHead className="text-xs">Item</TableHead>
              <TableHead className="text-xs text-right">Estoque</TableHead>
              <TableHead className="text-xs text-right">Largura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {colored.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-xs text-muted-foreground text-center py-4">
                  Nenhuma cor cadastrada neste grupo.
                </TableCell>
              </TableRow>
            ) : colored.map(p => {
              const w = widthByProductId?.get(p.id);
              const diverge = groupWidth && w != null && Number(w) > 0 && Number(w) !== Number(groupWidth);
              return (
                <TableRow key={p.id}>
                  <TableCell className="text-xs font-medium">{p.color}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.name}</TableCell>
                  <TableCell className="text-xs text-right font-mono">{p.quantity} {p.unit}</TableCell>
                  <TableCell className={`text-xs text-right font-mono ${diverge ? 'text-red-600' : 'text-muted-foreground'}`}>
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
