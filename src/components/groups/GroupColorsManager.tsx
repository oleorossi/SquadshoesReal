/**
 * GroupColorsManager — UI revista em 2026-05 pra resolver confusão
 * apontada pelo usuário ("forma de colocar variações de cores está muito
 * confuso").
 *
 * Antes: 2 listas separadas (cores vinculadas via junction vs cores
 * detectadas dos produtos). Usuário não entendia a diferença e achava
 * que vincular cor = criar produto naquela cor (não é — vincular só
 * registra "esta família aceita essa cor").
 *
 * Agora: 1 lista unificada com STATUS visual por cor:
 *   - "✓ Pronta" — cor vinculada E tem produto cadastrado na cor
 *   - "○ Sem produto" — vinculada mas sem produto → botão criar inline
 *   - "↓ Detectada" — produto existe mas cor não está vinculada → ação vincular
 * Botão único "Vincular cor" abre catálogo. Botão "Criar produto" no chip cria
 * 1 produto naquela cor automaticamente.
 */
import { useState, useMemo } from 'react';
import { Palette, Plus, X, Check, MagnifyingGlass as Search, Sparkle as Sparkles, WarningCircle as AlertCircle, Package as PackagePlus } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { deriveCategoryFromGroup } from '@/lib/categoryFromGroup';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useColors } from '@/hooks/useColors';
import { useGroupColors, useAddGroupColor, useRemoveGroupColor } from '@/hooks/useGroupColors';
import GroupColorSourcesPanel from './GroupColorSourcesPanel';
import { useProducts } from '@/hooks/useProducts';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

interface GroupColorsManagerProps {
  groupId: string;
  groupName: string;
}

interface UnifiedColorRow {
  /** Nome canônico (display) */
  name: string;
  /** id da junction group_colors, se existir */
  junctionId: string | null;
  /** id da color (catalog), se vinculada via junction */
  colorId: string | null;
  /** hex pra swatch */
  hex: string | null;
  /** produto correspondente neste grupo + cor (se existir) */
  product: { id: string; sku: string; quantity: number } | null;
  /** status visual */
  status: 'ready' | 'no-product' | 'detected-only';
}

function slugSku(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
}

