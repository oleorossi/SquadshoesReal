// ════════════════════════════════════════════════════════════════════════
// Match de fornecedor (§6).
//
// 1) CNPJ (mais confiável) — casa por dígitos.
// 2) Nome — compara o nome extraído (normalizado) contra `suppliers.search_norm`.
//    Exato primeiro; depois "contém" (guardado por tamanho mínimo p/ não casar
//    fragmentos curtos).
// 3) 1 match → usa. 0 ou vários → não inventa: devolve status pro chamador
//    decidir a resposta no Zap.
//
// A tabela `suppliers` tem poucas dezenas de linhas, então buscamos os ativos
// e casamos em memória (evita normalizar dentro do SQL).
// ════════════════════════════════════════════════════════════════════════

import { normalizeCnpj, normalizeName } from "../lib/normalize.ts";

export interface SupplierRow {
  id: string;
  name: string;
  search_norm: string | null;
  cnpj: string | null;
}

export type SupplierMatch =
  | { status: "matched"; supplier: SupplierRow }
  | { status: "ambiguous"; candidates: SupplierRow[] }
  | { status: "none"; candidates: SupplierRow[] };

export async function matchSupplier(
  supabase: any,
  name: string | null,
  cnpj: string | null,
): Promise<SupplierMatch> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, search_norm, cnpj")
    .eq("active", true);
  if (error) throw new Error(`suppliers query: ${error.message}`);
  const suppliers: SupplierRow[] = data ?? [];

  // 1) CNPJ tem prioridade.
  const ncnpj = normalizeCnpj(cnpj);
  if (ncnpj.length >= 8) {
    const byCnpj = suppliers.filter((s) => normalizeCnpj(s.cnpj) === ncnpj);
    if (byCnpj.length === 1) return { status: "matched", supplier: byCnpj[0] };
    if (byCnpj.length > 1) return { status: "ambiguous", candidates: byCnpj };
  }

  // 2) Nome.
  const nname = normalizeName(name);
  if (nname.length < 3) return { status: "none", candidates: [] };

  const supNorm = (s: SupplierRow) => s.search_norm || normalizeName(s.name);

  // 2a) Exato.
  const exact = suppliers.filter((s) => supNorm(s) === nname);
  if (exact.length === 1) return { status: "matched", supplier: exact[0] };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };

  // 2b) "Contém" (qualquer direção). Dedup por id.
  const contains = suppliers.filter((s) => {
    const sn = supNorm(s);
    return sn.includes(nname) || nname.includes(sn);
  });
  if (contains.length === 1) return { status: "matched", supplier: contains[0] };
  if (contains.length > 1) return { status: "ambiguous", candidates: contains };

  return { status: "none", candidates: [] };
}
