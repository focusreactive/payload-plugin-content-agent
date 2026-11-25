/**
 * The stable id of a user, as stored with conversations and edits. Ids collide across auth
 * collections, so a user outside the admin collection is `collection:id`; an admin user keeps
 * the bare id.
 * @public
 */
export function principalOf(
  user: { id?: unknown; email?: unknown; collection?: unknown } | null | undefined,
  payload: { config?: { admin?: { user?: unknown } } } | null | undefined
): string {
  const id = String(user?.id ?? user?.email ?? "anonymous");
  const collection = user?.collection;
  const adminSlug = payload?.config?.admin?.user ?? "users";

  return collection && String(collection) !== String(adminSlug)
    ? `${String(collection)}:${id}`
    : id;
}
