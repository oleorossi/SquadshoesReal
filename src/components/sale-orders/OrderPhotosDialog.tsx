import { useEffect, useMemo, useState } from 'react';
import {
  Images,
  FilePdf,
  CircleNotch as Loader2,
  MagnifyingGlass as Maximize2,
  X,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SignedImage } from '@/components/ui/signed-image';
import { toast } from 'sonner';
import {
  collectOrderPhotos,
  groupOrderPhotos,
  openPrintTab,
  printOrderPhotosPdf,
  type OrderPhoto,
  type OrderPhotoItem,
} from '@/lib/printOrderPhotos';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  orderNumber: string;
  clientName?: string;
  items: OrderPhotoItem[];
};

export default function OrderPhotosDialog({ open, onOpenChange, orderNumber, clientName, items }: Props) {
  const photos = useMemo(() => collectOrderPhotos(items), [items]);
  const groups = useMemo(() => groupOrderPhotos(photos), [photos]);
  const [active, setActive] = useState<OrderPhoto | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    if (!open) setActive(null);
  }, [open]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActive(null);
        return;
      }
      const idx = photos.findIndex((p) => p.id === active.id);
      if (idx < 0) return;
      if (e.key === 'ArrowRight') setActive(photos[(idx + 1) % photos.length]);
      if (e.key === 'ArrowLeft') setActive(photos[(idx - 1 + photos.length) % photos.length]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, photos]);

  const activeIndex = active ? photos.findIndex((p) => p.id === active.id) : -1;
  const pairs = photos.reduce((s, p) => s + p.quantity, 0);

  const handleGerarPdf = () => {
    if (photos.length === 0) {
      toast.info('Nenhum item neste pedido para gerar o PDF.');
      return;
    }
    // Aba TEM que abrir no clique, antes de qualquer await — senão o celular
    // trata como pop-up e o PDF nunca aparece.
    const tab = openPrintTab();
    setPdfBusy(true);
    void printOrderPhotosPdf({
      orderNumber,
      clientName,
      items,
      target: tab,
    }).then((ok) => {
      if (ok) toast.success('Gerando PDF das fotos…');
    }).catch((err: unknown) => {
      tab?.close();
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      toast.error(`Não foi possível gerar o PDF: ${msg}`);
    }).finally(() => setPdfBusy(false));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Tela cheia no viewport do cliente. O DialogContent-base é `grid` +
        `max-w-3xl` + `overflow-y-auto`: em nested dialog o segundo filho
        (a galeria) colapsava pra 0px — só o cabeçalho aparecia, uma faixa
        branca no meio da tela. `flex flex-col` + altura explícita em dvh
        preenche a resolução; a galeria (`flex-1 min-h-0`) rola o resto.
      */}
      <DialogContent className="flex h-[96dvh] w-[96vw] max-h-[96dvh] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b bg-muted/40 px-5 py-4 pr-12 space-y-0 text-left">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="flex items-center gap-2 text-2xl">
                <Images className="h-5 w-5 text-primary" />
                Fotos dos produtos
              </DialogTitle>
              <DialogDescription className="mt-1">
                {orderNumber}{clientName ? ` · ${clientName}` : ''} — {groups.length} {groups.length === 1 ? 'referência' : 'referências'} · {photos.length} {photos.length === 1 ? 'cor' : 'cores'} · {pairs.toLocaleString('pt-BR')} pares
              </DialogDescription>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={handleGerarPdf}
              disabled={pdfBusy || photos.length === 0}
              title="Gerar PDF com as fotos das fichas técnicas deste pedido"
            >
              {pdfBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FilePdf className="h-3.5 w-3.5" />}
              GERAR PDF
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {photos.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhum item neste pedido.
            </p>
          ) : groups.map((g) => (
            <section key={g.key}>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-bold tracking-tight">
                  {g.refName}
                  {g.refCode && g.refCode !== g.refName ? (
                    <span className="ml-2 font-mono text-xs font-medium text-muted-foreground">{g.refCode}</span>
                  ) : null}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {g.items.length} {g.items.length === 1 ? 'cor' : 'cores'} · {g.items.reduce((s, i) => s + i.quantity, 0)} pares
                </p>
              </div>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {g.items.map((photo) => (
                  <li key={photo.id}>
                    <button
                      type="button"
                      onClick={() => setActive(photo)}
                      className="group flex w-full flex-col overflow-hidden rounded-md border bg-card text-left transition-colors duration-150 hover:border-foreground/40"
                    >
                      <span className="relative aspect-square overflow-hidden bg-muted">
                        <SignedImage
                          src={photo.src}
                          alt={`${g.refCode} ${photo.color}`}
                          className="h-full w-full transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transform-none"
                        />
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-background/90 p-1 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                          <Maximize2 className="h-3.5 w-3.5" />
                        </span>
                      </span>
                      <span className="flex flex-col gap-0.5 px-2.5 py-2">
                        <span className="truncate text-xs font-bold">{photo.color}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {photo.quantity} pares
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {active ? (
          <div
            className="absolute inset-0 z-10 flex flex-col bg-foreground/92 text-background"
            role="dialog"
            aria-modal="true"
            aria-label={`Foto ampliada ${active.refCode} ${active.color}`}
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">
                  {active.refCode} · {active.color}
                </p>
                <p className="text-xs text-background/70">
                  {active.quantity} pares · {activeIndex + 1} / {photos.length}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="text-background hover:bg-background/10"
                onClick={() => setActive(null)}
                aria-label="Fechar ampliação"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center px-12 pb-6">
              <button
                type="button"
                className="absolute left-2 rounded-full bg-background/15 p-2 text-background hover:bg-background/25"
                onClick={() => setActive(photos[(activeIndex - 1 + photos.length) % photos.length])}
                aria-label="Foto anterior"
              >
                <CaretLeft className="h-6 w-6" />
              </button>
              <SignedImage
                src={active.src}
                alt={`${active.refCode} ${active.color}`}
                fit="contain"
                className="max-h-full max-w-full rounded-md"
              />
              <button
                type="button"
                className="absolute right-2 rounded-full bg-background/15 p-2 text-background hover:bg-background/25"
                onClick={() => setActive(photos[(activeIndex + 1) % photos.length])}
                aria-label="Próxima foto"
              >
                <CaretRight className="h-6 w-6" />
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
