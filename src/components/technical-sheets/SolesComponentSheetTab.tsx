import { useState, useMemo } from 'react';
import { Footprints, MagnifyingGlass, CircleNotch as Loader2, FloppyDisk as Save, CheckCircle as CheckCircle2, WarningCircle as AlertCircle, Package, CaretRight as ChevronRight, CaretDown as ChevronDown, Cube as Box } from '@phosphor-icons/react';
import { PackagingTab } from './PackagingTab';
import { SearchInput } from '@/components/ui/search-input';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { NumberInput } from '@/components/ui/number-input';
import { useProducts } from '@/hooks/useProducts';
import {
  useComponentSheets,
  useAddComponentSheet,
  useUpdateComponentSheet,
} from '@/hooks/useComponentSheets';
import { normalizeProductName } from '@/lib/productNameNormalization';
import { searchMatchesAllTerms } from '@/lib/searchUtils';

/**
 * Aba dedicada de Solados na Ficha de Componentes.
 *
 * Regras específicas:
 *  - Unidade de consumo é PAR (não dm² como nos demais materiais).
 *  - Lista TODOS os solados cadastrados em estoque (products.category ~ 'solado').
 *  - Permite definir o consumo por par diretamente em cada solado, mesmo
 *    aqueles que ainda não possuem ficha de componente.
 *  - Persiste o valor em `component_sheets.yield_per_size['par']` para que o
 *    motor de cálculo industrial reconheça. O `dimensions_unit` é fixado em "par".
 */
