import { FormSkeleton } from '@/components/layout/PageSkeleton';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileMagnifyingGlass as FileSearch, ArrowCounterClockwise as RotateCcw, Handshake, CheckCircle, Warning as AlertTriangle, PaperPlaneTilt } from '@phosphor-icons/react';
import { SendSectorToContractorDialog } from '@/components/sale-orders/SendSectorToContractorDialog';
// `newISO` é date-only: `new Date(iso)` parseia UTC e o toast confirmava o dia
// ANTERIOR ao que era gravado em `delivery_deadline`.
import { formatDateBR } from '@/lib/dateOnly';
import { fetchClientCreditExposure } from '@/lib/clientCreditExposure';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { EditorialPageHeader } from '@/components/layout/EditorialPageHeader';
import SaleOrderFormPanel, { removeItemsAtIndices, restoreItemsAt } from '@/components/sale-orders/SaleOrderFormPanel';
import { PvServiceOrdersCard } from '@/components/sale-orders/PvServiceOrdersCard';
import { GenerateServiceOrdersWizard } from '@/components/contractors/GenerateServiceOrdersWizard';
import {
  buildExtraItemColumns,
  useCreateSaleOrder,
  useUpdateSaleOrder,
  SaleOrderFormData,
  SaleOrderItemFormData,
} from '@/hooks/useSaleOrders';
import { calculateOrderCost, type OrderCostResult } from '@/services/costingService';
import { CancelOpsAndEditDialog, type BlockingOp } from '@/components/sale-orders/CancelOpsAndEditDialog';
import {
  StrapSourcingAdminOverrideDialog,
  type StrapSourcingAdminOverrideTarget,
} from '@/components/sale-orders/StrapSourcingAdminOverrideDialog';
import { useTechnicalSheets } from '@/hooks/useTechnicalSheets';
import { useClients } from '@/hooks/useClients';
import { useRepresentatives } from '@/hooks/useRepresentatives';
import { useAuth } from '@/hooks/useAuth';
import { useCan } from '@/hooks/useAccessControl';
import { useIsAdmin } from '@/hooks/useUserManagement';
import { useCheckStockAvailability } from '@/hooks/useOrders';
import { getCanonicalReferenceIdMap, getCanonicalSaleOrderReferences } from '@/lib/saleOrderReferences';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { checkSoleAvailability, SoleAvailabilityResult } from '@/lib/soleAvailability';
import { SolePurchaseConfirmDialog } from '@/components/sale-orders/SolePurchaseConfirmDialog';
import { enrichMaterialShortages, MaterialAvailabilityResult } from '@/lib/materialAvailability';
import { MaterialPurchaseConfirmDialog } from '@/components/sale-orders/MaterialPurchaseConfirmDialog';
import { checkSectorCapacity, CapacityCheckResult } from '@/lib/sectorCapacity';
import { SectorOverloadDialog } from '@/components/sale-orders/SectorOverloadDialog';
import { computeMinBillingForNewOrder, fetchMinBillingDate, isBeforeMinDate, toISOWeek, type MinBillingResult } from '@/lib/minBillingDate';
import { MinBillingDateSuggestionDialog } from '@/components/sale-orders/MinBillingDateSuggestionDialog';
import { OverrideOutsourceCosturaDialog } from '@/components/sale-orders/OverrideOutsourceCosturaDialog';
import { monthWeekToISODate, isoToMonthWeek } from '@/lib/billingWeek';
import { listMissingTechnicalStrapSnapshots } from '@/lib/strapSnapshotGuard';
import {
  isCommittedStrapSourcingError,
  sameStrapSourcingSelection,
  strapSourcingErrorDetails,
} from '@/lib/strapSourcingOverride';

const emptyForm: SaleOrderFormData = {
  client_id: null,
  client_name: '', client_cnpj: '', client_contact: '', client_order_number: '',
  representative: '', payment_condition: '', delivery_deadline: '', delivery_week: '', delivery_month: '',
  notes: '', status: 'Rascunho',
  nfe: '', remessa: '', is_factoring: false, factoring_config_id: '', packaging_mode: 'colmeia',
  box_grouping: 'grade',
  shipping_rate_per_pair: 0,
  nfe_required: true,
  own_delivery: false,
  informacoes_complementares_nf: '',
  brand: 'Squad Shoes',
  order_type: 'carteira',
  nfe_external: false,
  external_nfe_number: '',
};

const emptyItem: SaleOrderItemFormData = {
  reference_id: '', color: '', grade: {}, unit_price: 0, quantity: 0, fichas: 1, observation: null,
  selected_terceirizacao_ids: [],
  terceirizacao_quantities: {},
  outsourced_sectors: {},
};

const SALE_ORDER_DRAFT_KEY_PREFIX = 'sale_order_draft';

/**
 * Chave do rascunho, NAMESPACED por usuário: o rascunho carrega cliente, condições
 * comerciais e preços, então o de um vendedor não pode ressurgir na conta de outro
 * que usou o mesmo navegador. Fonte única — o componente e o
 * `hasStoredSaleOrderDraft` derivam a chave daqui, senão os dois divergem e a
 * detecção de rascunho olha uma chave que ninguém grava.
 */
function saleOrderDraftKey(userId: string | null | undefined): string {
  return `${SALE_ORDER_DRAFT_KEY_PREFIX}:${userId ?? 'anonymous'}`;
}

// Cópia parcial de itens (edição → novo PV): a edição grava o seed aqui e navega
// pra /sales/new, que o consome UMA vez no mount. Chave separada do rascunho:
// o rascunho é opt-in (dialog), a cópia é ação deliberada e aplica direto.
const SALE_ORDER_COPY_SEED_KEY = 'sale_order_copy_seed';

/** Id fixo do toast de exclusão em lote — ver handleDeleteSelectedItems. */
const PV_ITEM_DELETE_TOAST_ID = 'pv-itens-excluidos';

export type SaleOrderCopySeed = {
  sourceOrderNumber: string | null;
  selectedClientId: string;
  form: Partial<SaleOrderFormData>;
  items: SaleOrderItemFormData[];
};

/**
 * Monta o payload do seed de "Copiar itens p/ novo PV" (pura — exportada pra
 * teste, mesmo padrão do mapLoadedSaleOrderItem). Guardas que o teste trava:
 *
 *  - o `id` do item NÃO viaja: copiá-lo faria o save do novo PV "atualizar"
 *    linha de OUTRO pedido — é o campo de identidade estável do item
 *    (migration 20260919120000);
 *  - variante de material inativa é limpa (id obsoleto bloquearia a NF-e do
 *    novo PV — emit-nfe devolve 400 pra variante inativa);
 *  - intenção de terceirização (ids/quantidades/setores) é RESETADA: gera OS
 *    no save, e a decisão pertence ao novo pedido — herdar em silêncio criaria
 *    OS que ninguém pediu;
 *  - empresa emitente só viaja se ainda estiver ATIVA: `useCompanies` só lista as
 *    ativas, então um `company_id` desativado ficaria invisível no seletor (que
 *    mostraria "primária") enquanto o form gravava o CNPJ errado na NF-e. Null =
 *    empresa primária, que é o default documentado da coluna;
 *  - do cabeçalho viajam só cliente + condições comerciais; datas de entrega,
 *    OC do cliente, NF e notas ficam nos defaults (pedido novo, agenda nova).
 *
 * ⚠ O FRETE POR PAR fica de fora de propósito (paridade com o Duplicar por Grupo,
 * que também não o carrega). Dois motivos somados: (1) salvar um Rascunho com
 * `shipping_rate_per_pair > 0` já cria uma despesa 'pendente' em
 * `financial_entries` pelo gatilho `tg_sale_order_creates_shipping_expense`, com
 * vencimento contado de HOJE — desligada da agenda de um pedido que ainda nem tem
 * data; e (2) o painel lê esse campo pra um `useState` no PRÓPRIO mount, e o seed
 * chega depois (efeito de filho roda antes do de pai), então a tela mostraria
 * R$ 0,00 enquanto o valor copiado ia no payload: frete que o usuário nunca viu.
 * Frete é decisão do embarque novo — deixá-lo em zero é o default seguro.
 *
 * ⚠ NÃO gravar `parent_order_id` na cópia parcial. Naquele campo, neste sistema,
 * "pai" quer dizer especificamente *duplicata de grupo econômico*: o dialog
 * Duplicar por Grupo lista como "loja já copiada" todo cliente com PV filho
 * daquele pai (`alreadyCopiedClientIds`, SaleOrders.tsx) e o REMOVE da lista.
 * Como aqui o usuário pode trocar o cliente antes de salvar, marcar a cópia
 * parcial como filha esconderia uma loja que recebeu 2 de 10 itens, bloqueando
 * em silêncio a duplicação do pedido inteiro pra ela.
 */
/**
 * Lê e CONSOME (one-shot) o seed deixado pela cópia parcial. Remove a chave
 * ANTES de interpretar o conteúdo: seed corrompido não pode ficar preso no
 * armazenamento reaparecendo a cada visita a /sales/new.
 *
 * Devolve null quando não há cópia pendente, quando o JSON não parseia, ou
 * quando o seed não traz item nenhum — nos três casos a tela segue no fluxo
 * normal de pedido novo (inclusive o prompt de rascunho).
 *
 * Mora fora do componente pra ser testável: o consumo do seed é justamente o
 * ponto onde a feature quebrou (o efeito de montagem não rodava), e teste de
 * função pura não alcança lógica presa dentro de um useEffect.
 */
export function consumeCopySeed(): SaleOrderCopySeed | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(SALE_ORDER_COPY_SEED_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SALE_ORDER_COPY_SEED_KEY);
  } catch {
    return null; // armazenamento indisponível (modo privado, cota) — sem cópia
  }
  try {
    const seed = JSON.parse(raw) as SaleOrderCopySeed;
    if (!Array.isArray(seed?.items) || seed.items.length === 0) return null;
    return seed;
  } catch {
    return null;
  }
}

/**
 * Há rascunho de pedido guardado PARA ESTE usuário? (o da cópia é outra chave, ver
 * acima). Recebe o id porque a chave é namespaced: sem ele a função olharia uma
 * chave que ninguém grava e devolveria sempre `false`, desarmando a preservação do
 * rascunho na cópia parcial.
 */
export function hasStoredSaleOrderDraft(userId: string | null | undefined): boolean {
  const key = saleOrderDraftKey(userId);
  try {
    return !!(sessionStorage.getItem(key) ?? localStorage.getItem(key));
  } catch {
    return false;
  }
}

export function buildCopySeedPayload(args: {
  seedItems: SaleOrderItemFormData[];
  form: SaleOrderFormData;
  selectedClientId: string;
  sourceOrderNumber: string | null;
  activeVariantIds: Set<string>;
  companyIsActive: boolean;
}): SaleOrderCopySeed {
  const { seedItems, form: f, selectedClientId, sourceOrderNumber, activeVariantIds, companyIsActive } = args;
  return {
    sourceOrderNumber,
    selectedClientId,
    form: {
      client_id: (f as any).client_id ?? null,
      company_id: companyIsActive ? ((f as any).company_id ?? null) : null,
      client_name: f.client_name,
      client_cnpj: f.client_cnpj,
      client_contact: f.client_contact,
      representative: f.representative,
      payment_condition: f.payment_condition,
      is_factoring: f.is_factoring,
      factoring_config_id: f.factoring_config_id,
      packaging_mode: f.packaging_mode,
      nfe_required: f.nfe_required,
      own_delivery: f.own_delivery,
      brand: f.brand,
      order_type: f.order_type,
      status: 'Rascunho',
    },
    items: seedItems.map(({ id: _itemId, strap_sourcing_revision: _sourceRevision, ...rest }) => ({
      ...rest,
      material_variant_id:
        rest.material_variant_id && activeVariantIds.has(rest.material_variant_id)
          ? rest.material_variant_id
          : null,
      selected_terceirizacao_ids: [],
      terceirizacao_quantities: {},
      outsourced_sectors: {},
    })),
  };
}

interface SubmitOptions {
  skipMinBillingCheck?: boolean;
  skipCreditCheck?: boolean;
}

