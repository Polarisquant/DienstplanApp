import Link from "next/link";
import { ReactNode } from "react";

export type AppNavLink = { href: string; label: string };

const desktopLinkClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50";
const mobileLinkClass =
  "block rounded-lg px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-100";

/** Desktop: inline links. Mobile: collapsible navigation panel. */
export function AppNavLinks({
  links,
  after,
}: {
  links: AppNavLink[];
  after?: ReactNode;
}) {
  return (
    <>
      <details className="w-full md:hidden">
        <summary className="touch-target flex w-full cursor-pointer list-none items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
          Navigation
        </summary>
        <nav className="mt-2 flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={mobileLinkClass}>
              {l.label}
            </Link>
          ))}
          {after ? (
            <div className="border-t border-slate-100 pt-1">{after}</div>
          ) : null}
        </nav>
      </details>
      <div className="hidden flex-wrap items-center gap-2 md:flex">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={desktopLinkClass}>
            {l.label}
          </Link>
        ))}
        {after}
      </div>
    </>
  );
}
