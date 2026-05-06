import { supabase } from '@/integrations/supabase/client';
import { SectorOverloadItem, SECTOR_LABELS } from '@/lib/sectorCapacity';

type ContractorRow = { id: string; name: string | null; service_type: string | null; active: boolean | null };

/**
 * Cria Ordens de Serviço de terceirização para suprir o excedente de cada setor
 * em sobrecarga. Agrupa por setor + referência e usa o terceirizado padrão do
 * setor (primeiro contractor ativo cujo `service_type` contém o nome do setor).
 *
 * Retorna a lista de OSs criadas.
 */
export async function createOutsourceOrdersForOverloads(
  overloads: SectorOverloadItem[],
  saleOrderId?: string,
): Promise<{ created: number; orderIds: string[] }> {
  if (!overloads.length) return { created: 0, orderIds: [] };

  // Carrega contractors ativos
  const { data: contractors } = await supabase
    .from('contractors')
    .select('id, name, service_type, active')
    .eq('active', true);

  const rows = (contractors || []) as unknown as ContractorRow[];
  const orderIds: string[] = [];

  for (const ov of overloads) {
    const sectorLabel = SECTOR_LABELS[ov.sector];
    // Match por service_type contendo o nome do setor (case-insensitive)
    const candidate =
      rows.find(c => (c.service_type || '').toLowerCase().includes(ov.sector)) ||
      rows.find(c => (c.service_type || '').toLowerCase().includes(sectorLabel.toLowerCase())) ||
      rows[0];

    if (!candidate) {
      // Sem terceirizado disponível — apenas pula
      continue;
    }

    const { data, error } = await supabase
      .from('service_orders')
      .insert({
        contractor_id: candidate.id,
        description: `[AUTO] Terceirização ${sectorLabel} — ${ov.reference_label} (${ov.shortfall_pairs} pares)`,
        service_date: ov.window_start_iso,
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

  return { created: orderIds.length, orderIds };
}
