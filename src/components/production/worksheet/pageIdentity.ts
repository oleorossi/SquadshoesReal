/**
 * Identidade da faixa do topo (pagi-page-head) das fichas A4.
 *
 * Decisão do dono (2026-10): linha 1 = setor; linhas seguintes = pedido do
 * cliente + PV + OP (quando houver) + razão social. Faixa cresce com o
 * conteúdo. Relatório Gerencial omite OP.
 */

export interface PageIdentityEntry {
  clientOrderNumber?: string | null;
  pvNumber?: string | null;
  opNumber?: string | null;
  clientName?: string | null;
}

export interface PageIdentity {
  sector: string;
  entries: PageIdentityEntry[];
}

export interface OrderIdentityLookup {
  opNumber?: string | null;
  pvNumber?: string | null;
  clientOrderNumber?: string | null;
  clientName?: string | null;
}

function trimOrNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length > 0 ? t : null;
}

/** Chave estável pra dedupe (PV · OP · pedido cliente · razão). */
export function pageIdentityEntryKey(e: PageIdentityEntry): string {
  return [
    trimOrNull(e.pvNumber) || '',
    trimOrNull(e.opNumber) || '',
    trimOrNull(e.clientOrderNumber) || '',
    trimOrNull(e.clientName) || '',
  ].join('\u0001');
}

/**
 * Dedup + ordena por PV, depois OP, depois pedido cliente.
 * `includeOp: false` zera OP (Relatório Gerencial).
 */
export function normalizePageIdentity(
  sector: string,
  entries: PageIdentityEntry[],
  opts: { includeOp?: boolean } = {},
): PageIdentity {
  const includeOp = opts.includeOp !== false;
  const map = new Map<string, PageIdentityEntry>();
  for (const raw of entries) {
    const entry: PageIdentityEntry = {
      clientOrderNumber: trimOrNull(raw.clientOrderNumber),
      pvNumber: trimOrNull(raw.pvNumber),
      opNumber: includeOp ? trimOrNull(raw.opNumber) : null,
      clientName: trimOrNull(raw.clientName),
    };
    if (!entry.pvNumber && !entry.opNumber && !entry.clientOrderNumber && !entry.clientName) {
      continue;
    }
    const key = pageIdentityEntryKey(entry);
    if (!map.has(key)) map.set(key, entry);
  }
  const sorted = Array.from(map.values()).sort((a, b) => {
    const pv = (a.pvNumber || '').localeCompare(b.pvNumber || '', 'pt-BR');
    if (pv !== 0) return pv;
    const op = (a.opNumber || '').localeCompare(b.opNumber || '', 'pt-BR');
    if (op !== 0) return op;
    return (a.clientOrderNumber || '').localeCompare(b.clientOrderNumber || '', 'pt-BR');
  });
  return { sector: sector.trim() || '—', entries: sorted };
}

/** Monta identidade a partir de OPs + lookup (op → meta do PV/cliente). */
export function pageIdentityForOps(
  sector: string,
  opNumbers: Array<string | null | undefined>,
  byOp: Map<string, OrderIdentityLookup>,
  opts: { includeOp?: boolean } = {},
): PageIdentity {
  const entries: PageIdentityEntry[] = [];
  const seenOps = new Set<string>();
  for (const raw of opNumbers) {
    const op = trimOrNull(raw);
    if (!op || seenOps.has(op)) continue;
    seenOps.add(op);
    const meta = byOp.get(op);
    entries.push({
      opNumber: op,
      pvNumber: meta?.pvNumber ?? null,
      clientOrderNumber: meta?.clientOrderNumber ?? null,
      clientName: meta?.clientName ?? null,
    });
  }
  return normalizePageIdentity(sector, entries, opts);
}

/**
 * Fallback quando só há listas agregadas (sem pairing OP↔PV).
 * Emite 1 entrada por PV (se houver); senão por OP; senão só cliente.
 */
export function pageIdentityFromLists(args: {
  sector: string;
  opNumbers?: Array<string | null | undefined>;
  pvNumbers?: Array<string | null | undefined>;
  clientNames?: Array<string | null | undefined>;
  clientOrderByPv?: Map<string, string | null | undefined>;
  includeOp?: boolean;
}): PageIdentity {
  const pvs = Array.from(new Set((args.pvNumbers || []).map(trimOrNull).filter(Boolean))) as string[];
  const ops = Array.from(new Set((args.opNumbers || []).map(trimOrNull).filter(Boolean))) as string[];
  const clients = Array.from(new Set((args.clientNames || []).map(trimOrNull).filter(Boolean))) as string[];
  const entries: PageIdentityEntry[] = [];

  if (pvs.length > 0) {
    for (const pv of pvs) {
      entries.push({
        pvNumber: pv,
        clientOrderNumber: args.clientOrderByPv?.get(pv) ?? null,
        clientName: clients.length === 1 ? clients[0] : null,
        opNumber: null,
      });
    }
    // OPs extras na mesma faixa (listadas sem amarrar a PV quando o pairing falta).
    if (args.includeOp !== false) {
      for (const op of ops) {
        entries.push({ opNumber: op, pvNumber: null, clientOrderNumber: null, clientName: null });
      }
    }
  } else if (ops.length > 0 && args.includeOp !== false) {
    for (const op of ops) {
      entries.push({
        opNumber: op,
        clientName: clients.length === 1 ? clients[0] : null,
      });
    }
  } else {
    for (const c of clients) {
      entries.push({ clientName: c });
    }
  }

  // Se vários clientes e vários PVs, anexa razões que não foram pinadas.
  if (pvs.length > 0 && clients.length > 1) {
    for (const c of clients) {
      entries.push({ clientName: c });
    }
  }

  return normalizePageIdentity(args.sector, entries, { includeOp: args.includeOp });
}

/** Uma linha da faixa (pedido cliente · PV · OP · razão). */
export function formatPageIdentityLine(entry: PageIdentityEntry): string {
  const parts: string[] = [];
  const clientOrder = trimOrNull(entry.clientOrderNumber);
  const pv = trimOrNull(entry.pvNumber);
  const op = trimOrNull(entry.opNumber);
  const client = trimOrNull(entry.clientName);
  if (clientOrder) parts.push(clientOrder);
  if (pv) parts.push(pv);
  if (op) parts.push(op);
  if (client) parts.push(client);
  return parts.join(' · ');
}
