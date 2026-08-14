export const SW_RESET_FLAG = "sw-clear-done";

 export async function registerServiceWorker() {
   if ('serviceWorker' in navigator) {
     try {
       const registration = await navigator.serviceWorker.register('/sw.js');
       console.log('[SW] Registered with scope:', registration.scope);
     } catch (error) {
       console.error('[SW] Registration failed:', error);
     }
   }
 }
 
 export async function clearStalePwaArtifacts(): Promise<void> {
   // Nunca é chamado no carregamento normal. Só nos fluxos explícitos de
   // recuperação após deploy, quando manter um chunk velho é pior que perder um
   // cache temporário de API.
   if ('caches' in window) {
     const keys = await caches.keys();
     await Promise.all(keys.map(key => caches.delete(key)));
   }
   if ('serviceWorker' in navigator) {
     const registrations = await navigator.serviceWorker.getRegistrations();
     await Promise.all(registrations.map(registration => registration.unregister()));
   }
 }
