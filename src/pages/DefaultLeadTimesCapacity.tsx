import { useEffect, useMemo, useState } from 'react';
import { ArrowsClockwise, Check, CircleNotch as Loader2, FloppyDisk, GearSix, Info, PencilSimple as Pencil, Plus, Trash, Warning, X } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DEFAULT_LEAD_TIME_CAPACITY_FIELDS,
  emptyDefaultLeadTimesCapacity,
  type DefaultLeadTimeCapacityField,
  type DefaultLeadTimesCapacity,
  useDefaultLeadTimeCategories,
  useDefaultLeadTimes,
  useRecalcWavesForCategory,
  useShoeCategoriesInUse,
  useUpsertDefaultLeadTimes,
} from '@/hooks/useDefaultLeadTimes';
import {
  useCreateShoeCategory,
  useDeleteShoeCategory,
  useRenameShoeCategory,
  useShoeCategories,
} from '@/hooks/useShoeCategories';
import { SHOE_CATEGORIES } from '@/lib/shoeCategories';

const SECTORS: ReadonlyArray<{
  field: DefaultLeadTimeCapacityField;
  label: string;
}> = [
  { field: 'sewing_capacity_per_day', label: 'Corte Palmilha' },
  { field: 'cutting_capacity_per_day', label: 'Corte Forração' },
  { field: 'costura_cabedal_capacity_per_day', label: 'Costura Cabedal' },
  { field: 'costura_palmilha_capacity_per_day', label: 'Costura Palmilha' },
  { field: 'mesa_daily_capacity', label: 'Aviamento' },
  { field: 'silk_capacity_per_day', label: 'Silk' },
  { field: 'gluing_capacity_per_day', label: 'Colagem' },
  { field: 'assembly_capacity_per_day', label: 'Montagem' },
  { field: 'soling_capacity_per_day', label: 'Solagem' },
  { field: 'finishing_capacity_per_day', label: 'Acabamento' },
  { field: 'expedition_capacity_per_day', label: 'Expedição' },
];

function valuesFromRow(row: Record<string, unknown> | null | undefined): DefaultLeadTimesCapacity {
  return DEFAULT_LEAD_TIME_CAPACITY_FIELDS.reduce((values, field) => {
    const value = Number(row?.[field]);
    values[field] = Number.isFinite(value) ? value : 0;
    return values;
  }, emptyDefaultLeadTimesCapacity());
}

