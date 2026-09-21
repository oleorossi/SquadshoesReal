import { useMemo, useState } from 'react';
import { Package as BoxIcon, CircleNotch as Loader2 } from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  countVolumesInSelection,
  parseRotuloVolumeSpec,
  type ExternalVolumePartialRow,
  type ExternalVolumePartialSelection,
} from '@/lib/labelExternalVolumePartial';

interface PartialExternalBoxDialogProps {
  rows: ExternalVolumePartialRow[];
  loading?: boolean;
  onGenerate: (selection: ExternalVolumePartialSelection) => void;
  onClose: () => void;
}

export function PartialExternalBoxDialog({
  rows,
  loading = false,
  onGenerate,
  onClose,
}: PartialExternalBoxDialogProps) {
  const [draft, setDraft] = useState<ExternalVolumePartialSelection>({});

  const totalVolumes = useMemo(
    () => countVolumesInSelection(rows, draft),
    [draft, rows],
  );

  function setRowText(volumeSetKey: string, value: string) {
    setDraft(current => {
      const next = { ...current };
      if (!value.trim()) delete next[volumeSetKey];
      else next[volumeSetKey] = value;
      return next;
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-5 py-5 sm:px-6">
          <div className="flex items-center gap-2 pr-8">
            <BoxIcon className="h-5 w-5 shrink-0 text-primary" />
            <DialogTitle>Parcial Rótulo externo</DialogTitle>
          </div>
          <DialogDescription className="max-w-2xl pt-1 text-left">
            Informe os volumes do rótulo (o n de VOLUME n/N) que faltaram. Use vírgula
            para soltos (<span className="font-mono">20, 27</span>) e hífen para
            intervalo (<span className="font-mono">50-55</span>). Campo vazio deixa
            aquela cor de fora. Números inválidos são ignorados.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Calculando volumes das caixas…
            </div>
          ) : rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum volume de rótulo externo encontrado na seleção.
            </div>
          ) : (
            <div className="space-y-4">
              {rows.map(row => {
                const inputId = `external-volume-${row.volumeSetKey}`;
                const value = draft[row.volumeSetKey] || '';
                const parsed = parseRotuloVolumeSpec(value, row.maxVolume);
                return (
                  <div
                    key={row.volumeSetKey}
                    className="rounded-md border border-border bg-card p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {row.refCode || row.refName}
                          <span className="text-muted-foreground font-normal"> · {row.color}</span>
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {row.saleOrderNumber || 'Sem PV'}
                          {row.orderNumbers.length > 0 ? ` · ${row.orderNumbers.join(', ')}` : ''}
                        </p>
                      </div>
                      <Badge variant="secondary" className="font-mono tabular-nums shrink-0">
                        1–{row.maxVolume}
                      </Badge>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={inputId} className="text-xs font-medium">
                        Volumes a reimprimir
                      </Label>
                      <Input
                        id={inputId}
                        value={value}
                        onChange={event => setRowText(row.volumeSetKey, event.target.value)}
                        placeholder="Ex.: 20, 27 ou 50-55"
                        className="h-9 font-mono"
                        autoComplete="off"
                        spellCheck={false}
                        onKeyDown={event => {
                          if (event.key === 'Enter') event.preventDefault();
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Volumes disponíveis: 1–{row.maxVolume.toLocaleString('pt-BR')}
                        {parsed.length > 0 && (
                          <>
                            {' · '}
                            <span className="text-foreground font-medium tabular-nums">
                              {parsed.length.toLocaleString('pt-BR')}{' '}
                              {parsed.length === 1 ? 'volume' : 'volumes'}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border bg-background px-5 py-4 sm:items-center sm:justify-between sm:px-6">
          <div className="mr-auto flex flex-wrap items-center gap-2" aria-live="polite">
            <Badge variant="secondary">
              {rows.length} {rows.length === 1 ? 'conjunto' : 'conjuntos'}
            </Badge>
            <strong className="text-sm tabular-nums text-foreground">
              {totalVolumes.toLocaleString('pt-BR')} {totalVolumes === 1 ? 'rótulo' : 'rótulos'}
            </strong>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            type="button"
            data-dialog-primary="true"
            disabled={loading || totalVolumes === 0}
            onClick={() => onGenerate(draft)}
          >
            Gerar PDF parcial
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
