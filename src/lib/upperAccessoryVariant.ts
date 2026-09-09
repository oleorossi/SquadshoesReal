/** Material adicional sem SKU próprio acompanha a identidade do cabedal-base.
 * `mandatory` significa que sua área soma ao consumo; não fixa a família.
 * Igualdade espelha lower(btrim) do SQL. Não aproximar nomes por acento,
 * espessura ou prefixo: outro grupo e qualquer pin explícito são independentes. */
export function sameUpperMaterialIdentity(left?: string | null, right?: string | null): boolean {
  const normalized = (value?: string | null) => value?.trim().toLocaleLowerCase('pt-BR') || '';
  const material = normalized(left);
  return !!material && material === normalized(right);
}

export function upperAccessoryFollowsBaseMaterial(
  accessory: { mandatory?: boolean | null; material?: string | null; product_id?: string | null; id?: unknown; leftover?: boolean | null },
  baseMaterial?: string | null,
): boolean {
  if (accessory.mandatory !== true || accessory.leftover === true || accessory.id || accessory.product_id?.trim()) return false;
  return sameUpperMaterialIdentity(accessory.material, baseMaterial);
}
