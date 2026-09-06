export function PolicyLinks() {
  return (
    <nav aria-label="Legal and contact" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
      <a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/terms">Terms</a>
      <a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/privacy">Privacy</a>
      <a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/cookies">Cookies</a>
      <a className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/contact">Contact</a>
    </nav>
  );
}
