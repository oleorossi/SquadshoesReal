import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Saves and restores scroll position per route using sessionStorage.
 * Place this hook in a component rendered inside BrowserRouter.
 */
export function useScrollRestoration() {
  const location = useLocation();
  const key = `scroll_${location.pathname}`;

  // Restore scroll on mount / route change
  useEffect(() => {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const y = parseInt(saved, 10);
      // Use requestAnimationFrame to wait for content render
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    } else {
      window.scrollTo(0, 0);
    }

    // Save scroll on unmount (leaving the page)
    return () => {
      sessionStorage.setItem(key, String(window.scrollY));
    };
  }, [key]);

  // Also save on scroll (debounced via passive listener)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        sessionStorage.setItem(key, String(window.scrollY));
      }, 150);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [key]);
}
