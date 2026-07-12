import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Scissors, Footprints, Sparkle as Sparkles, Wrench, Paperclip, Palette, Package, Flame, Cloud, Pen } from '@phosphor-icons/react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { useEnsureFreshSchedule } from '@/hooks/useProductionEngine';

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

/**
 * APONTAMENTO (R6) — a porta de chão de fábrica do motor: uma aba por setor,
 * cada uma com sua lista de OPs e o diálogo de apontar quantidade. Kanban e
 * estas telas gravam no MESMO ledger/RPC (apontar_producao_setor), com os
 * mesmos avisos confirmáveis e autoria.
 */
export default function Setores() {
   // Garante a virada do dia do motor ao abrir a tela de chão de fábrica
   useEnsureFreshSchedule();
   // Removido 'ordens' como sub-aba — lista global vive no menu lateral em /orders
   // pra eliminar duplicidade (era o mesmo componente embutido aqui).
   const [activeTab, setActiveTab] = usePersistedState<string>('setores-active-tab', 'corte');
  const [searchParams, setSearchParams] = useSearchParams();

  // Redireciona quem ainda tem 'ordens' salvo no localStorage
  useEffect(() => {
    if (activeTab === 'ordens') setActiveTab('corte');
  }, [activeTab, setActiveTab]);

  // Deep-link: ?sub=corte (redirects /corte etc. em App.tsx) tem PRIORIDADE
  // sobre o localStorage. ?tab=corte legado segue aceito como fallback
  // (o PCPHub normaliza pra sub=, mas a URL antiga pode chegar direto aqui).
  useEffect(() => {
    const fromUrl = searchParams.get('sub') ?? searchParams.get('tab');
    if (fromUrl && (SECTOR_TABS as readonly string[]).includes(fromUrl) && fromUrl !== activeTab) {
      setActiveTab(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Troca de sub-aba: além do localStorage, reflete na URL (?sub=) pra
  // refresh/compartilhamento voltarem no mesmo setor. Preserva tab=setores
  // (e demais params) e usa replace pra não poluir o histórico.
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sub', value);
      return next;
    }, { replace: true });
  };

   return (
     <div className="space-y-4 page-enter">
       <EditorialPageHeader
         sectionLabel="PRODUÇÃO · APONTAMENTO"
         title="Apontamento"
         description="Chão de fábrica: aponte a quantidade produzida em cada setor. Tudo cai no mesmo motor do Kanban e do Planejamento, com autoria registrada."
       />
       <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-2">
            <TabsList indicator="none" className="inline-flex w-max h-auto gap-1 bg-muted/50 p-1 rounded-lg">
             <TabsTrigger value="corte" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
               <Scissors className="h-4 w-4" /> Corte Palmilha
             </TabsTrigger>
              <TabsTrigger value="forracao" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Cloud className="h-4 w-4" /> Corte Forração
              </TabsTrigger>
              <TabsTrigger value="costura" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Pen className="h-4 w-4" /> Costura
              </TabsTrigger>
              <TabsTrigger value="aviamento" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Paperclip className="h-4 w-4" /> Aviamento
              </TabsTrigger>
              <TabsTrigger value="silk" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Palette className="h-4 w-4" /> Silk
              </TabsTrigger>
              <TabsTrigger value="colagem" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Flame className="h-4 w-4" /> Colagem
              </TabsTrigger>
              <TabsTrigger value="montagem" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Wrench className="h-4 w-4" /> Montagem
              </TabsTrigger>
              <TabsTrigger value="solagem" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Footprints className="h-4 w-4" /> Solagem
              </TabsTrigger>
              <TabsTrigger value="acabamento" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Sparkles className="h-4 w-4" /> Acabamento
              </TabsTrigger>
              <TabsTrigger value="expedicao" className="text-xs whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-1.5 rounded-md">
                <Package className="h-4 w-4" /> Expedição
              </TabsTrigger>
           </TabsList>
          </div>

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
