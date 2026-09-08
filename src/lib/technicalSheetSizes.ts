/** Grades padrão por categoria de calçado — compartilhado entre ficha e BOM. */
export const ADULT_SIZES = [34, 35, 36, 37, 38, 39, 40];
export const CHILD_SIZES = [21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];

export function getSizesForCategory(shoeCategory?: string): number[] {
  return shoeCategory === 'Infantil' ? CHILD_SIZES : ADULT_SIZES;
}

export function parseSizesFromRange(sizesStr?: string, shoeCategory?: string): number[] {
  if (sizesStr && sizesStr.includes('-')) {
    const [start, end] = sizesStr.split('-').map(Number);
    if (!isNaN(start) && !isNaN(end) && start <= end) {
      const out: number[] = [];
      for (let n = start; n <= end; n++) out.push(n);
      return out;
    }
  }
  return getSizesForCategory(shoeCategory);
}
