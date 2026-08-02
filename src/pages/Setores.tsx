import { lazy, Suspense, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { HubTabsList } from '@/components/layout/HubTabs';
import { Scissors, Footprints, Sparkle as Sparkles, Wrench, Paperclip, Palette, Package, Flame, Cloud, Pen } from '@phosphor-icons/react';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import { useEnsureFreshSchedule } from '@/hooks/useProductionEngine';

const Corte = lazy(() => import('./Corte'));
const Forracao = lazy(() => import('./Costura')); // legado: Costura.tsx é "Corte Forração"
const SetorCostura = lazy(() => import('./SetorCostura')); // genérica: recebe o setor por prop
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

 const SECTOR_TABS = ['corte', 'forracao', 'costura-palmilha', 'costura-cabedal', 'aviamento', 'silk', 'colagem', 'montagem', 'solagem', 'acabamento', 'expedicao'] as const;

/**
 * APONTAMENTO (R6) — a porta de chão de fábrica do motor: uma aba por setor,
 * cada uma com sua lista de OPs e o diálogo de apontar quantidade. Kanban e
 * estas telas gravam no MESMO ledger/RPC (apontar_producao_setor), com os
 * mesmos avisos confirmáveis e autoria.
 *
 * ⚠ Isto passou a ser VERDADE só em 2026-07-29. Antes o comentário afirmava
 * isso mas o "Finalizar OPs selecionadas" de cada aba chamava
 * `finalize_production_sector` direto — RPC que não escreve em
 * `production_pointings`. Resultado medido em produção: 180 OPs com produção
 * apontada e apenas 6 no ledger. A correção está em `finalizeSectorTask`
 * (`useProductionTransitions.ts`); não voltar a chamar o finalizador direto.
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
    // Divisão da costura (2026-10-01): quem tinha a aba única salva cai na de palmilha
    if (activeTab === 'costura') setActiveTab('costura-palmilha');
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
            <HubTabsList
              tabs={[
                { value: 'corte', label: 'Corte Palmilha', icon: Scissors },
                { value: 'forracao', label: 'Corte Forração', icon: Cloud },
                { value: 'costura-palmilha', label: 'Costura Palmilha', icon: Pen },
                { value: 'costura-cabedal', label: 'Costura Cabedal', icon: Pen },
                { value: 'aviamento', label: 'Aviamento', icon: Paperclip },
                { value: 'silk', label: 'Silk', icon: Palette },
                { value: 'colagem', label: 'Colagem', icon: Flame },
                { value: 'montagem', label: 'Montagem', icon: Wrench },
                { value: 'solagem', label: 'Solagem', icon: Footprints },
                { value: 'acabamento', label: 'Acabamento', icon: Sparkles },
                { value: 'expedicao', label: 'Expedição', icon: Package },
              ]}
            />
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

          <TabsContent value="costura-palmilha">
            <Suspense fallback={<TabLoader />}>
              <SetorCostura sectorName="Costura Palmilha" />
            </Suspense>
          </TabsContent>

          <TabsContent value="costura-cabedal">
            <Suspense fallback={<TabLoader />}>
              <SetorCostura sectorName="Costura Cabedal" />
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
