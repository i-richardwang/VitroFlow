/*
 * A person without a picture: the first two characters of their name, upper
 * case, in bold at half the avatar's size on the border color. Square, its
 * corners rounded by a sixth of its size.
 */
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="ui-avatar"
      style={{
        blockSize: size,
        borderRadius: Math.max(size / 6, 2),
        fontSize: size * 0.5,
        inlineSize: size,
      }}
    >
      {Array.from(name.trim().toUpperCase()).slice(0, 2).join("")}
    </span>
  );
}
