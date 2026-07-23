type NavigationIntent = {
  href: string;
  currentHref: string;
  target?: string | null;
  download?: boolean;
};

const downloadableExtension = /\.(?:pdf|zip|tar|gz|csv|xlsx?|docx?|conf|txt)$/i;

export function isInternalPageNavigation(input: NavigationIntent) {
  if (input.download || (input.target && input.target !== "_self")) return false;
  const current = new URL(input.currentHref);
  const destination = new URL(input.href, current);
  if (!["http:", "https:"].includes(destination.protocol)) return false;
  if (destination.origin !== current.origin || destination.href === current.href) return false;
  if (destination.pathname.startsWith("/api/") || downloadableExtension.test(destination.pathname)) return false;
  return true;
}
