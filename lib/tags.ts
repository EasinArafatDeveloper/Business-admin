/** Tags are short lower-case labels: "Hot Lead " → "hot-lead". At most 20, each up to 40 characters. */
export function cleanTags(input: string[] | string): string[] {
  const parts = (Array.isArray(input) ? input : input.split(/[,\n]/))
    .map((t) =>
      t
        .trim()
        .replace(/^#/, "")
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^\p{L}\p{N}_-]/gu, "")
        .slice(0, 40)
    )
    .filter(Boolean);
  return [...new Set(parts)].slice(0, 20);
}
