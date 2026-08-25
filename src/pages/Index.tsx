import { useEffect, useState, useMemo, useRef } from 'react';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Package, GridFour as LayoutGrid, Bell, ClockCounterClockwise as History, ArrowsLeftRight as ArrowRightLeft, Stack as Layers } from '@phosphor-icons/react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useIsAdmin } from '@/hooks/useUserManagement';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

import { MaterialsTab } from '@/components/inventory/tabs/MaterialsTab';
import { ReportTab } from '@/components/inventory/tabs/ReportTab';
import { NotificationsTab } from '@/components/inventory/tabs/NotificationsTab';
import { ConversionReportTab } from '@/components/inventory/tabs/ConversionReportTab';
import AuditLogTab from '@/components/inventory/tabs/AuditLogTab';
 import StockHistory from './StockHistory';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import GroupOrganizationPanel from '@/components/groups/GroupOrganizationPanel';

// Categorias de material para filtro inline (chips).
// 'Solado' REMOVIDO em 18/05/2026 — gestão de solados vive em /solados (SolesHub).
// User pediu deduplicação: "hoje vejo status do Solado em estoque e em gestão
// de solados, quero apenas em gestão de solados".
const MATERIAL_CATEGORIES = [
  { value: 'all',       label: 'Todos' },
  { value: 'Cabedal',   label: 'Cabedal' },
  { value: 'Forração da Palmilha', label: 'Forração' },
  { value: 'Palmilha',  label: 'Palmilha' },
  { value: 'Cola / Químico', label: 'Químicos' },
  { value: 'Componente',label: 'Componentes' },
  // 'Embalagem' REMOVIDO em 04/07/2026 — embalagem tem módulo próprio em
  // /embalagens (box_types). O silo products/Embalagem estava vazio (0 itens).
];

// Tabs principais
const MAIN_TABS = ['materials', 'organization', 'overview', 'alerts', 'conversion'] as const;

// Admin-only tabs — removidas da barra principal
const ADMIN_TABS = new Set(['audit']);


