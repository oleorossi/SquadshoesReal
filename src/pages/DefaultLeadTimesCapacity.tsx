import { useEffect, useMemo, useState } from 'react';
import { FloppyDisk, Info, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  useUpsertDefaultLeadTimes,
} from '@/hooks/useDefaultLeadTimes';
import { SHOE_CATEGORIES } from '@/lib/shoeCategories';

const SECTORS: ReadonlyArray<{
  field: DefaultLeadTimeCapacityField;
  label: string;
}> = [
  { field: 'sewing_capacity_per_day', label: 'Corte Palmilha' },
  { field: 'cutting_capacity_per_day', label: 'Corte Forração' },
  {
    field: 'costura_capacity_per_day',
    label: 'Costura',
  },
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
  const { data: defaultLeadTimes, isLoading } = useDefaultLeadTimes(shoeCategory);
  const { data: configuredCategories = [] } = useDefaultLeadTimeCategories();
  const upsertDefaultLeadTimes = useUpsertDefaultLeadTimes();
  const categoryOptions = useMemo(
    () => Array.from(new Set([...SHOE_CATEGORIES, ...configuredCategories])).sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [configuredCategories],
  );

  useEffect(() => {
    setCapacities(valuesFromRow(defaultLeadTimes));
  }, [defaultLeadTimes, shoeCategory]);

  const updateCapacity = (field: DefaultLeadTimeCapacityField, value: number) => {
    setCapacities((current) => ({ ...current, [field]: value }));
  };

  const handleSave = () => {
    upsertDefaultLeadTimes.mutate({ shoe_category: shoeCategory, ...capacities });
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
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <CardTitle>Categoria do calçado</CardTitle>
            <CardDescription>Use a mesma taxonomia cadastrada nas Fichas Técnicas.</CardDescription>
          </div>
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
              <div className="flex justify-end border-t pt-4">
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
    </div>
  );
}
