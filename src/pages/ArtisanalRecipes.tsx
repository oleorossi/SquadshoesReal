import { Navigate } from 'react-router-dom';

/** Compatibilidade temporária; toda escrita vive no hub canônico. */
export default function ArtisanalRecipes() {
  return <Navigate to="/tiras-artesanais?tab=receitas" replace />;
}
