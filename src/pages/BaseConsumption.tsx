import { useMemo, useState } from 'react';
import { MagnifyingGlass as Search, Stack as Layers, Footprints, Info, Wrench, Image as ImageIcon, Ruler, CurrencyDollar as DollarSign, Truck, Package, Gear as Settings2, Cube as Box } from '@phosphor-icons/react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useProducts } from '@/hooks/useProducts';
import { SoleStandardItemsPanel } from '@/components/technical-sheets/SoleStandardItemsPanel';
import { SoleTechnicalDetails } from '@/components/technical-sheets/SoleTechnicalDetails';
import { SoleSilkPanel } from '@/components/technical-sheets/SoleSilkPanel';
import { SilkGlobalPanel } from '@/components/technical-sheets/SilkGlobalPanel';
import { SoleTechnicalEditDialog } from '@/components/inventory/SoleTechnicalEditDialog';
import { SoleConsumptionExportButton } from '@/components/technical-sheets/SoleConsumptionExportButton';
import { SoleConsumptionHistoryDrawer, HistoryButton } from '@/components/technical-sheets/SoleConsumptionHistoryDrawer';
import { PackagingTab } from '@/components/technical-sheets/PackagingTab';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { productGroupingKey, normalizeProductName } from '@/lib/productNameNormalization';
import { normalizeForSearch } from '@/lib/searchUtils';

