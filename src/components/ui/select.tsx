import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, CaretDown as ChevronDown, CaretUp as ChevronUp } from '@phosphor-icons/react';

import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { searchMatchesAllTerms } from "@/lib/searchUtils";

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      // Industrial Editorial Pro: borda 1.5px decisive + rounded-sm.
      // Focus: borda foreground sólida sem ring colorido (igual Input).
      // 44px no mobile evita alvo de toque apertado; no desktop, h-9 alinha com
      // Input e SearchableSelect sem desperdiçar altura em telas operacionais.
      "flex h-11 w-full items-center justify-between rounded-sm border-[1.5px] border-foreground/15 bg-background px-3 py-2 text-base md:h-9 md:text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:border-foreground focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 aria-[invalid=true]:border-primary",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

interface SelectContentProps extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> {
  /**
   * `auto` ativa a busca quando a lista ultrapassa `searchThreshold` itens.
   * Use `true` para forçar ou `false` para manter um seletor curto sem busca.
   */
  searchable?: boolean | 'auto';
  /** Quantidade de opções a partir da qual `searchable="auto"` é ativado. */
  searchThreshold?: number;
  /** Placeholder específico do catálogo, ex.: "Buscar produto, SKU ou cor…". */
  searchPlaceholder?: string;
  /** Rótulo curto exibido acima da busca. */
  searchLabel?: string;
  /** Mensagem exibida quando nenhuma opção corresponde à busca. */
  searchEmptyText?: string;
}

interface FilteredSelectNodes {
  nodes: React.ReactNode;
  totalItems: number;
  matchedItems: number;
}

function textFromReactNode(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textFromReactNode).join(' ');
  if (!React.isValidElement(node)) return '';
  return textFromReactNode((node.props as { children?: React.ReactNode }).children);
}

function isSelectItemElement(node: React.ReactNode): node is React.ReactElement<
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
> {
  if (!React.isValidElement(node)) return false;
  const elementType = node.type as { displayName?: string };
  return node.type === SelectItem || elementType?.displayName === SelectItem.displayName;
}

/**
 * Percorre também SelectGroup/Fragment, preservando os grupos que ainda têm
 * resultados. Como o filtro acontece nos React children, as opções que não
 * casam nem entram no Collection do Radix: teclado e leitor de tela enxergam
 * exatamente a mesma lista que o usuário vê.
 */