export function SolesComponentSheetTab() {
  const { data: products = [], isLoading: loadingProducts } = useProducts();
  const { data: sheets = [], isLoading: loadingSheets } = useComponentSheets();
  const addSheet = useAddComponentSheet();
  const updateSheet = useUpdateComponentSheet();

  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { consumption: number; waste_pct: number }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Regra global de agrupamento — ver src/lib/productNameNormalization.ts
  // Ex.: "Saltinho Bloco - Caramelo" e "Saltinho Bloco - Preto" -> "saltinho bloco"
  const normalizeName = normalizeProductName;

  // Solados do estoque (variantes de cor individuais)
  const allSolesVariants = useMemo(() => {
    return (products as any[])
      .filter((p) => {
        const cat = (p.category || '').toLowerCase().trim();
        return cat.includes('solado') || cat === 'sola';
      });
  }, [products]);

  // Mapa product_id -> sheet (para saber quais solados já têm ficha)
  const sheetByProductId = useMemo(() => {
    const m = new Map<string, any>();
    (sheets as any[]).forEach((s) => {
      if (s.product_id) m.set(s.product_id, s);
    });
    return m;
  }, [sheets]);

  // AGRUPA variantes de cor sob o mesmo modelo de solado.
  // Cada linha da tabela representa um MODELO (item) — não uma cor individual.
  // O "primary" é a primeira variante com ficha (ou a primeira ordenada) e
  // serve como âncora para persistir a ficha de componente.
  type SoleGroup = {
    key: string;
    name: string;
    primary: any;
    variants: any[];
    hasSheet: boolean;
  };

  const soleGroups = useMemo<SoleGroup[]>(() => {
    const map = new Map<string, any[]>();
    allSolesVariants.forEach((p) => {
      const key = normalizeName(p.name) || p.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    return Array.from(map.entries())
      .map(([key, variants]) => {
        const sorted = [...variants].sort((a, b) =>
          (a.color || '').localeCompare(b.color || '') || (a.sku || '').localeCompare(b.sku || '')
        );
        // Prefere variante que já tem ficha como primary
        const withSheet = sorted.find((v) => sheetByProductId.has(v.id));
        const primary = withSheet || sorted[0];
        return {
          key,
          name: normalizeProductName(primary.name || '') || primary.name,
          primary,
          variants: sorted,
          hasSheet: sorted.some((v) => sheetByProductId.has(v.id)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
  }, [allSolesVariants, sheetByProductId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return soleGroups;
    return soleGroups.filter((g) =>
      searchMatchesAllTerms(
        search,
        g.name,
        ...g.variants.flatMap((v) => [v.sku, v.color, v.name]),
      )
    );
  }, [soleGroups, search]);

  const getRow = (productId: string) => {
    const sheet = sheetByProductId.get(productId);
    const draft = drafts[productId];
    const baseConsumption = sheet?.yield_per_size?.par ?? sheet?.yield_per_size?.['par'] ?? 1;
    const baseWaste = sheet?.waste_pct ?? 0;
    return {
      sheet,
      consumption: draft?.consumption ?? Number(baseConsumption) ?? 1,
      waste_pct: draft?.waste_pct ?? Number(baseWaste) ?? 0,
      dirty: !!draft,
    };
  };

  const updateDraft = (productId: string, patch: Partial<{ consumption: number; waste_pct: number }>) => {
    const current = getRow(productId);
    setDrafts((prev) => ({
      ...prev,
      [productId]: {
        consumption: patch.consumption ?? current.consumption,
        waste_pct: patch.waste_pct ?? current.waste_pct,
      },
    }));
  };

  const clearDraft = (productId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  };

  const handleSave = async (productId: string) => {
    const row = getRow(productId);
    if (!row.dirty) return;
    setSavingId(productId);
    try {
      const yield_per_size: Record<string, number> = { par: row.consumption };
      if (row.sheet) {
        await updateSheet.mutateAsync({
          id: row.sheet.id,
          data: {
            yield_per_size,
            waste_pct: row.waste_pct,
            dimensions_unit: 'par',
          },
        });
      } else {
        await addSheet.mutateAsync({
          product_id: productId,
          group_id: null,
          default_sole_group_id: null,
          dimensions_length: 0,
          dimensions_width: 0,
          dimensions_thickness: 0,
          dimensions_unit: 'par',
          yield_per_size,
          waste_pct: row.waste_pct,
          notes: '',
        });
      }
      clearDraft(productId);
    } catch (err) {
      // toast already handled inside hook
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const dirtyCount = Object.keys(drafts).length;

  if (loadingProducts || loadingSheets) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header / search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <div className="flex items-center gap-2 flex-1">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Footprints className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground leading-tight">Fichas de Solados</h2>
            <p className="text-xs text-muted-foreground">
              Consumo expresso em <span className="font-mono font-semibold">par</span> — todos os solados do estoque listados abaixo
            </p>
          </div>
        </div>
        <SearchInput
          className="w-full sm:w-72"
          value={search}
          onChange={setSearch}
          placeholder="Buscar solado por nome, SKU ou cor…"
          resultCount={filtered.length}
          totalCount={soleGroups.length}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-3 flex items-center gap-3">
            <Package className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-lg font-bold leading-none">{soleGroups.length}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Modelos de solado</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3 flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <div>
              <p className="text-lg font-bold leading-none">
                {soleGroups.filter((g) => g.hasSheet).length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Com ficha</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <div>
              <p className="text-lg font-bold leading-none">
                {soleGroups.filter((g) => !g.hasSheet).length}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Sem ficha</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-3 flex items-center gap-3">
            <Save className="h-4 w-4 text-primary" />
            <div>
              <p className="text-lg font-bold leading-none">{dirtyCount}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Alterações pendentes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card className="border-border/60">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            soleGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Footprints className="h-10 w-10 opacity-30 mb-3" />
                <p className="text-sm font-medium text-foreground">Nenhum solado cadastrado no estoque</p>
                <p className="text-xs mt-1">Cadastre solados em Estoque &gt; Materiais com a categoria "Solado"</p>
              </div>
            ) : (
              <EmptyState
                size="sm"
                icon={MagnifyingGlass}
                title={`Nenhum resultado para "${search}"`}
                action={<Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button>}
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Solado (modelo)</TableHead>
                  <TableHead className="hidden md:table-cell">Cores disponíveis</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[160px] text-center">
                    Consumo (par/par)
                  </TableHead>
                  <TableHead className="w-[120px] text-center">Perda %</TableHead>
                  <TableHead className="w-[140px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((group) => {
                  const primary = group.primary;
                  const row = getRow(primary.id);
                  const isExpanded = expandedId === group.key;
                  return (
                    <>
                      <TableRow key={group.key} className={row.dirty ? 'bg-primary/5' : ''}>
                        <TableCell className="p-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(isExpanded ? null : group.key)}
                            className="h-9 w-9 rounded-md bg-muted/50 border border-border/40 flex items-center justify-center overflow-hidden hover:border-primary/40 transition"
                            title={isExpanded ? 'Recolher' : 'Definir itens padrão (cola, EVA, linha, etc)'}
                          >
                            {primary.image_url ? (
                              <img src={primary.image_url} alt={group.name} className="h-full w-full object-cover" />
                            ) : (
                              <Footprints className="h-4 w-4 text-muted-foreground/40" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-sm text-foreground">{group.name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {group.variants.length} {group.variants.length === 1 ? 'variante' : 'variantes'} de cor
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {group.variants.map((v) => (
                              <Badge
                                key={v.id}
                                variant="secondary"
                                className="text-xs font-normal"
                                title={`SKU: ${v.sku || '—'}`}
                              >
                                {v.color || 'sem cor'}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {group.hasSheet ? (
                            <Badge variant="outline" className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                              <CheckCircle2 className="h-3 w-3" />
                              Com ficha
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600">
                              <AlertCircle className="h-3 w-3" />
                              Sem ficha
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <NumberInput
                              value={row.consumption}
                              onChange={(v) => updateDraft(primary.id, { consumption: Number(v) || 0 })}
                              step="0.01"
                              min={0}
                              decimals={4}
                              className="h-8 w-20 text-center text-sm"
                            />
                            <span className="text-xs text-muted-foreground font-mono">par</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <NumberInput
                              value={row.waste_pct}
                              onChange={(v) => updateDraft(primary.id, { waste_pct: Number(v) || 0 })}
                              step="0.5"
                              min={0}
                              decimals={2}
                              className="h-8 w-16 text-center text-sm"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setExpandedId(isExpanded ? null : group.key)}
                              className="h-8 w-8 p-0"
                              title="Itens padrão (cola, EVA, linha…)"
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="sm"
                              variant={row.dirty ? 'default' : 'ghost'}
                              disabled={!row.dirty || savingId === primary.id}
                              onClick={() => handleSave(primary.id)}
                              className="h-8 gap-1"
                            >
                              {savingId === primary.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Save className="h-3.5 w-3.5" />
                              )}
                              {row.dirty ? 'Salvar' : 'Salvo'}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${group.key}-expanded`} className="bg-muted/10 hover:bg-muted/10 border-b">
                          <TableCell colSpan={7} className="p-4">
                            {/* Itens Padrão por Numeração saiu em 03/08/2026:
                                escrevia em sole_standard_items_consumption, tabela
                                aposentada em 07/06 e já suprimida no custeio. O
                                cadastro de consumo é Solados → Consumo Padrão. */}
                            <PackagingTab soleGroupId={primary.group_id} />
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground px-1">
        <span className="font-semibold">Dica:</span> o consumo padrão de um solado é{' '}
        <span className="font-mono">1 par/par</span>. Use valores fracionários apenas quando houver perda de
        pareamento (ex.: <span className="font-mono">1.05</span> = 5% de reposição).
      </p>
    </div>
  );
}
