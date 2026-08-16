export type ClickNotasProductCandidate = Record<string, unknown>;

export type ClickNotasProductIdentityResolution<T extends ClickNotasProductCandidate> =
  | {
      kind: "match";
      product: T;
      exactNameMatches: number;
      exactIdentityMatches: number;
    }
  | {
      kind: "not_found";
      exactNameMatches: 0;
      exactIdentityMatches: 0;
    }
  | {
      kind: "conflict";
      reason: "ambiguous_identity";
      exactNameMatches: number;
      exactIdentityMatches: number;
    };

export const CLICKNOTAS_PRODUCT_NAME_MAX_LENGTH = 120;

export type ClickNotasProductClaimResult =
  | {
      outcome: "acquired";
      technical_name: string;
      lease_generation: number;
      attempt_count?: number;
    }
  | {
      outcome: "ready";
      technical_name: string;
      provider_id: string;
      lease_generation: number;
      attempt_count?: number;
    }
  | {
      outcome: "busy";
      state: "resolving" | "posting" | "retryable";
      technical_name: string;
      retry_after_ms: number;
      lease_generation: number;
      attempt_count?: number;
      last_error?: string;
    }
  | {
      outcome: "reconcile_required" | "conflict";
      technical_name: string;
      lease_generation: number;
      attempt_count?: number;
      reconciliation_count?: number;
      last_error?: string;
    };

export type ClickNotasProductCompletionResult = {
  outcome: "ready" | "lost";
  technical_name: string;
  provider_id?: string | null;
  lease_generation: number;
  state?: "resolving" | "posting" | "ready" | "retryable" | "reconcile_required" | "conflict";
};

export type ClickNotasProductBeginPostResult = {
  outcome: "posting" | "lost";
  technical_name: string;
  lease_generation: number;
  state?: "resolving" | "posting" | "ready" | "retryable" | "reconcile_required" | "conflict";
  provider_id?: string | null;
};

export type ClickNotasProductReconciliationResult = {
  outcome: "ready" | "reconcile_required" | "conflict" | "ignored";
  technical_name: string;
  provider_id?: string | null;
  lease_generation: number;
  last_error?: string;
};

export type ClickNotasExternalLookupResult =
  | { kind: "match"; providerId: string }
  | { kind: "not_found" }
  | { kind: "conflict"; message: string };

export class ClickNotasProductClaimBusyError extends Error {
  readonly httpStatus = 409;

  constructor(message: string) {
    super(message);
    this.name = "ClickNotasProductClaimBusyError";
  }
}

export class ClickNotasProductIdentityConflictError extends Error {
  readonly httpStatus = 409;
  readonly retryDelaySeconds = 300;

  constructor(message: string) {
    super(message);
    this.name = "ClickNotasProductIdentityConflictError";
  }
}

export class ClickNotasProductReconciliationRequiredError extends Error {
  readonly httpStatus = 409;

  constructor(message: string) {
    super(message);
    this.name = "ClickNotasProductReconciliationRequiredError";
  }
}

/** Só use quando o provedor comprovadamente recusou sem processar o POST. */
export class ClickNotasProductPostDefinitelyRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClickNotasProductPostDefinitelyRejectedError";
  }
}

interface ProvisionClickNotasProductOptions {
  claim: () => Promise<ClickNotasProductClaimResult>;
  lookup: (technicalName: string) => Promise<ClickNotasExternalLookupResult>;
  create: (technicalName: string) => Promise<{ providerId: string }>;
  beginPost: (
    leaseGeneration: number,
  ) => Promise<ClickNotasProductBeginPostResult>;
  complete: (
    leaseGeneration: number,
    providerId: string,
  ) => Promise<ClickNotasProductCompletionResult>;
  recordOutcome: (
    leaseGeneration: number,
    outcome: "retryable" | "reconcile_required" | "conflict",
    error: string,
    retrySeconds: number,
  ) => Promise<unknown>;
  reconcile: (
    observation: "found" | "not_found" | "conflict",
    providerId: string | null,
    error: string,
  ) => Promise<ClickNotasProductReconciliationResult>;
  sleep?: (milliseconds: number) => Promise<void>;
  maxWaitMs?: number;
}

export type ProvisionedClickNotasProduct = {
  providerId: string;
  technicalName: string;
  source: "registry_ready" | "external_lookup" | "external_create";
};

/**
 * Orquestra o claim persistido. Só o owner de uma geração consulta/cria no
 * provedor; concorrentes aguardam `ready`. Todo owner, inclusive takeover de
 * lease vencido, consulta o nome técnico write-once antes de cogitar POST.
 */
