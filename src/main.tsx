import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from '@/app';
import { Landing } from '@/landing';

const root = document.getElementById('app');
if (!root) throw new Error('#app mount point not found in index.html');

/**
 * Hash routing.
 *
 * - Production: Landing is default. '#peek' shows App (the test scene as a
 *   public sneak peek).
 * - Development: App is default (so `npm run dev` lands directly on the test
 *   scene). '#landing' previews the Landing page locally without touching
 *   the build mode.
 */
function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (import.meta.env.DEV) {
    return hash === '#landing' ? <Landing /> : <App />;
  }
  return hash === '#peek' ? <App /> : <Landing />;
}

render(<Root />, root);
