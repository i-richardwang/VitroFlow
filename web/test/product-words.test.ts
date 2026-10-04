/**
 * Every message a reader sees is written in product words. Identifiers from
 * the code and the data model stay out of the copy; a value that is an
 * identifier (an image's digest, a model's id) enters as a parameter.
 */
import { expect, test } from "bun:test";

const WEB_DIR = `${import.meta.dir}/..`;

/** Words and shapes that only exist on the code side. */
const INTERNAL: readonly { pattern: RegExp; why: string }[] = [
  {
    pattern: /\b[a-z0-9]+_[a-z0-9_]+\b/i,
    why: "snake_case is a key, column or tool name",
  },
  {
    pattern: /\b[a-z]{2,}[A-Z]\w*\b/,
    why: "camelCase is a field or parameter name (runId, sessionId)",
  },
  {
    pattern: /\bdigests?\b/i,
    why: "a digest is how storage addresses an image; readers see the image",
  },
  {
    pattern: /\bseed-detector\b/,
    why: "the built-in model's id; readers see its name from model-names.ts",
  },
];

/** The text of a message: plain strings, or the variants of a plural. */
function texts(message: unknown): string[] {
  if (typeof message === "string") return [message];
  if (Array.isArray(message)) return message.flatMap(texts);
  if (message && typeof message === "object" && "match" in message)
    return Object.values(message.match as Record<string, unknown>).flatMap(
      texts,
    );
  return [];
}

async function messages(): Promise<[string, string][]> {
  const found: [string, string][] = [];
  for (const path of new Bun.Glob("messages/*/*.json").scanSync({
    cwd: WEB_DIR,
  })) {
    const bundle: Record<string, unknown> = await Bun.file(
      `${WEB_DIR}/${path}`,
    ).json();
    for (const [key, message] of Object.entries(bundle)) {
      if (key === "$schema") continue;
      for (const text of texts(message)) found.push([`${path} ${key}`, text]);
    }
  }
  return found;
}

test("messages carry no internal identifiers", async () => {
  const all = await messages();
  expect(all.length).toBeGreaterThan(100);
  const hits = all.flatMap(([where, text]) => {
    const visible = text.replace(/\{[^}]*\}/g, "");
    return INTERNAL.filter(({ pattern }) => pattern.test(visible)).map(
      ({ why }) => `${where}: "${text}" (${why})`,
    );
  });
  expect(hits).toEqual([]);
});
