interface ProductMaster {
  main_image_url?: string | null;
}

interface ProductVariant {
  variant_image_url?: string | null;
  product_master: ProductMaster;
}

/**
 * Lógica de Renderização da Imagem na Etiqueta / OP
 * 1. Tenta a foto da cor específica
 * 2. Se não houver, tenta a foto principal do modelo (Produto Pai)
 * 3. Fallback final: Placeholder genérico
 */
export function getProductDisplayImage(variant: ProductVariant): string {
  if (variant.variant_image_url) return variant.variant_image_url;
  if (variant.product_master?.main_image_url) return variant.product_master.main_image_url;
  return "/placeholder.svg";
}

/**
 * Versão simplificada para uso em OperatorWorkSheet / fichas de produção.
 * Recebe variant e master como objetos separados.
 */
export function getProductImage(
  variant: { variant_image_url?: string | null },
  master: { main_image_url?: string | null }
): string {
  if (variant?.variant_image_url) return variant.variant_image_url;
  if (master?.main_image_url) return master.main_image_url;
  return "/placeholder.svg";
}
