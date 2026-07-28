import { useState, useMemo, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import { Button } from '@/components/ui/button';
 import { Panel } from '@/components/ui/panel';
 import { EmptyState } from '@/components/ui/empty-state';
 import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
 import { Truck, Package, Cube as Box, Plus, Calculator, PencilSimple as Pencil, Trash as Trash2, Buildings as Building2, MagnifyingGlass as Search, MapPin, TrendUp as TrendingUp, NavigationArrow as Navigation } from '@phosphor-icons/react';
import { OrderTransportCalculator } from '@/components/transport/OrderTransportCalculator';
import { RouteOptimizerPanel } from '@/components/logistics/RouteOptimizerPanel';
import { RoutePlanner } from '@/components/logistics/RoutePlanner';
import PackagingManagementPage from './PackagingManagement';
 import { useBaus, useAddBau, useDeleteBau, useBoxTypes, useAddBoxType, useDeleteBoxType, useItemTypes, useAddItemType, useDeleteItemType, useTransportCompanies, useAddTransportCompany, useUpdateTransportCompany, useDeleteTransportCompany, useTransportCompanyRates, useUpsertTransportCompanyRates } from '@/hooks/useTransport';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { calculatePacking } from '@/lib/packingCalculator';
 import type { BoxType, TransportCompany, PackingItem, PackingSummary } from '@/types/transport';
import { BRAZILIAN_STATES } from '@/types/transport';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { searchMatchesAllTerms } from '@/lib/searchUtils';
import { SearchInput } from '@/components/ui/search-input';
import { useCan } from '@/hooks/useAccessControl';

type PermissionGate = ReturnType<typeof useCan>;

export default function Transport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'capacity';
  const perm = useCan('/transporte');

  const handleTabChange = (value: string) => {
    setSearchParams(value === 'capacity' ? {} : { tab: value }, { replace: true });
  };

  return (
    
      <div className="space-y-5 page-enter">
        <EditorialPageHeader
          sectionLabel="LOGÍSTICA · TRANSPORTE"
          title="Logística e Transporte"
          description="Gestão de baús, embalagens e transportadoras"
        />

        <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-4">
          <TabsList>
            <TabsTrigger value="capacity" className="gap-2">
              <Box className="h-4 w-4" />
              Capacidade do Baú
            </TabsTrigger>
            <TabsTrigger value="packaging" className="gap-2">
              <Package className="h-4 w-4" />
              Embalagens
            </TabsTrigger>
            <TabsTrigger value="carriers" className="gap-2">
              <Building2 className="h-4 w-4" />
              Transportadoras
            </TabsTrigger>
            <TabsTrigger value="simulator" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              Simulador de Pedido
            </TabsTrigger>
            <TabsTrigger value="routes" className="gap-2">
              <Navigation className="h-4 w-4" />
              Rota de Entrega
            </TabsTrigger>
            <TabsTrigger value="route-planner" className="gap-2">
              <MapPin className="h-4 w-4" />
              Roteirização
            </TabsTrigger>
          </TabsList>

          <TabsContent value="capacity">
            <CapacityTab perm={perm} />
          </TabsContent>

          <TabsContent value="packaging">
            <PackagingManagementPage embedded />
          </TabsContent>

          <TabsContent value="carriers">
            <CarriersTab perm={perm} />
          </TabsContent>

          <TabsContent value="simulator">
            <SimulatorTab />
          </TabsContent>

          <TabsContent value="routes">
            <RouteOptimizerPanel />
          </TabsContent>

          <TabsContent value="route-planner">
            <RoutePlanner />
          </TabsContent>
        </Tabs>
      </div>
    
  );
}

// ============= CAPACITY TAB =============

