import { supabase } from '@/integrations/supabase/client';

/**
 * Resolução de fornecedor a partir de `group_suppliers`.
 *
 * ⚠ `group_suppliers` NÃO tem coluna `supplier_id` — só `supplier_name` e
 * `supplier_cnpj` (verificado no schema, auditoria 04/08/2026). Os três
 * caminhos de compra automática (materialAutoPO, soleAutoPO e a sugestão de
 * reposição em useSaleOrders) selecionavam `supplier_id` e, como o `error` do
 * PostgREST não era capturado, o 42703 virava `data: null` em silêncio: a
 * prioridade "fornecedor do grupo" nunca valia e toda OC automática nascia
 * como "A definir" / "Sem Fornecedor".
 *
 * O vínculo real é por CNPJ (chave forte) com fallback por nome — mesma
 * estratégia que o lado SQL adotou em `20260606121000`: só preenche
 * `supplier_id` quando o casamento é inequívoco.
 */

export interface GroupSupplier {
  supplier_id: string | null;
  supplier_name: string;
}

const onlyDigits = (s: string | null | undefined) => String(s || '').replace(/\D/g, '');

/** Casa linhas de `group_suppliers` contra `suppliers`, por CNPJ e depois por nome. */
async function attachSupplierIds(
  rows: Array<{ supplier_name: string | null; supplier_cnpj: string | null }>,
): Promise<Map<string, string | null>> {
  // chave = supplier_name normalizado → suppliers.id
  const byName = new Map<string, string | null>();
  const names = [...new Set(rows.map(r => (r.supplier_name || '').trim()).filter(Boolean))];
  const cnpjs = [...new Set(rows.map(r => onlyDigits(r.supplier_cnpj)).filter(Boolean))];
  if (names.length === 0 && cnpjs.length === 0) return byName;

  const { data: sups, error } = await supabase
    .from('suppliers')
    .select('id, name, cnpj');
  if (error) {
    console.warn('[groupSupplierResolution] falha ao carregar suppliers:', error.message);
    return byName;
  }

  const idByCnpj = new Map<string, string>();
  const idByName = new Map<string, string>();
  for (const s of (sups || []) as any[]) {
    const c = onlyDigits(s.cnpj);
    if (c && !idByCnpj.has(c)) idByCnpj.set(c, s.id);
    const n = String(s.name || '').trim().toUpperCase();
    if (n && !idByName.has(n)) idByName.set(n, s.id);
  }

  for (const r of rows) {
    const nameKey = (r.supplier_name || '').trim();
    if (!nameKey) continue;
    const c = onlyDigits(r.supplier_cnpj);
    const resolved = (c ? idByCnpj.get(c) : undefined) ?? idByName.get(nameKey.toUpperCase()) ?? null;
    byName.set(nameKey, resolved);
  }
  return byName;
}

/** Fornecedor mais recente cadastrado para UM grupo. `null` quando não há. */
export async function resolveGroupSupplier(groupId: string | null | undefined): Promise<GroupSupplier | null> {
  if (!groupId) return null;
  const { data, error } = await (supabase as any)
    .from('group_suppliers')
    .select('supplier_name, supplier_cnpj')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn('[groupSupplierResolution] falha ao ler group_suppliers:', error.message);
    return null;
  }
  if (!data?.supplier_name) return null;

  const ids = await attachSupplierIds([data]);
  return {
    supplier_id: ids.get(String(data.supplier_name).trim()) ?? null,
    supplier_name: data.supplier_name,
  };
}

/** Versão em lote: mapa `group_id` → fornecedor mais recente daquele grupo. */
export async function resolveGroupSuppliers(groupIds: string[]): Promise<Map<string, GroupSupplier>> {
  const out = new Map<string, GroupSupplier>();
  if (groupIds.length === 0) return out;

  const { data, error } = await (supabase as any)
    .from('group_suppliers')
    .select('group_id, supplier_name, supplier_cnpj')
    .in('group_id', groupIds)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('[groupSupplierResolution] falha ao ler group_suppliers em lote:', error.message);
    return out;
  }

  // `.order` desc + primeiro a vencer = mais recente por grupo.
  const firstByGroup: any[] = [];
  const seen = new Set<string>();
  for (const g of (data || []) as any[]) {
    if (seen.has(g.group_id)) continue;
    seen.add(g.group_id);
    firstByGroup.push(g);
  }

  const ids = await attachSupplierIds(firstByGroup);
  for (const g of firstByGroup) {
    if (!g.supplier_name) continue;
    out.set(g.group_id, {
      supplier_id: ids.get(String(g.supplier_name).trim()) ?? null,
      supplier_name: g.supplier_name,
    });
  }
  return out;
}
