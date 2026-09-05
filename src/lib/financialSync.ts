/**
 * Núcleo do sync financeiro do PV (accounts_receivable + financial_entries).
 *
 * P0.4 (PRD 2026-07-03): extraído de useSaleOrders.ts para rodar TAMBÉM no
 * servidor (edge function `sync-ar`, service role) sem duplicar a lógica de
 * parcelas/factoring — o cliente supabase é INJETADO (`db`). O hook
 * `syncFinancialRecords` do frontend vira um wrapper fino sobre este core.
 *
 * ⚠ ESPELHO: supabase/functions/sync-ar/financialSync.ts precisa ser CÓPIA
 * byte-idêntica deste arquivo (assim como saleOrderAR.ts e factoringCalc.ts).
 * O teste src/lib/__tests__/financialSyncShared.parity.test.ts trava isso.
 *
 * Gate anti-ghost-revenue (estendido em 2026-07-03, decisão do usuário):
 * PV 'Faturado' que exige NF só reconhece receita se houver
 *   (a) NF-e AUTORIZADA em nfe_emitidas, OU
 *   (b) NF EXTERNA registrada (nfe_external=true, ou external_nfe_number/nfe
 *       preenchidos) — antes esses 27 PVs ficavam permanentemente sem AR.
 * PV sem documento nenhum continua barrado; a exceção auditada é o
 * `allowMissingNf` (só o backfill explícito via sync-ar usa), que grava as
 * parcelas com marcador BACKFILL_SEM_NF_MARKER em notes — e o branch de
 * cancelamento do gate PULA essas linhas (senão o próximo sync desfaria a
 * decisão do usuário).
 */

import { calculateFactoringDiscount } from './factoringCalc.ts';
import { computeARSchedule, type InstallmentSchedule } from './saleOrderAR.ts';

/** Cliente supabase (browser anon ou service-role) — API compatível supabase-js v2. */
export type DbClient = any;

export const BACKFILL_SEM_NF_MARKER = 'backfill-sem-nf';

/**
 * Data de hoje no fuso de Brasília (America/Sao_Paulo, UTC-3, sem horário de
 * verão). A edge function `sync-ar` roda em UTC — sem isto, um faturamento à
 * noite no Brasil (ex.: 22:30 de 31/07 = 01:30 UTC de 01/08) seria carimbado no
 * dia/mês seguinte, jogando a receita pro período errado na DRE. Funciona igual
 * no browser e no Deno. (code-review 2026-07-04, finding #4)
 */
