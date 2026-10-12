/**
 * Guards de salvamento do PV que o RODAPÉ também precisa listar.
 *
 * ⚠ Existiam DOIS portões que não conversavam. O rodapé
 * (`SaleOrderFormPanel`) derivava `submitDisabled` de uma lista própria —
 * cliente, item sem referência, factoring, cor faltando, preço zero — enquanto
 * `handleSubmit` (`pages/SaleOrderForm`) barrava com `toast.error` por outros
 * motivos que NUNCA entravam naquela contagem. O efeito prático, relatado pelo
 * dono em 12/10/2026: o rodapé dizia "1 erro(s) — Item 3: cor faltando", ele
 * corrigia, o contador zerava, clicava em Criar Pedido e levava um toast sobre
 * um material que jamais aparecera na lista de pendências. Sem saída visível.
 *
 * Este módulo é a fonte única das regras que dependem só de `items`/`form`, pra
 * que o rodapé possa anunciá-las antes do clique em vez de depois.
 */

export interface SubmitGuardStrapLike {
  color?: string | null;
  color_id?: string | null;
  color_mode?: string | null;
  label?: string | null;
  group_name?: string | null;
}

export interface SubmitGuardItemLike {
  reference_id?: string | null;
  color?: string | null;
  strap_colors?: unknown;
}

export interface SubmitGuardReferenceLike {
  id: string;
  code?: string | null;
  name?: string | null;
}

/**
 * Tira com cor vazia (auditoria 2026-07-01, achado ALTO). Uma linha de tira sem
 * cor passava por TODOS os guards existentes — `colorIssues` exige cor ESCOLHIDA
 * sem produto, `strapShortages` pula a linha sem cor e o `incomplete` do pós-save
 * só pega `strap_colors = []` inteiro. Resultado: o PV salvava e o débito da tira
 * era PULADO em silêncio na conversão pra OP (`debit_strap_stock` não resolve
 * produto sem cor). Não há fluxo legítimo de "tira sem cor até definir depois".
 *
 * ⚠ O resolvedor canônico não aceita texto/alias como identidade: exigimos
 * também o UUID de cor persistido no snapshot.
 *
 * @param colorModeOf  injetado pra este módulo não depender da política de tiras
 *                     (evita import cíclico com `strapMaterialPolicy`).
 */
export function findTiraSemCor(
  items: readonly SubmitGuardItemLike[],
  references: readonly SubmitGuardReferenceLike[],
  colorModeOf: (strap: SubmitGuardStrapLike) => string,
): string | null {
  for (let i = 0; i < items.length; i++) {
    const straps = Array.isArray(items[i]?.strap_colors)
      ? (items[i].strap_colors as SubmitGuardStrapLike[])
      : [];
    const semCor = straps.filter((s) => {
      if (!s) return false;
      // Somente reference_base + follow_main deriva a identidade da cor
      // principal. Uma tira interna select_on_order precisa carregar texto e
      // UUID canônicos da posição, assim como uma tira comprada pronta.
      if (colorModeOf(s) === 'follow_main' && String(items[i].color || '').trim()) return false;
      return !String(s.color || '').trim() || !String(s.color_id || '').trim();
    });
    if (semCor.length === 0) continue;
    const ref = references.find((r) => r.id === items[i].reference_id);
    const refLabel = ref
      ? `${ref.code || ''} ${ref.name || ''}`.trim() || `item ${i + 1}`
      : `item ${i + 1}`;
    const tiras = semCor
      .map((s) => String(s.label || s.group_name || 'TIRA').trim() || 'TIRA')
      .join(', ');
    return (
      `Tira sem cor canônica no item ${i + 1} (${refLabel}): ${tiras}. `
      + 'Selecione a cor no catálogo; texto antigo não identifica estoque nem permite confirmar o pedido.'
    );
  }
  return null;
}

export interface ColorIssueLike {
  color: string;
  /** Já vem rotulado por componente: `Forração (NAPA SUDANI)`. */
  materials: string[];
  message?: string;
}

/**
 * Mesma mensagem que `handleSubmit` joga no toast — por isso mora aqui, e não
 * numa string montada à parte no rodapé. Duas redações para a mesma pendência
 * fariam o usuário achar que são dois problemas.
 */
export function colorIssueBlockerMessage(issue: ColorIssueLike): string {
  return issue.message || (
    `Cor "${issue.color}" não cadastrada em ${issue.materials.join(', ')}. `
    + 'Use o botão "Cadastrar" no item para registrar a cor antes de salvar o pedido.'
  );
}