export async function provisionClickNotasProductIdentity(
  options: ProvisionClickNotasProductOptions,
): Promise<ProvisionedClickNotasProduct> {
  const sleep = options.sleep || ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? 12_000);
  const startedAt = Date.now();

  while (true) {
    const claim = await options.claim();
    if (claim.outcome === "ready") {
      const providerId = String(claim.provider_id || "").trim();
      if (!providerId) {
        throw new Error("Registry ClickNotas ready sem provider_id.");
      }
      return {
        providerId,
        technicalName: claim.technical_name,
        source: "registry_ready",
      };
    }

    if (claim.outcome === "busy") {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= maxWaitMs) {
        const detail = claim.last_error
          ? ` Último erro: ${claim.last_error}`
          : "";
        throw new ClickNotasProductClaimBusyError(
          `A identidade ClickNotas "${claim.technical_name}" está sendo processada por outra emissão. Tente novamente em instantes.${detail}`,
        );
      }
      const remaining = maxWaitMs - elapsed;
      await sleep(Math.max(
        25,
        Math.min(Number(claim.retry_after_ms) || 250, 1_000, remaining),
      ));
      continue;
    }

    if (claim.outcome === "conflict") {
      throw new ClickNotasProductIdentityConflictError(
        claim.last_error
          || `A identidade ClickNotas "${claim.technical_name}" está em conflito e exige revisão.`,
      );
    }

    if (claim.outcome === "reconcile_required") {
      const technicalName = claim.technical_name;
      const lookup = await options.lookup(technicalName);
      if (lookup.kind === "match") {
        const providerId = String(lookup.providerId || "").trim();
        const reconciled = await options.reconcile(
          "found",
          providerId,
          `Produto ${providerId} encontrado por nome técnico após resultado ambíguo.`,
        );
        if (reconciled.outcome === "ready" && reconciled.provider_id) {
          return {
            providerId: String(reconciled.provider_id),
            technicalName: reconciled.technical_name || technicalName,
            source: "external_lookup",
          };
        }
      } else if (lookup.kind === "conflict") {
        await options.reconcile("conflict", null, lookup.message);
        throw new ClickNotasProductIdentityConflictError(lookup.message);
      } else {
        const message =
          `Resultado anterior do POST para "${technicalName}" é ambíguo e a reconciliação ainda não encontrou produto. `
          + "Nenhum novo POST será feito. Administração deve confirmar a ausência no ClickNotas e usar reset_clicknotas_product_identity_after_verified_absence.";
        await options.reconcile("not_found", null, message);
        throw new ClickNotasProductReconciliationRequiredError(message);
      }
      throw new ClickNotasProductReconciliationRequiredError(
        `A identidade ClickNotas "${technicalName}" continua pendente de reconciliação.`,
      );
    }

    const generation = Number(claim.lease_generation);
    const technicalName = claim.technical_name;
    let phase: "resolving" | "posting" = "resolving";
    try {
      // Recovery load-bearing: sempre lookup antes do POST. Se o owner anterior
      // caiu depois de criar no provedor, esta consulta transforma o registro
      // em ready sem duplicar o produto externo.
      const lookup = await options.lookup(technicalName);
      if (lookup.kind === "conflict") {
        await options.recordOutcome(generation, "conflict", lookup.message, 300);
        throw new ClickNotasProductIdentityConflictError(lookup.message);
      }

      let source: "external_lookup" | "external_create" = "external_lookup";
      let providerId = lookup.kind === "match"
        ? String(lookup.providerId || "").trim()
        : "";

      if (lookup.kind === "not_found") {
        // Commitir `posting` antes do HTTP fecha o crash window: se a resposta
        // deste RPC se perder, NÃO fazemos POST. Lease posting expirado só pode
        // reconciliar por GET, nunca readquirir automaticamente.
        const begun = await options.beginPost(generation);
        if (begun.outcome !== "posting") {
          throw new ClickNotasProductClaimBusyError(
            `O lease da identidade ClickNotas "${technicalName}" mudou antes do POST; tente novamente.`,
          );
        }
        phase = "posting";
        source = "external_create";
        try {
          providerId = String((await options.create(technicalName)).providerId || "").trim();
        } catch (error) {
          const definitelyRejected = error instanceof ClickNotasProductPostDefinitelyRejectedError;
          await options.recordOutcome(
            generation,
            definitelyRejected ? "retryable" : "reconcile_required",
            error instanceof Error ? error.message : String(error),
            definitelyRejected ? 30 : 60,
          );
          throw error;
        }
      }
      if (!providerId) {
        if (phase === "posting") {
          await options.recordOutcome(
            generation,
            "reconcile_required",
            "ClickNotas respondeu ao POST sem provider_id; resultado externo ambíguo.",
            60,
          );
        }
        throw new Error("ClickNotas não retornou provider_id ao provisionar produto.");
      }

      let completion: ClickNotasProductCompletionResult;
      try {
        completion = await options.complete(generation, providerId);
      } catch (error) {
        await options.recordOutcome(
          generation,
          phase === "posting" ? "reconcile_required" : "retryable",
          `Falha ao persistir provider_id ${providerId}: ${error instanceof Error ? error.message : String(error)}`,
          phase === "posting" ? 60 : 30,
        );
        throw error;
      }
      const completedProviderId = String(completion.provider_id || "").trim();
      if (completion.outcome === "ready" && completedProviderId === providerId) {
        return {
          providerId,
          technicalName: completion.technical_name || technicalName,
          source,
        };
      }
      if (completion.outcome === "ready" && completedProviderId) {
        throw new ClickNotasProductIdentityConflictError(
          `Registry ClickNotas concluiu a identidade com provider_id ${completedProviderId}, diferente de ${providerId}.`,
        );
      }
      throw new ClickNotasProductClaimBusyError(
        `O lease da identidade ClickNotas "${technicalName}" mudou durante o provisionamento; tente a emissão novamente.`,
      );
    } catch (error) {
      if (phase === "resolving"
          && !(error instanceof ClickNotasProductIdentityConflictError)
          && !(error instanceof ClickNotasProductClaimBusyError)) {
        try {
          await options.recordOutcome(
            generation,
            "retryable",
            error instanceof Error ? error.message : String(error),
            30,
          );
        } catch {
          // Falha ao registrar mantém lease resolving, que pode ser retomado.
        }
      }
      throw error;
    }
  }
}

