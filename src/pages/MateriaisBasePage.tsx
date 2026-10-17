import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, FloppyDisk as Save, Trash as Trash2 } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { formatCurrency } from '@/lib/utils';
import { SHOE_CATEGORIES } from '@/lib/shoeCategories';
import { useShoeCategories } from '@/hooks/useShoeCategories';
import { useProducts } from '@/hooks/useProducts';
import {
  useBaseMaterialKits,
  useBaseMaterialKitItems,
  useUpsertBaseMaterialKit,
  useSaveBaseMaterialKitItem,
  useDeleteBaseMaterialKitItem,
  type BaseMaterialKitItem,
} from '@/hooks/useBaseMaterialKits';

/**
 * Hub de materiais base / preço base por categoria (Engenharia).
 * Na criação de ficha rascunho, o kit da categoria é copiado para a Precificação.
 */
export default function MateriaisBasePage() {
  const { data: kits = [], isLoading } = useBaseMaterialKits();
  const { data: shoeCategories = [] } = useShoeCategories();
  const categories = shoeCategories.length > 0 ? shoeCategories : [...SHOE_CATEGORIES];
  const upsertKit = useUpsertBaseMaterialKit();
  const [selectedKitId, setSelectedKitId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const selectedKit = kits.find(k => k.id === selectedKitId) || kits[0] || null;
  const activeKitId = selectedKit?.id || null;
  const { data: items = [], isLoading: loadingItems } = useBaseMaterialKitItems(activeKitId);
  const saveItem = useSaveBaseMaterialKitItem();
  const deleteItem = useDeleteBaseMaterialKitItem();
  const { data: products = [] } = useProducts();

  const usedCategories = useMemo(() => new Set(kits.map(k => k.shoe_category)), [kits]);
  const availableCategories = categories.filter(c => !usedCategories.has(c));

  const totalAtivo = items
    .filter(i => i.is_active)
    .reduce((s, i) => s + (Number(i.cost_per_pair) || 0), 0);

  const handleCreateKit = async () => {
    if (!newCategory) return;
    const kit = await upsertKit.mutateAsync({
      shoe_category: newCategory,
      name: `Custo base — ${newCategory}`,
      notes: null,
      active: true,
    });
    setSelectedKitId(kit.id);
    setNewCategory('');
  };

  return (
    <div className="space-y-5 page-enter editorial-stagger">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA"
        title="Materiais base"
        description="Kits de materiais e preços base por categoria — aplicados ao criar a ficha rascunho"
        actions={
          <Button variant="outline" asChild className="gap-2">
            <Link to="/engenharia">
              <ArrowLeft className="h-4 w-4" />
              Engenharia
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categorias</p>
            {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
            {!isLoading && kits.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum kit ainda.</p>
            )}
            <div className="space-y-1">
              {kits.map(kit => (
                <button
                  key={kit.id}
                  type="button"
                  onClick={() => setSelectedKitId(kit.id)}
                  className={`w-full text-left rounded-md px-2.5 py-2 text-sm transition-colors ${
                    activeKitId === kit.id ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{kit.shoe_category}</span>
                    {!kit.active && <Badge variant="outline" className="text-[10px]">off</Badge>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-dashed border-border p-3 space-y-2">
            <Label className="text-xs">Novo kit</Label>
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Categoria…" />
              </SelectTrigger>
              <SelectContent>
                {availableCategories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="w-full gap-1.5"
              disabled={!newCategory || upsertKit.isPending}
              onClick={() => void handleCreateKit()}
            >
              <Plus className="h-3.5 w-3.5" /> Criar kit
            </Button>
          </div>
        </aside>

        <section className="space-y-4">
          {!selectedKit ? (
            <EmptyState
              title="Selecione ou crie um kit"
              description="Cada categoria (ex.: Rasteirinha) tem seus materiais e preços base."
            />
          ) : (
            <>
              <div className="rounded-lg border border-border bg-card p-4 flex flex-wrap items-end gap-3 justify-between">
                <div>
                  <h2 className="text-base font-semibold">{selectedKit.name}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Categoria <strong>{selectedKit.shoe_category}</strong>
                    {selectedKit.notes ? ` · ${selectedKit.notes}` : ''}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total ativo</div>
                  <div className="text-lg font-display font-bold tabular-nums">{formatCurrency(totalAtivo)}</div>
                </div>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground uppercase text-[10px] tracking-wider border-b">
                      <tr>
                        <th className="p-2 text-left font-medium w-10">#</th>
                        <th className="p-2 text-left font-medium">Descrição</th>
                        <th className="p-2 text-left font-medium">Tipo</th>
                        <th className="p-2 text-left font-medium">Estoque</th>
                        <th className="p-2 text-right font-medium">Custo R$/par</th>
                        <th className="p-2 text-center font-medium">Ativo</th>
                        <th className="p-2 w-20" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {loadingItems && (
                        <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Carregando…</td></tr>
                      )}
                      {!loadingItems && items.map((item, idx) => (
                        <KitItemRow
                          key={item.id}
                          item={item}
                          index={idx + 1}
                          products={products as Array<{ id: string; name: string; unit_price?: number | null }>}
                          onSave={(patch) => saveItem.mutateAsync({ ...item, ...patch, kit_id: item.kit_id, description: patch.description ?? item.description })}
                          onDelete={() => deleteItem.mutateAsync({ id: item.id, kitId: item.kit_id })}
                        />
                      ))}
                      {!loadingItems && items.length === 0 && (
                        <tr><td colSpan={7} className="p-8 text-center text-muted-foreground italic">Kit vazio — adicione itens.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="border-t bg-muted/20 p-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={!activeKitId || saveItem.isPending}
                    onClick={() => {
                      if (!activeKitId) return;
                      void saveItem.mutateAsync({
                        kit_id: activeKitId,
                        description: 'Novo material',
                        line_kind: 'material',
                        cost_mode: 'fixed_per_pair',
                        cost_per_pair: 0,
                        quantity_per_unit: 1,
                        unit: 'par',
                        is_active: true,
                        sort_order: items.length + 1,
                      });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar linha
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function KitItemRow({
  item,
  index,
  products,
  onSave,
  onDelete,
}: {
  item: BaseMaterialKitItem;
  index: number;
  products: Array<{ id: string; name: string; unit_price?: number | null }>;
  onSave: (patch: Partial<BaseMaterialKitItem> & { description?: string }) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [description, setDescription] = useState(item.description);
  const [cost, setCost] = useState(String(item.cost_per_pair ?? ''));
  const [kind, setKind] = useState(item.line_kind);
  const [productId, setProductId] = useState(item.product_id || '');
  const [active, setActive] = useState(item.is_active);
  const dirty =
    description !== item.description
    || Number(cost || 0) !== Number(item.cost_per_pair || 0)
    || kind !== item.line_kind
    || (productId || null) !== (item.product_id || null)
    || active !== item.is_active;

  return (
    <tr className={!active ? 'opacity-50 bg-muted/20' : undefined}>
      <td className="p-2 tabular-nums text-muted-foreground">{index}</td>
      <td className="p-2">
        <Input className="h-8" value={description} onChange={e => setDescription(e.target.value)} />
      </td>
      <td className="p-2">
        <Select value={kind} onValueChange={v => setKind(v as 'material' | 'ajuste')}>
          <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="material">Material</SelectItem>
            <SelectItem value="ajuste">Ajuste</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="p-2 min-w-[180px]">
        {kind === 'ajuste' ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Select value={productId || '__draft__'} onValueChange={v => setProductId(v === '__draft__' ? '' : v)}>
            <SelectTrigger className="h-8"><SelectValue placeholder="Rascunho…" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__draft__">Sem estoque (rascunho)</SelectItem>
              {products.slice(0, 400).map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="p-2">
        <Input
          className="h-8 text-right font-mono"
          value={cost}
          onChange={e => setCost(e.target.value)}
          inputMode="decimal"
        />
      </td>
      <td className="p-2 text-center">
        <Switch checked={active} onCheckedChange={setActive} aria-label="Ativo" />
      </td>
      <td className="p-2">
        <div className="flex gap-1 justify-end">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-8 w-8"
            disabled={!dirty}
            aria-label="Salvar linha"
            onClick={() => void onSave({
              description,
              line_kind: kind,
              product_id: kind === 'ajuste' ? null : (productId || null),
              cost_per_pair: Number(cost) || 0,
              estimated_unit_price: (!productId && kind === 'material') ? (Number(cost) || 0) : null,
              is_active: active,
              cost_mode: 'fixed_per_pair',
            })}
          >
            <Save className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remover" onClick={() => void onDelete()}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