function filterSelectNodes(children: React.ReactNode, query: string): FilteredSelectNodes {
  let totalItems = 0;
  let matchedItems = 0;
  const hasQuery = query.trim().length > 0;

  const nodes = React.Children.map(children, (child) => {
    if (isSelectItemElement(child)) {
      totalItems += 1;
      const props = child.props as React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
        'aria-label'?: string;
      };
      const matches = !hasQuery || searchMatchesAllTerms(
        query,
        props.textValue,
        props.value,
        props['aria-label'],
        textFromReactNode(props.children),
      );
      if (matches) matchedItems += 1;
      return matches ? child : null;
    }

    if (!React.isValidElement(child)) return child;
    const props = child.props as { children?: React.ReactNode };
    if (props.children == null) {
      // Separadores soltos não agregam informação durante um refinamento.
      if (hasQuery && child.type === SelectSeparator) return null;
      return child;
    }

    const nested = filterSelectNodes(props.children, query);
    totalItems += nested.totalItems;
    matchedItems += nested.matchedItems;

    // Se este elemento agrupava opções e nenhuma casou, remove o grupo inteiro
    // (inclusive label/separadores), evitando cabeçalhos órfãos.
    if (nested.totalItems > 0 && nested.matchedItems === 0) return null;
    return React.cloneElement(child, undefined, nested.nodes);
  });

  return { nodes, totalItems, matchedItems };
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(({
  className,
  children,
  position = "popper",
  searchable = 'auto',
  searchThreshold = 8,
  searchPlaceholder = 'Buscar nesta lista…',
  searchLabel = 'Localizar opção',
  searchEmptyText = 'Nenhuma opção encontrada.',
  onEscapeKeyDown,
  onKeyDownCapture,
  ...props
}, ref) => {
  const [query, setQuery] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const contentRef = React.useRef<React.ElementRef<typeof SelectPrimitive.Content>>(null);
  const filtered = React.useMemo(() => filterSelectNodes(children, query), [children, query]);
  const searchEnabled = searchable === true || (searchable === 'auto' && filtered.totalItems >= searchThreshold);

  const setContentRef = React.useCallback((node: React.ElementRef<typeof SelectPrimitive.Content> | null) => {
    contentRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const focusFirstVisibleOption = () => {
    const firstOption = contentRef.current?.querySelector<HTMLElement>('[role="option"]:not([data-disabled])');
    firstOption?.focus();
  };

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={setContentRef}
        className={cn(
          // Industrial Editorial Pro: popover com borda 1.5px decisive em vez
          // de shadow-md, rounded-sm. Animations só fade (sem zoom/slide).
          // max-h respeita a altura disponível calculada pelo Radix (teclado
          // virtual/landscape), com teto de 24rem no desktop.
          "relative z-popover max-h-[min(24rem,var(--radix-select-content-available-height))] min-w-[8rem] overflow-hidden rounded-sm border-[1.5px] border-foreground bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        onEscapeKeyDown={(event) => {
          onEscapeKeyDown?.(event);
          if (event.defaultPrevented || !query) return;
          event.preventDefault();
          setQuery('');
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onKeyDownCapture={(event) => {
          onKeyDownCapture?.(event);
          if (event.defaultPrevented || !searchEnabled) return;

          // O Radix trata Esc antes do bubble do Input. Interceptar aqui faz o
          // primeiro Esc apenas limpar o refinamento; com a busca vazia, o
          // próximo Esc volta ao comportamento nativo e fecha a lista.
          if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery('');
            inputRef.current?.focus();
            return;
          }

          if (event.target === inputRef.current) {
            return;
          }

          // Digitar com uma opção focada transfere o texto para a busca, em vez
          // de acionar o typeahead de uma letra do Radix.
          const isPrintable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
          if (isPrintable) {
            event.preventDefault();
            event.stopPropagation();
            setQuery((current) => current + event.key);
            inputRef.current?.focus();
          }
        }}
        {...props}
      >
        {searchEnabled && (
          <div className="border-b border-foreground/10 bg-muted-soft p-2" data-select-search>
            <div className="mb-1 flex items-center justify-between gap-3 px-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <span>{searchLabel}</span>
              <span aria-live="polite" className="shrink-0 tabular-nums">
                {query ? `${filtered.matchedItems} de ` : ''}{filtered.totalItems.toLocaleString('pt-BR')}
              </span>
            </div>
            <SearchInput
              ref={inputRef}
              value={query}
              onChange={setQuery}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              hideHint
              disableSlashFocus
              className="w-full"
              inputClassName="h-11 bg-background sm:h-8"
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  event.stopPropagation();
                  focusFirstVisibleOption();
                  return;
                }
                // O primeiro Esc limpa a busca (SearchInput); o segundo fecha o
                // seletor pelo comportamento nativo do Radix.
                if (event.key === 'Escape' && query) {
                  event.stopPropagation();
                  return;
                }
                if (event.key !== 'Tab') event.stopPropagation();
              }}
            />
          </div>
        )}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {filtered.matchedItems > 0 || !searchEnabled ? filtered.nodes : (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground" role="status">
              {searchEmptyText}
            </div>
          )}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

/**
 * Sentinela usado quando algum SelectItem é renderizado com value vazio,
 * null ou undefined. Radix proíbe value="" (empty string é reservado pra
 * "limpar seleção"), e qualquer linha com value inválido **crasha** o app
 * inteiro com a exceção `A <Select.Item /> must have a value prop that is
 * not an empty string`. Em vez de deixar o app cair quando dados sujos do
 * banco chegam (department='', refs com id ausente, etc), substituímos
 * por essa sentinela e logamos um warning em DEV.
 */
const __INVALID_VALUE_SENTINEL = '__invalid_select_value__';

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, value, ...props }, ref) => {
  // Guard universal: value '' / null / undefined / só-whitespace é inválido.
  const isInvalid = value == null || (typeof value === 'string' && value.trim() === '');
  if (isInvalid) {
    if (import.meta.env.DEV) {

      console.warn(
        '[SelectItem] value vazio detectado — substituído por sentinela. ' +
          'Origem provável: dado sujo (ex: department="" no DB) sendo passado direto pro value. ' +
          'Filtre antes de mapear ou use uma sentinela explícita (ex: "all", "none"). children:',
        children,
      );
    }
  }
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex min-h-11 w-full cursor-default select-none items-center rounded-sm py-2.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground md:min-h-0 md:py-1.5",
        className,
      )}
      value={isInvalid ? __INVALID_VALUE_SENTINEL : (value as string)}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
