import { Copy, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { PasteReject } from "@/lib/stockPasteImport";

interface StockPasteRejectedPanelProps {
  rejected: PasteReject[];
  appliedCount: number;
  onCopy(): void;
  onDiscardPaste(): void;
  onDismiss(): void;
}

export function StockPasteRejectedPanel({
  rejected,
  appliedCount,
  onCopy,
  onDiscardPaste,
  onDismiss,
}: StockPasteRejectedPanelProps) {
  return (
    <div className="shrink-0 max-h-40 overflow-auto border border-destructive/30 bg-destructive/5 rounded-md my-2 p-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-destructive">
            {rejected.length} linha{rejected.length !== 1 ? "s" : ""} rejeitada{rejected.length !== 1 ? "s" : ""} na colagem
          </p>
          <p className="text-xs text-muted-foreground">
            {appliedCount} linha{appliedCount !== 1 ? "s" : ""} aplicada{appliedCount !== 1 ? "s" : ""} como rascunho.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onCopy}>
          <Copy />
          Copiar rejeitadas
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onDiscardPaste}>
          Descartar colagem
        </Button>
        <Button type="button" size="icon-xs" variant="ghost" onClick={onDismiss} title="Fechar painel">
          <X />
        </Button>
      </div>

      <div className="mt-2 space-y-0.5 text-xs font-mono">
        {rejected.map((item, index) => (
          <div key={`${item.line}-${item.sku}-${index}`} className="grid grid-cols-[3.5rem_minmax(5rem,1fr)_minmax(4rem,0.6fr)_minmax(12rem,2fr)] gap-2 text-muted-foreground">
            <span>linha {item.line}</span>
            <span className="truncate" title={item.sku || "SKU vazio"}>{item.sku || "—"}</span>
            <span className="truncate" title={item.rawQty || "Quantidade vazia"}>{item.rawQty || "—"}</span>
            <span>{item.reason}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