export default function Index() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const requestedTab = searchParams.get('tab');

  // Redireciona tabs legadas para seus hubs canônicos. Bookmarks/links antigos
  // continuam funcionando sem manter uma segunda superfície operacional.
  useEffect(() => {
    if (requestedTab === 'solados') {
      navigate('/solados', { replace: true });
    } else if (requestedTab === 'strap-stock') {
      navigate('/tiras-artesanais?tab=historico-estoque', { replace: true });
    }
  }, [requestedTab, navigate]);

  // A aba mora na URL (contrato do lote L6a). Esta tela já LIA `?tab=` mas nunca
  // ESCREVIA: o deep-link funcionava na ida e trocar de aba não mudava o
  // endereço, então F5 e o botão Voltar devolviam pra "Materiais".
  //
  // As abas de auditoria só existem pra admin — por isso a lista de valores é
  // condicional. Sem isso, um não-admin com `?tab=audit` no link ficaria numa
  // aba que a barra nem desenha.
  const valoresValidos = useMemo(
    () => (isAdmin ? [...MAIN_TABS, ...ADMIN_TABS, 'history'] : [...MAIN_TABS, 'history']) as string[],
    [isAdmin],
  );

  const { value: activeTab, setValue: setActiveTab } = useUrlTabState({
    values: valoresValidos,
    defaultValue: 'materials',
    // Nomes antigos continuam abrindo a tela certa.
    aliases: {
      componentes: 'materials',   // virou filtro dentro de Materiais
      consumables: 'materials',   // aba removida
      report: 'overview',
      painel: 'overview',
      notifications: 'alerts',
      grupos: 'organization',
      organizacao: 'organization',
    },
  });

  // Filtro de categoria de material (chip inline)
  const [materialCategory, setMaterialCategory] = useState<string>('all');

  // `?tab=componentes` não é só um apelido de "materials": ele também PRÉ-SELECIONA
  // o chip de categoria. Lido do parâmetro cru, uma vez, antes que a normalização
  // o troque por `materials`.
  const semeouCategoria = useRef(false);
  useEffect(() => {
    if (semeouCategoria.current) return;
    semeouCategoria.current = true;
    if (requestedTab === 'componentes') setMaterialCategory('Componente');
  }, [requestedTab]);

  return (
    <div className="space-y-6 editorial-stagger">
      <EditorialPageHeader
        sectionNumber="01"
        sectionLabel="INVENTÁRIO SQUAD"
        title="Estoque"
        description="Materiais, consumos, alertas e visão geral do inventário"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* ── Tab bar principal ── */}
        <TabsList indicator="none" className="h-auto w-full justify-start gap-1 overflow-x-auto border-y border-foreground/15 bg-muted/20 p-1">
          <TabsTrigger
            value="materials"
            className="min-w-[145px] justify-start gap-2 border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <Package className="h-4 w-4 shrink-0" />
            <span><span className="block text-xs font-semibold">Materiais</span><span className="block text-[9px] font-normal text-muted-foreground">buscar e movimentar</span></span>
          </TabsTrigger>
          <TabsTrigger
            value="organization"
            className="min-w-[145px] justify-start gap-2 border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <Layers className="h-4 w-4 shrink-0" />
            <span><span className="block text-xs font-semibold">Organização</span><span className="block text-[9px] font-normal text-muted-foreground">setor, família e grupo</span></span>
          </TabsTrigger>
          <TabsTrigger
            value="overview"
            className="min-w-[145px] justify-start gap-2 border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <LayoutGrid className="h-4 w-4 shrink-0" />
            <span><span className="block text-xs font-semibold">Visão geral</span><span className="block text-[9px] font-normal text-muted-foreground">posição do estoque</span></span>
          </TabsTrigger>
          <TabsTrigger
            value="alerts"
            className="min-w-[145px] justify-start gap-2 border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm"
          >
            <Bell className="h-4 w-4 shrink-0" />
            <span><span className="block text-xs font-semibold">Alertas</span><span className="block text-[9px] font-normal text-muted-foreground">ruptura e reposição</span></span>
          </TabsTrigger>
           <TabsTrigger
             value="conversion"
             className="min-w-[145px] justify-start gap-2 border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm"
           >
             <ArrowRightLeft className="h-4 w-4 shrink-0" />
             <span><span className="block text-xs font-semibold">Conversões</span><span className="block text-[9px] font-normal text-muted-foreground">compra e consumo</span></span>
           </TabsTrigger>
           <TabsTrigger
             value="history"
             className="min-w-[145px] justify-start gap-2 border border-transparent px-3 py-2 text-left font-sans normal-case tracking-normal data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:shadow-sm"
           >
             <History className="h-4 w-4 shrink-0" />
             <span><span className="block text-xs font-semibold">Histórico</span><span className="block text-[9px] font-normal text-muted-foreground">entradas e saídas</span></span>
           </TabsTrigger>

          {/* ── Admin tabs — separadas visualmente ── */}
          {isAdmin && (
            <>
              <Separator orientation="vertical" className="h-5 mx-1" />
              <TabsTrigger
                value="audit"
                className="min-w-[120px] gap-1.5 border border-transparent px-3 py-2 text-xs opacity-60 data-[state=active]:border-foreground/20 data-[state=active]:bg-background data-[state=active]:opacity-100"
              >
                <History className="h-3.5 w-3.5" />
                Auditoria
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <div className="mt-4">
          {/* ── Organização industrial ── */}
          <TabsContent value="organization">
            <GroupOrganizationPanel permPath="/estoque" />
          </TabsContent>

          {/* ── Visão Geral ── */}
          <TabsContent value="overview">
            <ReportTab />
          </TabsContent>

          {/* ── Materiais — com chips de categoria ── */}
          <TabsContent value="materials">
            <div className="space-y-4">
              {/* Chips de filtro por categoria */}
              <div className="flex items-center gap-2 flex-wrap">
                {MATERIAL_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    onClick={() => setMaterialCategory(cat.value)}
                    className={
                      materialCategory === cat.value
                        ? 'px-3 py-1.5 rounded-full text-xs font-semibold bg-foreground text-background transition-colors'
                        : 'px-3 py-1.5 rounded-full text-xs font-medium border border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors'
                    }
                  >
                    {cat.label}
                  </button>
                ))}

                <Separator orientation="vertical" className="h-5 mx-1" />

                {/* Link para Fichas de Componentes — página própria */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => navigate('/fichas-tecnicas')}
                >
                  Fichas de Componentes ↗
                </Button>
              </div>

              {/* Conteúdo filtrado — Solado removido em 18/05/2026, vive em /solados */}
              {materialCategory !== 'all' ? (
                <MaterialsTab defaultGroupName={materialCategory} title={
                  MATERIAL_CATEGORIES.find(c => c.value === materialCategory)?.label ?? materialCategory
                } />
              ) : (
                <MaterialsTab />
              )}
            </div>
          </TabsContent>

          {/* ── Alertas ── */}
          <TabsContent value="alerts">
            <NotificationsTab />
          </TabsContent>

          {/* ── Relatório de Conversão ── */}
          <TabsContent value="conversion">
            <ConversionReportTab />
          </TabsContent>

           {/* ── Histórico ── */}
           <TabsContent value="history">
             <StockHistory />
           </TabsContent>

          {/* ── Admin: Auditoria ── */}
          {isAdmin && (
            <>
              <TabsContent value="audit">
                <AuditLogTab />
              </TabsContent>
            </>
          )}
        </div>
      </Tabs>
    </div>
  );
}
