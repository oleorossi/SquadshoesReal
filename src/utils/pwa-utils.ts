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
   // This was previously clearing everything on every load.
   // We keep it as an export but don't call it automatically anymore
   // to allow our new SW to work.
 }
