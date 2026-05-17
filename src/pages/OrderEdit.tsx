import AppLayout from "@/components/layout/AppLayout";
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useOrders, useUpdateOrderStatus } from '@/hooks/useOrders';
import { useAllOrderStages, useUpdateOrderStage, useRealtimeOrderStages } from '@/hooks/useOrderStages';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useColorVariants } from '@/hooks/useColorVariants';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { SignedImage } from '@/components/ui/signed-image';
import { Panel } from '@/components/ui/panel';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowLeft, CircleNotch as Loader2, CheckCircle as CheckCircle2, Scissors, Footprints, Sparkle as Sparkles, Package, ArrowSquareOut as ExternalLink, ClipboardText as ClipboardList, Calendar, Factory, User, PaintBrush as Paintbrush, Flame, Wrench, Image as ImageIcon, Truck } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OrderTransportCalculator } from '@/components/transport/OrderTransportCalculator';
import { ProductionPipeline } from '@/components/production/ProductionPipeline';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useState, useMemo } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { RefChip } from '@/components/ui/ref-chip';

const STATUS_COLORS: Record<string, string> = {
  'Rascunho': 'bg-muted text-muted-foreground border-border',
  'Reservado': 'bg-primary/15 text-primary border-primary/30',
  'Em Produção': 'bg-warning/15 text-warning border-warning/30',
  'Concluída': 'bg-success/15 text-success border-success/30',
  'Cancelada': 'bg-destructive/15 text-destructive border-destructive/30',
};

const SIZES_ALL = ['17','18','19','20','21','22','23','24','25','26','27','28','29','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45'];

const SECTORS = [
  { name: 'Corte Palmilha', icon: Scissors, color: 'bg-blue-500 hover:bg-blue-600' },
  { name: 'Corte Forração', icon: Paintbrush, color: 'bg-pink-500 hover:bg-pink-600' },
  { name: 'Mesa', icon: Package, color: 'bg-purple-500 hover:bg-purple-600' },
  { name: 'Silk', icon: Paintbrush, color: 'bg-cyan-500 hover:bg-cyan-600' },
  { name: 'Colagem', icon: Flame, color: 'bg-orange-500 hover:bg-orange-600' },
  { name: 'Montagem', icon: Wrench, color: 'bg-indigo-500 hover:bg-indigo-600' },
  { name: 'Solagem', icon: Footprints, color: 'bg-amber-500 hover:bg-amber-600' },
  { name: 'Acabamento', icon: Sparkles, color: 'bg-emerald-500 hover:bg-emerald-600' },
];

