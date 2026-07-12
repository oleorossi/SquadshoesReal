import React, { useState, useMemo } from 'react';
import { Plus, CircleNotch as Loader2, Warning as AlertTriangle, CheckCircle as CheckCircle2, ShieldCheck, Package, Ruler, ArrowsClockwise as RefreshCw, CaretDown as ChevronDown, CaretUp as ChevronUp } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';

import DeleteConfirmButton from '@/components/ui/delete-confirm-button';
import { cn, parseSafeNumber, safeToFixed } from '@/lib/utils';
import { toast } from 'sonner';
import { useProducts } from '@/hooks/useProducts';
import {
  useTechnicalReferences,
  useTechnicalRefMaterials,
  useAddTechnicalReference,
  useUpdateTechnicalReference,
  useDeleteTechnicalReference,
  useAddTechRefMaterial,
  useUpdateTechRefMaterial,
  useDeleteTechRefMaterial,
  useValidateTechnicalReference,
  TechnicalReferenceRow,
} from '@/hooks/useTechnicalReferences';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { useCan } from '@/hooks/useAccessControl';

const CATEGORIES = [
  { value: 'furniture', label: 'Mobiliário' },
  { value: 'metalwork', label: 'Metalurgia' },
  { value: 'construction', label: 'Construção' },
  { value: 'custom', label: 'Personalizado' },
] as const;

const STATUSES = [
  { value: 'draft', label: 'Rascunho', color: 'bg-muted text-muted-foreground' },
  { value: 'validated', label: 'Validada', color: 'bg-blue-500/10 text-blue-600' },
  { value: 'approved', label: 'Aprovada', color: 'bg-green-500/10 text-green-600' },
  { value: 'production_ready', label: 'Pronta p/ Produção', color: 'bg-emerald-500/10 text-emerald-600' },
] as const;

const DIMENSION_UNITS = ['mm', 'cm', 'm'] as const;

interface Props {
  sheetId: string;
  sheetName: string;
}