export default function GroupColorsManager({ groupId, groupName }: GroupColorsManagerProps) {
  const qc = useQueryClient();
  const { data: allColors = [] } = useColors();
  const { data: groupColors = [] } = useGroupColors(groupId);
  const { data: allProducts = [] } = useProducts();
  const addColor = useAddGroupColor();
  const removeColor = useRemoveGroupColor();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  // Produtos deste grupo (estoque atual + cores ocupadas)
  const groupProducts = useMemo(
    () => allProducts.filter(p => p.group_id === groupId && p.active !== false),
    [allProducts, groupId],
  );

  // Lookup case-insensitive: nome cor (UPPER) → product do grupo nessa cor
  const productByColor = useMemo(() => {
    const m = new Map<string, { id: string; sku: string; quantity: number }>();
    for (const p of groupProducts) {
      const key = (p.color || '').trim().toUpperCase();
      if (key && !m.has(key)) {
        m.set(key, { id: p.id, sku: p.sku || '', quantity: Number(p.quantity) || 0 });
      }
    }
    return m;
  }, [groupProducts]);

  // Lista unificada: junta junction + produtos detectados, dedupando por nome
  const unified = useMemo<UnifiedColorRow[]>(() => {
    const map = new Map<string, UnifiedColorRow>();

    // 1) Adiciona cores vinculadas via junction
    for (const gc of groupColors) {
      const name = (gc.color_name || '').trim();
      if (!name) continue;
      const key = name.toUpperCase();
      const product = productByColor.get(key) || null;
      map.set(key, {
        name,
        junctionId: gc.id,
        colorId: gc.color_id,
        hex: gc.color_hex || null,
        product,
        status: product ? 'ready' : 'no-product',
      });
    }

    // 2) Adiciona cores que apareceram só via produtos (sem vinculo no catálogo)
    for (const [key, product] of productByColor.entries()) {
      if (!map.has(key)) {
        const catalogMatch = allColors.find(c => (c.nome || '').toUpperCase() === key);
        map.set(key, {
          name: catalogMatch?.nome || key.charAt(0) + key.slice(1).toLowerCase(),
          junctionId: null,
          colorId: catalogMatch?.id || null,
          hex: catalogMatch?.referencia_hex || null,
          product,
          status: 'detected-only',
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [groupColors, productByColor, allColors]);

  // Catálogo filtrado pra popover (exclui o que já está vinculado)
  const linkedColorIds = useMemo(() => new Set(groupColors.map(gc => gc.color_id)), [groupColors]);
  const filteredCatalog = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allColors
      .filter(c => !q || c.nome.toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [allColors, search]);

  const handleVincular = (colorId: string) => {
    if (linkedColorIds.has(colorId)) {
      const gc = groupColors.find(g => g.color_id === colorId);
      if (gc) removeColor.mutate({ id: gc.id, groupId });
    } else {
      addColor.mutate({ groupId, colorId });
    }
  };

  const handleRemove = (row: UnifiedColorRow) => {
    if (row.junctionId) {
      if (row.product) {
        if (!window.confirm(`A cor "${row.name}" tem produto cadastrado (estoque ${row.product.quantity}). Remover apenas o vínculo no catálogo? (O produto continua existindo)`)) return;
      }
      removeColor.mutate({ id: row.junctionId, groupId });
    } else {
      toast.info('Esta cor foi detectada do produto. Para removê-la, exclua o produto correspondente.');
    }
  };

  const handleCreateProduct = async (row: UnifiedColorRow) => {
    setCreatingFor(row.name);
    try {
      const sku = `${slugSku(groupName)}-${slugSku(row.name)}`;
      // products.category é NOT NULL no DB. Antes faltava esse campo aqui
      // e a inserção falhava com '23502 null value in column "category"'.
      // Derivamos category do nome do grupo (Solado/Cabedal/Palmilha/etc).
      const category = deriveCategoryFromGroup(groupName);
      const { error } = await (supabase as any).from('products').insert({
        name: `${groupName} - ${row.name}`,
        sku,
        color: row.name,
        group_id: groupId,
        category,
        quantity: 0,
        active: true,
        unit: 'un',
        unit_price: 0,
      });
      if (error) {
        if (error.code === '23505') {
          throw new Error(`SKU "${sku}" já existe. Renomeie manualmente em /estoque.`);
        }
        throw error;
      }
      toast.success(`Produto "${groupName} - ${row.name}" criado.`);
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (err: any) {
      toast.error(err.message || 'Erro ao criar produto');
    } finally {
      setCreatingFor(null);
    }
  };

  const handleVincularDetected = async (row: UnifiedColorRow) => {
    // Se a cor existe no catálogo mas não tem vínculo com este grupo, vincula
    if (row.colorId) {
      addColor.mutate({ groupId, colorId: row.colorId });
    } else {
      // Não existe nem no catálogo de cores — sugere cadastrar
      toast.info(`A cor "${row.name}" não está no catálogo de cores. Cadastre primeiro em /estoque > Cores pra poder vincular.`);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Cores da família</span>
          <Badge variant="secondary" className="text-xs">{unified.length}</Badge>
        </div>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 h-8">
              <Plus className="h-3.5 w-3.5" />
              Vincular cor do catálogo
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-2" align="end">
            <div className="flex items-center gap-2 mb-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar cor..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="max-h-56 overflow-y-auto space-y-0.5">
              {filteredCatalog.length === 0 ? (
                <p className="text-sm text-muted-foreground px-2 py-3 text-center">Nenhuma cor encontrada</p>
              ) : filteredCatalog.map(color => {
                const isLinked = linkedColorIds.has(color.id);
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => handleVincular(color.id)}
                    className={cn(
                      'flex items-center gap-2.5 w-full rounded-md px-2.5 py-2 text-sm hover:bg-accent transition-colors',
                      isLinked && 'bg-primary/5'
                    )}
                  >
                    <Check className={cn('h-4 w-4 shrink-0 text-primary', isLinked ? 'opacity-100' : 'opacity-0')} />
                    {color.referencia_hex ? (
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-border shrink-0 shadow-sm"
                        style={{ backgroundColor: color.referencia_hex }}
                      />
                    ) : (
                      <span className="inline-block h-4 w-4 rounded-full border border-dashed border-muted-foreground/30 shrink-0" />
                    )}
                    <span className="truncate">{color.nome}</span>
                    {color.referencia_pantone && (
                      <span className="text-[11px] text-muted-foreground ml-auto shrink-0">{color.referencia_pantone}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Legenda */}
      {unified.length > 0 && (
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground border-b border-border/40 pb-2">
          <span className="flex items-center gap-1"><Check className="h-3 w-3 text-emerald-600" /> Pronta (produto + vínculo)</span>
          <span className="flex items-center gap-1"><PackagePlus className="h-3 w-3 text-amber-600" /> Sem produto (só vínculo)</span>
          <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-blue-600" /> Detectada (produto, sem vínculo)</span>
        </div>
      )}

      {/* Lista unificada */}
      {unified.length === 0 ? (
        <div className="text-center py-6 px-4 border-2 border-dashed border-border/60 rounded-lg">
          <Palette className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm font-medium">Sem cores cadastradas</p>
          <p className="text-xs text-muted-foreground mt-1">
            Vincule cores do catálogo ou crie produtos com cor.<br />
            Atalho: <span className="font-mono">Estoque → "Cadastro rápido com cores"</span>
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {unified.map(row => {
            const statusIcon =
              row.status === 'ready' ? <Check className="h-3 w-3 text-emerald-600" /> :
              row.status === 'no-product' ? <PackagePlus className="h-3 w-3 text-amber-600" /> :
              <AlertCircle className="h-3 w-3 text-blue-600" />;
            const statusBg =
              row.status === 'ready' ? 'bg-emerald-500/5 border-emerald-500/30' :
              row.status === 'no-product' ? 'bg-amber-500/5 border-amber-500/30' :
              'bg-blue-500/5 border-blue-500/30';
            return (
              <div
                key={row.name}
                className={cn(
                  'flex items-center gap-2 pl-2 pr-1 py-1 rounded-md border text-sm group',
                  statusBg,
                )}
              >
                {row.hex ? (
                  <span
                    className="inline-block h-4 w-4 rounded-full border border-border shrink-0 shadow-sm"
                    style={{ backgroundColor: row.hex }}
                    title={row.name}
                  />
                ) : (
                  <span className="inline-block h-4 w-4 rounded-full border border-dashed border-muted-foreground/30 shrink-0" />
                )}
                {statusIcon}
                <span className="font-medium">{row.name}</span>
                {row.product && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    · {row.product.quantity}
                  </span>
                )}

                {/* Ações contextuais */}
                {row.status === 'no-product' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px] gap-1"
                    onClick={() => handleCreateProduct(row)}
                    disabled={creatingFor === row.name}
                    title="Criar produto nesta cor"
                  >
                    <PackagePlus className="h-3 w-3" />
                    Criar produto
                  </Button>
                )}
                {row.status === 'detected-only' && row.colorId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-6 px-1.5 text-[11px] gap-1"
                    onClick={() => handleVincularDetected(row)}
                    title="Vincular essa cor ao catálogo"
                  >
                    <Sparkles className="h-3 w-3" />
                    Vincular
                  </Button>
                )}
                {(row.junctionId || row.status === 'detected-only') && (
                  <button
                    type="button"
                    onClick={() => handleRemove(row)}
                    className="opacity-0 group-hover:opacity-100 hover:text-destructive transition-opacity ml-0.5"
                    title="Remover vínculo"
                    disabled={!row.junctionId}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Fontes de cores: permite herdar paleta de outros grupos (ex: tira
          derivada de napa). Importação manual — operador escolhe quais cores
          quer disponíveis aqui. */}
      <GroupColorSourcesPanel groupId={groupId} groupName={groupName} />
    </div>
  );
}