export default function OrderEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: orders = [], isLoading: ordersLoading } = useOrders();
  const orderIds = useMemo(() => orders.map(o => o.id), [orders]);
  const { data: allStages = [] } = useAllOrderStages(orderIds.length > 0 ? orderIds : undefined);
  const { data: references = [] } = useTechnicalSheets();
  const updateStage = useUpdateOrderStage();
  const updateStatus = useUpdateOrderStatus();
  useRealtimeOrderStages();

  const [confirmSector, setConfirmSector] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  // Show only the single order that was clicked
  const order = orders.find(o => o.id === id);
  const displayOrders = order ? [order] : [];

  // Get reference info for image
  const ref = order ? references.find(r => r.id === order.reference_id) : null;
  const orderColor = (order as any)?.color || '';

  // Get color variants for this reference to find color-specific image
  const { data: colorVariants = [] } = useColorVariants(order?.reference_id);

  // Find the best image: color variant image > reference image > any variant image
  const colorVariant = colorVariants.find(cv => cv.color.toLowerCase() === orderColor.toLowerCase());
  const refImages = (ref as any)?.images as string[] | undefined;
  const anyVariantImg = colorVariants.find(cv => cv.image_url)?.image_url || '';
  const productImage = colorVariant?.image_url || (refImages && refImages.length > 0 ? refImages[0] : '') || (ref as any)?.image_url || anyVariantImg;

  const { data: saleOrder } = useQuery({
    queryKey: ['sale_order_detail', id],
    queryFn: async () => {
      const soId = (order as any)?.sale_order_id;
      if (!soId) return null;
      const { data } = await supabase.from('sale_orders').select('*').eq('id', soId).maybeSingle();
      return data;
    },
    enabled: !!(order as any)?.sale_order_id,
  });

  const isLoading = ordersLoading;

  // Collect all stages for these orders
  const displayOrderIds = useMemo(() => displayOrders.map(o => o.id), [displayOrders]);
  const relevantStages = useMemo(() => allStages.filter(s => displayOrderIds.includes(s.order_id)), [allStages, displayOrderIds]);

  const getSectorStatus = (sectorName: string) => {
    const sectorStages = relevantStages.filter(s => s.stage_name === sectorName);
    if (sectorStages.length === 0) return 'sem_etapas';
    const allDone = sectorStages.every(s => s.status === 'concluido');
    const someDone = sectorStages.some(s => s.status === 'concluido');
    if (allDone) return 'concluido';
    if (someDone) return 'parcial';
    return 'pendente';
  };

  const currentPipelineStep = useMemo(() => {
    if (order?.status === 'Concluída') return 'expedicao';
    
    const corteStatus = getSectorStatus('Corte');
    if (corteStatus !== 'concluido') return 'corte';
    
    const prepSectors = ['Forração', 'Aviamento', 'Silk', 'Colagem'];
    const prepDone = prepSectors.every(s => getSectorStatus(s) === 'concluido' || getSectorStatus(s) === 'sem_etapas');
    if (!prepDone) return 'preparacao';
    
    const montagemSectors = ['Montagem', 'Solagem', 'Acabamento'];
    const montagemDone = montagemSectors.every(s => getSectorStatus(s) === 'concluido' || getSectorStatus(s) === 'sem_etapas');
    if (!montagemDone) return 'montagem';
    
    return 'expedicao';
  }, [order?.status, relevantStages]);

  const handleCompleteSector = async (sectorName: string) => {
    setCompleting(true);
    try {
      const sectorStages = relevantStages.filter(s => s.stage_name === sectorName && s.status !== 'concluido');
      await Promise.all(sectorStages.map(stage => updateStage.mutateAsync({
        id: stage.id,
        status: 'concluido',
        completed_at: new Date().toISOString(),
        quantity_processed: stage.quantity_total,
      })));
      toast.success(`Setor "${sectorName}" finalizado para ${sectorStages.length} ${sectorStages.length === 1 ? 'OP' : 'OPs'}!`);
    } catch (err: any) {
      toast.error(`Erro ao finalizar setor: ${err.message}`);
    } finally {
      setCompleting(false);
      setConfirmSector(null);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (displayOrders.length === 0) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => navigate('/orders')} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </Button>
          <p className="text-muted-foreground">Ordem de produção não encontrada.</p>
        </div>
      </AppLayout>
    );
  }

  const totalPairs = displayOrders.reduce((s, o) => s + o.quantity, 0);


  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <EditorialPageHeader
          sectionLabel="PEDIDOS · EDIÇÃO"
          title={saleOrder ? `Pedido ${saleOrder.order_number}` : `OP ${(displayOrders[0] as any).order_number}`}
          description={`${saleOrder ? saleOrder.client_name : (displayOrders[0] as any).technical_sheets?.name || '—'} · ${displayOrders.length} ${displayOrders.length === 1 ? 'OP' : 'OPs'} · ${totalPairs} pares`}
          actions={
            <Button variant="ghost" size="icon" onClick={() => navigate('/orders')} aria-label="Voltar para Ordens de Produção">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          }
        />

        <ProductionPipeline orderId={id || ''} currentStep={currentPipelineStep} />

        <Tabs defaultValue="production" className="space-y-4">
          <TabsList>
            <TabsTrigger value="production" className="gap-2">
              <Factory className="h-4 w-4" /> Produção
            </TabsTrigger>
            <TabsTrigger value="transport" className="gap-2">
              <Truck className="h-4 w-4" /> Transporte
            </TabsTrigger>
          </TabsList>

          <TabsContent value="production" className="space-y-6">
            {/* Summary Card */}
            <Panel eyebrow="PEDIDOS · EDIÇÃO" title="Resumo">
                <div className="flex gap-6">
                  {/* Product Image */}
                  <div className="shrink-0">
                    {productImage ? (
                      <div className="w-40 h-40 rounded-lg border overflow-hidden bg-muted">
                        <SignedImage
                          src={productImage}
                          alt={`${ref?.name || 'Produto'} — ${orderColor || 'sem cor'}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-40 h-40 rounded-lg border bg-muted flex flex-col items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-10 w-10 mb-1" />
                        <span className="text-xs">Sem foto</span>
                      </div>
                    )}
                    {orderColor && (
                      <p className="text-center text-sm font-medium mt-2 text-muted-foreground">
                        Cor: <span className="text-foreground">{orderColor}</span>
                      </p>
                    )}
                  </div>

                  {/* Info Grid */}
                  <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><ClipboardList className="h-3 w-3" /> Total de OPs</p>
                      <p className="display text-2xl tabular-nums font-mono">{displayOrders.length}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground flex items-center gap-1"><Factory className="h-3 w-3" /> Total de Pares</p>
                      <p className="display text-2xl tabular-nums font-mono">{totalPairs}</p>
                    </div>
                    {ref && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Referência</p>
                        <p className="text-lg font-semibold flex items-center gap-2">
                          {ref.code && <RefChip code={ref.code} />} {ref.name}
                        </p>
                      </div>
                    )}
                    {saleOrder?.delivery_deadline && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Entrega</p>
                        <p className="text-lg font-semibold">{format(parseISO(saleOrder.delivery_deadline), 'dd/MM/yyyy')}</p>
                      </div>
                    )}
                    {saleOrder && (
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><User className="h-3 w-3" /> Cliente</p>
                        <Link to="/clients" className="text-lg font-semibold text-primary hover:underline flex items-center gap-1">
                          {saleOrder.client_name} <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
            </Panel>

            {/* Sector Completion Buttons */}
            <Panel
              eyebrow="PEDIDOS · EDIÇÃO"
              title="Finalizar Setores"
              subtitle="Clique em um setor para marcar todas as OPs como finalizadas naquele setor."
              bodyClassName="space-y-4"
            >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {SECTORS.map(sector => {
                    const status = getSectorStatus(sector.name);
                    const isDone = status === 'concluido';
                    const Icon = sector.icon;

                    return (
                      <Button
                        key={sector.name}
                        variant={isDone ? 'outline' : 'default'}
                        className={`h-20 flex-col gap-2 text-base ${isDone ? 'border-success text-success' : `${sector.color} text-white`}`}
                        disabled={isDone || status === 'sem_etapas' || completing}
                        onClick={() => setConfirmSector(sector.name)}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-6 w-6" />
                        ) : (
                          <Icon className="h-6 w-6" />
                        )}
                        <span>{sector.name}</span>
                        {isDone && <span className="text-xs">Concluído</span>}
                        {status === 'sem_etapas' && <span className="text-xs opacity-60">Sem etapas</span>}
                      </Button>
                    );
                  })}
                </div>
            </Panel>

            {/* Orders List */}
            <Panel eyebrow="PEDIDOS · EDIÇÃO" title="Ordens de Produção">
                <div className="space-y-3">
                  {displayOrders.map(order => {
                    const ref = references.find(r => r.id === order.reference_id);
                    const orderStages = allStages.filter(s => s.order_id === order.id);
                    const completedStages = orderStages.filter(s => s.status === 'concluido').length;
                    const totalStages = orderStages.length;
                    const grade = order.grade as Record<string, number> | null;
                    const activeSizes = grade ? SIZES_ALL.filter(s => Number(grade[s]) > 0) : [];

                    return (
                      <div key={order.id} className="border rounded-lg p-4 space-y-3 hover:border-primary/50 transition-colors">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-mono text-sm font-bold">{(order as any).order_number}</span>
                            <Link
                              to="/fichas-tecnicas"
                              className="text-sm text-primary hover:underline flex items-center gap-1"
                            >
                              {ref?.code && <RefChip code={ref.code} />} {ref?.name} <ExternalLink className="h-3 w-3" />
                            </Link>
                            {(order as any).color && (
                              <span className="text-sm text-muted-foreground">Cor: {(order as any).color}</span>
                            )}
                            <Badge variant="outline" className={`${STATUS_COLORS[order.status] || ''} text-xs`}>
                              {order.status}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-semibold">{order.quantity} pares</span>
                            {totalStages > 0 && (
                              <Badge variant="secondary" className="text-xs">
                                {completedStages}/{totalStages} setores
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Details row */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                          {(order as any).planned_start && (
                            <div className="text-muted-foreground">
                              <span className="font-medium">Início:</span> {format(parseISO((order as any).planned_start), 'dd/MM/yyyy')}
                            </div>
                          )}
                          {(order as any).planned_delivery && (
                            <div className="text-muted-foreground">
                              <span className="font-medium">Entrega:</span> {format(parseISO((order as any).planned_delivery), 'dd/MM/yyyy')}
                            </div>
                          )}
                          {(order as any).production_line && (
                            <div className="text-muted-foreground">
                              <span className="font-medium">Linha:</span> {(order as any).production_line}
                            </div>
                          )}
                          {(order as any).responsible && (
                            <div className="text-muted-foreground">
                              <span className="font-medium">Responsável:</span> {(order as any).responsible}
                            </div>
                          )}
                        </div>

                        {/* Grade */}
                        {grade && activeSizes.length > 0 && (
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/40 hover:bg-muted/40 [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-muted-foreground">
                                  {activeSizes.map(s => (
                                    <TableHead key={s} className="text-center px-2">{s}</TableHead>
                                  ))}
                                  <TableHead className="text-center px-2">Total</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                <TableRow>
                                  {activeSizes.map(s => (
                                    <TableCell key={s} className="text-center font-mono text-sm px-2">{grade[s] || 0}</TableCell>
                                  ))}
                                  <TableCell className="text-center font-mono text-sm font-bold px-2">
                                    {activeSizes.reduce((sum, s) => sum + (Number(grade[s]) || 0), 0)}
                                  </TableCell>
                                </TableRow>
                              </TableBody>
                            </Table>
                          </div>
                        )}

                        {/* Stage progress */}
                        {totalStages > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {orderStages.map(stage => (
                              <Badge
                                key={stage.id}
                                variant="outline"
                                className={`text-xs ${
                                  stage.status === 'concluido' ? 'bg-success/15 text-success border-success/30' :
                                  stage.status === 'em_andamento' ? 'bg-warning/15 text-warning border-warning/30' :
                                  'bg-muted text-muted-foreground border-border'
                                }`}
                              >
                                {stage.stage_name}
                                {stage.status === 'concluido' && <CheckCircle2 className="h-3 w-3 ml-1" />}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
            </Panel>
          </TabsContent>

          <TabsContent value="transport">
            <OrderTransportCalculator
              orderQuantity={totalPairs}
              orderNumber={saleOrder?.order_number || (displayOrders[0] as any).order_number}
              productCategory="ADULTO_SALTO"
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Confirm sector completion dialog */}
      <AlertDialog open={!!confirmSector} onOpenChange={(open) => !open && setConfirmSector(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Finalizar setor "{confirmSector}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as OPs ({displayOrders.length}) terão o setor "{confirmSector}" marcado como concluído. Esta ação não pode ser desfeita facilmente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={completing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={completing}
              onClick={() => confirmSector && handleCompleteSector(confirmSector)}
            >
              {completing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirmar Finalização
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
