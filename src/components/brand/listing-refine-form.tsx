import Form from "next/form";
import type { ReactNode } from "react";

/**
 * The GET form that refines a listing: search, filters, sort.
 *
 * Its fields become the query string exactly as a plain `<form method="get">` would build it, and
 * without JavaScript it is one. With JavaScript the navigation stays client-side and keeps the
 * shopper's scroll position, because refining is narrowing what they are already looking at. The
 * route still owns the URL: whatever this submits is parsed and canonicalized by the loader.
 */
export function ListingRefineForm({
  action,
  className,
  children,
}: Readonly<{ action: string; className?: string; children: ReactNode }>) {
  return (
    <Form action={action} className={className} scroll={false}>
      {children}
    </Form>
  );
}
