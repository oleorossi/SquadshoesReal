import { lazy, Suspense } from 'react';
import type { RouteObject } from 'react-router-dom';
import { CircleNotch as Loader2 } from '@phosphor-icons/react';

const VitrineProntaEntrega = lazy(() => import('./pages/VitrineProntaEntrega'));

function PublicLoader() {
  return (
    <div className="min-h-screen grid place-items-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

export const publicVitrineRoute: RouteObject = {
  path: '/vitrine/:token',
  element: (
    <Suspense fallback={<PublicLoader />}>
      <VitrineProntaEntrega />
    </Suspense>
  ),
};
