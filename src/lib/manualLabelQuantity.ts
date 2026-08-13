export interface ManualGradeEntry {
  size: string;
  qty: number;
}

/** Uma entrada por etiqueta física: quantidade da grade × multiplicador. */
export function expandManualGrade(grade: ManualGradeEntry[], copies: number): string[] {
  const multiplier = Math.max(1, Math.floor(Number(copies) || 1));
  if (grade.length === 0) return Array.from({ length: multiplier }, () => '');
  return grade.flatMap(item =>
    Array.from({ length: Math.max(0, Math.floor(Number(item.qty) || 0)) * multiplier }, () => item.size),
  );
}
