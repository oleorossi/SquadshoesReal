import { Skeleton } from '@/components/ui/skeleton';

export function PageSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3 w-3 rounded" />
        <Skeleton className="h-3.5 w-20 rounded" />
        <Skeleton className="h-3 w-3 rounded" />
        <Skeleton className="h-3.5 w-28 rounded" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 rounded-md" />
        <Skeleton className="h-4 w-72 rounded-md" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default PageSkeleton;

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="space-y-1">
        <Skeleton className="h-7 w-56 rounded-md" />
        <Skeleton className="h-4 w-40 rounded" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <div className="flex justify-between">
              <Skeleton className="h-3 w-20 rounded" />
              <Skeleton className="h-8 w-8 rounded-xl" />
            </div>
            <Skeleton className="h-6 w-24 rounded" />
            <Skeleton className="h-3 w-16 rounded" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-5 w-32 rounded" />
          <Skeleton className="h-[220px] w-full rounded-md" />
        </div>
        <div className="rounded-lg border p-4 space-y-3">
          <Skeleton className="h-5 w-32 rounded" />
          <Skeleton className="h-[220px] w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}

export function InventorySkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="space-y-1">
        <Skeleton className="h-7 w-48 rounded-md" />
        <Skeleton className="h-4 w-64 rounded" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 rounded-md" />
        <Skeleton className="h-9 w-44 rounded-md" />
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>
      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted/50 px-4 py-2.5 flex gap-4">
          {[60, 140, 100, 80, 80, 80].map((w, i) => (
            <Skeleton key={i} className="h-3 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex gap-4 border-t items-center">
            <Skeleton className="h-14 w-14 rounded shrink-0" />
            <Skeleton className="h-4 w-36 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-4 w-16 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FinanceSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="space-y-1">
        <Skeleton className="h-7 w-52 rounded-md" />
        <Skeleton className="h-4 w-80 rounded" />
      </div>
      <div className="flex gap-1 flex-wrap">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-7 w-20 rounded-md" />)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
      </div>
      <div className="rounded-lg border overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex gap-6 border-t items-center">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-4 w-24 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function OrdersSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="space-y-1">
        <Skeleton className="h-7 w-52 rounded-md" />
        <Skeleton className="h-4 w-64 rounded" />
      </div>
      <div className="flex gap-2 justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>
      <div className="rounded-lg border overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 flex gap-4 border-t items-center">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-7 w-16 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PCPSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="space-y-1">
        <Skeleton className="h-7 w-44 rounded-md" />
        <Skeleton className="h-4 w-72 rounded" />
      </div>
      <div className="flex gap-2 bg-muted/50 p-1 rounded-lg w-fit">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-24 rounded-md" />)}
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}

/**
 * Body-only skeletons (SEM header) — usados junto do <EditorialPageHeader> REAL
 * montado durante isLoading, pra não piscar o chrome da página (eyebrow/título/
 * sidebar). Padrão do Lote 1 (auditoria visual 2026-06-30):
 *
 *   if (isLoading) return (
 *     <div className="w-full space-y-6 page-enter">
 *       <EditorialPageHeader sectionLabel=… title=… description=… />
 *       <StatGridSkeleton count={4} />
 *       <TableSkeleton rows={8} />
 *     </div>
 *   );
 */
export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in duration-300">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-lg" />
      ))}
    </div>
  );
}

export function TableSkeleton({
  rows = 8,
  withToolbar = true,
}: {
  rows?: number;
  withToolbar?: boolean;
}) {
  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {withToolbar && (
        <div className="flex gap-2 justify-between flex-wrap">
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
          <Skeleton className="h-9 w-56 rounded-md" />
        </div>
      )}
      <div className="rounded-lg border overflow-hidden">
        <div className="bg-muted/40 px-4 py-2.5 flex gap-4">
          {[16, 120, 90, 80, 70].map((w, i) => (
            <Skeleton key={i} className="h-3 rounded" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="px-4 py-3.5 flex gap-4 border-t items-center">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-7 w-16 rounded ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}
