// Prefix a public-asset path with the basePath so it works under GitHub Pages.
// Usage: asset("/data/sf.geojson") -> "/avmap-quality-console/data/sf.geojson" in prod, "/data/sf.geojson" in dev.
export function asset(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!path.startsWith("/")) path = "/" + path;
  return `${base}${path}`;
}
