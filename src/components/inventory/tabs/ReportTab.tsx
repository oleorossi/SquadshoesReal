 import { useInventoryStats } from '@/hooks/useInventoryStats';
 import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
 import { DollarSign, Package, AlertCircle, ArrowUpRight, TrendingUp } from 'lucide-react';
 import { Button } from '@/components/ui/button';
 import { useNavigate } from 'react-router-dom';
import { StockCharts } from '@/components/inventory/StockCharts';
import { useProducts } from '@/hooks/useProducts';
 import { useQuery } from '@tanstack/react-query';
 import { supabase } from '@/integrations/supabase/client';
 import { Badge } from '@/components/ui/badge';

export function ReportTab() {
  const { data: stats, isLoading } = useInventoryStats();
   const navigate = useNavigate();
  const { data: allProducts = [] } = useProducts(); // Still needed for charts
  // Embalagens vivem no módulo "Embalagens"; Solados vivem em SolesHub —
  // nenhum dos dois deve entrar nos gráficos do estoque "tradicional".
  const products = allProducts.filter(p => {
    const cat = (p.category || '').toLowerCase().trim();
    return cat !== 'embalagem' && cat !== 'embalagens' && cat !== 'solado';
  });

   const { data: topProducts = [], isLoading: loadingTop } = useQuery({
     queryKey: ['top-sold-products'],
     queryFn: async () => {
       // Antes lia product_references (vazia em produção). Mudamos pra technical_sheets
       // que tem os modelos reais com referência + imagem + categoria.
       const { data, error } = await (supabase as any)
         .from('technical_sheets')
         .select('id, name, code, image_url, status')
         .eq('status', 'publicada')
         .order('updated_at', { ascending: false })
         .limit(4);
       if (error) return [];
       return (data || []).map((t: any) => ({
         id: t.id,
         name: t.name || t.code,
         image_url: t.image_url,
         shoe_category: t.code,
       }));
     }
   });

   const cards = [
     {
       title: "Capital Imobilizado",
       value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats?.totalValue || 0),
       icon: DollarSign,
       color: "text-emerald-600",
       bg: "bg-emerald-50",
       link: "/financeiro?tab=patrimonio"
     },
     {
       title: "Total de SKUs",
       value: stats?.activeItems || 0,
       icon: Package,
       color: "text-blue-600",
       bg: "bg-blue-50",
       link: "/estoque?tab=materials"
     },
     {
       title: "Alertas de Compra",
       value: stats?.lowStockCount || 0,
       icon: AlertCircle,
       color: "text-red-600",
       bg: "bg-red-50",
       link: "/estoque?tab=alerts"
     }
   ];

  return (
    <div className="space-y-6 mt-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card, i) => (
           <Card 
             key={i} 
             className="border-none shadow-sm overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/20 transition-all group"
             onClick={() => navigate(card.link)}
           >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                {card.title}
              </CardTitle>
               <div className={`${card.bg} ${card.color} p-2 rounded-lg group-hover:scale-110 transition-transform`}>
                <card.icon className="h-4 w-4" />
              </div>
            </CardHeader>
             <CardContent className="flex justify-between items-end">
              {isLoading ? (
                <div className="h-8 w-24 bg-muted animate-pulse rounded" />
              ) : (
                <div className="text-2xl font-bold tracking-tight">
                  {card.value}
                </div>
              )}
               <ArrowUpRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-primary transition-colors" />
            </CardContent>
          </Card>
        ))}
      </div>

       <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
         <div className="lg:col-span-3">
           <StockCharts products={products} />
         </div>
         
         <Card className="border-none shadow-sm">
           <CardHeader className="pb-3">
             <div className="flex items-center justify-between">
               <CardTitle className="text-sm font-semibold flex items-center gap-2">
                 <TrendingUp className="h-4 w-4 text-primary" />
                 Top Modelos
               </CardTitle>
               <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => navigate('/produtos')}>
                 Ver todos
               </Button>
             </div>
           </CardHeader>
           <CardContent className="space-y-4">
             {loadingTop ? (
               [1, 2, 3].map(i => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)
             ) : topProducts.length > 0 ? (
               topProducts.map((product) => (
                 <div 
                   key={product.id} 
                   className="flex items-center gap-3 group cursor-pointer"
                   onClick={() => navigate(`/produtos/${product.id}`)}
                 >
                   <div className="h-12 w-12 rounded-md bg-muted overflow-hidden shrink-0 border border-border/50">
                     {product.image_url ? (
                       <img src={product.image_url} alt={product.name} className="h-full w-full object-cover group-hover:scale-110 transition-transform" />
                     ) : (
                       <Package className="h-full w-full p-3 text-muted-foreground/40" />
                     )}
                   </div>
                   <div className="min-w-0">
                     <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{product.name}</p>
                     <p className="text-[10px] text-muted-foreground truncate">{product.shoe_category || 'Sem categoria'}</p>
                   </div>
                 </div>
               ))
             ) : (
               /* Audit visual #35: empty state mais descritivo + CTA. Antes só
                  exibia "Nenhum produto encontrado" sem contexto. */
               <div className="py-6 text-center space-y-2">
                 <Package className="h-8 w-8 mx-auto text-muted-foreground/30" />
                 <p className="text-xs text-muted-foreground">Nenhum produto cadastrado ainda.</p>
                 <Button variant="outline" size="sm" onClick={() => navigate('/produtos')} className="h-7 text-xs">
                   Cadastrar primeiro produto
                 </Button>
               </div>
             )}
           </CardContent>
         </Card>
       </div>

    </div>
  );
}