const formatCurrency = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Extraída pra ser testável de fora do componente (guard de regressão do
// incidente PV-00146). O `id` PRECISA viajar junto: é ele que faz o save
// ATUALIZAR a linha do item em vez de apagar+recriar — o que rompia o vínculo
// de OP/OS/alocação e duplicava OPs (migration 20260919120000).
export function mapLoadedSaleOrderItem(
  i: any,
  canonicalReferenceIdMap: Map<string, string>,
): SaleOrderItemFormData {
  const grade = (i.grade as Record<string, number>) || {};
  const gradeTotal = Object.values(grade).reduce((s, v) => s + (Number(v) || 0), 0);
  const qty = Number(i.quantity) || 0;
  const fichas = gradeTotal > 0 ? Math.max(1, Math.round(qty / gradeTotal)) : 1;
  const normalizedReferenceId = canonicalReferenceIdMap.get(i.reference_id) || i.reference_id;
  return {
    id: i.id,
    reference_id: normalizedReferenceId,
    color: i.color || '',
    grade,
    unit_price: Number(i.unit_price) || 0,
    quantity: qty,
    fichas,
    strap_colors: (i.strap_colors as any[]) || [],
    // Origem explícita por UUID da linha técnica; não existe fallback herdado.
    strap_sourcing: ((i as any).strap_sourcing as SaleOrderItemFormData['strap_sourcing']) ?? null,
    strap_sourcing_revision: Number((i as any).strap_sourcing_revision) || 0,
    observation: (i as any).observation || null,
    // Sem copiar na carga, editar o PV gravava null (o payload de update e o
    // RPC update_sale_order_atomic JÁ persistem a coluna) → perda silenciosa
    // da variante de cor a cada edição. Auditoria 2026-06-14, Top10 #9.
    material_variant_id: (i as any).material_variant_id ?? null,
    // Terceirização integrada: preserva a seleção ao reabrir o PV pra editar.
    selected_terceirizacao_ids: ((i as any).selected_terceirizacao_ids as string[]) ?? [],
    // ...e a quantidade parcial por serviço (split fábrica × rua).
    terceirizacao_quantities: ((i as any).terceirizacao_quantities as Record<string, number>) ?? {},
    // Terceirização por setor: sem copiar na carga, reabrir o PV pra editar
    // gravaria mapa vazio por cima (a edição grava o vazio de propósito, pra
    // desmarcar funcionar) e os setores marcados sumiriam em silêncio.
    outsourced_sectors: ((i as any).outsourced_sectors as Record<string, string>) ?? {},
  };
}

export default function SaleOrderForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const { data: references = [], isLoading: referencesLoading } = useTechnicalSheets();
  const { data: clients = [] } = useClients();
  const { data: representatives = [] } = useRepresentatives();
  const createOrder = useCreateSaleOrder();
  const updateOrder = useUpdateSaleOrder();
  const checkStock = useCheckStockAvailability();
  const { user } = useAuth();
  const perm = useCan('/sales');
  const draftKey = saleOrderDraftKey(user?.id);

  // A URL direta não pode contornar a matriz CRUD. A proteção de rota governa
  // visualização; aqui a operação exige explicitamente create/edit.
  useEffect(() => {
    if (!perm.loading && ((isEdit && !perm.canEdit) || (!isEdit && !perm.canCreate))) {
      toast.error('Você não tem permissão para editar pedidos de venda.');
      navigate('/sales', { replace: true });
    }
  }, [isEdit, navigate, perm.canCreate, perm.canEdit, perm.loading]);

  // Diálogo "cancelar todas as OPs em produção e editar". A confirmação
  // envia cancelamento + liberação de reservas pendentes + save ao writer
  // transacional único; nenhum
  // cancelamento acontece antecipadamente no browser.
  const [cancelOpsDialog, setCancelOpsDialog] = useState<{
    open: boolean;
    ops: BlockingOp[];
    pendingStatusOverride?: string;
  }>({ open: false, ops: [] });
  const [cancelOpsPreflight, setCancelOpsPreflight] = useState<{
    isRunning: boolean;
    error: string | null;
  }>({ isRunning: false, error: null });
  // Estado React desabilita o botão no render seguinte; o ref fecha também a
  // janela de dois cliques no mesmo frame antes de qualquer OP ser cancelada.
  const cancelOpsPreflightRunningRef = useRef(false);

  // Fonte ÚNICA dos papéis. Havia aqui um useQuery inline com a MESMA queryKey
  // do useUserRoles mas devolvendo string[] em vez de UserRole[] — o cache do
  // React Query é por chave, então bastava passar antes por uma tela que usa o
  // hook canônico pra este componente ler OBJETOS e `includes('admin')` dar
  // false. Admin de verdade era barrado ao faturar antes da semana mínima.
  const isAdmin = useIsAdmin();

  const canonicalReferenceIdMap = useMemo(
    () => getCanonicalReferenceIdMap(references as Array<{ id: string; code?: string | null; name?: string | null; updated_at?: string | null }>),
    [references]
  );

  const canonicalReferences = useMemo(
    () => getCanonicalSaleOrderReferences(references as Array<{ id: string; code?: string | null; name?: string | null; updated_at?: string | null }>),
    [references]
  );

  const normalizeItemReference = (item: SaleOrderItemFormData): SaleOrderItemFormData => ({
    ...item,
    reference_id: canonicalReferenceIdMap.get(item.reference_id) || item.reference_id,
  });

  // GUARD (auditoria 2026-07-01, achado ALTO — tira com cor vazia): uma linha de
  // tira sem cor passava por TODOS os guards existentes — colorIssues exige cor
  // ESCOLHIDA sem produto (strapMissing pula `!s?.color`), o strapShortages pula
  // a linha sem cor (`if (!color) continue`) e o `incomplete` do pós-save só pega
  // strap_colors=[] inteiro. Resultado: o PV salvava e o débito da tira era
  // PULADO em silêncio na conversão pra OP (debit_strap_stock não resolve produto
  // sem cor). Não há fluxo legítimo de "tira sem cor até definir depois": o
  // O resolvedor canônico não aceita texto/alias como identidade: bloqueamos
  // ANTES do save e exigimos também o UUID de cor persistido no snapshot.
  const findTiraSemCor = (its: SaleOrderItemFormData[]): string | null => {
    for (let i = 0; i < its.length; i++) {
      const straps = Array.isArray((its[i] as any).strap_colors)
        ? ((its[i] as any).strap_colors as any[])
        : [];
      const semCor = straps.filter((s) => {
        if (!s) return false;
        const referenceBase = (s.identity_basis || 'reference_base') === 'reference_base';
        // Para reference_base, a cor principal do item e a intenção: o writer
        // atômico resolve o UUID e materializa a variante antes do INSERT/UPDATE.
        if (referenceBase && String(its[i].color || '').trim()) return false;
        return !String(s.color || '').trim() || !String(s.color_id || '').trim();
      });
      if (semCor.length === 0) continue;
      const ref = canonicalReferences.find((r: any) => r.id === its[i].reference_id) as any;
      const refLabel = ref
        ? `${ref.code || ''} ${ref.name || ''}`.trim() || `item ${i + 1}`
        : `item ${i + 1}`;
      const tiras = semCor
        .map((s) => String(s.label || s.group_name || 'TIRA').trim() || 'TIRA')
        .join(', ');
      return (
        `Tira sem cor canônica no item ${i + 1} (${refLabel}): ${tiras}. ` +
        `Selecione a cor no catálogo; texto antigo não identifica estoque nem permite confirmar o pedido.`
      );
    }
    return null;
  };

  const [form, setForm] = useState<SaleOrderFormData>(emptyForm);
  const [items, setItems] = useState<SaleOrderItemFormData[]>([{ ...emptyItem }]);
  const originalStrapSourcingRef = useRef(new Map<string, {
    revision: number;
    lines: NonNullable<SaleOrderItemFormData['strap_sourcing']>;
  }>());
  const [strapOverrideTarget, setStrapOverrideTarget] = useState<StrapSourcingAdminOverrideTarget | null>(null);
  // A chave nasce na primeira tentativa e sobrevive a qualquer retry desta tela.
  // Só é descartada após a RPC confirmar a criação, evitando PV duplicado em
  // timeout/resposta perdida.
  const clientRequestIdRef = useRef<string | null>(null);
  // Ligado quando a tela nasce de uma cópia E já havia rascunho salvo. O caminho
  // do seed pula o prompt "Rascunho encontrado" (a cópia vence a tela), e sem
  // esta trava o auto-save de 5s gravaria o pedido copiado POR CIMA de um
  // rascunho que o usuário nunca chegou a ver — perda silenciosa e sem volta,
  // já que o rascunho só é apagado por Restaurar/Descartar explícitos.
  const preserveExistingDraftRef = useRef(false);

  // Itens com cor não cadastrada (cabedal/forração/tira) — BLOQUEIA o save até
  // cadastrar. Reportado por cada SaleOrderItemForm via onColorIssueChange.
  const [colorIssues, setColorIssues] = useState<Record<number, { color: string; materials: string[]; message?: string }>>({});
  const handleColorIssueChange = useCallback((idx: number, info: { color: string; materials: string[]; message?: string } | null) => {
    setColorIssues(prev => {
      if (!info) { if (!(idx in prev)) return prev; const n = { ...prev }; delete n[idx]; return n; }
      const ex = prev[idx];
      if (ex && ex.color === info.color && ex.materials.join(',') === info.materials.join(',') && ex.message === info.message) return prev;
      return { ...prev, [idx]: info };
    });
  }, []);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [packagingProductId, setPackagingProductId] = useState<string>('');
  const [packagingQuantity, setPackagingQuantity] = useState<number>(0);
  const [loading, setLoading] = useState(isEdit || referencesLoading);

  // Pending draft detection: cargas anteriores salvaram um rascunho em
  // sessionStorage (saída pra /estoque) ou localStorage (auto-save).
  // Restauração agora é OPT-IN: user vê toast com botão e decide.
  const [pendingDraft, setPendingDraft] = useState<null | {
    form: SaleOrderFormData;
    items: SaleOrderItemFormData[];
    selectedClientId: string;
    packagingProductId: string;
    packagingQuantity: number;
    savedAt?: number;
    source: 'session' | 'local';
  }>(null);

  useEffect(() => {
    // Espera o usuário resolver: a chave do rascunho é por conta, e o seed é
    // one-shot — consumi-lo antes da sessão carregar o descartaria sem aplicar.
    // O efeito re-roda quando `user?.id` chega (está nas deps).
    if (isEdit || !user?.id) return;
    // 1) Seed de cópia parcial (veio de "Copiar p/ novo PV" na edição de outro
    //    pedido). Aplica DIRETO, sem opt-in — o usuário acabou de pedir a cópia.
    //    Consome (remove) antes de aplicar: é one-shot, um F5 depois disso volta
    //    ao fluxo normal de rascunho.
    const seed = consumeCopySeed();
    if (seed) {
      // Rascunho anterior fica INTACTO: como aqui não passamos pelo prompt de
      // restauração, o auto-save é desarmado nesta sessão em vez de sobrescrever
      // um trabalho que o usuário não teve chance de ver.
      if (hasStoredSaleOrderDraft(user.id)) {
        preserveExistingDraftRef.current = true;
        toast.info(
          'Havia um rascunho de pedido salvo — ele foi preservado e continua disponível na próxima visita a "Novo Pedido". ' +
          'Esta cópia não será auto-salva; salve o pedido ao terminar.',
          { duration: 12000 },
        );
      }
      setForm({ ...emptyForm, ...seed.form });
      setItems(seed.items);
      setSelectedClientId(seed.selectedClientId || '');
      const n = seed.items.length;
      toast.success(
        `${n} ${n === 1 ? 'item copiado' : 'itens copiados'}` +
        `${seed.sourceOrderNumber ? ` do ${seed.sourceOrderNumber}` : ' do pedido original'}` +
        ' — revise datas e condições antes de salvar.',
        { duration: 8000 },
      );
      return; // seed vence: não oferece restauração de rascunho antigo por cima
    }
    const sessionRaw = sessionStorage.getItem(draftKey);
    const localRaw = localStorage.getItem(draftKey);
    const raw = sessionRaw ?? localRaw;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.ownerId === user.id && (parsed?.form || parsed?.items?.length)) {
        setPendingDraft({
          form: parsed.form ?? emptyForm,
          items: parsed.items?.length ? parsed.items : [{ ...emptyItem }],
          selectedClientId: parsed.selectedClientId ?? '',
          packagingProductId: parsed.packagingProductId ?? '',
          packagingQuantity: parsed.packagingQuantity ?? 0,
          savedAt: parsed.savedAt,
          source: sessionRaw ? 'session' : 'local',
        });
      }
    } catch { /* ignore corrupted draft */ }
  }, [draftKey, isEdit, user?.id]);

  // Auto-save em localStorage a cada 5s enquanto user mexe no form
  // (sessionStorage continua sendo usado pelo fluxo de saída pra /estoque).
  useEffect(() => {
    // Não autossalva enquanto pendingDraft está aberto, nem quando a tela veio de
    // uma cópia com rascunho anterior guardado (ver preserveExistingDraftRef), nem
    // sem usuário resolvido (a chave é por conta — gravaria em 'anonymous').
    if (isEdit || pendingDraft || !user?.id || preserveExistingDraftRef.current) return;
    const hasContent =
      (form.client_name?.trim() || '').length > 0 ||
      items.some((it) => it.reference_id || (it.quantity ?? 0) > 0);
    if (!hasContent) return;
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(
          draftKey,
          JSON.stringify({ ownerId: user.id, form, items, selectedClientId, packagingProductId, packagingQuantity, savedAt: Date.now() }),
        );
      } catch { /* ignore quota errors */ }
    }, 5_000);
    return () => clearTimeout(handle);
  }, [draftKey, form, items, selectedClientId, packagingProductId, packagingQuantity, isEdit, pendingDraft, user?.id]);

  const restoreDraft = () => {
    if (!pendingDraft) return;
    setForm(pendingDraft.form);
    setItems(pendingDraft.items);
    setSelectedClientId(pendingDraft.selectedClientId);
    setPackagingProductId(pendingDraft.packagingProductId);
    setPackagingQuantity(pendingDraft.packagingQuantity);
    sessionStorage.removeItem(draftKey);
    localStorage.removeItem(draftKey);
    setPendingDraft(null);
    toast.success('Rascunho restaurado');
  };

  const discardDraft = () => {
    sessionStorage.removeItem(draftKey);
    localStorage.removeItem(draftKey);
    setPendingDraft(null);
    toast.success('Rascunho descartado');
  };

  // Dispensar (Esc/X/clique fora) ≠ Descartar: fechar o dialog só esconde o
  // aviso — o rascunho continua no storage pra próxima visita. Apagar de vez
  // é SÓ pelo botão "Descartar" explícito.
  const dismissDraftPrompt = () => setPendingDraft(null);

  useEffect(() => {
    if (!referencesLoading && !isEdit) {
      setLoading(false);
    }
  }, [referencesLoading, isEdit]);
  const [checkingStock, setCheckingStock] = useState(false);
  const [orderLoaded, setOrderLoaded] = useState(false);

  // Bug histórico: navegar de /sales/edit/A pra /sales/edit/B (via GlobalSearch)
  // não desmontava o componente — `id` mudava no useParams mas o useEffect que
  // carrega o pedido tinha guarda `if (orderLoaded) return`. Resultado: tela
  // continuava mostrando PV A com URL nova. Fix: resetar orderLoaded e o form
  // quando id muda, forçando o reload do useEffect de carregamento.
  useEffect(() => {
    if (!id) return; // criar novo: nada a fazer
    // Reseta só se o componente JÁ tinha carregado um pedido antes (orderLoaded)
    // pra evitar mexer no mount inicial.
    if (orderLoaded) {
      setOrderLoaded(false);
      setForm(emptyForm);
      setItems([{ ...emptyItem }]);
      originalStrapSourcingRef.current.clear();
      setStrapOverrideTarget(null);
      setSelectedClientId('');
      setPackagingProductId('');
      setPackagingQuantity(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [soleResult, setSoleResult] = useState<SoleAvailabilityResult | null>(null);
  const [soleDialogOpen, setSoleDialogOpen] = useState(false);
  const [materialResult, setMaterialResult] = useState<MaterialAvailabilityResult | null>(null);
  const [materialDialogOpen, setMaterialDialogOpen] = useState(false);

  // Bug fix (2026-06-02): só re-checar estoque/solado (que abre "gerar Ordem de
  // Compra?") quando os itens que afetam COMPRA mudarem. Assinatura dos itens do
  // pedido carregado em edição, comparada no submit. Sem isto, qualquer edição
  // (data, obs, cliente) reabria o prompt de OC porque a falta de estoque persiste.
  const itemsPurchaseSig = (its: SaleOrderItemFormData[]) => JSON.stringify(
    its.filter(i => i.reference_id).map(i => ({
      r: i.reference_id,
      q: i.quantity,
      c: (i.color || '').trim().toUpperCase(),
      g: (i as any).grade || {},
      s: Array.isArray((i as any).strap_colors)
        ? (i as any).strap_colors.map((x: any) => ({ color: x?.color || '', color_id: x?.color_id || '' }))
        : [],
      so: (i as any).strap_sourcing || {},
    })).sort((a, b) => (a.r + a.c).localeCompare(b.r + b.c)),
  );
  // Alterações não salvas. Alimentado por evento de DOM vindo do painel — ver a
  // nota no <form> de SaleOrderFormPanel sobre por que snapshot não serve aqui.
  // ⚠ `originalItemsSigRef` NÃO serve de baseline: ele cobre só os campos de
  // COMPRA do item (itemsPurchaseSig), não o formulário.
  const [hasUnsavedEdits, setHasUnsavedEdits] = useState(false);
  const [pendingExit, setPendingExit] = useState<null | (() => void)>(null);
  // O mesmo diálogo serve pra Voltar/Cancelar e pra cópia, mas o texto genérico
  // ("descarta o que foi digitado") seria meia-verdade no fluxo de cópia: os
  // valores digitados VÃO junto na cópia; quem se perde é só o pedido original.
  const [pendingExitIsCopy, setPendingExitIsCopy] = useState(false);

  // Sair da tela mata o "Desfazer" pendente: ele restauraria itens de um
  // formulário que não está mais montado — botão morto. O toast não expira
  // sozinho (fica até fechar), então sem isto ele sobreviveria à navegação.
  useEffect(() => () => { toast.dismiss(PV_ITEM_DELETE_TOAST_ID); }, []);

  // Guarda de F5 / fechar aba / sair do site. Só o nativo do browser funciona
  // aqui; diálogo próprio não é permitido neste evento.
  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedEdits]);

  /** Envolve uma saída de tela: sem edição pendente sai direto; com edição, pergunta. */
  const guardExit = (go: () => void, opts?: { isCopy?: boolean }) => () => {
    if (!hasUnsavedEdits) { go(); return; }
    setPendingExitIsCopy(!!opts?.isCopy);
    setPendingExit(() => go);
  };

  const originalItemsSigRef = useRef<string | null>(null);
  const originalDeadlineRef = useRef<string | null>(null);
  useEffect(() => {
    if (isEdit && originalItemsSigRef.current === null && items.some(i => i.reference_id)) {
      originalItemsSigRef.current = itemsPurchaseSig(items);
      originalDeadlineRef.current = form.delivery_deadline || '';
    }
  }, [isEdit, items]);
  const [capacityResult, setCapacityResult] = useState<CapacityCheckResult | null>(null);
  const [capacityDialogOpen, setCapacityDialogOpen] = useState(false);
  const [minBillingDialogOpen, setMinBillingDialogOpen] = useState(false);
  const [minBillingSuggestion, setMinBillingSuggestion] = useState<MinBillingResult | null>(null);
  const [computingMinBilling, setComputingMinBilling] = useState(false);
  const [creditLimitConfirm, setCreditLimitConfirm] = useState<null | {
    clientName: string;
    exposure: number;
    orderTotal: number;
    projected: number;
    limit: number;
    submitOptions: SubmitOptions;
  }>(null);
  // Estado (c) das travas de venda: a checagem NÃO rodou (banco fora, rede caída,
  // RPC com erro). Não é "checou e passou" nem "checou e reprovou" — e até
  // 2026-08-05 se comportava como o primeiro: o erro ia pro console (ou era
  // descartado no Promise.allSettled) e o PV salvava como se estivesse tudo em
  // ordem, ou seja, indisponibilidade do banco virava "pode vender".
  // Fail-closed cego também não serve (venda é o fluxo que paga a empresa), então
  // o meio-termo é este: a UI DIZ o que não conseguiu verificar e o usuário
  // confirma explicitamente. `resume` é o ponto exato onde o fluxo continua.
  const [unverifiedConfirm, setUnverifiedConfirm] = useState<null | {
    what: string;
    consequence: string;
    detail?: string;
    resume: () => void;
  }>(null);
  const [billingOverrideConfirm, setBillingOverrideConfirm] = useState<null | {
    newISO: string;
    minDateISO: string;
  }>(null);
  const [billingOverrideReason, setBillingOverrideReason] = useState('');
  // Dialog de terceirização da costura: abre após save quando o PV foi
  // salvo com manual_billing_override=true. saleOrderId fica setado pra
  // o dialog buscar as OPs criadas e disparar a RPC.
  const [sendSectorOpen, setSendSectorOpen] = useState(false);
  const [outsourceCosturaOpen, setOutsourceCosturaOpen] = useState(false);
  const [outsourceCosturaPvId, setOutsourceCosturaPvId] = useState<string | null>(null);
  const [outsourceCosturaPendingNav, setOutsourceCosturaPendingNav] = useState<boolean>(false);
  // Atalho "Gerar OS por Pedido" — abre o assistente de terceirização já com este
  // PV selecionado. genOsNavAfter=true quando aberto na finalização (fechar → /sales).
  const queryClient = useQueryClient();
  const [genOsOpen, setGenOsOpen] = useState(false);
  const [genOsPvId, setGenOsPvId] = useState<string | null>(null);
  const [genOsNavAfter, setGenOsNavAfter] = useState(false);
  const [postSaveOsOpen, setPostSaveOsOpen] = useState(false);
  const [postSaveOsPvId, setPostSaveOsPvId] = useState<string | null>(null);
  const capacityOutsourceAfterSaveRef = useRef(false);
  // Live min billing date for the persistent red badge in the form panel.
  // Edit mode → server compute_min_billing_date(id). New mode → frontend
  // computeMinBillingForNewOrder over current items. Recomputed with debounce.
  const [liveMinBillingISO, setLiveMinBillingISO] = useState<string | null>(null);
  const [computingLive, setComputingLive] = useState(false);

  // Always-current form ref so setTimeout callbacks don't capture stale closures
  const formLatestRef = useRef(form);
  useEffect(() => { formLatestRef.current = form; }, [form]);

  // Auto-deriva delivery_deadline a partir de delivery_month + delivery_week.
  // Antes o usuário tinha QUE preencher os 2 (mês+semana + data) — sem sentido
  // já que a data é determinística (segunda da semana N do mês). Agora só o
  // par mês+semana é editável; a data é resultado.
  useEffect(() => {
    if (!form.delivery_month || !form.delivery_week) return;
    const derived = monthWeekToISODate(form.delivery_month, form.delivery_week);
    if (derived && derived !== form.delivery_deadline) {
      setForm(f => ({ ...f, delivery_deadline: derived }));
    }
  }, [form.delivery_month, form.delivery_week]);

  // Min-billing dialog re-entry: handleMinBillingConfirm/Manual chamam
  // submitInternal({ skipMinBillingCheck: true }) pra evitar reabrir o dialog
  // que o usuário acabou de confirmar. Substitui o antigo skipMinBillingCheckRef
  // (useRef + setTimeout) por passagem explícita de parâmetro — mais previsível
  // em duplo-click / re-render.

  // Recalculate live min_billing_date with debounce whenever items change
  // (or on edit mode load). Drives the red badge in SaleOrderFormPanel.
  useEffect(() => {
    const validItems = items.filter(i => i.reference_id && i.quantity > 0);
    if (validItems.length === 0) {
      setLiveMinBillingISO(null);
      return;
    }
    let cancelled = false;
    const timeout = setTimeout(async () => {
      setComputingLive(true);
      try {
        if (isEdit && id) {
          const iso = await fetchMinBillingDate(id);
          if (!cancelled) setLiveMinBillingISO(iso);
        } else {
          const capInputs = validItems.map((it) => {
            const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
            const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
            return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
          });
          const suggestion = await computeMinBillingForNewOrder(capInputs);
          if (!cancelled) setLiveMinBillingISO(suggestion?.minDateISO || null);
        }
      } catch {
        if (!cancelled) setLiveMinBillingISO(null);
      } finally {
        if (!cancelled) setComputingLive(false);
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [items, isEdit, id, canonicalReferences]);

  // ⚠ PERF: esta função desce como prop até SaleOrderItemForm, que é `memo()`.
  // Se ela mudar de identidade a cada render, o memo vira no-op e TODOS os itens do
  // PV re-renderizam a cada tecla. Não dá pra só envolver em useCallback com as 5
  // dependências (uma delas é `items`, que muda a cada digitação) — então o estado
  // vai num ref lido só na hora do clique, e a função fica estável de verdade.
  const draftStateRef = useRef({ form, items, selectedClientId, packagingProductId, packagingQuantity });
  draftStateRef.current = { form, items, selectedClientId, packagingProductId, packagingQuantity };

  const handleSaveStateAndNavigate = useCallback(() => {
    sessionStorage.setItem(
      draftKey,
      JSON.stringify({ ownerId: user?.id, ...draftStateRef.current, savedAt: Date.now() }),
    );
    navigate('/estoque?returnTo=sale-order');
  }, [draftKey, navigate, user?.id]);

  // Load existing order for edit (only once, after references are ready)
  useEffect(() => {
    if (!id || orderLoaded || referencesLoading) return;
    (async () => {
      setLoading(true);
      const { data: order } = await supabase.from('sale_orders').select('*').eq('id', id).single();
      if (!order) { toast.error('Pedido não encontrado'); navigate('/sales'); return; }
      const rep = representatives.find(r => r.name === order.representative);
      setForm({
        client_id: (order as any).client_id || null,
        // Sem carregar company_id, reabrir o PV mostrava o emitente como matriz/
        // padrão e um novo save sobrescrevia a coluna com null. (PV-00140, 2026-06-16)
        company_id: (order as any).company_id || null,
        client_name: order.client_name || '', client_cnpj: order.client_cnpj || '',
        client_contact: order.client_contact || '', client_order_number: order.client_order_number || '',
        representative: rep?.id || (order as any).representative_id || '',
        payment_condition: order.payment_condition || '', delivery_deadline: order.delivery_deadline || '',
        delivery_week: (order as any).delivery_week || '', delivery_month: (order as any).delivery_month || '',
        notes: order.notes || '', status: order.status || 'Pendente',
        nfe: order.nfe || '', remessa: order.remessa || '',
        is_factoring: (order as any).is_factoring || false,
        factoring_config_id: (order as any).factoring_config_id || '',
        packaging_mode: (order as any).packaging_mode || 'colmeia',
        // Sem carregar, reabrir o PV mostraria 'grade' e o save gravaria por cima
        // da escolha — o mesmo furo que já custou company_id e nfe_external.
        box_grouping: (order as any).box_grouping || 'grade',
        shipping_rate_per_pair: Number((order as any).shipping_rate_per_pair) || 0,
        nfe_required: (order as any).nfe_required !== false,
        own_delivery: (order as any).own_delivery === true,
        informacoes_complementares_nf: (order as any).informacoes_complementares_nf || '',
        brand: (order as any).brand || 'Squad Shoes',
        order_type: (order as any).order_type || 'carteira',
        // Sem carregar estes dois, reabrir um PV "NF externa" o mostrava como
        // interno e (com o RPC já gravando a coluna) o save resetava pra false.
        nfe_external: (order as any).nfe_external === true,
        external_nfe_number: (order as any).external_nfe_number || '',
      });
      setPackagingProductId((order as any).packaging_product_id || '');
      setPackagingQuantity((order as any).packaging_quantity || 0);
      const client = clients.find(c => c.razao_social === order.client_name);
      setSelectedClientId(client?.id || '');
      const { data: orderItems } = await supabase.from('sale_order_items').select('*').eq('sale_order_id', id);
      if (orderItems && orderItems.length > 0) {
        const mapped = orderItems.map(i => mapLoadedSaleOrderItem(i, canonicalReferenceIdMap));
        // Sort items so that the same reference (and color) always appears together in editing
        const refLabel = (refId: string) => {
          const ref = (references as any[]).find(r => r.id === refId);
          return (ref?.code || ref?.name || refId || '').toString();
        };
        mapped.sort((a, b) => {
          const cmp = refLabel(a.reference_id).localeCompare(refLabel(b.reference_id), 'pt-BR', { numeric: true, sensitivity: 'base' });
          if (cmp !== 0) return cmp;
          return (a.color || '').localeCompare(b.color || '', 'pt-BR', { sensitivity: 'base' });
        });
        originalStrapSourcingRef.current = new Map(mapped.flatMap((item) => {
          if (!item.id) return [];
          return [[item.id, {
            revision: Number(item.strap_sourcing_revision) || 0,
            lines: buildExtraItemColumns(item).strap_sourcing as NonNullable<SaleOrderItemFormData['strap_sourcing']>,
          }]];
        }));
        setItems(mapped);
      }
      setOrderLoaded(true);
      setLoading(false);
    })();
  }, [id, orderLoaded, referencesLoading, canonicalReferenceIdMap]);

  // Update representative match when reps load after order
  useEffect(() => {
    if (!orderLoaded || !id) return;
    if (form.representative) return; // already matched
    (async () => {
      const { data: order } = await supabase.from('sale_orders').select('representative, representative_id').eq('id', id).single();
      if (!order) return;
      const rep = representatives.find(r => r.name === order.representative);
      if (rep) setForm(f => ({ ...f, representative: rep.id }));
    })();
  }, [representatives.length, orderLoaded]);

  // Update client match when clients load after order
  useEffect(() => {
    if (!orderLoaded || selectedClientId) return;
    const client = clients.find(c => c.razao_social === form.client_name);
    if (client) setSelectedClientId(client.id);
  }, [clients.length, orderLoaded]);

  const handleClientSelect = (clientId: string) => {
    setSelectedClientId(clientId);
    const client = clients.find(c => c.id === clientId);
    if (client) {
      // client_id grava o FK pra clients — antes só os campos texto eram
      // salvos, deixando a coluna client_id null e quebrando JOINs.
      setForm(f => ({
        ...f,
        client_id: client.id,
        client_name: client.razao_social,
        client_cnpj: client.cnpj || '',
        client_contact: client.contato || '',
      }));
    }
  };

  /**
   * "Copiar p/ novo PV" (barra de lote da edição): valida a seleção, resolve
   * variantes de material ativas e monta o seed via buildCopySeedPayload (que
   * documenta o que viaja e o que fica). O novo PV nasce Rascunho e passa por
   * TODO o fluxo normal de criação (crédito, semana mínima, estoque, tira sem
   * cor) — por isso a cópia semeia o formulário em vez de criar o PV direto no
   * banco.
   */
  const buildCopySeed = async (indices: number[]): Promise<SaleOrderCopySeed | null> => {
    const selected = indices.map(i => items[i]).filter(Boolean);
    const seedItems = selected.filter(it => it.reference_id);
    if (seedItems.length === 0) {
      toast.error('Selecione ao menos um item com referência preenchida pra copiar.');
      return null;
    }
    if (seedItems.length < selected.length) {
      toast.warning(`${selected.length - seedItems.length} item(ns) sem referência foram ignorados na cópia.`);
    }

    // Mesma guarda do "Duplicar por Grupo": variante de material pode ter sido
    // inativada desde a criação do pedido — copiar o id obsoleto bloquearia a
    // emissão da NF-e do novo PV (emit-nfe devolve 400 pra variante inativa).
    const variantIds = [...new Set(seedItems.map(i => i.material_variant_id).filter(Boolean))] as string[];
    let activeVariantIds = new Set<string>();
    if (variantIds.length > 0) {
      const { data: activeVariants } = await (supabase as any)
        .from('reference_material_variants')
        .select('id')
        .in('id', variantIds)
        .eq('active', true);
      activeVariantIds = new Set((activeVariants || []).map((v: any) => v.id));
      const staleCount = variantIds.filter(vid => !activeVariantIds.has(vid)).length;
      if (staleCount > 0) {
        toast.warning(`${staleCount} variação(ões) de material inativa(s) — o campo será limpo nos itens copiados.`);
      }
    }

    // Empresa emitente: só copiamos se ainda estiver ativa (ver doc de
    // buildCopySeedPayload — desativada some do seletor e o PV nasceria com o
    // CNPJ errado na NF-e sem nada aparecer na tela).
    const copiedCompanyId = (formLatestRef.current as any).company_id as string | null | undefined;
    let companyIsActive = true;
    if (copiedCompanyId) {
      const { data: company } = await supabase
        .from('companies')
        .select('id')
        .eq('id', copiedCompanyId)
        .eq('active', true)
        .maybeSingle();
      companyIsActive = !!company;
      if (!companyIsActive) {
        toast.warning('Empresa emitente do pedido original está inativa — o novo PV usará a empresa primária.');
      }
    }

    // Número do PV de origem pro toast do seed (form.order_number não é
    // populado na carga da edição — buscar é 1 select barato em ação de clique).
    let sourceOrderNumber: string | null = null;
    if (id) {
      const { data: src } = await supabase
        .from('sale_orders')
        .select('order_number')
        .eq('id', id)
        .maybeSingle();
      sourceOrderNumber = (src as any)?.order_number || null;
    }

    return buildCopySeedPayload({
      seedItems,
      form: formLatestRef.current,
      selectedClientId,
      sourceOrderNumber,
      activeVariantIds,
      companyIsActive,
    });
  };

  /**
   * "Excluir selecionados" da barra de lote (só na edição). Tira os itens da
   * lista e oferece Desfazer num toast que fica ATÉ o usuário fechar.
   *
   * A exclusão é local: o banco só perde a linha quando o PV é salvo — aí
   * `update_sale_order_atomic` apaga o que sumiu do payload. Por isso não há
   * diálogo aqui (decisão do dono); o Desfazer é a rede.
   *
   * ⚠ O toast tem id FIXO de propósito: uma segunda exclusão SUBSTITUI o Desfazer
   * anterior, então só a última é desfazível (decisão do dono). Sem id fixo eles
   * empilhariam e, como não expiram sozinhos, entulhariam a tela no celular.
   */
  const handleDeleteSelectedItems = (indices: number[]) => {
    const { remaining, removed } = removeItemsAtIndices(items, indices);
    if (removed.length === 0) return;
    setItems(remaining);

    const n = removed.length;
    toast.warning(
      `${n} ${n === 1 ? 'referência removida' : 'referências removidas'} — salve o pedido para aplicar.`,
      {
        id: PV_ITEM_DELETE_TOAST_ID,
        duration: Infinity,
        action: {
          label: 'Desfazer',
          onClick: () => {
            // Devolve às posições originais. `restoreItemsAt` limita o índice ao
            // tamanho atual: como o toast não expira, a lista pode ter encolhido
            // desde a exclusão.
            setItems(prev => restoreItemsAt(prev, removed));
            toast.dismiss(PV_ITEM_DELETE_TOAST_ID);
            // Não desarma `hasUnsavedEdits`: pode haver outras edições na tela.
          },
        },
      },
    );
  };

  const handleCopyItemsToNewOrder = async (indices: number[]) => {
    const seed = await buildCopySeed(indices);
    if (!seed) return;
    // O seed só toca o storage DENTRO do go(): se o usuário cancelar o diálogo
    // de "sair sem salvar", nada fica pendurado pra uma visita futura a
    // /sales/new consumir por engano.
    guardExit(() => {
      try {
        sessionStorage.setItem(SALE_ORDER_COPY_SEED_KEY, JSON.stringify(seed));
      } catch {
        toast.error('Não foi possível preparar a cópia (armazenamento do navegador indisponível).');
        return;
      }
      navigate('/sales/new');
    }, { isCopy: true })();
  };

  /**
   * #3 Guardrail de margem (pós-save, NÃO bloqueia). Decisão do usuário (2026-06-01):
   * avisar pós-save + piso = prejuízo (<0%). Custeia o pedido recém-salvo via
   * calculate_order_cost e:
   *  - margem < 0 → toast de erro (vende abaixo do custo) — o caso acionável;
   *  - margem ≥ 0 mas custo PARCIAL → toast.info (margem otimista) — porque hoje
   *    o MOD (cronoanálise/bom_operations) e larguras de ficha podem faltar,
   *    subestimando o custo e inflando a margem. persist=true também popula
   *    order_costs (usado no Relatório Gerencial). Falha no custeio é silenciosa
   *    (o pedido já foi salvo); roda async sem travar a navegação.
   */
  const isCostPartial = (c: OrderCostResult): boolean => {
    const noLabor = !c.labor_cost || c.labor_cost <= 0; // MOD ausente (sem cronoanálise)
    const scan = (r?: OrderCostResult) => (r?.breakdown?.materials || []).some(m => !!m.conversion_warning);
    const widthMissing = scan(c) || (c.items || []).some(scan); // largura de ficha faltando
    return noLabor || widthMissing;
  };

  const checkMarginAfterSave = async (orderId?: string) => {
    if (!orderId) return;
    try {
      const cost = await calculateOrderCost(orderId, undefined, true);
      const partial = isCostPartial(cost);
      const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      if (Number(cost.margin) < 0) {
        toast.error(
          `Margem NEGATIVA neste PV: ${Number(cost.margin_pct).toFixed(1)}% ` +
          `(receita ${fmt(cost.revenue)} − custo ${fmt(cost.total_cost)})` +
          (partial ? ' · custo parcial (MOD/largura faltando — margem ainda otimista)' : ''),
          { duration: 12000 },
        );
      } else if (partial && Number(cost.total_cost) > 0) {
        toast.info(
          `Margem estimada ${Number(cost.margin_pct).toFixed(1)}% — custo parcial ` +
          `(MOD/largura faltando), pode estar otimista.`,
          { duration: 7000 },
        );
      } else if (Number(cost.total_cost) > 0) {
        // #4 guardrail: margem ≥ 0 e custo COMPLETO, mas abaixo do PISO da ficha
        // (technical_sheets.safety_margin_pct; a ficha tem id === reference_id do
        // item). Avisa (não bloqueia) — antes só alertava prejuízo (<0%).
        const refIds = items.map(i => i.reference_id).filter((x): x is string => !!x);
        if (refIds.length > 0) {
          const { data: sheets } = await supabase
            .from('technical_sheets')
            .select('safety_margin_pct')
            .in('id', refIds);
          const floors = (sheets || [])
            .map(s => Number((s as { safety_margin_pct: number | null }).safety_margin_pct) || 0)
            .filter(v => v > 0);
          const floor = floors.length ? Math.min(...floors) : 0;
          if (floor > 0 && Number(cost.margin_pct) < floor) {
            toast.warning(
              `Margem ${Number(cost.margin_pct).toFixed(1)}% abaixo do piso da ficha (${floor.toFixed(0)}%).`,
              { duration: 8000 },
            );
          }
        }
      }
    } catch {
      /* custeio falhou — não atrapalha o salvamento, que já foi persistido */
    }
  };

  /**
   * Executa de fato a mutação (sem pre-checks de OPs). Separado de doSubmit
   * pra permitir re-disparo após confirmação do CancelOpsAndEditDialog.
   */
  const dispatchMutation = (statusOverride?: string, cancelOpIds: string[] = []) => {
    const f = formLatestRef.current;
    const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
    const total = validItems.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    const rep = representatives.find(r => r.id === f.representative);
    const commission_value = rep ? total * (rep.commission_pct ?? 0) / 100 : 0;
    const orderData = { ...f, representative: rep?.name || f.representative };
    if (statusOverride) orderData.status = statusOverride;
    const resolvedClientId = (f as any).client_id || selectedClientId || null;

    // A origem das tiras já foi escolhida por linha no formulário. Ao salvar,
    // trigger + fila canônicos fazem netting, lote e compra; não existe segundo
    // escritor de OC/OS no cliente.
    const isOverride = !!(f as any).manual_billing_override;
    const handlePostSave = async (pvId: string | undefined) => {
      // Salvou: desarma a guarda. Sem isto o beforeunload continuaria disparando
      // depois do save, e os diálogos de pós-save (tiras, OS, costura) navegam
      // sozinhos — o usuário levaria um aviso de "alterações não salvas" logo
      // depois de o toast dizer que salvou.
      setHasUnsavedEdits(false);
      // Salvou: a exclusão já foi aplicada no banco. Um "Desfazer" ainda aberto
      // restauraria os itens só na tela e daria a falsa impressão de que voltaram.
      toast.dismiss(PV_ITEM_DELETE_TOAST_ID);
      void checkMarginAfterSave(pvId);
      if (!pvId) { navigate('/sales'); return; }
      if (validItems.some((item) => Array.isArray(item.strap_colors) && item.strap_colors.length > 0)) {
        toast.info('Demanda de tiras enviada ao processamento canônico. Acompanhe em Engenharia → Tiras → Demandas.');
      }
      if (isOverride) {
        setOutsourceCosturaPvId(pvId);
        setOutsourceCosturaPendingNav(true);
        setOutsourceCosturaOpen(true);
      } else {
        if (capacityOutsourceAfterSaveRef.current) {
          capacityOutsourceAfterSaveRef.current = false;
          setGenOsPvId(pvId);
          setGenOsNavAfter(true);
          setGenOsOpen(true);
          return;
        }
        // Atalho de finalização: se o pedido tem algum serviço terceirizável pendente,
        // oferece gerar OS por pedido antes de sair (best-effort — falha não bloqueia).
        try {
          const { data: outLines } = await (supabase as any).rpc('get_pv_outsourceable_lines', { p_sale_order_id: pvId });
          const actionable = (outLines || []).some((l: any) =>
            !l.already_has_os && String(l.sector_status || '').toLowerCase() !== 'concluido');
          if (actionable) { setPostSaveOsPvId(pvId); setPostSaveOsOpen(true); return; }
        } catch { /* segue pro fluxo normal */ }
        navigate('/sales');
      }
    };

    if (isEdit) {
      updateOrder.mutate({
        id: id!,
        order: orderData,
        items: validItems,
        client_id: resolvedClientId,
        representative_id: f.representative || null,
        commission_value,
        packaging_product_id: packagingProductId || null,
        packaging_quantity: packagingQuantity,
        cancel_op_ids: cancelOpIds,
      } as any, {
        onSuccess: () => {
          if (cancelOpIds.length > 0) {
            cancelOpsPreflightRunningRef.current = false;
            setCancelOpsPreflight({ isRunning: false, error: null });
            setCancelOpsDialog({ open: false, ops: [] });
            toast.success(
              `${cancelOpIds.length} OP${cancelOpIds.length === 1 ? '' : 's'} cancelada${cancelOpIds.length === 1 ? '' : 's'} e edição salva atomicamente.`,
            );
          }
          handlePostSave(id!);
        },
        onError: (error: unknown) => {
          if (cancelOpIds.length > 0) {
            const message = error instanceof Error
              ? error.message
              : error && typeof error === 'object' && 'message' in error
                ? String((error as { message?: unknown }).message || 'O servidor recusou a edição atômica.')
                : 'O servidor recusou a edição atômica.';
            cancelOpsPreflightRunningRef.current = false;
            setCancelOpsPreflight({ isRunning: false, error: message });
          }
          if (!isCommittedStrapSourcingError(error)) return;
          if (!isAdmin) {
            toast.error(
              'A origem já possui compromisso operacional. Somente o Administrador pode reconciliá-la; nenhum campo do PV foi salvo.',
              { duration: 9000 },
            );
            return;
          }
          const candidate = validItems
            .flatMap((item) => {
              if (!item.id) return [];
              const baseline = originalStrapSourcingRef.current.get(item.id);
              const lines = buildExtraItemColumns(item).strap_sourcing as NonNullable<SaleOrderItemFormData['strap_sourcing']>;
              if (!baseline || sameStrapSourcingSelection(baseline.lines, lines)) return [];
              const reference = canonicalReferences.find((entry) => entry.id === item.reference_id);
              const referenceLabel = reference
                ? `${reference.code || ''} ${reference.name || ''}`.trim() || item.reference_id
                : item.reference_id;
              return [{
                saleOrderItemId: item.id,
                expectedRevision: Number(item.strap_sourcing_revision ?? baseline.revision),
                referenceLabel,
                lines,
                detectionDiagnostic: strapSourcingErrorDetails(error),
              } satisfies StrapSourcingAdminOverrideTarget];
            })
            .sort((left, right) => left.saleOrderItemId.localeCompare(right.saleOrderItemId))[0];
          if (!candidate) {
            toast.error(
              'O servidor detectou uma origem comprometida, mas a linha alterada não pôde ser identificada com segurança. Recarregue o PV; nenhum override foi tentado.',
              { duration: 10000 },
            );
            return;
          }
          setStrapOverrideTarget(candidate);
        },
      });
    } else {
      const clientRequestId = clientRequestIdRef.current ?? crypto.randomUUID();
      clientRequestIdRef.current = clientRequestId;
      createOrder.mutate({
        order: orderData,
        items: validItems,
        client_id: resolvedClientId,
        representative_id: f.representative || null,
        commission_value,
        packaging_product_id: packagingProductId || null,
        packaging_quantity: packagingQuantity,
        client_request_id: clientRequestId,
      } as any, {
        onSuccess: (created: { id?: string } | undefined) => {
          clientRequestIdRef.current = null;
          handlePostSave(created?.id);
        },
      });
    }
  };

  const doSubmit = async (statusOverride?: string) => {
    const f = formLatestRef.current;
    const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
    if (validItems.length === 0) {
      toast.error('Adicione pelo menos um item ao pedido.');
      return;
    }
    if (validItems.some(i => !i.color?.trim())) {
      toast.error('Selecione uma cor para todos os itens.');
      return;
    }
    // Paridade com handleSubmit: dialogs de confirmação chamam doSubmit direto,
    // então o guard de tira sem cor também precisa valer aqui.
    {
      const tiraSemCor = findTiraSemCor(validItems);
      if (tiraSemCor) { toast.error(tiraSemCor, { duration: 8000 }); return; }
    }
    if (validItems.some(i => i.quantity <= 0)) {
      toast.error('A quantidade dos itens deve ser maior que zero.');
      return;
    }
    // Audit visual: factoring marcado sem config selecionada criava registro
    // inválido (is_factoring=true, factoring_config_id='') que quebrava o
    // syncFinancialRecords ao faturar. Bloqueia explicitamente.
    if (f.is_factoring && !f.factoring_config_id) {
      toast.error('Selecione qual factoring está antecipando este pedido.');
      return;
    }

    // Pre-check em edição: se existem OPs em produção avançada vinculadas a
    // este PV, abre dialog de confirmação ao invés de deixar o guard do
    // useUpdateSaleOrder falhar com toast genérico. O dialog oferece batch
    // cancel + re-tentativa em 1 clique.
    if (isEdit && id) {
      const { data: blocking } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .eq('sale_order_id', id)
        .in('status', ['Em Produção', 'Concluída', 'Finalizado']);
      if (blocking && blocking.length > 0) {
        setCancelOpsPreflight({ isRunning: false, error: null });
        setCancelOpsDialog({
          open: true,
          ops: blocking as BlockingOp[],
          pendingStatusOverride: statusOverride,
        });
        return;
      }
    }

    dispatchMutation(statusOverride);
  };

  const handleConfirmCancelOps = () => {
    if (cancelOpsPreflightRunningRef.current || updateOrder.isPending) return;
    const ops = cancelOpsDialog.ops;
    const pendingOverride = cancelOpsDialog.pendingStatusOverride;
    cancelOpsPreflightRunningRef.current = true;
    setCancelOpsPreflight({ isRunning: true, error: null });
    dispatchMutation(pendingOverride, ops.map((op) => op.id));
  };

  const handleSubmit = async (
    e: React.FormEvent,
    opts: SubmitOptions = {},
  ) => {
    e.preventDefault();
    if ((isEdit && !perm.canEdit) || (!isEdit && !perm.canCreate)) {
      toast.error('Você não tem permissão para salvar pedidos de venda.');
      return;
    }
    const f = formLatestRef.current;
    const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
    if (validItems.length === 0) { toast.error('Adicione pelo menos um item ao pedido.'); return; }
    if (validItems.some(i => !i.color?.trim())) { toast.error('Selecione uma cor para todos os itens.'); return; }
    const missingStrapSnapshots = listMissingTechnicalStrapSnapshots(validItems, canonicalReferences as any[]);
    if (missingStrapSnapshots.length > 0) {
      toast.error(
        `Demanda de tira não resolvida em ${missingStrapSnapshots[0].label}: a ficha exige tiras, mas o item está sem linhas técnicas. ` +
        'Cadastre as tiras na ficha técnica e volte ao pedido; o sistema não infere cor ou variante.',
        { duration: 8000 },
      );
      return;
    }
    // GUARD: bloqueia salvar com TIRA de cor vazia (débito pulado em silêncio).
    {
      const tiraSemCor = findTiraSemCor(validItems);
      if (tiraSemCor) { toast.error(tiraSemCor, { duration: 8000 }); return; }
    }
    // GUARD: bloqueia salvar com cor não cadastrada no material (cabedal/forração/
    // tira). Sem produto na cor, o débito é pulado (ruptura). Cadastre antes.
    {
      const pendentes = Object.entries(colorIssues).filter(([k]) => {
        const i = Number(k);
        return i < items.length && !!items[i]?.reference_id;
      });
      if (pendentes.length > 0) {
        const [, first] = pendentes[0];
        toast.error(
          first.message || (
            `Cor "${first.color}" não cadastrada em ${first.materials.join(', ')}. ` +
            `Use o botão "Cadastrar" no item para registrar a cor antes de salvar o pedido.`
          ),
          { duration: 8000 },
        );
        return;
      }
    }
    if (!f.delivery_month) { toast.error('Selecione o mês de faturamento.'); return; }
    if (!f.delivery_week) { toast.error('Selecione a semana de faturamento.'); return; }
    if (f.is_factoring && !f.factoring_config_id) {
      toast.error('Selecione qual factoring está antecipando este pedido.');
      return;
    }

    // 0) Em pedidos NOVOS com cliente cadastrado, valida limite de crédito.
    //    Permite seguir mediante confirmação, mas avisa explicitamente.
    if (!isEdit && selectedClientId && !opts.skipCreditCheck) {
      try {
        const { data: client, error: clientErr } = await supabase
          .from('clients')
          .select('credit_limit, name')
          .eq('id', selectedClientId)
          .maybeSingle() as any;
        // O destructure ignorava `error`: consulta falhada devolve data=null, o
        // limite virava 0 e a trava concluía "cliente sem limite cadastrado" —
        // falha (c) DISFARÇADA de (a), sem nem passar pelo catch abaixo.
        if (clientErr) throw clientErr;
        const limit = Number(client?.credit_limit || 0);
        if (limit > 0) {
          // Filtrava por `accounts_receivable.client_id`, NULO em 70 dos 72
          // títulos: a exposição dava sempre 0 e a trava nunca disparava.
          // Ver clientCreditExposure — o vínculo real é via sale_order_id.
          const exposure = await fetchClientCreditExposure(selectedClientId);
          const orderTotal = validItems.reduce(
            (s, i) => s + (Number(i.unit_price) || 0) * (Number(i.quantity) || 0),
            0,
          );
          const projected = exposure + orderTotal;
          if (projected > limit) {
            setCreditLimitConfirm({
              clientName: client.name || f.client_name || 'Cliente',
              exposure,
              orderTotal,
              projected,
              limit,
              submitOptions: opts,
            });
            return;
          }
        }
      } catch (err: any) {
        // (c) não deu pra checar. Antes seguia direto pro save — cliente estourado
        // passava batido sempre que a consulta falhasse.
        console.warn('[handleSubmit] credit limit check falhou:', err);
        setUnverifiedConfirm({
          what: 'o limite de crédito deste cliente',
          consequence: 'O pedido pode ultrapassar o limite em aberto sem ninguém ser avisado.',
          detail: err?.message,
          resume: () => {
            const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
            void handleSubmit(fakeEvent, { ...opts, skipCreditCheck: true });
          },
        });
        return;
      }
    }

    // 1) Sugere a semana mínima de faturamento antes dos checks de estoque.
    //    Se a data estiver vazia OU for anterior ao mínimo calculado, abre o diálogo.
    //    opts.skipMinBillingCheck=true vem de handleMinBillingConfirm/handleMinBillingManual
    //    pra evitar reabrir o dialog após o usuário já ter confirmado.
    const doMinBillingCheck = !isEdit && validItems.length > 0 && !opts.skipMinBillingCheck;
    if (doMinBillingCheck) {
      setComputingMinBilling(true);
      try {
        // Edit mode: server-side compute_min_billing_date(id) — alinhada com
        // compute_wave_timeline (mesmos 8 setores + buffer + supplier).
        // New mode: itera capacidade setorial via computeMinBillingForNewOrder.
        let suggestion: MinBillingResult | null = null;
        if (isEdit && id) {
          const iso = await fetchMinBillingDate(id);
          // Server-side não detalha gargalo — defaults equivalem aos defaults
          // do MinBillingDateSuggestionDialog (bottleneck 'nenhum' não renderiza
          // a seção de gargalo), preservando o comportamento anterior.
          if (iso) {
            suggestion = {
              minDateISO: iso, minWeekISO: toISOWeek(iso),
              bottleneck: 'nenhum', capacityReadyDateISO: iso,
              materialReadyDateISO: iso, materialShortfalls: [],
            };
          }
        } else {
          const capInputs = validItems.map((it) => {
            const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
            const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
            return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
          });
          suggestion = await computeMinBillingForNewOrder(capInputs);
        }
        setComputingMinBilling(false);
        if (suggestion) {
          const needsConfirm =
            !f.delivery_deadline || isBeforeMinDate(f.delivery_deadline, suggestion.minDateISO);
          if (needsConfirm) {
            setMinBillingSuggestion(suggestion);
            setMinBillingDialogOpen(true);
            return;
          }
        }
      } catch (err: any) {
        setComputingMinBilling(false);
        // Falha silenciosa antes invalidava o fluxo sem aviso ao usuário.
        // Toast garante que problema de capacidade/rede vire visível.
        toast.error('Não foi possível calcular a semana mínima', {
          description: err?.message ?? 'Você pode prosseguir, mas o sistema não verificou a disponibilidade da capacidade dos setores.',
        });
      }
    }

    // Bug fix (2026-06-02): em EDIÇÃO, não re-perguntar sobre compra/capacidade
    // quando nada relevante mudou. Itens de compra inalterados (ref/qtd/cor/grade/
    // tiras) → não re-checa estoque/solado (prompt "gerar Ordem de Compra?"). Se a
    // data de faturamento também não mudou → salva direto (pula a capacidade tb).
    // Só itens OU data mudando é que volta a checar. Na dúvida, checa (seguro).
    if (isEdit && originalItemsSigRef.current !== null && itemsPurchaseSig(items) === originalItemsSigRef.current) {
      if (originalDeadlineRef.current !== null && (f.delivery_deadline || '') === originalDeadlineRef.current) {
        doSubmit();
        return;
      }
      await runCapacityCheck(validItems);
      return;
    }

    // Check stock availability for all items in parallel
    setCheckingStock(true);
    // Run all stock checks concurrently. `allSettled` nunca rejeita — quem diz se
    // a consulta de cada item respondeu é o status do resultado, checado abaixo.
    const stockResults = await Promise.allSettled(
      validItems.map(async (item) => {
        const ref = canonicalReferences.find((r: any) => r.id === item.reference_id);
        const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : item.reference_id.substring(0, 8);
        // Passa strap_colors + grade pra que a checagem detecte shortage
        // de TIRAS (não só componentes regulares). Sem isso, tiras sem estoque
        // passavam invisíveis pelo PV → OS pra terceiro nunca era criada.
        const availability = await checkStock(
          item.reference_id,
          item.quantity,
          item.color || '',
          (item as any).grade ?? null,
          (item as any).strap_colors ?? null,
          // Modo de embalagem do PV: filtra a caixa do modo errado quando a
          // ficha tem colmeia E individual no BOM (paridade com o custeio).
          f.packaging_mode || null,
          // Variante de material do item (CONS-4): sem ela a checagem
          // avaliava o material da FICHA, não o da variante escolhida.
          (item as any).material_variant_id ?? null,
        );
        return { availability, refLabel, color: item.color };
      })
    );

    // Segunda metade da checagem (materiais → solado → capacidade). Extraída pra
    // poder ser RETOMADA depois que o usuário confirmar um "não consegui verificar"
    // — assim os itens que RESPONDERAM continuam abrindo os diálogos de compra
    // normais em vez de a falta virar save direto.
    const continueAfterStockCheck = async () => {
      try {
        // Collect all insufficient materials
        // Passa color + grade do item do PV pra cada shortage. A função
        // enrichMaterialShortages decide se mantém esses campos (solados →
        // agrupa por cor/grade) ou descarta (forros/tiras → agrega por
        // product_id apenas).
        const rawShortages: Array<{ product_id: string; product_name: string; required: number; available: number; referenceLabel: string; color?: string | null; grade?: Record<string, number> | null }> = [];
        const validItemsList = validItems;
        let resultIdx = 0;
        for (const result of stockResults) {
          const sourceItem = validItemsList[resultIdx];
          resultIdx += 1;
          if (result.status !== 'fulfilled' || !result.value.availability) continue;
          const itemGrade = (sourceItem as any)?.grade ?? null;
          const itemColor = result.value.color || null;
          for (const mat of result.value.availability) {
            if (!mat.sufficient) {
              rawShortages.push({
                product_id: mat.product_id,
                product_name: mat.product_name,
                required: mat.required,
                available: mat.available,
                referenceLabel: `${result.value.refLabel} (${itemColor || 'sem cor'})`,
                color: itemColor,
                grade: itemGrade,
              });
            }
          }
        }

        // TIRAS são tratadas EXCLUSIVAMENTE pela fila canônica após o save. Remove
        // tiras deste caminho antigo pra NÃO gerar OC DUPLICADA.
        // Exclui: (a) product_id nulo = tira de cor nova sem produto (check_stock_availability
        // agora emite a falta, mas quem resolve é o dialog de tiras); (b) produtos cujo grupo
        // é de tira — identificado pelos group_ids das strap_colors dos itens (autoritativo) +
        // regex de nome de grupo como reforço.
        const strapGroupIds = new Set<string>();
        for (const it of validItems) {
          const straps = Array.isArray((it as any).strap_colors) ? (it as any).strap_colors : [];
          for (const s of straps) if (s?.group_id) strapGroupIds.add(String(s.group_id));
        }
        const STRAP_GROUP_RE = /tira|el[aá]stic|tran[çc]/i;

        let materialShortages = rawShortages.filter((s) => s.product_id != null);
        if (rawShortages.length > 0) {
          // Enriquece solados: substitui cor do sapato pela cor real cadastrada do solado
          // (check_stock_availability não retorna cor do solado). E identifica tiras pra excluir.
          const productIds = [...new Set(rawShortages.map((s) => s.product_id).filter(Boolean))];
          const { data: prodMeta } = await supabase
            .from('products')
            .select('id, category, color, group_id, product_groups(name)')
            .in('id', productIds);
          const strapProductIds = new Set(
            (prodMeta || [])
              .filter((p: any) =>
                strapGroupIds.has(String(p.group_id)) || STRAP_GROUP_RE.test(p.product_groups?.name || ''))
              .map((p: any) => p.id as string)
          );
          materialShortages = materialShortages.filter((s) => !strapProductIds.has(s.product_id));

          const soleColor = new Map(
            (prodMeta || [])
              .filter((p: any) => p.category === 'Solado' && p.color)
              .map((p: any) => [p.id, p.color as string])
          );
          for (const s of materialShortages) {
            const realColor = soleColor.get(s.product_id);
            if (realColor) s.color = realColor;
          }
        }

        if (materialShortages.length > 0) {
          const enriched = await enrichMaterialShortages(materialShortages);
          if (enriched.shortages.length > 0) {
            setMaterialResult(enriched);
            setMaterialDialogOpen(true);
            setCheckingStock(false);
            return;
          }
        }

        // Material OK — check sole availability and offer to generate POs
        const soleCheck = await checkSoleAvailability(
          validItems.map((it) => {
            const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
            const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
            return {
              reference_id: it.reference_id,
              material_variant_id: it.material_variant_id || null,
              color: it.color || '',
              totalPairs: it.quantity,
              referenceLabel: refLabel,
              grade: (it as any).grade || null,
              orderNumber: f.client_order_number || null,
            };
          })
        );
        setCheckingStock(false);
        if (soleCheck.shortages.length > 0 || soleCheck.insoleShortages.length > 0) {
          setSoleResult(soleCheck);
          setSoleDialogOpen(true);
          return;
        }
        // Check de capacidade setorial
        await runCapacityCheck(validItems);
      } catch (err: any) {
        // (c) a checagem de material/solado morreu no meio (RPC, rede, enriquecimento).
        // Antes caía direto no doSubmit(): o PV era salvo sem ninguém saber que a
        // verificação de compra nem terminou.
        setCheckingStock(false);
        setUnverifiedConfirm({
          what: 'a disponibilidade de materiais e de solado deste pedido',
          consequence: 'O pedido pode ser salvo com material ou solado em falta, sem a Ordem de Compra ser oferecida.',
          detail: err?.message,
          resume: () => { void runCapacityCheck(validItems); },
        });
      }
    };

    // (c) por item: consulta que NÃO respondeu (RPC com erro, rede fora) ou que
    // voltou sem payload. Antes essas falhas eram descartadas no mesmo `continue`
    // dos itens sem falta, então "não consegui checar" saía do funil idêntico a
    // "checou e está tudo em estoque".
    const unverifiedItems: string[] = [];
    stockResults.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value.availability) return;
      const item = validItems[idx];
      const ref = canonicalReferences.find((r: any) => r.id === item?.reference_id);
      const refLabel = result.status === 'fulfilled'
        ? result.value.refLabel
        : (ref
          ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim()
          : String(item?.reference_id || '').substring(0, 8));
      unverifiedItems.push(`${refLabel} (${item?.color || 'sem cor'})`);
    });

    if (unverifiedItems.length > 0) {
      const failed = stockResults.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      // PV com muitos itens: lista os 5 primeiros pra não estourar o diálogo.
      const listados = unverifiedItems.slice(0, 5).join('; ')
        + (unverifiedItems.length > 5 ? ` e mais ${unverifiedItems.length - 5}` : '');
      setCheckingStock(false);
      setUnverifiedConfirm({
        what: unverifiedItems.length === 1
          ? `o estoque de 1 item: ${unverifiedItems[0]}`
          : `o estoque de ${unverifiedItems.length} itens: ${listados}`,
        consequence: 'Pode faltar material na produção sem a Ordem de Compra ser oferecida. Os itens que responderam seguem sendo checados normalmente.',
        detail: failed ? (failed.reason?.message ?? String(failed.reason)) : undefined,
        resume: () => { setCheckingStock(true); void continueAfterStockCheck(); },
      });
      return;
    }

    await continueAfterStockCheck();
  };

  const handleMinBillingConfirm = () => {
    if (!minBillingSuggestion) {
      setMinBillingDialogOpen(false);
      return;
    }
    const newISO = minBillingSuggestion.minDateISO;
    const newWeek = minBillingSuggestion.minWeekISO;
    // Recompõe delivery_month + delivery_week (formato "Sn") junto com o
    // deadline ISO. Sem isso o submit subsequente caía no
    // `if (!f.delivery_month)` e abortava silenciosamente.
    const mw = isoToMonthWeek(newISO);
    setForm((f) => ({
      ...f,
      delivery_deadline: newISO,
      delivery_month: mw?.month ?? f.delivery_month,
      delivery_week: mw?.week ?? f.delivery_week,
    }));
    setMinBillingDialogOpen(false);
    toast.success(`Faturamento ajustado para ${formatDateBR(newISO)} (${newWeek}).`);
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(fakeEvent, { skipMinBillingCheck: true });
    }, 50);
  };

  const applyMinBillingManual = (newISO: string, reason: string | null) => {
    if (!minBillingSuggestion) {
      setMinBillingDialogOpen(false);
      return;
    }
    const isOverride = isBeforeMinDate(newISO, minBillingSuggestion.minDateISO);
    // Recompõe month + week (formato "Sn") junto — sem isso o submit subsequente
    // tropeça no `if (!f.delivery_month)` ou na auto-derivação que reescreve o
    // deadline a partir de campos vazios, e o pedido nunca salva (override admin
    // travava aqui: trava por 50ms, abre toast escondido, volta ao pedido).
    const mw = isoToMonthWeek(newISO);
    setForm((f) => ({
      ...f,
      delivery_deadline: newISO,
      delivery_month: mw?.month ?? f.delivery_month,
      delivery_week: mw?.week ?? f.delivery_week,
      manual_billing_override: isOverride,
      original_min_billing_date: isOverride ? minBillingSuggestion.minDateISO : null,
      manual_override_reason: isOverride ? reason : null,
    }));
    setMinBillingDialogOpen(false);
    if (isOverride) {
      toast.warning(
        `Data anterior ao mínimo. O pedido será marcado como override manual.`,
      );
    }
    setTimeout(() => {
      const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
      handleSubmit(fakeEvent, { skipMinBillingCheck: true });
    }, 50);
  };

  const handleMinBillingManual = (newISO: string) => {
    if (!minBillingSuggestion) {
      setMinBillingDialogOpen(false);
      return;
    }
    if (isBeforeMinDate(newISO, minBillingSuggestion.minDateISO)) {
      setBillingOverrideReason('');
      setBillingOverrideConfirm({ newISO, minDateISO: minBillingSuggestion.minDateISO });
      return;
    }
    applyMinBillingManual(newISO, null);
  };

  const handleBillingOverrideConfirm = () => {
    const reason = billingOverrideReason.trim();
    if (!billingOverrideConfirm || !reason) {
      toast.error('Motivo do override é obrigatório para datas abaixo da mínima.');
      return;
    }
    const { newISO } = billingOverrideConfirm;
    setBillingOverrideConfirm(null);
    setBillingOverrideReason('');
    applyMinBillingManual(newISO, reason);
  };

  const runCapacityCheck = async (validItems: SaleOrderItemFormData[]) => {
    const deadline = formLatestRef.current.delivery_deadline;
    if (!deadline) {
      doSubmit();
      return;
    }
    try {
      const capInputs = validItems.map((it) => {
        const ref = canonicalReferences.find((r: any) => r.id === it.reference_id);
        const refLabel = ref ? `${(ref as any).code || ''} - ${(ref as any).name || ''}`.trim() : it.reference_id.substring(0, 8);
        return { reference_id: it.reference_id, reference_label: refLabel, quantity: it.quantity };
      });
      const cap = await checkSectorCapacity(capInputs, deadline);
      if (cap.hasOverload) {
        setCapacityResult(cap);
        setCapacityDialogOpen(true);
        return;
      }
      doSubmit();
    } catch (err: any) {
      // (c) não deu pra calcular a capacidade. Antes ia direto pro doSubmit(): o
      // PV entrava numa semana possivelmente lotada e ninguém era avisado.
      setUnverifiedConfirm({
        what: 'a capacidade dos setores para a data de faturamento escolhida',
        consequence: 'O pedido pode cair numa semana já lotada, sem OS de terceirização para o excedente.',
        detail: err?.message,
        resume: () => { void doSubmit(); },
      });
    }
  };

  const handleCapacityKeepDate = () => {
    setCapacityDialogOpen(false);
    if (!capacityResult) { doSubmit(); return; }
    // A OS precisa nascer depois do PV e das OPs. O fluxo antigo tentava criar
    // antes do save, sem OP, sem tarifa e sem vínculo confiável. Guardamos a
    // escolha e abrimos o assistente canônico assim que o pedido for persistido.
    capacityOutsourceAfterSaveRef.current = true;
    doSubmit();
  };

  const handleCapacityPostpone = (newISO: string) => {
    setCapacityDialogOpen(false);
    setForm((f) => ({ ...f, delivery_deadline: newISO }));
    toast.info(`Data de faturamento ajustada para ${formatDateBR(newISO)}.`);
    setTimeout(() => doSubmit(), 100);
  };

  // Admin override: pula a criação automática de OS terceirizada e salva o PV
  // assumindo que o admin já resolveu por fora (terceirizado próprio, material
  // emprestado, hora extra). Motivo do override é registrado em notes do PV.
  const handleCapacityAdminOverride = (reason: string) => {
    setCapacityDialogOpen(false);
    const existingNotes = (formLatestRef.current as any).notes || '';
    const overrideNote = `[OVERRIDE CAPACIDADE ${new Date().toLocaleDateString('pt-BR')}] ${reason}`;
    setForm((f) => ({
      ...f,
      notes: existingNotes ? `${existingNotes}\n${overrideNote}` : overrideNote,
    } as any));
    toast.warning('Override aplicado — pedido salvo sob sua responsabilidade.');
    setTimeout(() => doSubmit(), 100);
  };

  const handleSoleConfirm = (_generatedPO: boolean) => {
    setSoleDialogOpen(false);
    if (soleResult?.minBillingDateISO && !form.delivery_deadline) {
      setForm(f => ({ ...f, delivery_deadline: soleResult.minBillingDateISO! }));
    }
    setTimeout(() => {
      const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
      runCapacityCheck(validItems);
    }, 100);
  };

  /**
   * Fecha um portão do fluxo de save AVISANDO que o pedido não foi salvo.
   *
   * O save do PV passa por até 4 diálogos em sequência (material, solado,
   * capacidade, data mínima). Fechar qualquer um deles — Esc, X, clique fora ou
   * o botão "Cancelar" — apenas escondia a janela: o save nunca acontecia e nada
   * dizia isso. O usuário voltava para o formulário preenchido sem saber se
   * salvou, e o jeito de descobrir era ir na lista procurar o PV.
   * (auditoria PV 07/08/2026)
   *
   * ⚠ Só entra no caminho de ABANDONO. Os botões de confirmação chamam
   * `onConfirm`/`onConfirmMin`, e os handlers fecham por setState — mudança de
   * prop controlada não dispara `onOpenChange`, então não há aviso falso.
   */
  const abortSubmit = (setOpen: (v: boolean) => void, etapa: string) => (open: boolean) => {
    setOpen(open);
    if (open) return;
    toast.info(`Pedido não salvo — você saiu da etapa de ${etapa}.`, {
      description: 'O que você preencheu continua aqui. Clique em Salvar para retomar.',
    });
  };

  const handleMaterialConfirm = (action: 'with_po' | 'without_po' | 'draft') => {
    setMaterialDialogOpen(false);
    if (action !== 'draft' && materialResult?.minPurchaseDateISO && !form.delivery_deadline) {
      setForm(f => ({ ...f, delivery_deadline: materialResult.minPurchaseDateISO! }));
    }
    setTimeout(() => {
      if (action === 'draft') { doSubmit('Rascunho'); return; }
      const validItems = items.filter(i => i.reference_id).map(normalizeItemReference);
      runCapacityCheck(validItems);
    }, 100);
  };

  if (loading) {
    return (
      <FormSkeleton blocks={3} fieldsPerBlock={4} />
    );
  }

  return (
    <>
      <div className="w-full space-y-6 pb-20">
        <EditorialPageHeader
          sectionNumber={isEdit ? '02' : '01'}
          sectionLabel="COMERCIAL · Pedido de Venda"
          title={isEdit ? 'Editar Pedido' : 'Novo Pedido'}
          description={isEdit ? 'Revise o cliente, os itens e as condições antes de salvar.' : 'Cadastre o cliente, inclua as referências e revise as condições antes de criar.'}
          meta={isEdit && form?.order_number ? <span>PEDIDO <strong>{form.order_number}</strong></span> : undefined}
          actions={
            <>
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={guardExit(() => navigate('/sales'))}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              {/* Audit visual #16: mostra order_number (PV-2026-XXXXX) em vez
                  de UUID truncado no header. UUID é interno e irrelevante
                  pra usuário. Cai no UUID truncado só se ainda não carregou. */}
              {isEdit && (form?.order_number || id) && (
                <Badge variant="secondary" className="hidden font-mono sm:inline-flex">
                  {form?.order_number || id?.substring(0, 8)}
                </Badge>
              )}
              {isEdit && id && (
                <Button
                  variant="outline" size="sm" className="h-9 gap-1.5"
                  onClick={() => { setGenOsPvId(id); setGenOsNavAfter(false); setGenOsOpen(true); }}
                >
                  <Handshake className="h-4 w-4" /> Gerar OS
                </Button>
              )}
              {/* Envio POSTERIOR: setor que não foi marcado nos itens antes da OP
                  nascer, ou OS que falhou na criação automática (o trigger engole
                  o erro de propósito — falhar a OS não pode travar a OP). */}
              {isEdit && id && (
                <Button
                  variant="outline" size="sm" className="h-9 gap-1.5"
                  onClick={() => setSendSectorOpen(true)}
                >
                  <PaperPlaneTilt className="h-4 w-4" /> Enviar pra prestador
                </Button>
              )}
            </>
          }
        />

        <SaleOrderFormPanel
          saleOrderId={isEdit ? id : null}
          form={form}
          setForm={setForm}
          items={items}
          setItems={setItems}
          clients={clients}
          representatives={representatives}
          references={canonicalReferences}
          isAdmin={isAdmin}
          selectedClientId={selectedClientId}
          onClientSelect={handleClientSelect}
          onSubmit={handleSubmit}
          onCancel={guardExit(() => navigate('/sales'))}
          onUserEdit={() => setHasUnsavedEdits(true)}
          isPending={createOrder.isPending || updateOrder.isPending || checkingStock || computingMinBilling}
          submitLabel={
            computingMinBilling
              ? 'Calculando semana mínima...'
              : checkingStock
                ? 'Verificando estoque...'
                : (isEdit ? 'Salvar Alterações' : 'Criar Pedido')
          }
          packagingProductId={packagingProductId}
          onPackagingProductChange={setPackagingProductId}
          packagingQuantity={packagingQuantity}
          onPackagingQuantityChange={setPackagingQuantity}
          onSaveStateAndNavigate={!isEdit ? handleSaveStateAndNavigate : undefined}
          onCopyToNewOrder={isEdit ? handleCopyItemsToNewOrder : undefined}
          onDeleteSelectedItems={isEdit ? handleDeleteSelectedItems : undefined}
          minBillingISO={liveMinBillingISO}
          computingMinBilling={computingLive}
          onColorIssueChange={handleColorIssueChange}
        />

        {/* OS deste pedido (read-only) — geração fica em Terceirizados → Gerar OS por Pedido */}
        {isEdit && id && (
          <div className="mt-4">
            <PvServiceOrdersCard saleOrderId={id} />
          </div>
        )}

        {isEdit && id && (
          <SendSectorToContractorDialog
            open={sendSectorOpen}
            onOpenChange={setSendSectorOpen}
            saleOrderId={id}
            saleOrderLabel={form?.order_number || null}
          />
        )}
      </div>

      {/* Dialog de rascunho — opt-in pra restaurar / descartar */}
      <Dialog
        open={!!pendingDraft}
        onOpenChange={(o) => { if (!o) dismissDraftPrompt(); }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-primary" />
              Rascunho encontrado
            </DialogTitle>
            <DialogDescription>
              {pendingDraft?.savedAt
                ? `Salvo em ${new Date(pendingDraft.savedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`
                : 'Rascunho de pedido encontrado.'}
              {' — '}
              {pendingDraft?.source === 'session'
                ? 'Você saiu pra outra tela e voltou.'
                : 'Você fechou a aba antes de salvar.'}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs space-y-1">
            <div><span className="text-muted-foreground">Cliente:</span> <strong>{pendingDraft?.form?.client_name || '—'}</strong></div>
            <div><span className="text-muted-foreground">Itens:</span> <strong>{pendingDraft?.items?.length ?? 0}</strong></div>
            {pendingDraft?.form?.delivery_deadline && (
              <div><span className="text-muted-foreground">Prazo:</span> <strong>{pendingDraft.form.delivery_deadline}</strong></div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={discardDraft}>
              Descartar
            </Button>
            <Button onClick={restoreDraft} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar rascunho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MaterialPurchaseConfirmDialog
        open={materialDialogOpen}
        onOpenChange={abortSubmit(setMaterialDialogOpen, 'compra de material')}
        result={materialResult}
        saleOrderId={isEdit ? id : null}
        onConfirm={handleMaterialConfirm}
      />

      <SolePurchaseConfirmDialog
        open={soleDialogOpen}
        onOpenChange={abortSubmit(setSoleDialogOpen, 'compra de solado')}
        result={soleResult}
        onConfirm={handleSoleConfirm}
      />

      <SectorOverloadDialog
        open={capacityDialogOpen}
        onOpenChange={abortSubmit(setCapacityDialogOpen, 'capacidade de setor')}
        result={capacityResult}
        onKeepDateAndOutsource={handleCapacityKeepDate}
        onPostponeDate={handleCapacityPostpone}
        onAdminOverride={handleCapacityAdminOverride}
      />

      <MinBillingDateSuggestionDialog
        open={minBillingDialogOpen}
        onOpenChange={abortSubmit(setMinBillingDialogOpen, 'data mínima de faturamento')}
        minDateISO={minBillingSuggestion?.minDateISO || ''}
        minWeekISO={minBillingSuggestion?.minWeekISO || ''}
        bottleneck={minBillingSuggestion?.bottleneck}
        capacityReadyDateISO={minBillingSuggestion?.capacityReadyDateISO}
        materialReadyDateISO={minBillingSuggestion?.materialReadyDateISO}
        materialShortfalls={minBillingSuggestion?.materialShortfalls}
        onConfirmMin={handleMinBillingConfirm}
        onPickManual={handleMinBillingManual}
        isAdmin={isAdmin}
        userPickedDateISO={form.delivery_deadline || null}
      />

      <AlertDialog
        open={creditLimitConfirm !== null}
        onOpenChange={(open) => { if (!open) setCreditLimitConfirm(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Limite de crédito ultrapassado
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>O novo pedido de <strong className="text-foreground">{creditLimitConfirm?.clientName}</strong> elevará a exposição acima do limite cadastrado.</p>
                <dl className="space-y-1.5 rounded-md border border-border/60 bg-muted/30 p-3 text-sm tabular-nums">
                  {([
                    ['Em aberto', creditLimitConfirm?.exposure],
                    ['Este PV', creditLimitConfirm?.orderTotal],
                    ['Total projetado', creditLimitConfirm?.projected],
                    ['Limite de crédito', creditLimitConfirm?.limit],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-4">
                      <dt>{label}</dt>
                      <dd className="font-mono font-semibold text-foreground">{formatCurrency(value || 0)}</dd>
                    </div>
                  ))}
                </dl>
                <p>Confirme somente se a venda acima do limite já foi autorizada.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revisar pedido</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = creditLimitConfirm;
                setCreditLimitConfirm(null);
                if (!pending) return;
                setTimeout(() => {
                  const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
                  void handleSubmit(fakeEvent, { ...pending.submitOptions, skipCreditCheck: true });
                }, 0);
              }}
            >
              Prosseguir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Estado (c) das travas: a checagem não rodou. Nem salva calado (o que
          fazia até 2026-08-05) nem bloqueia sozinho — diz o que ficou sem
          verificar e exige confirmação explícita, no mesmo desenho do diálogo de
          limite de crédito acima. */}
      <AlertDialog
        open={unverifiedConfirm !== null}
        onOpenChange={(open) => { if (!open) setUnverifiedConfirm(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Não foi possível verificar
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  O sistema não conseguiu verificar{' '}
                  <strong className="text-foreground">{unverifiedConfirm?.what}</strong>.
                  Isso <strong className="text-foreground">não</strong> quer dizer que está tudo certo — quer dizer que a consulta falhou.
                </p>
                {unverifiedConfirm?.detail && (
                  <p className="rounded-md border border-border/60 bg-muted/30 p-3 font-mono text-xs break-words">
                    {unverifiedConfirm.detail}
                  </p>
                )}
                <p>{unverifiedConfirm?.consequence}</p>
                <p>Prossiga somente se você já sabe que dá pra atender. Se preferir, volte e salve de novo em instantes.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revisar pedido</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const pending = unverifiedConfirm;
                setUnverifiedConfirm(null);
                if (!pending) return;
                setTimeout(() => pending.resume(), 0);
              }}
            >
              Prosseguir mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={billingOverrideConfirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBillingOverrideConfirm(null);
            setBillingOverrideReason('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Justificar antecipação do faturamento</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>A data escolhida é anterior à mínima calculada e exige um motivo para o log de auditoria.</p>
                <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-sm">
                  <span>Data escolhida</span>
                  <span className="font-mono tabular-nums text-foreground">{billingOverrideConfirm?.newISO || '—'}</span>
                  <span>Data mínima</span>
                  <span className="font-mono tabular-nums text-foreground">{billingOverrideConfirm?.minDateISO || '—'}</span>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="billing-override-reason" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Motivo obrigatório
            </label>
            <Textarea
              id="billing-override-reason"
              value={billingOverrideReason}
              onChange={(event) => setBillingOverrideReason(event.target.value)}
              placeholder="Explique por que este pedido precisa ser antecipado"
              className="min-h-24 resize-none"
              autoFocus
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                if (!billingOverrideReason.trim()) {
                  event.preventDefault();
                  toast.error('Motivo do override é obrigatório para datas abaixo da mínima.');
                  return;
                }
                handleBillingOverrideConfirm();
              }}
            >
              Confirmar antecipação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OverrideOutsourceCosturaDialog
        open={outsourceCosturaOpen}
        saleOrderId={outsourceCosturaPvId}
        onClose={() => {
          setOutsourceCosturaOpen(false);
          if (outsourceCosturaPendingNav) {
            setOutsourceCosturaPendingNav(false);
            navigate('/sales');
          }
        }}
      />

      <StrapSourcingAdminOverrideDialog
        target={strapOverrideTarget}
        onClose={() => setStrapOverrideTarget(null)}
        onApplied={(result) => {
          const lines = result.strap_sourcing || strapOverrideTarget?.lines || {};
          originalStrapSourcingRef.current.set(result.sale_order_item_id, {
            revision: result.strap_sourcing_revision,
            lines,
          });
          setItems((current) => current.map((item) => item.id === result.sale_order_item_id
            ? {
              ...item,
              strap_sourcing: lines,
              strap_sourcing_revision: result.strap_sourcing_revision,
            }
            : item));
          setStrapOverrideTarget(null);
          setHasUnsavedEdits(true);
          toast.info('Origem reconciliada. Revise os demais campos e clique em salvar novamente; eles ainda não foram gravados.');
        }}
      />

      <CancelOpsAndEditDialog
        open={cancelOpsDialog.open}
        onOpenChange={(v) => {
          if (!v && !updateOrder.isPending && !cancelOpsPreflight.isRunning) {
            cancelOpsPreflightRunningRef.current = false;
            setCancelOpsDialog({ open: false, ops: [] });
            setCancelOpsPreflight({ isRunning: false, error: null });
          }
        }}
        ops={cancelOpsDialog.ops}
        isPreflighting={cancelOpsPreflight.isRunning}
        preflightError={cancelOpsPreflight.error}
        isCancelling={updateOrder.isPending && cancelOpsDialog.open}
        onConfirm={handleConfirmCancelOps}
      />

      {/* Atalho de finalização: oferece gerar OS de terceirização deste pedido */}
      <Dialog
        open={postSaveOsOpen}
        onOpenChange={(o) => { if (!o) { setPostSaveOsOpen(false); navigate('/sales'); } }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" weight="fill" /> Pedido salvo
            </DialogTitle>
            <DialogDescription>
              Quer colocar algum serviço deste pedido na rua agora? Ex.: forração de palmilha, solagem.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setPostSaveOsOpen(false); navigate('/sales'); }}>
              Concluir
            </Button>
            <Button onClick={() => { setPostSaveOsOpen(false); setGenOsPvId(postSaveOsPvId); setGenOsNavAfter(true); setGenOsOpen(true); }}>
              <Handshake className="h-4 w-4 mr-1" /> Gerar OS por Pedido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateServiceOrdersWizard
        open={genOsOpen}
        onOpenChange={(o) => {
          setGenOsOpen(o);
          if (!o && genOsNavAfter) { setGenOsNavAfter(false); navigate('/sales'); }
        }}
        initialSaleOrderId={genOsPvId || undefined}
        onGenerated={() => {
          if (genOsPvId) queryClient.invalidateQueries({ queryKey: ['pv_service_orders', genOsPvId] });
        }}
      />

      {/* Saída com alterações pendentes. Cobre Voltar e Cancelar (navegação
          interna do router, que o beforeunload NÃO pega — ele só vale pra F5,
          fechar aba e sair do site). */}
      <AlertDialog
        open={pendingExit !== null}
        onOpenChange={(o) => {
          if (o) return;
          // Desistir aqui aborta a cópia inteira — sem este aviso o clique em
          // "Copiar p/ novo PV" simplesmente não fazia nada visível.
          if (pendingExitIsCopy) toast.info('Cópia cancelada — nada foi copiado.');
          setPendingExitIsCopy(false);
          setPendingExit(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingExitIsCopy ? 'Copiar e sair sem salvar?' : 'Sair sem salvar?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingExitIsCopy
                ? 'Os itens copiados levam o que está na tela agora, inclusive o que você ainda não salvou. ' +
                  'As alterações DESTE pedido, porém, serão descartadas — ele volta ao último estado salvo.'
                : 'Você alterou este pedido e ainda não salvou. Sair agora descarta o que foi digitado.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              // preventDefault pelo mesmo motivo do AlertDialog de /sales: o
              // Action é um Dialog.Close e fecharia por conta própria depois do
              // nosso handler. Aqui o efeito seria só cosmético, mas o padrão fica
              // consistente e à prova de encadear outro diálogo depois.
              onClick={(e) => {
                e.preventDefault();
                const go = pendingExit;
                setPendingExit(null);
                setPendingExitIsCopy(false);
                setHasUnsavedEdits(false);
                go?.();
              }}
            >
              {pendingExitIsCopy ? 'Descartar aqui e copiar' : 'Descartar e sair'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
