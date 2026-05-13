import AppLayout from "@/components/layout/AppLayout";
import React, { useState, useMemo, useCallback } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { toast } from 'sonner';
import { z } from 'zod';
import { useQuery } from '@tanstack/react-query';
import { apiService } from '@/lib/apiService';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';

// Schema de validação robusto
const ProductionSystemSchema = z.object({
  inventory: z.object({
    materials: z.array(z.object({
      id: z.string().uuid(),
      sku: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      category: z.enum(['leather', 'fabric', 'sole', 'hardware', 'packaging']),
      colors: z.array(z.object({
        code: z.string(),
        name: z.string(),
        hexCode: z.string().regex(/^#[0-9A-F]{6}$/i),
        stock: z.number().min(0),
        reserved: z.number().min(0),
        available: z.number().min(0)
      })),
      specifications: z.object({
        thickness: z.number().positive(),
        width: z.number().positive(),
        length: z.number().positive(),
        weight: z.number().positive(),
        durability: z.enum(['low', 'medium', 'high']),
        flexibility: z.enum(['rigid', 'semi', 'flexible'])
      }),
      supplier: z.object({
        id: z.string().uuid(),
        name: z.string(),
        leadTime: z.number().positive(),
        reliability: z.number().min(0).max(100)
      }),
      costs: z.object({
        unitPrice: z.number().positive(),
        lastUpdate: z.date(),
        priceHistory: z.array(z.object({
          price: z.number(),
          date: z.date(),
          reason: z.string()
        }))
      })
    }))
  }),
  production: z.object({
    orders: z.array(z.object({
      id: z.string().uuid(),
      number: z.string(),
      client: z.string(),
      reference: z.string(),
      model: z.string(),
      sizeGrid: z.record(z.number().min(0)), // {"34": 10, "35": 15}
      colors: z.array(z.string()),
      plannedQuantity: z.number().positive(),
      producedQuantity: z.number().min(0),
      defectiveQuantity: z.number().min(0),
      status: z.enum(['pending', 'active', 'completed', 'blocked']),
      completedDate: z.date().optional(),
      plannedEnd: z.date(),
      stages: z.array(z.object({
        name: z.string(),
        plannedStart: z.date(),
        actualStart: z.date().optional(),
        plannedEnd: z.date(),
        actualEnd: z.date().optional(),
        responsibleTeam: z.string(),
        status: z.enum(['pending', 'active', 'completed', 'blocked']),
        completionPercentage: z.number().min(0).max(100)
      })),
      qualityChecks: z.array(z.object({
        stage: z.string(),
        checkDate: z.date(),
        inspector: z.string(),
        approvedQuantity: z.number(),
        rejectedQuantity: z.number(),
        defects: z.array(z.object({
          type: z.string(),
          severity: z.enum(['minor', 'major', 'critical']),
          quantity: z.number(),
          canRework: z.boolean(),
          cost: z.number()
        }))
      }))
    }))
  })
});

// Infer types from schemas
type ProductionSystem = z.infer<typeof ProductionSystemSchema>;
type ProductionOrder = ProductionSystem['production']['orders'][0];

// Derived schemas
const MaterialUpdateSchema = z.object({
  id: z.string().uuid(),
  stock: z.number().min(0)
});

const ProductionOrderSchema = z.object({
  number: z.string(),
  client: z.string(),
  reference: z.string()
});

// Placeholder components to make it runnable
const InventoryDashboard = ({ data: _data }: any) => <div className="p-4 border rounded bg-muted/50">Dashboard de Inventário (Em desenvolvimento)</div>;
const ProductionManager = ({ data: _data }: any) => <div className="p-4 border rounded bg-muted/50">Gestor de Produção (Em desenvolvimento)</div>;
const QualityControl = ({ data: _data }: any) => <div className="p-4 border rounded bg-muted/50">Controle de Qualidade (Em desenvolvimento)</div>;
const ReportGenerator = ({ data: _data }: any) => <div className="p-4 border rounded bg-muted/50">Gerador de Relatórios (Em desenvolvimento)</div>;
const LoadingSpinner = () => <div className="flex items-center justify-center p-8"><Loader2 className="animate-spin h-8 w-8 text-primary" /></div>;

// Hook otimizado para gestão de estado
const useProductionSystem = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOperation = useCallback(async (
    operation: () => Promise<any>,
    errorMessage: string
  ): Promise<any> => {
    try {
      setLoading(true);
      setError(null);
      const result = await operation();
      toast.success('Operação realizada com sucesso');
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : errorMessage;
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, handleOperation };
};

// Componente principal otimizado
const OptimizedProductionSystem: React.FC = () => {
  const { loading, error, handleOperation } = useProductionSystem();

  // Estados com validação
  const [selectedTab, setSelectedTab] = useState<'inventory' | 'production' | 'quality' | 'reports'>('inventory');
  const [filters, setFilters] = useState({
    category: 'all',
    status: 'all',
    dateRange: { start: null, end: null }
  });

  // Dados cacheados com React Query
  const {
    data: systemData,
    isLoading: isDataLoading,
    error: dataError,
    refetch
  } = useQuery({
    queryKey: ['production_system', filters],
    queryFn: () => apiService.getProductionData(filters),
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: 3,
    retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000)
  });

  // Cálculos otimizados
  const dashboardMetrics = useMemo(() => {
    if (!systemData || !systemData.inventory || !systemData.inventory.materials) return null;
    const materials = systemData.inventory.materials;
    const orders = (systemData.production?.orders || []) as ProductionOrder[];

    return {
      inventory: {
        totalMaterials: materials.length,
        lowStockItems: materials.filter((m: any) => {
          const available = m.colors?.reduce((sum: number, c: any) => sum + (c.available || 0), 0) || 0;
          return available <= (m.minStock || 0);
        }).length,
        totalValue: materials.reduce((sum: number, m: any) => {
          const stock = m.colors?.reduce((stkSum: number, c: any) => stkSum + (c.stock || 0), 0) || 0;
          return sum + (stock * (m.costs?.unitPrice || 0));
        }, 0),
        criticalItems: materials.filter((m: any) => 
          m.colors?.some((c: any) => c.stock === 0)
        ).length
      },
      production: {
        activeOrders: orders.filter((o: any) => o.status === 'active').length,
        completedToday: orders.filter((o: any) =>
          o.completedDate && isToday(new Date(o.completedDate))
        ).length,
        delayedOrders: orders.filter((o: any) =>
          new Date(o.plannedEnd) < new Date() && o.status !== 'completed'
        ).length,
        totalPairsProduced: orders.reduce((sum: number, o: any) => sum + (o.producedQuantity || 0), 0)
      },
      quality: {
        defectRate: calculateDefectRate(orders),
        reworkRate: calculateReworkRate(orders),
        qualityScore: calculateQualityScore(orders)
      }
    };
  }, [systemData]);

  // Handlers com validação
  const handleMaterialUpdate = useCallback(async (materialData: any) => {
    try {
      const validatedData = MaterialUpdateSchema.parse(materialData);
      return handleOperation(
        () => apiService.updateMaterial(validatedData),
        'Erro ao atualizar material'
      );
    } catch (err) {
      toast.error('Dados de material inválidos');
      return null;
    }
  }, [handleOperation]);

  const handleProductionOrder = useCallback(async (orderData: any) => {
    try {
      const validatedData = ProductionOrderSchema.parse(orderData);
      return handleOperation(
        () => apiService.createProductionOrder(validatedData),
        'Erro ao criar ordem de produção'
      );
    } catch (err) {
      toast.error('Dados de ordem inválidos');
      return null;
    }
  }, [handleOperation]);

  // Renderização com error boundary
  return (
    <ErrorBoundary
      fallbackRender={({ error }) => (
        <div className="p-4 text-destructive bg-destructive/10 rounded">
          <h2 className="text-lg font-bold">Algo deu errado</h2>
          <pre className="text-sm">{(error as Error).message}</pre>
        </div>
      )}
      onError={(error, errorInfo) => {
        console.error('Production System Error:', error, errorInfo);
      }}
    >
      
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-bold tracking-tight">Sistema de Produção Otimizado</h1>
            <div className="flex gap-2">
              <Button onClick={() => refetch()} variant="outline">Atualizar</Button>
            </div>
          </div>

          <Tabs value={selectedTab} onValueChange={(v: any) => setSelectedTab(v)}>
            <TabsList>
              <TabsTrigger value="inventory">Inventário</TabsTrigger>
              <TabsTrigger value="production">Produção</TabsTrigger>
              <TabsTrigger value="quality">Qualidade</TabsTrigger>
              <TabsTrigger value="reports">Relatórios</TabsTrigger>
            </TabsList>

            {dashboardMetrics && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="p-4 border rounded bg-card">
                  <h3 className="text-sm font-medium text-muted-foreground">Estoque Crítico</h3>
                  <p className="text-2xl font-bold">{dashboardMetrics.inventory.criticalItems}</p>
                </div>
                <div className="p-4 border rounded bg-card">
                  <h3 className="text-sm font-medium text-muted-foreground">Ordens Ativas</h3>
                  <p className="text-2xl font-bold">{dashboardMetrics.production.activeOrders}</p>
                </div>
                <div className="p-4 border rounded bg-card">
                  <h3 className="text-sm font-medium text-muted-foreground">Taxa de Defeitos</h3>
                  <p className="text-2xl font-bold">{dashboardMetrics.quality.defectRate.toFixed(2)}%</p>
                </div>
              </div>
            )}

            {isDataLoading ? (
              <LoadingSpinner />
            ) : (
              <>
                <TabsContent value="inventory">
                  <InventoryDashboard data={systemData?.inventory?.materials} />
                </TabsContent>
                <TabsContent value="production">
                  <ProductionManager data={(systemData?.production?.orders || []) as ProductionOrder[]} />
                </TabsContent>
                <TabsContent value="quality">
                  <QualityControl data={(systemData?.production?.orders || []) as ProductionOrder[]} />
                </TabsContent>
                <TabsContent value="reports">
                  <ReportGenerator data={systemData} />
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
        
        {loading && (
          <div className="fixed inset-0 bg-background/50 flex items-center justify-center z-50">
            <LoadingSpinner />
          </div>
        )}
      
    </ErrorBoundary>
  );
};

// Funções utilitárias otimizadas
const calculateDefectRate = (orders: ProductionOrder[]): number => {
  if (!orders) return 0;
  const totalProduced = orders.reduce((sum, o) => sum + (o.producedQuantity || 0), 0);
  const totalDefective = orders.reduce((sum, o) => sum + (o.defectiveQuantity || 0), 0);
  return totalProduced > 0 ? (totalDefective / totalProduced) * 100 : 0;
};

const calculateReworkRate = (orders: ProductionOrder[]): number => {
  // Implementar cálculo de taxa de retrabalho
  return 0;
};

const calculateQualityScore = (orders: ProductionOrder[]): number => {
  // Implementar cálculo de score de qualidade
  return 0;
};

const isToday = (date: Date): boolean => {
  const today = new Date();
  return date.toDateString() === today.toDateString();
};

export default OptimizedProductionSystem;
