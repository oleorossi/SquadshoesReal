export type ShoeSizeMapping = {
  br: number;
  eu: number;
  us: number;
  uk: number;
};

export function getShoeSizeMappings(brSize: number): ShoeSizeMapping {
  // Common conversion mapping
  return {
    br: brSize,
    eu: brSize + 2,
    us: brSize - 30, // Approximate US Women
    uk: brSize - 31, // Approximate UK Women
  };
}

export const COMMON_ADULT_SIZES = [33, 34, 35, 36, 37, 38, 39, 40, 41];
export const COMMON_CHILD_SIZES = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33];