export function TechnicalReferencePanel({ sheetId, sheetName }: Props) {
  const { data: refs = [], isLoading } = useTechnicalReferences(sheetId);
  const addRef = useAddTechnicalReference();
  const deleteRef = useDeleteTechnicalReference();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  

  const handleCreate = () => {
    addRef.mutate(
      {
        sheet_id: sheetId,
        reference_code: `REF-${Date.now().toString(36).toUpperCase()}`,
        name: `Ref. Técnica — ${sheetName}`,
        category: 'custom',
        status: 'draft',
      },
      {
        onSuccess: (data: any) => {
          setExpandedId(data.id);
          
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Referências Técnicas</h3>
          <p className="text-xs text-muted-foreground">
            Especificações dimensionais e validação de materiais
          </p>
        </div>
        <Button size="sm" className="gap-1.5 h-8" onClick={handleCreate} disabled={addRef.isPending}>
          {addRef.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Nova Referência
        </Button>
      </div>

      {refs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Ruler className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">Nenhuma referência técnica vinculada</p>
            <p className="text-xs">Crie uma para especificar dimensões e validar materiais</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {refs.map((ref) => (
            <Card key={ref.id} className="overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expandedId === ref.id ? null : ref.id)}
              >
                <div className="flex items-center gap-3">
                  <ValidationBadge ref_={ref} />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{ref.name}</span>
                      <Badge variant="outline" className="text-xs font-mono">{ref.reference_code}</Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={ref.status} />
                      {parseSafeNumber(ref.estimated_cost) > 0 && (
                        <span className="text-xs text-muted-foreground">
                          Custo est.: R$ {safeToFixed(ref.estimated_cost, 2)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <DeleteConfirmButton
                    onConfirm={() => deleteRef.mutate(ref.id)}
                    title="Excluir referência técnica?"
                    size="h-7 w-7"
                    iconSize="h-3 w-3"
                  />
                  {expandedId === ref.id ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>

              {expandedId === ref.id && (
                <CardContent className="pt-0 pb-4 px-4">
                  <Separator className="mb-4" />
                  <TechnicalReferenceDetail ref_={ref} />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ValidationBadge({ ref_ }: { ref_: TechnicalReferenceRow }) {
  if (ref_.is_valid) {
    return (
      <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
      </div>
    );
  }
  if (ref_.validation_errors && (ref_.validation_errors as any[]).length > 0) {
    return (
      <div className="h-8 w-8 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
        <AlertTriangle className="h-4 w-4 text-destructive" />
      </div>
    );
  }
  return (
    <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
      <Ruler className="h-4 w-4 text-muted-foreground" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find((st) => st.value === status) || STATUSES[0];
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${s.color}`}>{s.label}</span>;
}

function TechnicalReferenceDetail({ ref_ }: { ref_: TechnicalReferenceRow }) {
  const updateRef = useUpdateTechnicalReference();
  const validate = useValidateTechnicalReference();
  const { data: products = [] } = useProducts();

  const [form, setForm] = useState({
    name: ref_.name,
    reference_code: ref_.reference_code,
    description: ref_.description || '',
    category: ref_.category,
    status: ref_.status,
    final_length: ref_.final_length,
    final_width: ref_.final_width,
    final_height: ref_.final_height,
    dimensions_unit: ref_.dimensions_unit,
    tolerance: ref_.tolerance,
  });

  const handleSave = () => {
    updateRef.mutate({ id: ref_.id, data: form as any }, {
      onSuccess: () => {
        window.history.back();
      }
    });
  };

  const handleValidate = () => {
    validate.mutate(ref_.id, {
      onSuccess: (result) => {
        if (result.is_valid) {
          toast.success('Referência validada com sucesso!');
        } else {
          toast.warning(`${result.errors.length} problema(s) encontrado(s)`);
        }
      },
      onError: (err) => toast.error(`Erro na validação: ${err.message}`),
    });
  };

  return (
    <div className="space-y-5">
      {/* Header form */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="col-span-2">
          <Label className="text-xs">Nome</Label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Código</Label>
          <Input
            value={form.reference_code}
            onChange={(e) => setForm((f) => ({ ...f, reference_code: e.target.value }))}
            className="mt-1 h-8 text-sm font-mono"
          />
        </div>
        <div>
          <Label className="text-xs">Categoria</Label>
          <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
            <SelectTrigger className="mt-1 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Dimensions */}
      <Card className="bg-muted/30">
        <CardHeader className="py-2 px-3">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            <Ruler className="h-3.5 w-3.5" />
            Dimensões do Produto Final
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs">Comprimento</Label>
              <NumberInput
                value={form.final_length}
                onChange={(v) => setForm((f) => ({ ...f, final_length: v }))}
                className="mt-1 h-8 text-sm"
                min={0}
              />
            </div>
            <div>
              <Label className="text-xs">Largura</Label>
              <NumberInput
                value={form.final_width}
                onChange={(v) => setForm((f) => ({ ...f, final_width: v }))}
                className="mt-1 h-8 text-sm"
                min={0}
              />
            </div>
            <div>
              <Label className="text-xs">Altura</Label>
              <NumberInput
                value={form.final_height}
                onChange={(v) => setForm((f) => ({ ...f, final_height: v }))}
                className="mt-1 h-8 text-sm"
                min={0}
              />
            </div>
            <div>
              <Label className="text-xs">Unidade</Label>
              <Select value={form.dimensions_unit} onValueChange={(v) => setForm((f) => ({ ...f, dimensions_unit: v }))}>
                <SelectTrigger className="mt-1 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIMENSION_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tolerância (±)</Label>
              <NumberInput
                value={form.tolerance}
                onChange={(v) => setForm((f) => ({ ...f, tolerance: v }))}
                className="mt-1 h-8 text-sm"
                min={0}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status & save */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs">Status:</Label>
          <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-8"
            onClick={handleValidate}
            disabled={validate.isPending}
          >
            {validate.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Validar
          </Button>
          <Button size="sm" className="gap-1.5 h-8" onClick={handleSave} disabled={updateRef.isPending}>
            {updateRef.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Salvar
          </Button>
        </div>
      </div>

      {/* Validation results */}
      {ref_.validation_errors && (ref_.validation_errors as any[]).length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-3 px-3 space-y-1.5">
            <p className="text-xs font-semibold text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {(ref_.validation_errors as any[]).length} Problema(s)
            </p>
            {(ref_.validation_errors as any[]).map((err: any, i: number) => (
              <div key={i} className="text-xs bg-background rounded p-2 border border-destructive/20">
                <span className="font-medium">{err.message}</span>
                {err.suggested_action && (
                  <p className="text-muted-foreground mt-0.5">💡 {err.suggested_action}</p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {ref_.validation_warnings && (ref_.validation_warnings as any[]).length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="py-3 px-3 space-y-1.5">
            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {(ref_.validation_warnings as any[]).length} Aviso(s)
            </p>
            {(ref_.validation_warnings as any[]).map((w: any, i: number) => (
              <p key={i} className="text-xs text-amber-700">{w.message}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Materials */}
      <Separator />
      <MaterialsSection refId={ref_.id} products={products} />
    </div>
  );
}

function MaterialsSection({ refId, products }: { refId: string; products: any[] }) {
  const { data: materials = [], isLoading } = useTechnicalRefMaterials(refId);
  const addMat = useAddTechRefMaterial();
  const updateMat = useUpdateTechRefMaterial();
  const deleteMat = useDeleteTechRefMaterial();
  const perm = useCan('/fichas-tecnicas');

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  const addedIds = new Set(materials.map((m: any) => m.product_id));

  const categories = useMemo(() => {
    const cats = new Set(products.map((p: any) => p.category).filter(Boolean));
    return Array.from(cats).sort() as string[];
  }, [products]);

  const catalogProducts = useMemo(() => {
    let filtered = products.filter((p: any) => !addedIds.has(p.id));
    if (categoryFilter !== 'all') filtered = filtered.filter((p: any) => p.category === categoryFilter);
    if (showOnlyAvailable) filtered = filtered.filter((p: any) => p.quantity > 0);
    if (searchQuery.trim()) {
      filtered = filtered.filter((p: any) =>
        searchMatchesAllTerms(searchQuery, p.name, p.sku, p.category, (p.product_groups as any)?.name)
      );
    }
    return filtered.sort((a: any, b: any) => (b.quantity || 0) - (a.quantity || 0));
  }, [products, addedIds, categoryFilter, showOnlyAvailable, searchQuery]);

  const handleAddFromCatalog = (product: any) => {
    const nextSeq = materials.length > 0 ? Math.max(...materials.map((m: any) => m.sequence)) + 1 : 1;
    // Prefere consumption_unit (canônica de BOM, ex: m²/dm²) sobre unit (estoque,
    // ex: "rolo"). Fallback final pra group.consumption_unit caso o produto não
    // tenha override próprio.
    const consumptionUnit =
      (product.consumption_unit || '').toString().trim() ||
      (product.product_groups?.consumption_unit || '').toString().trim() ||
      (product.unit || '').toString().trim() ||
      'un';
    addMat.mutate({
      technical_reference_id: refId,
      product_id: product.id,
      sequence: nextSeq,
      quantity_needed: 1,
      unit: consumptionUnit,
      waste_factor: getDefaultWaste(product.category),
      is_critical: false,
    } as any);
  };

  if (isLoading) {
    return <Loader2 className="h-5 w-5 animate-spin text-primary mx-auto" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold flex items-center gap-1.5">
          <Package className="h-3.5 w-3.5" />
          Materiais ({materials.length})
        </h4>
        {perm.canEdit && (
          <Button
            variant={showCatalog ? 'default' : 'outline'}
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => setShowCatalog(!showCatalog)}
          >
            <Plus className="h-3 w-3" />
            {showCatalog ? 'Fechar Catálogo' : 'Adicionar do Estoque'}
          </Button>
        )}
      </div>

      {/* Materials table */}
      {materials.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-xs w-10">#</TableHead>
                <TableHead className="text-xs">Material</TableHead>
                <TableHead className="text-xs w-20">Qtd</TableHead>
                <TableHead className="text-xs w-16">Unid.</TableHead>
                <TableHead className="text-xs w-16">Perda %</TableHead>
                <TableHead className="text-xs w-28">Dim. Corte (mm)</TableHead>
                <TableHead className="text-xs w-14">Crítico</TableHead>
                <TableHead className="text-xs w-24">Estoque</TableHead>
                <TableHead className="text-xs w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {materials.map((mat: any) => (
                <MaterialRow
                  key={mat.id}
                  mat={mat}
                  onUpdate={(data) => updateMat.mutate({ id: mat.id, data })}
                  onDelete={() => deleteMat.mutate(mat.id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {materials.length === 0 && !showCatalog && (
        <div className="text-center py-6 text-muted-foreground text-xs border rounded-lg border-dashed">
          <Package className="h-6 w-6 mx-auto mb-2 opacity-40" />
          Nenhum material adicionado. Clique em "Adicionar do Estoque" acima.
        </div>
      )}

      {/* Product catalog */}
      {showCatalog && (
        <Card className="bg-muted/20">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-xs font-semibold">Catálogo de Materiais</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <SearchInput
                className="flex-1 min-w-[160px]"
                inputClassName="h-7 text-xs"
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Buscar por nome, SKU, categoria ou grupo…"
                resultCount={catalogProducts.length}
                totalCount={products.length}
              />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-xs cursor-pointer">
                <Checkbox
                  checked={showOnlyAvailable}
                  onCheckedChange={(v) => setShowOnlyAvailable(!!v)}
                />
                Em estoque
              </label>
            </div>

            {catalogProducts.length === 0 ? (
              searchQuery.trim() ? (
                <div className="flex items-center justify-center gap-2 py-4">
                  <p className="text-xs text-muted-foreground">Nenhum resultado para "{searchQuery}"</p>
                  <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => setSearchQuery('')}>
                    Limpar busca
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">Nenhum material encontrado</p>
              )
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
                {catalogProducts.slice(0, 30).map((p: any) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleAddFromCatalog(p)}
                    disabled={addMat.isPending}
                    className="flex items-center gap-2 p-2 rounded-md border bg-background hover:bg-accent/50 transition-colors text-left text-xs"
                  >
                    <Plus className="h-3 w-3 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{p.name}</div>
                      <div className="text-muted-foreground text-xs flex gap-2">
                        <span className="font-mono">{p.sku}</span>
                        <span>{p.category}</span>
                        <span>
                          Estoque: <span className={p.quantity > 0 ? 'text-primary' : 'text-destructive'}>{p.quantity}</span> {p.unit}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {catalogProducts.length > 30 && (
              <p className="text-xs text-muted-foreground text-center">
                Mostrando 30 de {catalogProducts.length} — refine a busca
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function getDefaultWaste(category?: string): number {
  switch (category?.toLowerCase()) {
    case 'cabedal': return 8;
    case 'solado': return 3;
    case 'palmilha': return 5;
    case 'cola / químico': return 10;
    default: return 5;
  }
}

function MaterialRow({
  mat,
  onUpdate,
  onDelete,
}: {
  mat: any;
  onUpdate: (data: any) => void;
  onDelete: () => void;
}) {
  const perm = useCan('/fichas-tecnicas');
  const product = mat.products;
  const totalNeeded = mat.quantity_needed * (1 + mat.waste_factor / 100);
  const available = product?.quantity ?? 0;
  const isShort = available < totalNeeded;
  const isCriticalShort = isShort && mat.is_critical;

  return (
    <TableRow className={cn('text-xs', isCriticalShort && 'bg-destructive/5')}>
      <TableCell className="font-mono text-muted-foreground">{mat.sequence}</TableCell>
      <TableCell>
        <div>
          <span className="font-medium">{product?.name || 'Produto não encontrado'}</span>
          {product?.sku && (
            <span className="text-muted-foreground ml-1 font-mono text-xs">{product.sku}</span>
          )}
          {product?.category && (
            <Badge variant="outline" className="ml-1 text-xs h-4">{product.category}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <NumberInput
          value={mat.quantity_needed}
          onChange={(v) => onUpdate({ quantity_needed: v })}
          className="h-7 text-xs w-18"
          min={0}
        />
      </TableCell>
      <TableCell>
        <Input
          value={mat.unit}
          onChange={(e) => onUpdate({ unit: e.target.value })}
          className="h-7 text-xs w-14"
        />
      </TableCell>
      <TableCell>
        <NumberInput
          value={mat.waste_factor}
          onChange={(v) => onUpdate({ waste_factor: v })}
          className="h-7 text-xs w-14"
          min={0}
        />
      </TableCell>
      <TableCell>
        <div className="flex gap-0.5">
          <Input
            value={mat.cut_length ?? ''}
            onChange={(e) => onUpdate({ cut_length: e.target.value ? Number(e.target.value) : null })}
            placeholder="C"
            className="h-7 text-xs w-9 px-1 text-center"
            title="Comprimento de corte (mm)"
          />
          <span className="text-muted-foreground self-center text-xs">×</span>
          <Input
            value={mat.cut_width ?? ''}
            onChange={(e) => onUpdate({ cut_width: e.target.value ? Number(e.target.value) : null })}
            placeholder="L"
            className="h-7 text-xs w-9 px-1 text-center"
            title="Largura de corte (mm)"
          />
        </div>
      </TableCell>
      <TableCell>
        <Checkbox
          checked={mat.is_critical}
          onCheckedChange={(v) => onUpdate({ is_critical: !!v })}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Badge
            variant={isShort ? 'destructive' : 'default'}
            className="text-xs font-mono"
          >
            {safeToFixed(available, 1)}
          </Badge>
          {isShort && (
            <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
          )}
        </div>
        {isShort && (
          <span className="text-xs text-destructive">
            Falta {safeToFixed(totalNeeded - available, 1)}
          </span>
        )}
      </TableCell>
      <TableCell>
        {perm.canEdit && (
          <DeleteConfirmButton
            onConfirm={onDelete}
            title="Remover material?"
            size="h-6 w-6"
            iconSize="h-3 w-3"
          />
        )}
      </TableCell>
    </TableRow>
  );
}
