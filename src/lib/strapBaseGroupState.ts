import { strapIdentityBasis } from '@/lib/strapIdentity';
import { strapMaterialMode, type StrapMaterialPolicyLike } from '@/lib/strapMaterialPolicy';

/**
 * Estado da napa-base de uma tira na tela do PV.
 *
 * Existe porque a tela acusava o CADASTRO ("A ficha não identifica o material-base
 * desta posição") sempre que a napa não estava resolvida — inclusive quando o único
 * motivo era o preview de estoque ainda não ter respondido. Em 12/10/2026 o dono
 * reportou isso num PV novo de S300 (variante GLOW METALIC, cor CHAMPAGNE): o RPC
 * `preview_sale_order_strap_demand_draft` devolve `base_group_id = GLOW METALIC`
 * nas 4 tiras, e mesmo assim a tela dizia que a ficha estava incompleta.
 *
 * ⚠ Só `follow_reference` depende do preview. `fixed_group` lê o grupo da própria
 * ficha, `select_on_order` lê a escolha gravada no item, e `finished_product_group`
 * usa o grupo acabado — nesses três a ausência de napa é fato do cadastro e deve
 * continuar acusando na hora, sem esperar servidor nenhum.
 */
export type StrapBaseGroupState =
  /** Napa resolvida. */
  | 'resolved'
  /** O preview ainda não respondeu. NUNCA acusar o cadastro aqui. */
  | 'pending'
  /** O preview respondeu, mas não trouxe linha para esta tira. */
  | 'preview_missing'
  /** O preview respondeu e a napa veio nula: aí sim é cadastro. */
  | 'unresolved';

export interface StrapBaseGroupStateInput {
  /** Linha técnica (reconciliada) da tira. */
  line: StrapMaterialPolicyLike | null | undefined;
  /** Resultado de `materialBaseForStrap` no call site. */
  identityResolved: boolean;
  /** Linha devolvida pelo preview para esta tira, se houver. */
  previewLine: unknown | null | undefined;
  /** A query do preview já terminou ao menos uma vez (`isFetched`). */
  previewSettled: boolean;
  /** A query do preview falhou. */
  previewFailed?: boolean;
}

/**
 * Só a tira que herda a napa da referência precisa do preview para saber qual é
 * ela — o servidor resolve a cascata (produto pinado → grupo da variante →
 * forração → ficha). O cliente não reimplementa essa cascata de propósito:
 * um segundo motor TS divergiria do SQL no primeiro caso de forração.
 */
export function strapBaseGroupDependsOnPreview(
  line: StrapMaterialPolicyLike | null | undefined,
): boolean {
  if (!line) return false;
  return strapIdentityBasis(line) === 'reference_base'
    && strapMaterialMode(line) === 'follow_reference';
}

export function strapBaseGroupState({
  line,
  identityResolved,
  previewLine,
  previewSettled,
  previewFailed = false,
}: StrapBaseGroupStateInput): StrapBaseGroupState {
  if (identityResolved) return 'resolved';
  // Cadastro é fato local: acusa sem esperar o servidor.
  if (!strapBaseGroupDependsOnPreview(line)) return 'unresolved';
  if (!previewSettled) return 'pending';
  // Falha de rede não é ficha incompleta — e a query falhada não tem linha.
  if (previewFailed || !previewLine) return 'preview_missing';
  return 'unresolved';
}

/** Único estado que pode culpar o cadastro da ficha (e abrir o CTA do estoque). */
export function strapBaseGroupBlamesSheet(state: StrapBaseGroupState): boolean {
  return state === 'unresolved';
}
