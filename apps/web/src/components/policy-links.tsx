import Link from "next/link";

export function PolicyLinks() {
  return (
    <nav aria-label="Legal and contact" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
      <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/terms">Terms</Link>
      <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/privacy">Privacy</Link>
      <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/cookies">Cookies</Link>
      <Link className="inline-flex min-h-11 items-center underline-offset-4 hover:underline" href="/contact">Contact</Link>
    </nav>
  );
}
