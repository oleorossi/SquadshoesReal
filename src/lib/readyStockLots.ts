export const GRADE_NOTE_PREFIX = '__GRADE__:';

export function sizesToGradeLabel(sizes: string[]): string {
  const nums = sizes
    .map((size) => Number.parseInt(String(size), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (nums.length === 0) return sizes.filter(Boolean).join('-') || '—';
  if (nums.length === 1) return String(nums[0]);
  return `${nums[0]}-${nums[nums.length - 1]}`;
}

export function parseGradeLabelFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  if (!notes.startsWith(GRADE_NOTE_PREFIX)) return null;
  const rest = notes.slice(GRADE_NOTE_PREFIX.length);
  const line = rest.split('\n')[0]?.trim();
  return line || null;
}

export function stripGradeMarker(notes: string | null | undefined): string {
  if (!notes) return '';
  if (!notes.startsWith(GRADE_NOTE_PREFIX)) return notes;
  const idx = notes.indexOf('\n');
  return idx >= 0 ? notes.slice(idx + 1) : '';
}

export function encodeGradeNotes(gradeLabel: string, notes?: string | null): string {
  const clean = stripGradeMarker(notes).trim();
  return `${GRADE_NOTE_PREFIX}${gradeLabel}${clean ? `\n${clean}` : ''}`;
}

export type ReadyStockLotKeyInput = {
  reference_id: string;
  color: string;
  size: string;
  notes?: string | null;
};

export function lotKey(item: ReadyStockLotKeyInput): string {
  const label = parseGradeLabelFromNotes(item.notes);
  return label
    ? `${item.reference_id}|${item.color}|${label}`
    : `${item.reference_id}|${item.color}|*`;
}

export function groupItemsByLot<T extends ReadyStockLotKeyInput>(items: T[]): Array<{
  key: string;
  gradeLabel: string;
  items: T[];
}> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = lotKey(item);
    const arr = map.get(key) || [];
    arr.push(item);
    map.set(key, arr);
  }
  return Array.from(map.entries()).map(([key, grouped]) => {
    const explicit = parseGradeLabelFromNotes(grouped[0]?.notes);
    return {
      key,
      gradeLabel: explicit || sizesToGradeLabel(grouped.map((row) => row.size)),
      items: grouped,
    };
  });
}
