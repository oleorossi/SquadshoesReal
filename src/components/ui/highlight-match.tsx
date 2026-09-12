import { type ReactNode } from 'react';
import { splitSearchTerms } from '@/lib/searchUtils';

/**
 * Destaca os tokens da busca dentro de um texto de resultado.
 * Extraído da busca global (⌘K) pra SmartSearch, tabelas e pickers usarem o mesmo <mark>.
 */
export function HighlightMatch({
  text,
  term,
}: {
  text: string | null | undefined;
  term: string;
}): ReactNode {
  if (!text) return null;
  const tokens = splitSearchTerms((term || '').replace(/^\//, ''))
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.join('|')})`, 'ig');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-primary/20 text-foreground rounded-[2px]">{p}</mark>
      : <span key={i}>{p}</span>,
  );
}
