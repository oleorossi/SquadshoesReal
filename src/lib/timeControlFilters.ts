const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface TimeControlFilterParams {
  selectedBatch?: string;
  filterStartDate?: string;
  filterEndDate?: string;
}

export interface TimeControlResolvedFilters {
  queryBatch?: string;
  queryStartDate?: string;
  queryEndDate?: string;
  dateRange: { startDate: string; endDate: string } | null;
}

 export function isValidIsoDate(value?: string): value is string {
   if (!value || !ISO_DATE_PATTERN.test(value)) return false;
   const year = parseInt(value.split('-')[0], 10);
   // Only allow years between 1950 and 2100 to prevent performance issues with wide date ranges
   return year > 1950 && year < 2100;
 }

export function getBatchDateRange(batch?: string) {
  if (!batch) return null;

  const rangeMatch = batch.match(/^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})_/);
  if (rangeMatch) {
    return {
      startDate: rangeMatch[1],
      endDate: rangeMatch[2],
    };
  }

  const legacyMatch = batch.match(/^(\d{4})-(\d{2})_/);
  if (legacyMatch) {
    const year = Number(legacyMatch[1]);
    const month = Number(legacyMatch[2]);
    const daysInMonth = new Date(year, month, 0).getDate();

    return {
      startDate: `${year}-${legacyMatch[2]}-01`,
      endDate: `${year}-${legacyMatch[2]}-${String(daysInMonth).padStart(2, '0')}`,
    };
  }

  return null;
}

export function resolveTimeControlFilters({
  selectedBatch,
  filterStartDate,
  filterEndDate,
}: TimeControlFilterParams): TimeControlResolvedFilters {
  const hasManualRange = isValidIsoDate(filterStartDate) && isValidIsoDate(filterEndDate);

  if (hasManualRange) {
    return {
      queryBatch: undefined,
      queryStartDate: filterStartDate,
      queryEndDate: filterEndDate,
      dateRange: {
        startDate: filterStartDate,
        endDate: filterEndDate,
      },
    };
  }

  const batchRange = getBatchDateRange(selectedBatch);
  if (batchRange) {
    return {
      queryBatch: undefined,
      queryStartDate: batchRange.startDate,
      queryEndDate: batchRange.endDate,
      dateRange: batchRange,
    };
  }

  return {
    queryBatch: selectedBatch || undefined,
    queryStartDate: undefined,
    queryEndDate: undefined,
    dateRange: null,
  };
}