function CapacityTab({ perm }: { perm: PermissionGate }) {
  const { data: baus = [] } = useBaus();
  const { data: boxTypes = [] } = useBoxTypes();
  const { data: itemTypes = [] } = useItemTypes();
  const addBau = useAddBau();
  const deleteBau = useDeleteBau();
  const addBoxType = useAddBoxType();
  const deleteBoxType = useDeleteBoxType();
  const addItemType = useAddItemType();
  const deleteItemType = useDeleteItemType();

   const [selectedBauId, setSelectedBauId] = useState<string>('');
   const [selectedItems, setSelectedItems] = useState<PackingItem[]>([]);
   const [packingResult, setPackingResult] = useState<PackingSummary | null>(null);
   const [efficiency, setEfficiency] = useState(88);

  // Dialog states
  const [bauDialog, setBauDialog] = useState(false);
  const [boxDialog, setBoxDialog] = useState(false);
  const [itemDialog, setItemDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ type: 'bau' | 'box' | 'item'; id: string; name: string } | null>(null);

  // Form states
  const [bauForm, setBauForm] = useState({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 });
  const [boxForm, setBoxForm] = useState({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0, empilhamento_maximo: 0 });
  const [itemForm, setItemForm] = useState({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 });

  const selectedBau = baus.find(b => b.id === selectedBauId);

  const handleAddItemToCalculation = (type: 'box' | 'item', id: string) => {
    const source = type === 'box' ? boxTypes : itemTypes;
    const item = source.find(i => i.id === id);
    if (!item) return;

    const packingItem: PackingItem = {
      id: `${type}-${id}-${Date.now()}`,
      type,
      nome: item.nome,
      L: item.comprimento_cm || 0,
      W: item.largura_cm || 0,
      H: item.altura_cm || 0,
      maxStack: type === 'box' ? (item as BoxType).empilhamento_maximo : undefined,
    };
    setSelectedItems(prev => [...prev, packingItem]);
    setPackingResult(null);
  };

  const handleRemoveItem = (itemId: string) => {
    setSelectedItems(prev => prev.filter(i => i.id !== itemId));
    setPackingResult(null);
  };

   const handleCalculate = () => {
     if (!selectedBau || selectedItems.length === 0) return;
     const result = calculatePacking(selectedBau, selectedItems, efficiency / 100);
     setPackingResult(result);
   };

  // Fechar/resetar só no sucesso — se a mutation falhar, o dialog continua
  // aberto com o que o usuário digitou.
  const handleSaveBau = () => {
    if (!perm.canCreate || !bauForm.nome.trim()) return;
    addBau.mutate(bauForm, {
      onSuccess: () => {
        setBauDialog(false);
        setBauForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 });
      },
    });
  };

  const handleSaveBox = () => {
    if (!perm.canCreate || !boxForm.nome.trim()) return;
    addBoxType.mutate(boxForm, {
      onSuccess: () => {
        setBoxDialog(false);
        setBoxForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0, empilhamento_maximo: 0 });
      },
    });
  };

  const handleSaveItem = () => {
    if (!perm.canCreate || !itemForm.nome.trim()) return;
    addItemType.mutate(itemForm, {
      onSuccess: () => {
        setItemDialog(false);
        setItemForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 });
      },
    });
  };

  const handleConfirmDelete = () => {
    if (!perm.canDelete || !deleteDialog) return;
    if (deleteDialog.type === 'bau') deleteBau.mutate(deleteDialog.id);
    else if (deleteDialog.type === 'box') deleteBoxType.mutate(deleteDialog.id);
    else deleteItemType.mutate(deleteDialog.id);
    setDeleteDialog(null);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Left Column - Configuration */}
      <div className="space-y-4">
        {/* Baú Selection */}
        <Panel
          eyebrow="LOGÍSTICA · CAPACIDADE"
          title="Baú do Veículo"
        >
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select value={selectedBauId} onValueChange={setSelectedBauId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecione um baú" />
                </SelectTrigger>
                <SelectContent>
                  {baus.map(b => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.nome} ({(b.comprimento_cm / 100).toFixed(2)}m × {(b.largura_cm / 100).toFixed(2)}m × {(b.altura_cm / 100).toFixed(2)}m)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {perm.canCreate && (
                <Button variant="outline" size="icon" onClick={() => setBauDialog(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedBau && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>L: {(selectedBau.comprimento_cm / 100).toFixed(2)} m</span>
                <span>×</span>
                <span>W: {(selectedBau.largura_cm / 100).toFixed(2)} m</span>
                <span>×</span>
                <span>H: {(selectedBau.altura_cm / 100).toFixed(2)} m</span>
                <Badge variant="secondary">
                  {((selectedBau.comprimento_cm * selectedBau.largura_cm * selectedBau.altura_cm) / 1_000_000).toFixed(2)} m³
                </Badge>
              </div>
            )}
          </div>
        </Panel>

        {/* Box Types */}
        <Panel
          eyebrow="LOGÍSTICA · CAPACIDADE"
          title="Tipos de Caixa"
          actions={perm.canCreate ? (
            <Button variant="outline" size="sm" onClick={() => setBoxDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Nova
            </Button>
          ) : undefined}
        >
            <ScrollArea className="h-[200px]">
              <div className="space-y-2">
                {boxTypes.map(box => (
                  <div key={box.id} className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{box.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {box.comprimento_cm}×{box.largura_cm}×{box.altura_cm} cm
                        {box.empilhamento_maximo && ` | Max: ${box.empilhamento_maximo} níveis`}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => handleAddItemToCalculation('box', box.id)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      {perm.canDelete && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDialog({ type: 'box', id: box.id, name: box.nome })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {boxTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum tipo de caixa cadastrado</p>
                )}
              </div>
            </ScrollArea>
        </Panel>

        {/* Item Types */}
        <Panel
          eyebrow="LOGÍSTICA · CAPACIDADE"
          title="Itens Individuais"
          actions={perm.canCreate ? (
            <Button variant="outline" size="sm" onClick={() => setItemDialog(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Novo
            </Button>
          ) : undefined}
        >
            <ScrollArea className="h-[150px]">
              <div className="space-y-2">
                {itemTypes.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-2 rounded-md border hover:bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">{item.nome}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.comprimento_cm}×{item.largura_cm}×{item.altura_cm} cm
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => handleAddItemToCalculation('item', item.id)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                      {perm.canDelete && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDialog({ type: 'item', id: item.id, name: item.nome })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {itemTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum item cadastrado</p>
                )}
              </div>
            </ScrollArea>
        </Panel>
      </div>

      {/* Right Column - Calculation */}
      <div className="space-y-4">
        {/* Selected Items for Calculation */}
        <Panel
          eyebrow="LOGÍSTICA · CAPACIDADE"
          title="Itens para Cálculo"
          actions={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 mr-2 px-3 py-1 bg-muted rounded-md">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Eficiência: {efficiency}%</span>
                <Slider
                  value={[efficiency]}
                  onValueChange={([v]) => setEfficiency(v)}
                  max={100}
                  min={50}
                  step={1}
                  className="w-24"
                />
              </div>
              <Button size="sm" onClick={handleCalculate} disabled={!selectedBau || selectedItems.length === 0}>
                Calcular
              </Button>
            </div>
          }
        >
            {selectedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Adicione itens clicando no botão + ao lado de cada tipo
              </p>
            ) : (
              <div className="space-y-2">
                {selectedItems.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                    <div className="flex items-center gap-2">
                      <Badge variant={item.type === 'box' ? 'default' : 'secondary'}>
                        {item.type === 'box' ? 'Caixa' : 'Item'}
                      </Badge>
                      <span className="text-sm">{item.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        ({item.L}×{item.W}×{item.H} cm)
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleRemoveItem(item.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
        </Panel>

        {/* Results */}
        {packingResult && (
          <Panel
            eyebrow="LOGÍSTICA · CAPACIDADE"
            title="Resultado do Cálculo"
            bodyClassName="space-y-4"
          >
              {/* Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-md bg-muted">
                  <p className="text-xs text-muted-foreground">Volume do Baú</p>
                  <p className="text-lg font-bold">{packingResult.bau_volume_m3} m³</p>
                </div>
                <div className="p-3 rounded-md bg-muted">
                  <p className="text-xs text-muted-foreground">Volume Ocupado</p>
                  <p className="text-lg font-bold">{packingResult.total_volume_m3} m³</p>
                </div>
                <div className="p-3 rounded-md bg-primary/10">
                  <p className="text-xs text-muted-foreground">Taxa de Ocupação</p>
                  <p className="display text-xl tabular-nums text-primary">{packingResult.ocupacao_total_pct}%</p>
                </div>
                <div className="p-3 rounded-md bg-muted">
                  <p className="text-xs text-muted-foreground">Volume Residual</p>
                  <p className="text-lg font-bold">{packingResult.residual_volume_m3} m³</p>
                </div>
              </div>

              {/* Detailed Results */}
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Arranjo</TableHead>
                    <TableHead className="text-center">Qtd Max</TableHead>
                    <TableHead className="text-right">Ocupação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packingResult.results.map(result => (
                    <TableRow key={result.id} className={!result.fits ? 'bg-destructive/10' : ''}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={result.type === 'box' ? 'default' : 'secondary'} className="text-xs">
                            {result.type === 'box' ? 'CX' : 'IT'}
                          </Badge>
                          <span className="text-sm">{result.nome}</span>
                        </div>
                        {result.warning && (
                          <p className="text-xs text-destructive mt-1">{result.warning}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-center font-mono text-sm">
                        {result.fits ? `${result.nL}×${result.nW}×${result.nH}` : '-'}
                      </TableCell>
                      <TableCell className="text-center font-bold">
                        {result.total}
                      </TableCell>
                      <TableCell className="text-right">
                        {result.ocupacao_pct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
          </Panel>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={bauDialog} onOpenChange={(open) => { setBauDialog(open); if (!open) setBauForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Baú</DialogTitle>
            <DialogDescription className="sr-only">Nome e dimensões internas do baú do veículo.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={bauForm.nome} onChange={e => setBauForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Fiorino Padrão" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Comprimento (m)</Label>
                <Input type="number" step="0.01" value={(bauForm.comprimento_cm / 100) || ''} onChange={e => setBauForm(f => ({ ...f, comprimento_cm: Math.round(Number(e.target.value) * 100) }))} />
              </div>
              <div>
                <Label>Largura (m)</Label>
                <Input type="number" step="0.01" value={(bauForm.largura_cm / 100) || ''} onChange={e => setBauForm(f => ({ ...f, largura_cm: Math.round(Number(e.target.value) * 100) }))} />
              </div>
              <div>
                <Label>Altura (m)</Label>
                <Input type="number" step="0.01" value={(bauForm.altura_cm / 100) || ''} onChange={e => setBauForm(f => ({ ...f, altura_cm: Math.round(Number(e.target.value) * 100) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBauDialog(false)}>Cancelar</Button>
            {perm.canCreate && <Button onClick={handleSaveBau} disabled={addBau.isPending}>{addBau.isPending ? 'Salvando…' : 'Salvar'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={boxDialog} onOpenChange={(open) => { setBoxDialog(open); if (!open) setBoxForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0, empilhamento_maximo: 0 }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Tipo de Caixa</DialogTitle>
            <DialogDescription className="sr-only">Nome, dimensões e empilhamento máximo da caixa.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={boxForm.nome} onChange={e => setBoxForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Caixa Corrugada P" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Comprimento (cm)</Label>
                <Input type="number" value={boxForm.comprimento_cm || ''} onChange={e => setBoxForm(f => ({ ...f, comprimento_cm: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Largura (cm)</Label>
                <Input type="number" value={boxForm.largura_cm || ''} onChange={e => setBoxForm(f => ({ ...f, largura_cm: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Altura (cm)</Label>
                <Input type="number" value={boxForm.altura_cm || ''} onChange={e => setBoxForm(f => ({ ...f, altura_cm: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <Label>Empilhamento Máximo (níveis)</Label>
              <Input type="number" value={boxForm.empilhamento_maximo || ''} onChange={e => setBoxForm(f => ({ ...f, empilhamento_maximo: Number(e.target.value) }))} placeholder="Deixe vazio para sem limite" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBoxDialog(false)}>Cancelar</Button>
            {perm.canCreate && <Button onClick={handleSaveBox} disabled={addBoxType.isPending}>{addBoxType.isPending ? 'Salvando…' : 'Salvar'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itemDialog} onOpenChange={(open) => { setItemDialog(open); if (!open) setItemForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 }); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Item Individual</DialogTitle>
            <DialogDescription className="sr-only">Nome e dimensões do item avulso.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={itemForm.nome} onChange={e => setItemForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Produto Avulso" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label>Comprimento (cm)</Label>
                <Input type="number" value={itemForm.comprimento_cm || ''} onChange={e => setItemForm(f => ({ ...f, comprimento_cm: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Largura (cm)</Label>
                <Input type="number" value={itemForm.largura_cm || ''} onChange={e => setItemForm(f => ({ ...f, largura_cm: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Altura (cm)</Label>
                <Input type="number" value={itemForm.altura_cm || ''} onChange={e => setItemForm(f => ({ ...f, altura_cm: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialog(false)}>Cancelar</Button>
            {perm.canCreate && <Button onClick={handleSaveItem} disabled={addItemType.isPending}>{addItemType.isPending ? 'Salvando…' : 'Salvar'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteDialog} onOpenChange={(o) => { if (!o) setDeleteDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja excluir "{deleteDialog?.name}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {perm.canDelete && (
              <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============= CARRIERS TAB =============

function CarriersTab({ perm }: { perm: PermissionGate }) {
  const { data: companies = [] } = useTransportCompanies();
  const addCompany = useAddTransportCompany();
  const updateCompany = useUpdateTransportCompany();
  const deleteCompany = useDeleteTransportCompany();

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ratesDialogOpen, setRatesDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<TransportCompany | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);

  const [form, setForm] = useState<{
    nome: string;
    tipo_pessoa: 'FISICA' | 'JURIDICA';
    documento: string;
    telefone: string;
    email: string;
    responsavel: string;
    condicoes_pagamento: string;
    seguro: boolean;
    observacoes: string;
    endereco: { rua?: string; numero?: string; bairro?: string; cidade?: string; estado?: string; cep?: string };
  }>({
    nome: '',
    tipo_pessoa: 'JURIDICA',
    documento: '',
    telefone: '',
    email: '',
    responsavel: '',
    condicoes_pagamento: '',
    seguro: false,
    observacoes: '',
    endereco: {},
  });

  const filteredCompanies = useMemo(() => {
    return companies.filter(c => searchMatchesAllTerms(
      search,
      c.nome, c.documento, c.email, c.telefone, c.responsavel,
      c.endereco?.cidade, c.endereco?.estado,
    ));
  }, [companies, search]);

  const openNewDialog = () => {
    if (!perm.canCreate) return;
    setEditingCompany(null);
    setForm({
      nome: '',
      tipo_pessoa: 'JURIDICA',
      documento: '',
      telefone: '',
      email: '',
      responsavel: '',
      condicoes_pagamento: '',
      seguro: false,
      observacoes: '',
      endereco: { rua: '', numero: '', bairro: '', cidade: '', estado: '', cep: '' },
    });
    setDialogOpen(true);
  };

  const openEditDialog = (company: TransportCompany) => {
    if (!perm.canEdit) return;
    setEditingCompany(company);
    setForm({
      nome: company.nome,
      tipo_pessoa: company.tipo_pessoa,
      documento: company.documento || '',
      telefone: company.telefone || '',
      email: company.email || '',
      responsavel: company.responsavel || '',
      condicoes_pagamento: company.condicoes_pagamento || '',
      seguro: company.seguro || false,
      observacoes: company.observacoes || '',
      endereco: company.endereco || { rua: '', numero: '', bairro: '', cidade: '', estado: '', cep: '' },
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.nome.trim()) return;
    const payload = { ...form };
    // Fecha só no sucesso — falha mantém o dialog aberto com os dados digitados.
    if (editingCompany) {
      if (!perm.canEdit) return;
      updateCompany.mutate({ id: editingCompany.id, data: payload }, { onSuccess: () => setDialogOpen(false) });
    } else {
      if (!perm.canCreate) return;
      addCompany.mutate(payload, { onSuccess: () => setDialogOpen(false) });
    }
  };

  const handleConfirmDelete = () => {
    if (!perm.canDelete || !deleteDialog) return;
    deleteCompany.mutate(deleteDialog.id);
    setDeleteDialog(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nome, CNPJ/CPF, e-mail…"
          resultCount={filteredCompanies.length}
          totalCount={companies.length}
          className="flex-1 max-w-sm"
        />
        {perm.canCreate && (
          <Button onClick={openNewDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Nova Transportadora
          </Button>
        )}
      </div>

      <Panel flush>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ/CPF</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Cidade/UF</TableHead>
              <TableHead className="w-[150px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCompanies.map(company => (
              <TableRow key={company.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{company.nome}</p>
                    {company.responsavel && <p className="text-xs text-muted-foreground">{company.responsavel}</p>}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm">{company.documento || '-'}</TableCell>
                <TableCell>
                  <div className="text-sm">
                    {company.telefone && <p>{company.telefone}</p>}
                    {company.email && <p className="text-muted-foreground">{company.email}</p>}
                  </div>
                </TableCell>
                <TableCell>
                  {company.endereco?.cidade && company.endereco?.estado
                    ? `${company.endereco.cidade}/${company.endereco.estado}`
                    : '-'}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {perm.canEdit && (
                      <>
                        <Button size="sm" variant="ghost" aria-label={`Tarifas por estado de ${company.nome}`} onClick={() => { setSelectedCompanyId(company.id); setRatesDialogOpen(true); }}>
                          <MapPin className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Editar ${company.nome}`} onClick={() => openEditDialog(company)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    {perm.canDelete && (
                      <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Excluir ${company.nome}`} onClick={() => setDeleteDialog({ id: company.id, name: company.nome })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredCompanies.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="p-0">
                  <EmptyState
                    icon={search ? Search : Building2}
                    title={search ? `Nenhum resultado para "${search}"` : 'Nenhuma transportadora cadastrada'}
                    description={search ? 'Ajuste a busca ou cadastre uma nova transportadora.' : 'Cadastre a primeira transportadora.'}
                    action={search ? <Button variant="outline" size="sm" onClick={() => setSearch('')}>Limpar busca</Button> : undefined}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Panel>

      {/* Company Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingCompany(null); setForm({ nome: '', tipo_pessoa: 'JURIDICA', documento: '', telefone: '', email: '', responsavel: '', condicoes_pagamento: '', seguro: false, observacoes: '', endereco: { rua: '', numero: '', bairro: '', cidade: '', estado: '', cep: '' } }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Editar Transportadora' : 'Nova Transportadora'}</DialogTitle>
            <DialogDescription>Dados cadastrais, endereço e condições de pagamento.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Nome *</Label>
                <Input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.tipo_pessoa} onValueChange={v => setForm(f => ({ ...f, tipo_pessoa: v as 'FISICA' | 'JURIDICA' }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="JURIDICA">Pessoa Jurídica</SelectItem>
                    <SelectItem value="FISICA">Pessoa Física</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{form.tipo_pessoa === 'JURIDICA' ? 'CNPJ' : 'CPF'}</Label>
                <Input value={form.documento} onChange={e => setForm(f => ({ ...f, documento: e.target.value }))} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} />
              </div>
              <div>
                <Label>E-mail</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
              <div>
                <Label>Responsável</Label>
                <Input value={form.responsavel} onChange={e => setForm(f => ({ ...f, responsavel: e.target.value }))} />
              </div>
              <div>
                <Label>Condições de Pagamento</Label>
                <Input value={form.condicoes_pagamento} onChange={e => setForm(f => ({ ...f, condicoes_pagamento: e.target.value }))} placeholder="Ex: 30/60 DDL" />
              </div>
            </div>

            <div className="border-t pt-4">
              <Label className="text-base font-semibold">Endereço</Label>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="col-span-2">
                  <Label>Rua</Label>
                  <Input value={form.endereco.rua} onChange={e => setForm(f => ({ ...f, endereco: { ...f.endereco, rua: e.target.value } }))} />
                </div>
                <div>
                  <Label>Número</Label>
                  <Input value={form.endereco.numero} onChange={e => setForm(f => ({ ...f, endereco: { ...f.endereco, numero: e.target.value } }))} />
                </div>
                <div>
                  <Label>Bairro</Label>
                  <Input value={form.endereco.bairro} onChange={e => setForm(f => ({ ...f, endereco: { ...f.endereco, bairro: e.target.value } }))} />
                </div>
                <div>
                  <Label>Cidade</Label>
                  <Input value={form.endereco.cidade} onChange={e => setForm(f => ({ ...f, endereco: { ...f.endereco, cidade: e.target.value } }))} />
                </div>
                <div>
                  <Label>Estado</Label>
                  <Select value={form.endereco.estado} onValueChange={v => setForm(f => ({ ...f, endereco: { ...f.endereco, estado: v } }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {BRAZILIAN_STATES.map(s => (
                        <SelectItem key={s.uf} value={s.uf}>{s.uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>CEP</Label>
                  <Input value={form.endereco.cep} onChange={e => setForm(f => ({ ...f, endereco: { ...f.endereco, cep: e.target.value } }))} />
                </div>
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={addCompany.isPending || updateCompany.isPending}>
              {(addCompany.isPending || updateCompany.isPending) ? 'Salvando…' : editingCompany ? 'Salvar' : 'Cadastrar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rates Dialog */}
      {selectedCompanyId && (
        <RatesDialog companyId={selectedCompanyId} open={ratesDialogOpen} onOpenChange={setRatesDialogOpen} perm={perm} />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDialog} onOpenChange={(o) => { if (!o) setDeleteDialog(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir transportadora?</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja excluir "{deleteDialog?.name}"? Esta ação excluirá também todas as tarifas associadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {perm.canDelete && (
              <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Excluir
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============= RATES DIALOG =============

function RatesDialog({ companyId, open, onOpenChange, perm }: { companyId: string; open: boolean; onOpenChange: (o: boolean) => void; perm: PermissionGate }) {
  const { data: rates = [], isLoading: ratesLoading } = useTransportCompanyRates(companyId);
  const upsertRates = useUpsertTransportCompanyRates();
  const { data: companies = [] } = useTransportCompanies();

  const company = companies.find(c => c.id === companyId);

  const [localRates, setLocalRates] = useState<Record<string, { valor_capital: number; valor_interior: number; tipo_valor: 'POR_KG' | 'POR_M3' | 'FIXO'; minimo: number }>>({});

  // Inicializa o estado local 1× por abertura (após o primeiro load), em vez do
  // antigo useMemo-com-setState que re-resetava localRates a CADA refetch de
  // 'rates' — apagando edições não salvas.
  const initializedRef = useRef(false);
  useEffect(() => {
    if (!open) { initializedRef.current = false; return; }
    if (initializedRef.current || ratesLoading) return;
    const initial: typeof localRates = {};
    for (const rate of rates) {
      initial[rate.estado] = {
        valor_capital: rate.valor_capital,
        valor_interior: rate.valor_interior,
        tipo_valor: rate.tipo_valor,
        minimo: rate.minimo || 0,
      };
    }
    setLocalRates(initial);
    initializedRef.current = true;
  }, [open, rates, ratesLoading]);

  const handleSave = () => {
    if (!perm.canEdit) return;
    const toSave = Object.entries(localRates)
      .filter(([, v]) => v.valor_capital > 0 || v.valor_interior > 0)
      .map(([estado, v]) => ({
        transport_company_id: companyId,
        estado,
        ...v,
      }));
    upsertRates.mutate(toSave as any, { onSuccess: () => onOpenChange(false) });
  };

  const updateRate = (estado: string, field: string, value: any) => {
    if (!perm.canEdit) return;
    setLocalRates(prev => ({
      ...prev,
      [estado]: {
        valor_capital: prev[estado]?.valor_capital || 0,
        valor_interior: prev[estado]?.valor_interior || 0,
        tipo_valor: prev[estado]?.tipo_valor || 'FIXO',
        minimo: prev[estado]?.minimo || 0,
        [field]: value,
      },
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Tarifas por Estado - {company?.nome}</DialogTitle>
          <DialogDescription>Valores de frete por estado (capital/interior) desta transportadora.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[60vh]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estado</TableHead>
                <TableHead>Valor Capital (R$)</TableHead>
                <TableHead>Valor Interior (R$)</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Mínimo (R$)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BRAZILIAN_STATES.map(state => (
                <TableRow key={state.uf}>
                  <TableCell className="font-medium">{state.uf} - {state.name}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      value={localRates[state.uf]?.valor_capital || ''}
                      onChange={e => updateRate(state.uf, 'valor_capital', Number(e.target.value))}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      value={localRates[state.uf]?.valor_interior || ''}
                      onChange={e => updateRate(state.uf, 'valor_interior', Number(e.target.value))}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={localRates[state.uf]?.tipo_valor || 'FIXO'}
                      onValueChange={v => updateRate(state.uf, 'tipo_valor', v)}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="FIXO">Fixo</SelectItem>
                        <SelectItem value="POR_KG">Por KG</SelectItem>
                        <SelectItem value="POR_M3">Por M³</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      className="w-24"
                      value={localRates[state.uf]?.minimo || ''}
                      onChange={e => updateRate(state.uf, 'minimo', Number(e.target.value))}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          {perm.canEdit && (
            <Button onClick={handleSave} disabled={upsertRates.isPending}>
              {upsertRates.isPending ? 'Salvando…' : 'Salvar Tarifas'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============= SIMULATOR TAB =============

function SimulatorTab() {
  const [quantity, setQuantity] = useState(500);
  const [category, setCategory] = useState('ADULTO_SALTO');
  const [avgWeight, setAvgWeight] = useState(0.45);
  const [selectedSoleId, setSelectedSoleId] = useState<string>('');
  const [selectedClientId, setSelectedClientId] = useState<string>('');

  // Fetch Solados (products with category/group containing 'solado')
  const { data: soles = [] } = useQuery({
    queryKey: ['products-soles'],
    queryFn: async () => {
      const { data, error } = await supabase
         .from('products')
         .select('id, name, sku, box_type_id, current_stock, pairs_per_package, category, technical_name')
         .or('category.ilike.%solado%,technical_name.ilike.%solado%')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data;
    },
  });

  // Fetch Clients
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-simulator'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('id, nome_fantasia, cidade, estado')
        .eq('active', true)
        .order('nome_fantasia');
      if (error) throw error;
      return data;
    },
  });

  const selectedSole = soles.find(s => s.id === selectedSoleId);
  const selectedClient = clients.find(c => c.id === selectedClientId);

  const { data: boxTypes = [] } = useBoxTypes();
  const selectedBox = selectedSole?.box_type_id ? boxTypes.find(bt => bt.id === selectedSole.box_type_id) : null;

  return (
    <div className="space-y-4">
      <Panel
        eyebrow="LOGÍSTICA · SIMULADOR"
        title="Simulador de Transporte"
        bodyClassName="space-y-4"
      >
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quantidade de Pares</Label>
              <Input
                type="number"
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                min={1}
              />
            </div>
            <div className="space-y-2">
              <Label>Tipo de Solado</Label>
              <Select value={selectedSoleId} onValueChange={setSelectedSoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o solado" />
                </SelectTrigger>
                <SelectContent>
                  {soles.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name} ({s.sku})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedBox && (
                <p className="text-xs text-muted-foreground mt-1">
                  Caixa: {selectedBox.nome} ({selectedBox.comprimento_cm}x{selectedBox.largura_cm}x{selectedBox.altura_cm}cm)
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Peso Médio por Par (kg)</Label>
              <Input
                type="number"
                step="0.01"
                value={avgWeight}
                onChange={e => setAvgWeight(Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label>Categoria de Referência</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADULTO_SALTO">Adulto Salto</SelectItem>
                  <SelectItem value="ADULTO_RASTEIRA">Adulto Rasteira</SelectItem>
                  <SelectItem value="INFANTIL_GRADE_A">Infantil Grade A</SelectItem>
                  <SelectItem value="INFANTIL_GRADE_B">Infantil Grade B</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cliente / Destino</Label>
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome_fantasia} ({c.cidade}/{c.estado})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
      </Panel>

      <OrderTransportCalculator
        orderQuantity={quantity}
        orderWeight={quantity * avgWeight}
        productCategory={category}
        orderNumber="Simulação"
         individualBoxDims={selectedBox && (selectedSole?.pairs_per_package || 1) <= 1 ? {
           L: selectedBox.comprimento_cm,
           W: selectedBox.largura_cm,
           H: selectedBox.altura_cm,
           name: selectedBox.nome
         } : undefined}
         masterBoxDims={selectedBox && (selectedSole?.pairs_per_package || 0) > 1 ? {
           L: selectedBox.comprimento_cm,
           W: selectedBox.largura_cm,
           H: selectedBox.altura_cm,
           name: selectedBox.nome,
           pairsPerMaster: selectedSole?.pairs_per_package
         } : undefined}
        destinationCity={selectedClient?.cidade}
        destinationState={selectedClient?.estado}
      />
    </div>
  );
}
