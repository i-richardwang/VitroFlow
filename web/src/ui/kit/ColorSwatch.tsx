/* A decorative 8-pixel color dot. `color` is any CSS color, `var()` and `light-dark()` included. */

export function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="ui-color-swatch"
      style={{ background: color }}
    />
  );
}
