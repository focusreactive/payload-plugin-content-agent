/** The admin route without its end slash: an admin mounted at "/" gives "". */
export function adminBase(route: string | undefined): string {
  return (route || "/admin").replace(/\/+$/u, "");
}

export function adminDocHref(
  collection: string,
  id?: string | number,
  adminRoute = "/admin"
): string {
  if (collection.startsWith("global:"))
    return `${adminRoute}/globals/${collection.slice("global:".length)}`;

  return id != null
    ? `${adminRoute}/collections/${collection}/${id}`
    : `${adminRoute}/collections/${collection}`;
}
