import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { Button } from '@/components/ui/button';
 import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
 import { Truck, Package, Box, Plus, Calculator, Pencil, Trash2, Building2, Search, MapPin, TrendingUp, Navigation } from 'lucide-react';
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

export default function Transport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'capacity';

  const handleTabChange = (value: string) => {
    setSearchParams(value === 'capacity' ? {} : { tab: value }, { replace: true });
  };

  return (
    
      <div className="space-y-5 page-enter">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="h-6 w-6 text-primary" />
            Logística e Transporte
          </h1>
          <p className="text-muted-foreground mt-1">
            Gestão de baús, embalagens e transportadoras
          </p>
        </div>

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
            <CapacityTab />
          </TabsContent>

          <TabsContent value="packaging">
            <PackagingManagementPage embedded />
          </TabsContent>

          <TabsContent value="carriers">
            <CarriersTab />
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

function CapacityTab() {
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

  const handleSaveBau = () => {
    if (!bauForm.nome.trim()) return;
    addBau.mutate(bauForm);
    setBauDialog(false);
    setBauForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 });
  };

  const handleSaveBox = () => {
    if (!boxForm.nome.trim()) return;
    addBoxType.mutate(boxForm);
    setBoxDialog(false);
    setBoxForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0, empilhamento_maximo: 0 });
  };

  const handleSaveItem = () => {
    if (!itemForm.nome.trim()) return;
    addItemType.mutate(itemForm);
    setItemDialog(false);
    setItemForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 });
  };

  const handleConfirmDelete = () => {
    if (!deleteDialog) return;
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Baú do Veículo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
              <Button variant="outline" size="icon" onClick={() => setBauDialog(true)}>
                <Plus className="h-4 w-4" />
              </Button>
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
          </CardContent>
        </Card>

        {/* Box Types */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Box className="h-5 w-5" />
                Tipos de Caixa
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setBoxDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Nova
              </Button>
            </div>
          </CardHeader>
          <CardContent>
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
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDialog({ type: 'box', id: box.id, name: box.nome })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {boxTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum tipo de caixa cadastrado</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Item Types */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Package className="h-5 w-5" />
                Itens Individuais
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setItemDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Novo
              </Button>
            </div>
          </CardHeader>
          <CardContent>
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
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDialog({ type: 'item', id: item.id, name: item.nome })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {itemTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">Nenhum item cadastrado</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Right Column - Calculation */}
      <div className="space-y-4">
        {/* Selected Items for Calculation */}
        <Card>
           <CardHeader className="pb-3">
             <div className="flex items-center justify-between">
               <CardTitle className="text-lg flex items-center gap-2">
                 <Calculator className="h-5 w-5" />
                 Itens para Cálculo
               </CardTitle>
               <div className="flex items-center gap-2">
                 <div className="flex items-center gap-2 mr-4 px-3 py-1 bg-muted rounded-md">
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
                 <Button onClick={handleCalculate} disabled={!selectedBau || selectedItems.length === 0}>
                   Calcular
                 </Button>
               </div>
             </div>
           </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>

        {/* Results */}
        {packingResult && (
          <Card className="border-primary">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Resultado do Cálculo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  <p className="text-xl font-bold text-primary">{packingResult.ocupacao_total_pct}%</p>
                </div>
                <div className="p-3 rounded-md bg-muted">
                  <p className="text-xs text-muted-foreground">Volume Residual</p>
                  <p className="text-lg font-bold">{packingResult.residual_volume_m3} m³</p>
                </div>
              </div>

              {/* Detailed Results */}
              <Table>
                <TableHeader>
                  <TableRow>
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
            </CardContent>
          </Card>
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={bauDialog} onOpenChange={(open) => { setBauDialog(open); if (!open) setBauForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Baú</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={bauForm.nome} onChange={e => setBauForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Fiorino Padrão" />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
            <Button onClick={handleSaveBau}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={boxDialog} onOpenChange={(open) => { setBoxDialog(open); if (!open) setBoxForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0, empilhamento_maximo: 0 }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Tipo de Caixa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={boxForm.nome} onChange={e => setBoxForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Caixa Corrugada P" />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
            <Button onClick={handleSaveBox}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itemDialog} onOpenChange={(open) => { setItemDialog(open); if (!open) setItemForm({ nome: '', comprimento_cm: 0, largura_cm: 0, altura_cm: 0 }); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Item Individual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={itemForm.nome} onChange={e => setItemForm(f => ({ ...f, nome: e.target.value }))} placeholder="Ex: Produto Avulso" />
            </div>
            <div className="grid grid-cols-3 gap-3">
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
            <Button onClick={handleSaveItem}>Salvar</Button>
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
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============= CARRIERS TAB =============

function CarriersTab() {
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
    const q = search.toLowerCase();
    if (!q) return companies;
    return companies.filter(c =>
      c.nome.toLowerCase().includes(q) ||
      c.documento?.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q)
    );
  }, [companies, search]);

  const openNewDialog = () => {
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
    if (editingCompany) {
      updateCompany.mutate({ id: editingCompany.id, data: payload });
    } else {
      addCompany.mutate(payload);
    }
    setDialogOpen(false);
  };

  const handleConfirmDelete = () => {
    if (!deleteDialog) return;
    deleteCompany.mutate(deleteDialog.id);
    setDeleteDialog(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar transportadora..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={openNewDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Transportadora
        </Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
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
                    <Button size="sm" variant="ghost" onClick={() => { setSelectedCompanyId(company.id); setRatesDialogOpen(true); }}>
                      <MapPin className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEditDialog(company)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteDialog({ id: company.id, name: company.nome })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredCompanies.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {search ? 'Nenhuma transportadora encontrada' : 'Nenhuma transportadora cadastrada'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Company Form Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) { setEditingCompany(null); setForm({ nome: '', tipo_pessoa: 'JURIDICA', documento: '', telefone: '', email: '', responsavel: '', condicoes_pagamento: '', seguro: false, observacoes: '', endereco: { rua: '', numero: '', bairro: '', cidade: '', estado: '', cep: '' } }); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Editar Transportadora' : 'Nova Transportadora'}</DialogTitle>
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
            <Button onClick={handleSave}>{editingCompany ? 'Salvar' : 'Cadastrar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rates Dialog */}
      {selectedCompanyId && (
        <RatesDialog companyId={selectedCompanyId} open={ratesDialogOpen} onOpenChange={setRatesDialogOpen} />
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
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============= RATES DIALOG =============

function RatesDialog({ companyId, open, onOpenChange }: { companyId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: rates = [] } = useTransportCompanyRates(companyId);
  const upsertRates = useUpsertTransportCompanyRates();
  const { data: companies = [] } = useTransportCompanies();

  const company = companies.find(c => c.id === companyId);

  const [localRates, setLocalRates] = useState<Record<string, { valor_capital: number; valor_interior: number; tipo_valor: 'POR_KG' | 'POR_M3' | 'FIXO'; minimo: number }>>({});

  // Initialize local rates from database
  useMemo(() => {
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
  }, [rates]);

  const handleSave = () => {
    const toSave = Object.entries(localRates)
      .filter(([, v]) => v.valor_capital > 0 || v.valor_interior > 0)
      .map(([estado, v]) => ({
        transport_company_id: companyId,
        estado,
        ...v,
      }));
    upsertRates.mutate(toSave as any);
  };

  const updateRate = (estado: string, field: string, value: any) => {
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
          <Button onClick={handleSave}>Salvar Tarifas</Button>
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Simulador de Transporte
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                <p className="text-[10px] text-muted-foreground mt-1">
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
        </CardContent>
      </Card>

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
