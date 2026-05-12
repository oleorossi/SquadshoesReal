import { useState, useEffect } from "react";
<<<<<<< Updated upstream
import { Warning as AlertOctagon, TrendDown as TrendingDown, Gauge, Package } from '@phosphor-icons/react';
=======
import { AlertOctagon, TrendDown as TrendingDown, Gauge, Package } from '@phosphor-icons/react';
>>>>>>> Stashed changes
import { cn } from "@/lib/utils";

type FilterKey = "all" | "critical" | "low" | "overstock";

interface FilterDef {
  key: FilterKey;
  label: string;
  Icon: typeof Package;
  /** Tailwind classes for the *active* state — uses semantic status tokens. */
  activeClass: string;
  /** Subtle accent applied even when inactive (small dot). */
  dotClass: string;
}

const FILTERS: FilterDef[] = [
  {
    key: "all",
    label: "Todos",
    Icon: Package,
    activeClass: "bg-primary/10 text-primary border-primary/30 ring-1 ring-primary/20",
    dotClass: "bg-muted-foreground/40",
  },
  {
    key: "critical",
    label: "Estoque crítico",
    Icon: AlertOctagon,
    activeClass: "bg-destructive/10 text-destructive border-destructive/30 ring-1 ring-destructive/20",
    dotClass: "bg-destructive",
  },
  {
    key: "low",
    label: "Reposição necessária",
    Icon: TrendingDown,
    activeClass: "bg-warning/15 text-warning border-warning/30 ring-1 ring-warning/20",
    dotClass: "bg-warning",
  },
  {
    key: "overstock",
    label: "Excesso de material",
    Icon: Gauge,
    activeClass: "bg-success/10 text-success border-success/30 ring-1 ring-success/20",
    dotClass: "bg-success",
  },
];

export function InventoryStatusFilters({ onFilterChange }: { onFilterChange: (status: string) => void }) {
  const [active, setActive] = useState<FilterKey>("all");

  useEffect(() => {
    onFilterChange(active);
  }, [active, onFilterChange]);

  return (
    <div
      className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide"
      role="tablist"
      aria-label="Filtros por status de estoque"
    >
      {FILTERS.map(({ key, label, Icon, activeClass, dotClass }) => {
        const isActive = active === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => setActive(key)}
            className={cn(
              "group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all shrink-0",
              "border-border/60 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              isActive && activeClass
            )}
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full transition-colors",
                isActive ? "opacity-100" : "opacity-60",
                dotClass
              )}
              aria-hidden
            />
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}