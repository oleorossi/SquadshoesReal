import TechnicalSheets from '@/pages/TechnicalSheets';

/**
 * Catálogo de fichas ainda não publicadas (rascunho / em revisão / validada).
 * Hub `/fichas-tecnicas` lista só `publicada`.
 */
export default function FichasEmRascunhoPage() {
  return <TechnicalSheets catalogScope="drafts" />;
}
