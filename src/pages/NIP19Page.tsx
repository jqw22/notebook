import NotFound from './NotFound';

/**
 * Route for NIP-19 identifiers (`/:nip19`).
 *
 * The notebook is private and has no public profile or event views, so every
 * identifier shows the 404 page rather than placeholder text. Implement views
 * here if public pages are ever added.
 */
export function NIP19Page() {
  return <NotFound />;
}
