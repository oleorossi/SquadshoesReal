import React from 'react';
import { Icon as LucideIcon } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface PageShellProps {
  title: string;
  subtitle?: string;
  /** Optional icon shown left of title */
  icon?: LucideIcon;
  /** Buttons / controls rendered top-right */
  actions?: React.ReactNode;
  /** Optional secondary row: tabs, filter pills, etc. */
  toolbar?: React.ReactNode;
  /** Additional className for the outer wrapper */
  className?: string;
  children: React.ReactNode;
}

/**
 * Standard page wrapper giving every page a consistent header:
 * optional icon + title + subtitle + actions + optional toolbar row.
 */
export default function PageShell({ title, subtitle, icon: Icon, actions, toolbar, className, children }: PageShellProps) {
  return (
    <div className={cn('flex flex-col gap-5 page-enter', className)}>

      {/* ── Page header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between pb-4 border-b border-border/60">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div className="mt-0.5 h-9 w-9 shrink-0 rounded-lg bg-primary/10 text-primary flex items-center justify-center ring-1 ring-primary/20 shadow-sm">
              <Icon className="h-[18px] w-[18px]" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold tracking-tight text-foreground leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground leading-snug">{subtitle}</p>
            )}
          </div>
        </div>

        {actions && (
          <div className="flex flex-wrap items-center gap-2 shrink-0 pt-0.5">
            {actions}
          </div>
        )}
      </div>

      {/* ── Optional toolbar row (tabs, filters, etc.) ── */}
      {toolbar && (
        <div className="flex flex-wrap items-center gap-2 -mt-2">
          {toolbar}
        </div>
      )}

      {/* ── Page content ── */}
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}
