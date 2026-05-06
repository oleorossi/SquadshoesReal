 import React, { Suspense, lazy } from 'react';
 
 // Lazy load do Design System original
 const DesignSystemApp = lazy(() => import('@/design-system/App'));
 
 const DesignSystemPage = () => {
   return (
     <Suspense fallback={
       <div className="flex items-center justify-center min-h-screen bg-background">
         <div className="text-center space-y-4">
           <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
           <p className="text-muted-foreground font-medium">Carregando Design System...</p>
         </div>
       </div>
     }>
       <DesignSystemApp />
     </Suspense>
   );
 };
 
 export default DesignSystemPage;
