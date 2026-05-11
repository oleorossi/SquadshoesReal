import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Scissors, Footprints, Sparkles, Wrench, Paperclip, Palette, Package, Flame, Cloud, Pen } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { usePersistedState } from '@/hooks/usePersistedState';

const Corte = lazy(() => import('./Corte'));
const Forracao = lazy(() => import('./Costura')); // legado: Costura.tsx é "Corte Forração"
const Costura = lazy(() => import('./SetorCostura')); // novo setor: costura palmilha + cabedal
const Aviamento = lazy(() => import('./Aviamento'));
const Silk = lazy(() => import('./Silk'));
const Colagem = lazy(() => import('./Colagem'));
const Montagem = lazy(() => import('./Montagem'));
const Solagem = lazy(() => import('./Solagem'));
const Acabamento = lazy(() => import('./Acabamento'));
const Expedicao = lazy(() => import('./ExpedicaoHub'));

const TabLoader = () => (
  <div className="flex items-center justify-center py-20">
    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
  </div>
);

 const SECTOR_TABS = ['corte', 'forracao', 'costura', 'aviamento', 'silk', 'colagem', 'montagem', 'solagem', 'acabamento', 'expedicao'] as const;

export default function Setores() {
   // Removido 'ordens' como sub-aba — lista global vive no menu lateral em /orders
   // pra eliminar duplicidade (era o mesmo componente embutido aqui).
   const [activeTab, setActiveTab] = usePersistedState<string>('setores-active-tab', 'corte');
  const [searchParams] = useSearchParams();

  // Redireciona quem ainda tem 'ordens' salvo no localStorage
  useEffect(() => {
    if (activeTab === 'ordens') setActiveTab('corte');
  }, [activeTab, setActiveTab]);

  // Deep-link from legacy ?tab=corte (etc.) URLs into the consolidated hub
  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    if (fromUrl && (SECTOR_TABS as readonly string[]).includes(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

   return (
     <div className="space-y-4">
       <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-10 max-w-7xl">
           <TabsTrigger value="corte" className="gap-1.5">
             <Scissors className="h-4 w-4" /> Corte Palmilha
           </TabsTrigger>
            <TabsTrigger value="forracao" className="gap-1.5">
              <Cloud className="h-4 w-4" /> Corte Forração
            </TabsTrigger>
            <TabsTrigger value="costura" className="gap-1.5">
              <Pen className="h-4 w-4" /> Costura
            </TabsTrigger>
            <TabsTrigger value="aviamento" className="gap-1.5">
              <Paperclip className="h-4 w-4" /> Aviamento
            </TabsTrigger>
            <TabsTrigger value="silk" className="gap-1.5">
              <Palette className="h-4 w-4" /> Silk
            </TabsTrigger>
            <TabsTrigger value="colagem" className="gap-1.5">
              <Flame className="h-4 w-4" /> Colagem
            </TabsTrigger>
            <TabsTrigger value="montagem" className="gap-1.5">
              <Wrench className="h-4 w-4" /> Montagem
            </TabsTrigger>
            <TabsTrigger value="solagem" className="gap-1.5">
              <Footprints className="h-4 w-4" /> Solagem
            </TabsTrigger>
            <TabsTrigger value="acabamento" className="gap-1.5">
              <Sparkles className="h-4 w-4" /> Acabamento
            </TabsTrigger>
            <TabsTrigger value="expedicao" className="gap-1.5">
              <Package className="h-4 w-4" /> Expedição
            </TabsTrigger>
         </TabsList>

         <TabsContent value="corte">
          <Suspense fallback={<TabLoader />}>
            <Corte />
          </Suspense>
        </TabsContent>

          <TabsContent value="forracao">
            <Suspense fallback={<TabLoader />}>
              <Forracao />
            </Suspense>
          </TabsContent>

          <TabsContent value="costura">
            <Suspense fallback={<TabLoader />}>
              <Costura />
            </Suspense>
          </TabsContent>

          <TabsContent value="aviamento">
            <Suspense fallback={<TabLoader />}>
              <Aviamento />
            </Suspense>
          </TabsContent>

          <TabsContent value="silk">
            <Suspense fallback={<TabLoader />}>
              <Silk />
            </Suspense>
          </TabsContent>

          <TabsContent value="colagem">
            <Suspense fallback={<TabLoader />}>
              <Colagem />
            </Suspense>
          </TabsContent>

          <TabsContent value="montagem">
            <Suspense fallback={<TabLoader />}>
              <Montagem />
            </Suspense>
          </TabsContent>

          <TabsContent value="solagem">
            <Suspense fallback={<TabLoader />}>
              <Solagem />
            </Suspense>
          </TabsContent>

          <TabsContent value="acabamento">
            <Suspense fallback={<TabLoader />}>
              <Acabamento />
            </Suspense>
          </TabsContent>

          <TabsContent value="expedicao">
            <Suspense fallback={<TabLoader />}>
              <Expedicao />
            </Suspense>
          </TabsContent>
      </Tabs>
    </div>
  );
}
