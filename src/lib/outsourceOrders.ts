import { supabase } from '@/integrations/supabase/client';
import { SectorOverloadItem, SECTOR_LABELS } from '@/lib/sectorCapacity';

type ContractorRow = { id: string; name: string | null; service_type: string | null; active: boolean | null };

export interface CreateOutsourceResult {
  created: number;
  orderIds: string[];
  /** Setores sem prestador correspondente — NÃO criamos OS (antes caíam no 1º
   *  contractor por engano, inflando o terceirizado errado). */
  skippedNoContractor: string[];
  /** Setores cuja OS [AUTO] já existia (idempotência) — não duplicamos. */
  skippedDuplicate: string[];
}

/** Escapa curingas de LIKE/ILIKE (%, _, \) num literal antes de usar em prefixo. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Cria Ordens de Serviço de terceirização para suprir o excedente de cada setor
 * em sobrecarga. Agrupa por setor + referência e usa o terceirizado do setor
 * (primeiro contractor ativo cujo `service_type` contém o nome do setor).
 *
 * ⚠ Correção de auditoria (2026-06-20): NÃO há mais fallback pro `rows[0]`. Antes,
 * quando NENHUM prestador casava com o setor (ex.: Montagem/Silk/Acabamento, que
 * normalmente não têm terceirizado), a OS era jogada no PRIMEIRO contractor ativo
 * — que acabava acumulando dezenas de OS de setores que ele nem executa (caso real:
 * "Seu nego", um fornecedor de Tira Chata, recebeu 32 OS de Montagem/Silk/etc).
 * Agora, sem prestador do setor, a OS é PULADA e o setor reportado em
 * `skippedNoContractor`. Também ficou idempotente: não recria uma OS [AUTO] que já
 * existe (mesmo PV quando houver, ou mesma contratada+setor+referência), evitando
 * duplicatas a cada novo save de um PV em sobrecarga.
 */
export async function createOutsourceOrdersForOverloads(
  overloads: SectorOverloadItem[],
  saleOrderId?: string,
): Promise<CreateOutsourceResult> {
  if (!overloads.length) return { created: 0, orderIds: [], skippedNoContractor: [], skippedDuplicate: [] };

  // Carrega contractors ativos
  const { data: contractors } = await supabase
    .from('contractors')
    .select('id, name, service_type, active')
    .eq('active', true);

  const rows = (contractors || []) as unknown as ContractorRow[];
  const orderIds: string[] = [];
  const skippedNoContractor: string[] = [];
  const skippedDuplicate: string[] = [];

  for (const ov of overloads) {
    const sectorLabel = SECTOR_LABELS[ov.sector];
    // Match SÓ por service_type contendo o nome do setor (key ou label).
    // Sem match → NÃO cria (nada de cair no rows[0]).
    const candidate =
      rows.find(c => (c.service_type || '').toLowerCase().includes(ov.sector)) ||
      rows.find(c => (c.service_type || '').toLowerCase().includes(sectorLabel.toLowerCase()));

    if (!candidate) {
      skippedNoContractor.push(sectorLabel);
      continue;
    }

    // Idempotência best-effort: não duplica a OS [AUTO] do mesmo setor+referência
    // pra esta contratada (e mesmo PV, quando saleOrderId é conhecido). O prefixo
    // da descrição é estável (sector + reference_label); só o nº de pares varia.
    const descPrefix = `[AUTO] Terceirização ${sectorLabel} — ${ov.reference_label} (`;
    let dupQ = supabase
      .from('service_orders')
      .select('id')
      .eq('contractor_id', candidate.id)
      .ilike('description', `${escapeLike(descPrefix)}%`)
      .not('status', 'in', '("Cancelado","cancelled","cancelado")')
      .limit(1);
    if (saleOrderId) dupQ = dupQ.eq('sale_order_id', saleOrderId);
    const { data: existing } = await dupQ;
    if (existing && existing.length > 0) {
      skippedDuplicate.push(sectorLabel);
      continue;
    }

    const { data, error } = await supabase
      .from('service_orders')
      .insert({
        contractor_id: candidate.id,
        description: `${descPrefix}${ov.shortfall_pairs} pares)`,
        service_date: ov.window_start_iso,
        target_sector: ov.sector,
        quantity: ov.shortfall_pairs,
        unit_price: 0,
        total_value: 0,
        status: 'Pendente',
        notes: `OS gerada automaticamente por sobrecarga do setor ${sectorLabel}.\n` +
               `Janela interna: ${ov.window_start_iso} → ${ov.window_end_iso}\n` +
               `Capacidade interna: ${ov.capacity_per_day} pares/dia\n` +
               `Carga prevista: ${ov.daily_load.toFixed(1)} pares/dia`,
        sale_order_id: saleOrderId || null,
      })
      .select('id')
      .single();

    if (!error && data) orderIds.push(data.id);
  }

  return { created: orderIds.length, orderIds, skippedNoContractor, skippedDuplicate };
}
