/**
 * URL pública de una foto del bucket `avatars`. El bucket es público y su URL
 * es determinista, así que no hace falta cliente de Supabase (ni `await`) para
 * componerla — es lo mismo que devuelve `storage.getPublicUrl`.
 */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${encodeURI(path)}`;
}
