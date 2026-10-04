import traverse from "@babel/traverse";
import { parse } from "@babel/parser";

const RULES = "docs/interface.md";

/**
 * Files that draw on the image viewport, where position, scale and cursor
 * follow the pointer and the image's own coordinates at render time.
 */
const INLINE_STYLE_FILES = new Set([
  "src/features/calibration/BoxLayer.tsx",
  "src/ui/viewport/ImageViewport.tsx",
]);

const STOCK_BREAKPOINTS = new Set(["sm", "md", "lg", "xl", "2xl"]);

/** Code that composes kit components: everything in the app outside the kit itself. */
function composes(file: string): boolean {
  return (
    /^src\/(features|routes|ui)\/.*\.tsx?$/.test(file) &&
    !file.startsWith("src/ui/kit/") &&
    !/\.test\.tsx?$/.test(file)
  );
}

/** What is wrong with one class token, if anything. */
function classViolation(token: string): string | null {
  const segments = token.split(":");
  const utility = (segments.pop() ?? "").replace(/^!?-?/, "");
  for (const variant of segments) {
    if (STOCK_BREAKPOINTS.has(variant.replace(/^max-/, "")))
      return `\`${token}\` uses a stock breakpoint; the layout widths are \`mobile:\` and \`laptop:\` (${RULES}, Tokens and the page environment)`;
  }
  if (/^(rounded|shadow)(-|$)/.test(utility))
    return `\`${token}\` draws a surface; take it from a kit component (${RULES}, Composition)`;
  if (/\[[^\]]*(\dpx|#)/.test(utility))
    return `\`${token}\` writes a raw length or color; use a token (${RULES}, Tokens and the page environment)`;
  return null;
}

function classViolations(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(classViolation)
    .filter((message): message is string => message !== null);
}

/**
 * Style rules for code outside the kit: classes compose semantic utilities,
 * surfaces come from components, and inline styles are left to drawings.
 * Paths are relative to web/.
 */
export function checkComposition(
  sources: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];
  for (const [file, source] of sources) {
    if (!composes(file)) continue;
    const report = (line: number | undefined, message: string) =>
      errors.push(`${file}:${line ?? 0}: ${message}`);
    const tree = parse(source, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
    });
    traverse(tree, {
      ImportDeclaration(ref) {
        if (ref.node.source.value.startsWith("@base-ui/react"))
          report(
            ref.node.loc?.start.line,
            `imports ${ref.node.source.value}; controls come from src/ui/kit (${RULES}, Composition)`,
          );
      },
      StringLiteral(ref) {
        if (ref.parentPath.isImportDeclaration()) return;
        for (const message of classViolations(ref.node.value))
          report(ref.node.loc?.start.line, message);
      },
      TemplateElement(ref) {
        for (const message of classViolations(ref.node.value.cooked ?? ""))
          report(ref.node.loc?.start.line, message);
      },
      JSXAttribute(ref) {
        const { name, value } = ref.node;
        if (name.type !== "JSXIdentifier") return;
        if (name.name === "style" && value && !INLINE_STYLE_FILES.has(file))
          report(
            ref.node.loc?.start.line,
            `inline style outside a drawing; choose a component's size or variant, or a utility (${RULES}, Composition)`,
          );
      },
    });
  }
  return errors;
}
