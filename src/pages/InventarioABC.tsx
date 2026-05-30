/**
 * Inventário Cíclico + Curva ABC — paridade Tutor32 (estoque #4).
 *
 * Aba "Curva ABC": classificação dos produtos por valor de estoque (A=80% / B=15% /
 * C=5% do valor acumulado). Aba "Contagens": abre sessões de contagem cíclica por
 * classe, registra o contado por item e reconcilia o saldo (adjust_stock).
 */
import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { ChartBar, Plus, ClipboardText, CheckCircle } from '@phosphor-icons/react';
import { formatCurrency } from '@/lib/utils';
import {
  useAbcClassification, useInventoryCounts, useCountItems, useOpenInventoryCount,
  useUpdateCountItem, useApplyInventoryCount, type Scope, type CountItem, type InventoryCount,
} from '@/hooks/useInventoryAbc';

const num = (n: number) => (n ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const fmtDate = (d?: string | null) => (d ? format(parseISO(d), 'dd/MM/yy HH:mm') : '—');

const ABC_BADGE: Record<string, string> = {
  A: 'bg-green-500/10 text-green-600 border-green-500/30',
  B: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  C: 'bg-muted text-muted-foreground border-border',
};

function AbcTab() {
  const { data: rows, isLoading } = useAbcClassification();
  const summary = useMemo(() => {
    const s: Record<string, { qtd: number; value: number }> = { A: { qtd: 0, value: 0 }, B: { qtd: 0, value: 0 }, C: { qtd: 0, value: 0 } };
    (rows ?? []).forEach((r) => { s[r.abc_class].qtd++; s[r.abc_class].value += r.stock_value; });
    return s;
  }, [rows]);

  if (isLoading) return <div className="p-4 space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(['A', 'B', 'C'] as const).map((c) => (
          <div key={c} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className={ABC_BADGE[c]}>Classe {c}</Badge>
              <span className="text-xs text-muted-foreground">{summary[c].qtd} itens</span>
            </div>
            <p className="mt-2 text-lg font-bold text-foreground tabular-nums">{formatCurrency(summary[c].value)}</p>
          </div>
        ))}
      </div>
      <Panel eyebrow="CLASSIFICAÇÃO" title="Produtos por valor de estoque" flush>
        {!rows?.length ? (
          <div className="p-6"><EmptyState icon={ChartBar} title="Sem dados" description="Nenhum produto com valor de estoque (qtd × preço)." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right">% acum.</TableHead>
                <TableHead>Classe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.product_id}>
                  <TableCell className="font-medium">{r.name}{r.sku && <span className="block text-[11px] text-muted-foreground font-mono">{r.sku}</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(r.quantity)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(r.unit_price)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(r.stock_value)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.cumulative_pct}%</TableCell>
                  <TableCell><Badge variant="outline" className={ABC_BADGE[r.abc_class]}>{r.abc_class}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

function CountItemRow({ item }: { item: CountItem }) {
  const [val, setVal] = useState(item.counted_qty == null ? '' : String(item.counted_qty));
  const upd = useUpdateCountItem();
  const div = item.counted_qty == null ? null : item.counted_qty - item.expected_qty;

  function save() {
    const v = val.trim() === '' ? null : parseFloat(val.replace(',', '.'));
    upd.mutate({ id: item.id, countId: item.count_id, counted_qty: v });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{item.products?.name ?? '—'}{item.abc_class && <Badge variant="outline" className={`ml-1.5 text-[10px] ${ABC_BADGE[item.abc_class] ?? ''}`}>{item.abc_class}</Badge>}</TableCell>
      <TableCell className="text-right tabular-nums">{num(item.expected_qty)}</TableCell>
      <TableCell>
        <Input value={val} onChange={(e) => setVal(e.target.value)} onBlur={save} inputMode="decimal" placeholder="—" className="h-8 w-24" />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {div == null ? '—' : <span className={div === 0 ? 'text-muted-foreground' : div > 0 ? 'text-green-600' : 'text-red-600'}>{div > 0 ? '+' : ''}{num(div)}</span>}
      </TableCell>
      <TableCell>{item.adjusted && <Badge variant="secondary" className="text-xs">ajustado</Badge>}</TableCell>
    </TableRow>
  );
}

function CountSession({ count }: { count: InventoryCount }) {
  const { data: items } = useCountItems(count.id);
  const apply = useApplyInventoryCount();
  const isOpen = count.status === 'aberta';

  return (
    <Panel
      eyebrow={`${count.scope === 'all' ? 'TODOS' : 'CLASSE ' + count.scope}`}
      title={count.count_number}
      subtitle={`${count.total_products} itens · ${fmtDate(count.created_at)}`}
      actions={
        isOpen ? (
          <Button size="sm" onClick={() => apply.mutate(count.id)} disabled={apply.isPending} className="gap-1.5">
            <CheckCircle className="size-4" /> {apply.isPending ? 'Aplicando…' : 'Aplicar contagem'}
          </Button>
        ) : (
          <Badge variant="secondary">{count.status} · {count.divergences_count} diverg. · {formatCurrency(count.total_divergence_value)}</Badge>
        )
      }
      flush
    >
      {!items?.length ? (
        <div className="p-4 text-sm text-muted-foreground">Sem itens.</div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead>Contado</TableHead>
              <TableHead className="text-right">Diverg.</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => <CountItemRow key={it.id} item={it} />)}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

function ContagensTab() {
  const { data: counts, isLoading } = useInventoryCounts();
  const open = useOpenInventoryCount();
  const [scope, setScope] = useState<Scope>('A');
  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(() => counts?.find((c) => c.id === activeId), [counts, activeId]);

  return (
    <div className="space-y-4">
      <Panel eyebrow="NOVA CONTAGEM" title="Abrir sessão cíclica">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1.5">
            <Label>Escopo</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="A">Classe A (alto valor)</SelectItem>
                <SelectItem value="B">Classe B</SelectItem>
                <SelectItem value="C">Classe C</SelectItem>
                <SelectItem value="all">Todos os produtos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => open.mutate(scope, { onSuccess: (id) => setActiveId(id) })} disabled={open.isPending} className="gap-1.5">
            <Plus className="size-4" /> {open.isPending ? 'Abrindo…' : 'Abrir contagem'}
          </Button>
        </div>
      </Panel>

      {active && <CountSession count={active} />}

      <Panel eyebrow="SESSÕES" title="Contagens recentes" flush>
        {isLoading ? (
          <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !counts?.length ? (
          <div className="p-6"><EmptyState icon={ClipboardText} title="Nenhuma contagem" description="Abra uma sessão de contagem cíclica por classe ABC." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contagem</TableHead>
                <TableHead>Escopo</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Divergências</TableHead>
                <TableHead className="text-right">Valor diverg.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counts.map((c) => (
                <TableRow key={c.id} className={activeId === c.id ? 'bg-muted/30' : ''}>
                  <TableCell className="font-mono text-xs">{c.count_number}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{c.scope === 'all' ? 'todos' : c.scope}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{c.total_products}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.divergences_count}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(c.total_divergence_value)}</TableCell>
                  <TableCell><Badge variant={c.status === 'aberta' ? 'default' : 'secondary'} className="text-xs">{c.status}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="ghost" className="h-7" onClick={() => setActiveId(c.id)}>Abrir</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  );
}

export default function InventarioABC() {
  return (
    <div className="space-y-6 pb-12">
      <EditorialPageHeader
        sectionNumber="02"
        sectionLabel="ESTOQUE · INVENTÁRIO"
        title="Inventário ABC"
        description="Classificação ABC por valor de estoque e contagem cíclica com reconciliação automática do saldo."
      />
      <Tabs defaultValue="abc">
        <TabsList>
          <TabsTrigger value="abc" className="gap-1.5"><ChartBar className="size-4" /> Curva ABC</TabsTrigger>
          <TabsTrigger value="contagens" className="gap-1.5"><ClipboardText className="size-4" /> Contagens</TabsTrigger>
        </TabsList>
        <TabsContent value="abc" className="mt-4"><AbcTab /></TabsContent>
        <TabsContent value="contagens" className="mt-4"><ContagensTab /></TabsContent>
      </Tabs>
    </div>
  );
}
