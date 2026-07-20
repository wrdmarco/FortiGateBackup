import Link from "next/link";

type QueryValue = string | number | null | undefined;

type ServerPaginationProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  path: string;
  query?: Record<string, QueryValue>;
  itemLabel?: string;
};

export function ServerPagination({
  page,
  pageSize,
  totalItems,
  path,
  query = {},
  itemLabel = "resultaten"
}: ServerPaginationProps) {
  if (totalItems === 0) return null;

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const firstItem = (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalItems);

  return (
    <nav
      aria-label="Paginanavigatie"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm"
    >
      <p className="text-muted-foreground">
        {firstItem}-{lastItem} van {totalItems} {itemLabel}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link className={linkClass} href={pageHref(path, page - 1, query)} rel="prev">
            Vorige
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>Vorige</span>
        )}
        <span className="min-w-24 text-center font-medium">
          Pagina {page} van {totalPages}
        </span>
        {page < totalPages ? (
          <Link className={linkClass} href={pageHref(path, page + 1, query)} rel="next">
            Volgende
          </Link>
        ) : (
          <span aria-disabled="true" className={disabledClass}>Volgende</span>
        )}
      </div>
    </nav>
  );
}

export function parsePageParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function normalizePage(requestedPage: number, totalItems: number, pageSize: number) {
  return Math.min(requestedPage, Math.max(1, Math.ceil(totalItems / pageSize)));
}

export function firstQueryValue(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function pageHref(path: string, page: number, query: Record<string, QueryValue>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== null && value !== undefined && String(value).length > 0) {
      params.set(key, String(value));
    }
  }
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

const linkClass =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 py-2 font-medium transition hover:border-primary/50 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const disabledClass =
  "inline-flex min-h-11 cursor-not-allowed items-center justify-center rounded-md border border-border bg-muted px-4 py-2 text-muted-foreground opacity-60";
