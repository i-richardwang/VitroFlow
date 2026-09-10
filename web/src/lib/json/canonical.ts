export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(
            ([left], [right]) => left.localeCompare(right),
          ),
        )
      : item,
  );
  if (encoded === undefined)
    throw new TypeError("Value is not JSON-serializable");
  return encoded;
}