function brDateISO(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

export interface SyncFinancialOptions {
  /**
   * Permite gerar AR para PV Faturado SEM documento fiscal (decisão explícita
   * do usuário, 2026-07-03, para os PVs legados). As parcelas nascem com
   * marcador de auditoria em notes. NUNCA usar no fluxo normal.
   */
  allowMissingNf?: boolean;
}

type ExistingAR = {
  id: string;
  status: string | null;
  installment_number: number | null;
  amount?: number;
  amount_received?: number | null;
  due_date?: string | null;
  notes?: string | null;
};

function hasRecordedReceipt(ar: ExistingAR): boolean {
  return ['received', 'recebido', 'partial', 'parcial'].includes(String(ar.status || '').toLowerCase())
    || Number(ar.amount_received ?? 0) > 0;
}

/**
 * Cancela somente cobranças sem nenhum caixa registrado. O filtro no UPDATE
 * repete a decisão no servidor para preservar uma baixa parcial que aconteça
 * entre a leitura inicial e esta mutação.
 */
async function cancelUnreceivedAR(
  db: DbClient,
  existingAR: ExistingAR[],
  operation: string,
) {
  const idsToCancel = existingAR
    .filter((ar) => !['cancelled', 'cancelado'].includes(String(ar.status || '')))
    .filter((ar) => !hasRecordedReceipt(ar))
    .map((ar) => ar.id);
  if (idsToCancel.length === 0) return;

  const { error } = await db.from('accounts_receivable')
    .update({ status: 'cancelled' })
    .in('id', idsToCancel)
    .not('status', 'in', '(received,recebido,partial,parcial,cancelled,cancelado)')
    .or('amount_received.is.null,amount_received.eq.0');
  if (error) throw new Error(`${operation}: ${error.message}`);
}

/**
 * Receita confirmada ainda e reversível: preserva a linha de auditoria como
 * estornada. Entries já postadas, pagas ou conciliadas ficam intocadas; rascunhos
 * continuam removidos como antes.
 */
async function reverseReversibleSaleOrderRevenue(
  db: DbClient,
  saleOrderId: string,
  operation: string,
) {
  const { error: reverseError } = await db.from('financial_entries')
    .update({ status: 'estornado' })
    .eq('reference_id', saleOrderId)
    .eq('reference_type', 'sale_order')
    .eq('type', 'receita')
    .eq('status', 'confirmed');
  if (reverseError) throw new Error(`${operation}: ${reverseError.message}`);

  const { error: deleteError } = await db.from('financial_entries')
    .delete()
    .eq('reference_id', saleOrderId)
    .eq('reference_type', 'sale_order')
    .eq('type', 'receita')
    .not('status', 'in', '(posted,paid,reconciled,confirmed,estornado,cancelado,cancelled)');
  if (deleteError) throw new Error(`${operation}: ${deleteError.message}`);
}

/**
 * Reconcilia as parcelas de accounts_receivable com o cronograma desejado.
 *  - Parcela existente sem baixa → UPDATE (valores/datas/labels).
 *  - Parcela parcial/recebida é sagrada — não toca.
 *  - Não existe → INSERT com (installment_number, total_installments).
 *  - Rows não-recebidas fora do cronograma ou duplicadas → CANCEL.
 */
export async function reconcileARInstallments(
  db: DbClient,
  saleOrderId: string,
  schedule: InstallmentSchedule[],
  existingAR: ExistingAR[],
  metadata: {
    client_name: string;
    client_cnpj: string;
    description_for: (s: InstallmentSchedule) => string;
    category: string;
    notes?: string | null;
  },
) {
  const must = (op: string, err: any) => { if (err) throw new Error(`${op}: ${err.message}`); };

  const N = schedule.length;
  const byNum = new Map<number, ExistingAR>();
  for (const ar of existingAR) {
    if (ar.status === 'cancelled') continue;
    if (ar.status === 'cancelado') continue;
    const num = ar.installment_number ?? 1;
    // Mais de 1 row no mesmo número (corrupção legacy ou race pré-constraint):
    // mantém o primeiro — os outros caem na limpeza final como duplicatas.
    if (!byNum.has(num)) byNum.set(num, ar);
  }

  for (const inst of schedule) {
    const existing = byNum.get(inst.installment_number);
    if (existing && hasRecordedReceipt(existing)) continue; // caixa registrado é sagrado
    if (existing) {
      const updatePayload: Record<string, any> = {
        amount: inst.amount,
        due_date: inst.due_date,
        installment_number: inst.installment_number,
        total_installments: inst.total_installments,
        client_name: metadata.client_name,
        client_cnpj: metadata.client_cnpj,
        description: metadata.description_for(inst),
      };
      if (metadata.notes !== undefined) updatePayload.notes = metadata.notes;
      const { error } = await db.from('accounts_receivable')
        .update(updatePayload)
        .eq('id', existing.id)
        .not('status', 'in', '(received,recebido,partial,parcial,cancelled,cancelado)')
        .or('amount_received.is.null,amount_received.eq.0');
      must(`Atualizar parcela ${inst.installment_number}/${N}`, error);
    } else {
      const { error } = await db.from('accounts_receivable').insert({
        sale_order_id: saleOrderId,
        client_name: metadata.client_name,
        client_cnpj: metadata.client_cnpj,
        description: metadata.description_for(inst),
        category: metadata.category,
        due_date: inst.due_date,
        amount: inst.amount,
        amount_received: 0,
        status: 'pending',
        installment_number: inst.installment_number,
        total_installments: inst.total_installments,
        ...(metadata.notes !== undefined ? { notes: metadata.notes } : {}),
      });
      must(`Inserir parcela ${inst.installment_number}/${N}`, error);
    }
  }

  // Cancela parcelas a mais (usuário reduziu o nº de parcelas) e duplicatas.
  const desiredNums = new Set(schedule.map((s) => s.installment_number));
  const rowsToCancel = existingAR
    .filter((ar) => !['cancelled', 'cancelado'].includes(String(ar.status || '')))
    .filter((ar) => !hasRecordedReceipt(ar))
    .filter((ar) => {
      const num = ar.installment_number ?? 1;
      if (!desiredNums.has(num)) return true; // parcela fora do schedule
      const owner = byNum.get(num);
      return owner ? owner.id !== ar.id : false; // duplicata: cancela todas exceto owner
    });

  await cancelUnreceivedAR(db, rowsToCancel, 'Cancelar parcelas extras/duplicadas');
}

/**
 * Sincroniza accounts_receivable + financial_entries de um PV conforme o status.
 * Idempotente: re-rodar não duplica (reconcilia por installment_number; entries
 * por (reference_id, reference_type) respeitando o índice único parcial).
 */
export async function syncFinancialRecordsCore(
  db: DbClient,
  saleOrderId: string,
  opts: SyncFinancialOptions = {},
) {
  const must = (op: string, err: any) => { if (err) throw new Error(`${op}: ${err.message}`); };

  const { data: so, error: soErr } = await db
    .from('sale_orders')
    .select('*')
    .eq('id', saleOrderId)
    .single();
  if (soErr) throw new Error(`Falha ao carregar PV ${saleOrderId}: ${soErr.message}`);
  if (!so) return;

  const { data: existingAR, error: arErr } = await db
    .from('accounts_receivable')
    .select('id, amount, amount_received, status, installment_number, total_installments, due_date, notes')
    .eq('sale_order_id', saleOrderId);
  must('Buscar contas a receber existentes', arErr);

  const total = Number(so.total) || 0;
  const nfeRequired: boolean = so.nfe_required;

  // PVs informais (nfe_required=false) e PVs finalizados sem NF não geram AR
  // nem lançamentos financeiros. Cancelamos qualquer AR pré-existente (caso
  // a flag tenha sido virada depois de Faturar) e saímos.
  if (nfeRequired === false || so.status === 'Finalizado s/ NF') {
    if (existingAR && existingAR.length > 0) {
      await cancelUnreceivedAR(db, existingAR, 'Cancelar AR de PV informal');
    }
    await reverseReversibleSaleOrderRevenue(db, saleOrderId, 'Estornar receita de PV informal');
    return;
  }

  if (so.status === 'Cancelado') {
    if (existingAR && existingAR.length > 0) {
      await cancelUnreceivedAR(db, existingAR, 'Cancelar contas a receber');
    }
    await reverseReversibleSaleOrderRevenue(db, saleOrderId, 'Estornar receita de PV cancelado');

    // Despesas de juros factoring podem ser sempre removidas no cancel — não vão
    // pro SPED e dependem 1:1 do PV ativo. Se PV reativar depois, o sync recria.
    const { error: delFactoringErr } = await db
      .from('financial_entries')
      .delete()
      .eq('reference_id', saleOrderId)
      .eq('reference_type', 'sale_order_factoring');
    must('Remover juros factoring de PV cancelado', delFactoringErr);
    return;
  }

  if (so.status === 'Faturado') {
    // Gate anti-ghost-revenue (auditoria fiscal C1 + extensão NF externa 2026-07-03):
    // reconhece receita se houver NF-e AUTORIZADA ou NF EXTERNA registrada.
    let arNotes: string | null | undefined = undefined;
    if ((nfeRequired as boolean) !== false) {
      const { data: authNfe, error: authErr } = await db
        .from('nfe_emitidas')
        .select('id')
        .eq('sale_order_id', saleOrderId)
        .eq('status', 'autorizada')
        .limit(1);
      must('Verificar NF-e autorizada (gate de receita)', authErr);
      const hasAuthorizedNfe = !!authNfe && authNfe.length > 0;
      // NF externa = marcador EXPLÍCITO (checkbox nfe_external ou número externo
      // digitado). NÃO usar so.nfe: esse campo texto é populado pelo trigger
      // sync_nfe_numero SÓ em NF autorizada e NUNCA é limpo quando a NF é
      // cancelada na SEFAZ e detectada pelo poller (sync-nfe-from-provider não
      // toca sale_orders). Usá-lo aqui ressuscitava receita fantasma de PV cuja
      // NF-e foi cancelada. (code-review 2026-07-04, finding #2)
      const hasExternalNfe =
        so.nfe_external === true ||
        String(so.external_nfe_number ?? '').trim() !== '';

      if (!hasAuthorizedNfe && !hasExternalNfe) {
        if (opts.allowMissingNf) {
          // Decisão explícita do usuário (backfill 2026-07): AR nasce mesmo sem
          // documento, com marcador de auditoria — e fica protegida do branch
          // de cancelamento abaixo em syncs futuros.
          arNotes = `${BACKFILL_SEM_NF_MARKER} — PV faturado sem NF (decisão usuário 2026-07-03)`;
        } else {
          console.warn(`syncFinancialRecords: PV ${saleOrderId} 'Faturado' SEM NF-e autorizada nem NF externa — receita NÃO reconhecida (gate anti-ghost-revenue).`);
          if (existingAR && existingAR.length > 0) {
            // Parcelas criadas pelo backfill autorizado NÃO são canceladas pelo
            // gate (senão cria/cancela em loop a cada sync).
            const regularAR = existingAR.filter((ar: ExistingAR) => !(ar.notes || '').includes(BACKFILL_SEM_NF_MARKER));
            await cancelUnreceivedAR(db, regularAR, 'Cancelar AR de PV sem NF autorizada');
            // Se só existem parcelas do backfill autorizado, mantém tudo como está.
            if (existingAR.some((ar: ExistingAR) => (ar.notes || '').includes(BACKFILL_SEM_NF_MARKER))) {
              return;
            }
          }
          await reverseReversibleSaleOrderRevenue(db, saleOrderId, 'Estornar receita barrada pelo gate fiscal');
          return;
        }
      }
    }
    // If factoring is enabled, calculate discounted amount and due date
    let factoringDiscountedTotal = total;
    let factoringConfigForEntry: { name?: string | null; receiving_days?: number; monthly_interest_rate?: number } | null = null;
    if (so.is_factoring && so.factoring_config_id) {
      const { data: factoringConfig } = await db
        .from('factoring_config')
        .select('name, receiving_days, monthly_interest_rate')
        .eq('id', so.factoring_config_id)
        .single();
      if (factoringConfig) {
        factoringConfigForEntry = factoringConfig as any;
        const { pv } = calculateFactoringDiscount({
          total,
          monthlyInterestRate: factoringConfig.monthly_interest_rate,
          paymentCondition: so.payment_condition,
          deliveryMonth: so.delivery_month,
          deliveryWeek: so.delivery_week,
          fallbackReceivingDays: factoringConfig.receiving_days,
        });
        factoringDiscountedTotal = pv;
      }
    }

    // Decisão Leonardo 2026-06-14 (regime caixa + factoring 1A): a AR é gravada
    // SEMPRE pelo valor BRUTO da venda (total). O custo do factoring vira uma
    // despesa financeira separada (reference_type='sale_order_factoring') —
    // debitado UMA única vez na DRE.
    const arTotal = total;
    const factoringDiscount = so.is_factoring ? (total - factoringDiscountedTotal) : 0;

    if (arTotal <= 0) {
      console.warn(`syncFinancialRecords: Faturado PV ${saleOrderId} has arTotal=${arTotal} — cancelling any existing AR to avoid ghost revenue.`);
      if (existingAR && existingAR.length > 0) {
        await cancelUnreceivedAR(db, existingAR, 'Cancelar AR de PV faturado com total zerado');
      }
      await reverseReversibleSaleOrderRevenue(db, saleOrderId, 'Estornar receita de PV faturado com total zerado');
      return;
    }

    // Cronograma de parcelas. payment_condition vira N rows em accounts_receivable.
    const schedule = computeARSchedule({
      total: arTotal,
      paymentCondition: so.payment_condition,
      deliveryDeadline: so.delivery_deadline,
      isFactoring: !!so.is_factoring,
      factoringReceivingDays: factoringConfigForEntry?.receiving_days ?? null,
      firstDueDateOverride: (so as any).nfe_first_due_date ?? null,
    });

    await reconcileARInstallments(db, saleOrderId, schedule, existingAR ?? [], {
      client_name: so.client_name || '',
      client_cnpj: so.client_cnpj || '',
      category: 'venda',
      notes: arNotes,
      description_for: (inst) => {
        const base = `Pedido ${so.order_number || saleOrderId}`;
        const installLabel = schedule.length > 1 ? ` (${inst.installment_number}/${schedule.length})` : '';
        const factoringLabel = so.is_factoring ? ` (Factoring - Desc. R$${factoringDiscount.toFixed(2)})` : '';
        return `${base}${installLabel}${factoringLabel}`;
      },
    });

    // Receita BRUTA (total) — desconto factoring vai como despesa separada.
    // Só considera lançamentos ATIVOS (trilha de auditoria preservada).
    const { data: existingEntry, error: feErr } = await db
      .from('financial_entries')
      .select('id, status')
      .eq('reference_id', saleOrderId)
      .eq('reference_type', 'sale_order')
      .eq('type', 'receita')
      .not('status', 'in', '(cancelado,cancelled,estornado)');
    must('Buscar financial_entries existentes', feErr);

    if (!existingEntry || existingEntry.length === 0) {
      const { error } = await db.from('financial_entries').insert({
        description: `Faturamento - ${so.client_name} - ${so.order_number || ''}`,
        amount: total,
        type: 'receita',
        entry_date: brDateISO(),
        reference_id: saleOrderId,
        reference_type: 'sale_order',
        status: 'confirmed',
      });
      must('Inserir financial_entry de faturamento', error);
    } else {
      const { error } = await db.from('financial_entries')
        .update({ amount: total, description: `Faturamento - ${so.client_name} - ${so.order_number || ''}` })
        .eq('reference_id', saleOrderId)
        .eq('reference_type', 'sale_order')
        .eq('type', 'receita')
        .eq('status', 'confirmed');
      must('Atualizar financial_entry de faturamento', error);
    }

    // Despesa financeira do desconto factoring — entry separada pra DRE.
    const { data: existingFactoringEntry } = await db
      .from('financial_entries')
      .select('id')
      .eq('reference_id', saleOrderId)
      .eq('reference_type', 'sale_order_factoring');

    if (factoringDiscount > 0 && factoringConfigForEntry) {
      const factoringDesc = `Juros factoring (${factoringConfigForEntry.name || 'config'}, ${factoringConfigForEntry.monthly_interest_rate}% a.m.) - ${so.client_name || ''} - ${so.order_number || ''}`;
      if (!existingFactoringEntry || existingFactoringEntry.length === 0) {
        const { error } = await db.from('financial_entries').insert({
          description: factoringDesc,
          amount: factoringDiscount,
          type: 'despesa',
          entry_date: brDateISO(),
          reference_id: saleOrderId,
          reference_type: 'sale_order_factoring',
          status: 'confirmed',
        });
        must('Inserir financial_entry de juros factoring', error);
      } else {
        // Idempotência: o valor do desconto é TRAVADO na criação. Recalcular
        // aqui vs `new Date()` encolhia a despesa a cada re-sync (menos dias de
        // juros até o vencimento) e fazia browser(UTC-3) e edge(UTC) se
        // sobrescreverem perto da meia-noite. Só o rótulo é atualizado.
        // (code-review 2026-07-04, finding #3)
        const { error } = await db.from('financial_entries')
          .update({ description: factoringDesc })
          .eq('reference_id', saleOrderId)
          .eq('reference_type', 'sale_order_factoring');
        must('Atualizar rótulo de juros factoring', error);
      }
    } else if (existingFactoringEntry && existingFactoringEntry.length > 0) {
      // Factoring foi desligado pós-faturamento ou desconto zerado: remove entry
      // legacy pra não inflar despesas financeiras na DRE.
      const idsToDelete = existingFactoringEntry.map((e: any) => e.id);
      const { error } = await db.from('financial_entries')
        .delete()
        .in('id', idsToDelete);
      must('Remover financial_entry legacy de juros factoring', error);
    }
    return;
  }

  // For Aprovado / Em Produção: create or update receivable
  if (so.status === 'Aprovado' || so.status === 'Em Produção') {
    if (total <= 0) return;
    const schedule = computeARSchedule({
      total,
      paymentCondition: so.payment_condition,
      deliveryDeadline: so.delivery_deadline,
      isFactoring: false,
      factoringReceivingDays: null,
    });
    await reconcileARInstallments(db, saleOrderId, schedule, existingAR ?? [], {
      client_name: so.client_name || '',
      client_cnpj: so.client_cnpj || '',
      category: 'venda',
      description_for: (inst) => {
        const base = `PV ${so.order_number || saleOrderId} - ${so.client_name || ''}`;
        return schedule.length > 1 ? `${base} (${inst.installment_number}/${schedule.length})` : base;
      },
    });
    return;
  }

  // For other statuses (Expedido, Concluído, etc.): sync amount AND due_date pra
  // cada parcela ativa. Preserva a estrutura de N parcelas já criada — não cria
  // nem cancela rows aqui.
  if (existingAR && existingAR.length > 0) {
    const schedule = computeARSchedule({
      total,
      paymentCondition: so.payment_condition,
      deliveryDeadline: so.delivery_deadline,
      isFactoring: false,
      factoringReceivingDays: null,
    });
    const byNum = new Map(schedule.map((s) => [s.installment_number, s]));
    for (const ar of existingAR) {
      if (hasRecordedReceipt(ar) || ar.status === 'cancelled' || ar.status === 'cancelado') continue;
      const num = ar.installment_number ?? 1;
      const inst = byNum.get(num);
      if (!inst) continue; // row "órfã" do cronograma — será revisada se PV voltar pra Aprovado/Faturado
      const updates: Record<string, any> = {};
      if (Number(ar.amount) !== inst.amount) updates.amount = inst.amount;
      if (ar.due_date !== inst.due_date) updates.due_date = inst.due_date;
      if (Object.keys(updates).length > 0) {
        const { error } = await db.from('accounts_receivable')
          .update(updates)
          .eq('id', ar.id)
          .not('status', 'in', '(received,recebido,partial,parcial,cancelled,cancelado)')
          .or('amount_received.is.null,amount_received.eq.0');
        must(`Atualizar parcela ${num} pós-Faturado`, error);
      }
    }
  }
}
