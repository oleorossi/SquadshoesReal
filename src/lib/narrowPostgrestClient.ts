/**
 * Fachada mínima para relações/RPCs que já existem no PostgREST, mas podem
 * ainda não constar no arquivo de tipos gerado durante um rollout.
 *
 * O tipo da linha continua explícito em cada chamada; apenas o catálogo de
 * nomes de relações é desacoplado do snapshot local do schema.
 */
export interface NarrowPostgrestError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

export interface NarrowPostgrestResponse<Row> {
  data: Row[] | null;
  error: NarrowPostgrestError | null;
  count: number | null;
}

export interface NarrowPostgrestSingleResponse<Row> {
  data: Row | null;
  error: NarrowPostgrestError | null;
  count: number | null;
}

export interface NarrowPostgrestQuery<Row> extends PromiseLike<NarrowPostgrestResponse<Row>> {
  select(columns?: string, options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }): NarrowPostgrestQuery<Row>;
  update(values: Record<string, unknown>): NarrowPostgrestQuery<Row>;
  eq(column: string, value: unknown): NarrowPostgrestQuery<Row>;
  neq(column: string, value: unknown): NarrowPostgrestQuery<Row>;
  not(column: string, operator: string, value: unknown): NarrowPostgrestQuery<Row>;
  in(column: string, values: readonly unknown[]): NarrowPostgrestQuery<Row>;
  is(column: string, value: unknown): NarrowPostgrestQuery<Row>;
  or(filters: string): NarrowPostgrestQuery<Row>;
  contains(column: string, value: unknown): NarrowPostgrestQuery<Row>;
  overlaps(column: string, value: readonly unknown[]): NarrowPostgrestQuery<Row>;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): NarrowPostgrestQuery<Row>;
  range(from: number, to: number): NarrowPostgrestQuery<Row>;
  limit(count: number): NarrowPostgrestQuery<Row>;
  single(): PromiseLike<NarrowPostgrestSingleResponse<Row>>;
  maybeSingle(): PromiseLike<NarrowPostgrestSingleResponse<Row>>;
}

export interface NarrowPostgrestClient {
  from<Row>(relation: string): NarrowPostgrestQuery<Row>;
  rpc<Result>(functionName: string, args?: Record<string, unknown>): PromiseLike<NarrowPostgrestSingleResponse<Result>>;
}

export interface NarrowPostgrestRelationClient<Row> {
  from(relation: string): NarrowPostgrestQuery<Row>;
}

export function narrowPostgrestClient(client: unknown): NarrowPostgrestClient {
  return client as NarrowPostgrestClient;
}

export function narrowPostgrestRelation<Row>(client: unknown): NarrowPostgrestRelationClient<Row> {
  return client as NarrowPostgrestRelationClient<Row>;
}