export default function BaseConsumption() {
  const { data: products = [], isLoading } = useProducts();
  const [search, setSearch] = useState('');
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('consumo');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [techEditOpen, setTechEditOpen] = useState(false);
  const [silkGlobalOpen, setSilkGlobalOpen] = useState(false);

  type SoleModel = {
    key: string;
    displayName: string;
    representative: any;
    variantCount: number;
    variantColors: string[];
  };

  const soleModels = useMemo<SoleModel[]>(() => {
    const allSoles = (products as any[]).filter((p) => {
      const cat = (p?.category || '').toLowerCase();
      return cat.includes('solado') || cat === 'sola';
    });

    const buckets = new Map<string, any[]>();
    for (const p of allSoles) {
      const key = productGroupingKey(p.name || '');
      const arr = buckets.get(key) ?? [];
      arr.push(p);
      buckets.set(key, arr);
    }

    const models: SoleModel[] = [];
    buckets.forEach((variants, key) => {
      const sorted = [...variants].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const rep = sorted[0];
      const colors = Array.from(
        new Set(variants.map((v) => (v.color || '').trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const displayName = stripColorSuffix(rep.name || '');
      models.push({ key, displayName, representative: rep, variantCount: variants.length, variantColors: colors });
    });

    const term = normalizeForSearch(search.trim());
    const filtered = term
      ? models.filter((m) =>
          [m.displayName, ...(m.variantColors || []), m.representative?.sku]
            .filter(Boolean)
            .some((v: string) => normalizeForSearch(v).includes(term)),
        )
      : models;

    return filtered.sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR'));
  }, [products, search]);

  const selectedModel = useMemo(
    () => soleModels.find((m) => m.key === selectedModelKey) || null,
    [soleModels, selectedModelKey],
  );

  const selectedSoleId = selectedModel?.representative?.id ?? null;
  const selectedProduct = selectedModel?.representative ?? null;

  const handleModelSelect = (key: string) => {
    setSelectedModelKey(key);
    setActiveTab('consumo');
  };

  return (
    <div className="space-y-5 page-enter">
      <EditorialPageHeader
        sectionLabel="ENGENHARIA · CONSUMO BASE"
        title="Gestão de Solados"
        description="Configure em um só lugar o consumo base, especificações por numeração, artes de silk e dados técnicos de cada modelo de solado."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setSilkGlobalOpen(true)}
            >
              <Layers className="h-3.5 w-3.5" />
              Silk Global
            </Button>
            <Badge variant="outline" className="gap-1.5 text-xs">
              <Info className="h-3 w-3" />
              {soleModels.length} modelo{soleModels.length === 1 ? '' : 's'} de solado
            </Badge>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[300px,1fr] gap-4">
        {/* Sidebar: lista de modelos */}
        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Modelos de solado
            </CardTitle>
            <CardDescription className="text-xs">
              Selecione um modelo para configurar.
            </CardDescription>
            <div className="relative pt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 mt-1 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar modelo ou SKU…"
                className="h-8 pl-7 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[60vh] lg:h-[calc(100vh-280px)]">
              <div className="px-2 pb-2 space-y-1">
                {isLoading ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">Carregando…</div>
                ) : soleModels.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    {search ? 'Nenhum modelo corresponde à busca.' : 'Nenhum modelo de solado cadastrado.'}
                  </div>
                ) : (
                  soleModels.map((model) => {
                    const active = model.key === selectedModelKey;
                    return (
                      <button
                        key={model.key}
                        type="button"
                        onClick={() => handleModelSelect(model.key)}
                        className={cn(
                          'w-full text-left rounded-md border px-2.5 py-2 transition-colors',
                          active
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border/60 bg-background hover:bg-muted/40',
                        )}
                      >
                        <div className="text-xs font-semibold truncate">{model.displayName}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <Badge variant="secondary" className="text-xs px-1.5 py-0">
                            {model.variantCount} {model.variantCount === 1 ? 'cor' : 'cores'}
                          </Badge>
                          {model.representative?.sku && (
                            <span className="text-xs text-muted-foreground font-mono truncate">
                              {model.representative.sku}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Painel principal: tabs de configuração */}
        {selectedModel && selectedSoleId ? (
          <div className="space-y-0">
            {/* Header do modelo selecionado */}
            <Card className="rounded-b-none border-b-0">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                      <Footprints className="h-4 w-4 text-primary" />
                      {selectedModel.displayName}
                      <Badge variant="outline" className="text-xs">
                        {selectedModel.variantCount} {selectedModel.variantCount === 1 ? 'variante' : 'variantes'}
                      </Badge>
                    </CardTitle>
                    {selectedModel.variantColors.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {selectedModel.variantColors.map((c) => (
                          <Badge key={c} variant="secondary" className="text-xs px-1.5 py-0">{c}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <SoleConsumptionExportButton
                      soleProductId={selectedSoleId}
                      soleLabel={selectedModel.displayName}
                    />
                    <HistoryButton onClick={() => setHistoryOpen(true)} />
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Abas */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="border border-t-0 rounded-b-lg overflow-hidden">
                <div className="bg-muted/30 border-b px-4 pt-1">
                  <TabsList className="h-9 bg-transparent gap-1">
                    <TabsTrigger value="consumo" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Package className="h-3.5 w-3.5" />Consumo Base
                    </TabsTrigger>
                    <TabsTrigger value="grade" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Ruler className="h-3.5 w-3.5" />Grade & Consumos
                    </TabsTrigger>
                    <TabsTrigger value="silk" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <ImageIcon className="h-3.5 w-3.5" />Silk / Arte
                    </TabsTrigger>
                    <TabsTrigger value="tecnico" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Wrench className="h-3.5 w-3.5" />Técnico
                    </TabsTrigger>
                    <TabsTrigger value="embalagem" className="text-xs gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                      <Box className="h-3.5 w-3.5" />Embalagem
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* Consumo Base */}
                <TabsContent value="consumo" className="m-0 p-4">
                  <p className="text-xs text-muted-foreground mb-4">
                    Consumo de itens padrão (palmilha, colas, forro, etc.) por numeração.
                    Alterações se propagam automaticamente para todas as cores deste modelo.
                  </p>
                  <SoleStandardItemsPanel soleProductId={selectedSoleId} />
                </TabsContent>

                {/* Grade & Consumos por numeração (forro, palmilha, fachete) */}
                <TabsContent value="grade" className="m-0 p-4">
                  <SoleTechnicalDetails
                    key={selectedSoleId}
                    soleId={selectedSoleId}
                    soleName={selectedModel.displayName}
                    onClose={() => setActiveTab('consumo')}
                  />
                </TabsContent>

                {/* Silk / Artes */}
                <TabsContent value="silk" className="m-0 p-4">
                  <p className="text-xs text-muted-foreground mb-4">
                    Artes de silk aplicadas neste solado, com escopo por cliente ou grupo econômico.
                  </p>
                  <SoleSilkPanel
                    key={selectedSoleId}
                    soleProductId={selectedSoleId}
                    soleName={selectedModel.displayName}
                  />
                </TabsContent>

                {/* Dados Técnicos */}
                <TabsContent value="tecnico" className="m-0 p-4">
                  <TechnicalInfoCard
                    product={selectedProduct}
                    onEdit={() => setTechEditOpen(true)}
                  />
                </TabsContent>

                {/* Embalagem */}
                <TabsContent value="embalagem" className="m-0 p-4">
                  <p className="text-xs text-muted-foreground mb-4">
                    Embalagens vinculadas a este solado. As configurações se aplicam a todas as
                    fichas técnicas que utilizam este modelo de solado.
                  </p>
                  <PackagingTab
                    key={selectedModel.representative?.group_id ?? selectedSoleId}
                    soleGroupId={selectedModel.representative?.group_id ?? undefined}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <EmptyState
                icon={Footprints}
                title="Selecione um modelo à esquerda para começar"
                description="Aqui você gerencia consumo, especificações por numeração, artes de silk e dados técnicos."
              />
            </CardContent>
          </Card>
        )}
      </div>

      {selectedModel && selectedSoleId && (
        <SoleConsumptionHistoryDrawer
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          soleProductId={selectedSoleId}
          soleLabel={selectedModel.displayName}
        />
      )}

      <SoleTechnicalEditDialog
        open={techEditOpen}
        onOpenChange={setTechEditOpen}
        product={selectedProduct}
      />

      <Sheet open={silkGlobalOpen} onOpenChange={setSilkGlobalOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Cadastro de Silk por Solado
            </SheetTitle>
            <p className="text-sm text-muted-foreground">
              Gerencie qual silk deve ser utilizada para cada tipo de solado e cliente.
            </p>
          </SheetHeader>
          <SilkGlobalPanel />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ── Card de info técnica (aba Técnico) ─────────────────────────────────── */
function TechnicalInfoCard({ product, onEdit }: { product: any; onEdit: () => void }) {
  if (!product) return null;

  const rows: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = [
    {
      icon: <DollarSign className="h-3.5 w-3.5" />,
      label: 'Custo unitário',
      value: product.unit_price
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(product.unit_price))
        : '—',
    },
    {
      icon: <Package className="h-3.5 w-3.5" />,
      label: 'MOQ (pares)',
      value: product.sole_moq ? String(product.sole_moq) : '—',
    },
    {
      icon: <Truck className="h-3.5 w-3.5" />,
      label: 'Lead time',
      value: product.supplier_lead_time_days ?? product.lead_time_days
        ? `${product.supplier_lead_time_days ?? product.lead_time_days} dias`
        : '—',
    },
    {
      icon: <Ruler className="h-3.5 w-3.5" />,
      label: 'Material',
      value: product.sole_material || '—',
    },
    {
      icon: <Ruler className="h-3.5 w-3.5" />,
      label: 'Altura do salto',
      value: product.heel_height ? `${product.heel_height} cm` : '—',
    },
    {
      icon: <Settings2 className="h-3.5 w-3.5" />,
      label: 'Solado fachetado',
      value: product.is_fachetado ? (
        <Badge className="text-xs bg-amber-500/15 text-amber-700 border-amber-500/30 hover:bg-amber-500/15">Sim</Badge>
      ) : (
        <span className="text-muted-foreground">Não</span>
      ),
    },
    {
      icon: <Settings2 className="h-3.5 w-3.5" />,
      label: 'Item padrão (BOM automático)',
      value: product.is_standard_sole_item ? (
        <Badge className="text-xs" variant="secondary">Ativo</Badge>
      ) : (
        <span className="text-muted-foreground">Não</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border divide-y">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <span className="text-muted-foreground flex-shrink-0">{row.icon}</span>
            <span className="text-xs text-muted-foreground w-40 flex-shrink-0">{row.label}</span>
            <span className="text-xs font-medium">{row.value}</span>
          </div>
        ))}
      </div>
      {product.sole_technical_notes && (
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notas técnicas</p>
          <p className="text-xs">{product.sole_technical_notes}</p>
        </div>
      )}
      <Separator />
      <div className="flex justify-end">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
          <Wrench className="h-3.5 w-3.5" />
          Editar dados técnicos
        </Button>
      </div>
    </div>
  );
}

function stripColorSuffix(name: string): string {
  const normalized = normalizeProductName(name);
  const original = (name || '').trim();
  const lowerOriginal = original
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (lowerOriginal === normalized) return original;
  if (lowerOriginal.startsWith(normalized)) {
    return original.slice(0, normalized.length).replace(/[\s\-/–—]+$/, '').trim();
  }
  return original;
}
