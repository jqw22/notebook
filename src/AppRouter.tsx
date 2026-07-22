import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import Notes from "./pages/Notes";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

// Resolve basename safely — esbuild-wasm (Shakespeare preview) doesn't
// define import.meta.env.BASE_URL. We use a type assertion + optional chaining
// so esbuild emits null-guarded code instead of a bare property access.
const baseUrl = (
  (import.meta as unknown as { env?: { BASE_URL?: string } })?.env?.BASE_URL ?? ''
).replace(/\/$/, '');

export function AppRouter() {
  return (
    <BrowserRouter basename={baseUrl}>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/notes" element={<Notes />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;