const normalizeIdentityPart = (value: unknown) =>
  String(value ?? "").trim().toUpperCase();

const candidateName = (candidate: ClickNotasProductCandidate) =>
  normalizeIdentityPart(candidate.nome_produto || candidate.nome);

/**
 * O ClickNotas ignora `codigo` no POST /produtos e gera um código interno.
 * Por isso a identidade reutilizável precisa morar no nome do cadastro
 * externo. A descrição fiscal continua separada no `nome_produto` da linha.
 */
export function buildClickNotasTechnicalProductName(
  productDescription: string,
  productSku: string,
): string {
  const description = String(productDescription || "").trim();
  const sku = normalizeIdentityPart(productSku);
  if (!description) {
    throw new Error("Descrição comercial vazia para identidade ClickNotas.");
  }
  if (!sku) {
    return description.slice(0, CLICKNOTAS_PRODUCT_NAME_MAX_LENGTH);
  }

  const suffix = ` [SKU:${sku}]`;
  const descriptionBudget = CLICKNOTAS_PRODUCT_NAME_MAX_LENGTH - suffix.length;
  if (descriptionBudget < 1) {
    throw new Error(
      `SKU excede o limite seguro da identidade ClickNotas (${sku.length} caracteres).`,
    );
  }
  const prefix = description.slice(0, descriptionBudget).trimEnd();
  if (!prefix) {
    throw new Error("Descrição comercial vazia para identidade ClickNotas.");
  }
  return `${prefix}${suffix}`;
}

/**
 * Resolve o cadastro pelo nome técnico determinístico, que já incorpora o SKU.
 * Não consulta o código retornado pela API: ele é um código interno gerado pelo
 * próprio ClickNotas, e portanto não é o SKU enviado no cadastro.
 */
export function resolveClickNotasProductIdentity<
  T extends ClickNotasProductCandidate,
>(
  candidates: T[],
  technicalProductName: string,
): ClickNotasProductIdentityResolution<T> {
  const normalizedName = normalizeIdentityPart(technicalProductName);
  const exactNameMatches = candidates.filter(
    (candidate) => candidateName(candidate) === normalizedName,
  );

  if (exactNameMatches.length === 0) {
    return {
      kind: "not_found",
      exactNameMatches: 0,
      exactIdentityMatches: 0,
    };
  }

  if (exactNameMatches.length === 1) {
    return {
      kind: "match",
      product: exactNameMatches[0],
      exactNameMatches: 1,
      exactIdentityMatches: 1,
    };
  }
  return {
    kind: "conflict",
    reason: "ambiguous_identity",
    exactNameMatches: exactNameMatches.length,
    exactIdentityMatches: exactNameMatches.length,
  };
}
