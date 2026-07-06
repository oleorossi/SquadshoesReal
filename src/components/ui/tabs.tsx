import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

// Quando a TabsList usa o estilo editorial (underline), a barra vermelha ativa é
// desenhada por um indicador que DESLIZA entre os triggers (ver TabsList). Nesse
// modo o TabsTrigger NÃO desenha seu próprio underline estático (senão apareceria
// uma marca fixa no destino + a barra deslizando = dois sublinhados). Em listas
// "pill" (indicator="none"), o trigger mantém o realce próprio (bg/border).
const TabsLineIndicatorContext = React.createContext(false);

/**
 * Mede o trigger ativo dentro da lista e devolve o style (transform + width) da
 * barra deslizante. Recalcula quando: o data-state de algum trigger muda
 * (troca de aba), a lista muda de tamanho, triggers são adicionados/removidos,
 * ou a janela é redimensionada. Sem framer-motion — a animação é uma transition
 * CSS (herda o handler global de prefers-reduced-motion).
 */
function useTabIndicator(
  listRef: React.RefObject<HTMLElement>,
  enabled: boolean,
): React.CSSProperties {
  const [style, setStyle] = React.useState<React.CSSProperties>({ opacity: 0 });

  React.useLayoutEffect(() => {
    if (!enabled) return;
    const list = listRef.current;
    if (!list) return;

    const update = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) {
        setStyle((s) => ({ ...s, opacity: 0 }));
        return;
      }
      // offset* é relativo à lista (position: relative), mesmo referencial da barra.
      const y = active.offsetTop + active.offsetHeight - 2; // 2px = altura da barra
      setStyle({
        opacity: 1,
        width: `${active.offsetWidth}px`,
        transform: `translate(${active.offsetLeft}px, ${y}px)`,
      });
    };

    update();

    const mo = new MutationObserver(update);
    mo.observe(list, {
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
      subtree: true,
    });
    const ro = new ResizeObserver(update);
    ro.observe(list);
    window.addEventListener("resize", update);

    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [enabled, listRef]);

  return style;
}

// Industrial Editorial Pro (22/05/2026): tabs editoriais — underline em vez
// de pill com bg. TabsList vira faixa horizontal com regra inferior 1.5px;
// active tab ganha underline vermelho squad e foreground sólido.
//
// indicator (2026-07-02):
//   "line" (default) → barra vermelha que DESLIZA entre os triggers ativos.
//   "none"           → sem barra; use em TabsList estilo pill (bg-muted/rounded),
//                      onde o realce ativo vem do próprio trigger (bg-background).
const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
    indicator?: "line" | "none";
  }
>(({ className, indicator = "line", children, ...props }, ref) => {
  const innerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => innerRef.current as HTMLDivElement);

  const lineMode = indicator === "line";
  const indicatorStyle = useTabIndicator(innerRef, lineMode);

  return (
    <TabsLineIndicatorContext.Provider value={lineMode}>
      <TabsPrimitive.List
        ref={innerRef}
        className={cn(
          "relative inline-flex h-11 items-center justify-start gap-1 border-b-[1.5px] border-foreground/15 text-muted-foreground w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          className,
        )}
        {...props}
      >
        {children}
        {lineMode && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: 2,
              willChange: "transform, width",
              transition:
                "transform 220ms var(--ease-out), width 220ms var(--ease-out), opacity 150ms var(--ease-out)",
              ...indicatorStyle,
            }}
            className="pointer-events-none bg-primary rounded-full"
          />
        )}
      </TabsPrimitive.List>
    </TabsLineIndicatorContext.Provider>
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const lineMode = React.useContext(TabsLineIndicatorContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        // Eyebrow style nos labels (mono uppercase tracking widest). Fonte maior
        // (text-sm) e aba ATIVA na cor primária (vermelho squad). Hover sutil.
        // (pedido do dono 2026-06-23)
        "inline-flex items-center justify-center whitespace-nowrap px-4 py-2 text-sm font-bold uppercase tracking-wider font-mono ring-offset-background transition-colors border-b-2 border-transparent -mb-[1.5px] hover:text-foreground data-[state=active]:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        // No modo editorial o underline é a barra deslizante da TabsList; fora dele
        // (pill/none) mantém o underline estático próprio pra não perder o realce.
        !lineMode && "data-[state=active]:border-primary",
        className,
      )}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      // Entrada sutil ao ativar a aba (fade + ~4px de subida, 200ms). O conteúdo
      // inativo desmonta no Radix, então a animação dispara a cada troca.
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:slide-in-from-top-1 data-[state=active]:duration-200",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