export default function DefaultLeadTimesCapacity() {
  const [shoeCategory, setShoeCategory] = useState<string>(SHOE_CATEGORIES[0]);
  const [capacities, setCapacities] = useState<DefaultLeadTimesCapacity>(emptyDefaultLeadTimesCapacity);
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [renamedCategory, setRenamedCategory] = useState('');
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);
  const { data: defaultLeadTimes, isLoading } = useDefaultLeadTimes(shoeCategory);
  const { data: configuredCategories = [] } = useDefaultLeadTimeCategories();
  const { data: shoeCategories = [], isLoading: isLoadingShoeCategories } = useShoeCategories();
  const { data: categoriesInUse = [] } = useShoeCategoriesInUse();
  const upsertDefaultLeadTimes = useUpsertDefaultLeadTimes();
  const recalcWaves = useRecalcWavesForCategory();
  const createShoeCategory = useCreateShoeCategory();
  const renameShoeCategory = useRenameShoeCategory();
  const deleteShoeCategory = useDeleteShoeCategory();
  const categoryOptions = useMemo(
    () => Array.from(new Set([
      ...(shoeCategories.length > 0 ? shoeCategories : SHOE_CATEGORIES),
      ...configuredCategories,
    ])).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [configuredCategories, shoeCategories],
  );

  // Categorias que alguma ficha técnica usa mas que ainda não têm padrão salvo.
  // Sem linha aqui E sem capacidade própria na ficha, o motor cai nas constantes
  // hard-coded (1-2 dias por setor, ignorando a quantidade) — o volume diário
  // some do cálculo sem nenhum aviso. Auto-derivado: categoria nova aparece só.
  const categoriesMissingStandard = useMemo(() => {
    const configured = new Set(configuredCategories);
    return categoriesInUse.filter(({ category }) => !configured.has(category));
  }, [categoriesInUse, configuredCategories]);

  useEffect(() => {
    setCapacities(valuesFromRow(defaultLeadTimes));
  }, [defaultLeadTimes, shoeCategory]);

  const updateCapacity = (field: DefaultLeadTimeCapacityField, value: number) => {
    setCapacities((current) => ({ ...current, [field]: value }));
  };

  const handleSave = () => {
    upsertDefaultLeadTimes.mutate({ shoe_category: shoeCategory, ...capacities });
  };

  const handleAddCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    createShoeCategory.mutate({ name }, {
      onSuccess: () => {
        setNewCategory('');
        setShoeCategory(name);
      },
    });
  };

  const handleRenameCategory = (oldName: string) => {
    const newName = renamedCategory.trim();
    if (!newName) return;
    renameShoeCategory.mutate({ oldName, newName }, {
      onSuccess: () => {
        if (shoeCategory === oldName) setShoeCategory(newName);
        setEditingCategory(null);
        setRenamedCategory('');
      },
    });
  };

  const handleDeleteCategory = () => {
    if (!categoryToDelete) return;
    const deletedCategory = categoryToDelete;
    deleteShoeCategory.mutate(deletedCategory, {
      onSuccess: () => {
        if (shoeCategory === deletedCategory) {
          setShoeCategory(categoryOptions.find((category) => category !== deletedCategory) ?? SHOE_CATEGORIES[0]);
        }
        setCategoryToDelete(null);
      },
    });
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="PRODUÇÃO · PADRÕES"
        title="Tempos-Padrão por Setor"
        description="Capacidade diária padrão por categoria de calçado."
      />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 pt-5 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Estes valores são aplicados quando a Ficha Técnica da referência não possui capacidade própria.
            Eles alimentam a produção diária, o cronograma de ondas e o cálculo da data faturável.
            Salvar vale para o que for calculado daqui em diante — ondas já montadas só mudam
            com o botão <strong>Recalcular ondas</strong>.
          </p>
        </CardContent>
      </Card>

      {categoriesMissingStandard.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="flex gap-3 pt-5 text-sm">
            <Warning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Categoria em uso sem padrão salvo
              </p>
              <p className="text-muted-foreground">
                Estas categorias têm ficha técnica mas nenhuma capacidade padrão. Sem isso, e sem
                capacidade própria na ficha, o motor usa um lead time fixo por setor e ignora a
                quantidade do pedido:{' '}
                {categoriesMissingStandard.map(({ category, sheets }, index) => (
                  <span key={category || '__sem_categoria__'}>
                    {index > 0 && ', '}
                    <strong className="text-foreground">{category || 'ficha sem categoria'}</strong>
                    {' '}({sheets} ficha{sheets > 1 ? 's' : ''})
                  </span>
                ))}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Categoria do calçado</CardTitle>
            <CardDescription>Use a mesma taxonomia cadastrada nas Fichas Técnicas.</CardDescription>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button variant="outline" className="h-9 gap-2" onClick={() => setManageCategoriesOpen(true)}>
              <GearSix className="h-4 w-4" />
              Gerenciar tipos
            </Button>
            <div className="w-full sm:w-72">
              <Label htmlFor="shoe-category" className="sr-only">Categoria do calçado</Label>
              <Select value={shoeCategory} onValueChange={setShoeCategory}>
                <SelectTrigger id="shoe-category">
                  <SelectValue placeholder="Selecione a categoria" />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando padrão da categoria…
            </div>
          ) : (
            <>
              {!defaultLeadTimes && (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Esta categoria ainda não possui padrão salvo. Preencha as capacidades e salve para criá-lo.
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {SECTORS.map((sector) => (
                  <div key={sector.field} className="space-y-2 rounded-lg border bg-muted/20 p-4">
                    <Label htmlFor={sector.field}>{sector.label}</Label>
                    <div className="flex items-center gap-2">
                      <NumberInput
                        id={sector.field}
                        value={capacities[sector.field]}
                        onChange={(value) => updateCapacity(sector.field, value)}
                        min={0}
                        step="1"
                        decimals={0}
                      />
                      <span className="shrink-0 text-xs text-muted-foreground">pares/dia</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
                {/* Repropagação EXPLÍCITA: default_lead_times não tem trigger de
                    recálculo (ao contrário de technical_sheets), então onda já
                    montada segue com a capacidade de quando foi criada. */}
                <Button
                  variant="outline"
                  onClick={() => recalcWaves.mutate(shoeCategory)}
                  disabled={recalcWaves.isPending || upsertDefaultLeadTimes.isPending}
                  title="Reaplica a capacidade atual às ondas já montadas desta categoria"
                >
                  {recalcWaves.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowsClockwise className="mr-2 h-4 w-4" />
                  )}
                  Recalcular ondas desta categoria
                </Button>
                <Button onClick={handleSave} disabled={upsertDefaultLeadTimes.isPending}>
                  {upsertDefaultLeadTimes.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FloppyDisk className="mr-2 h-4 w-4" />
                  )}
                  Salvar padrão
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={manageCategoriesOpen} onOpenChange={setManageCategoriesOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gerenciar tipos de calçado</DialogTitle>
            <DialogDescription>
              Adicione, renomeie ou exclua os tipos usados nas Fichas Técnicas e nos tempos-padrão.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              placeholder="Novo tipo de calçado"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleAddCategory();
                }
              }}
            />
            <Button className="h-9 gap-2" onClick={handleAddCategory} disabled={createShoeCategory.isPending || !newCategory.trim()}>
              {createShoeCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Adicionar
            </Button>
          </div>

          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {isLoadingShoeCategories ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando tipos…
              </div>
            ) : shoeCategories.length === 0 ? (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                Nenhum tipo cadastrado ainda. Adicione o primeiro tipo acima.
              </p>
            ) : shoeCategories.map((category) => (
              <div key={category} className="flex min-h-10 items-center gap-2 rounded-md border p-2">
                {editingCategory === category ? (
                  <>
                    <Input
                      value={renamedCategory}
                      onChange={(event) => setRenamedCategory(event.target.value)}
                      aria-label={`Novo nome para ${category}`}
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => handleRenameCategory(category)}
                      disabled={renameShoeCategory.isPending || !renamedCategory.trim()}
                      aria-label="Salvar novo nome"
                    >
                      {renameShoeCategory.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => { setEditingCategory(null); setRenamedCategory(''); }}
                      aria-label="Cancelar renomeação"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{category}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => { setEditingCategory(category); setRenamedCategory(category); }}
                      aria-label={`Renomear ${category}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setCategoryToDelete(category)}
                      aria-label={`Excluir ${category}`}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!categoryToDelete} onOpenChange={(open) => !open && setCategoryToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tipo de calçado?</AlertDialogTitle>
            <AlertDialogDescription>
              {categoryToDelete ? `"${categoryToDelete}" será excluído permanentemente.` : ''}
              {' '}Tipos em uso não podem ser excluídos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteCategory} disabled={deleteShoeCategory.isPending}>
              {deleteShoeCategory.isPending ? 'Excluindo…' : 'Excluir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
