import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
      {...props}
    />
  );
}

export function CursorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 2.5l10 4.5-4.3 1.6L7 13z" />
    </Icon>
  );
}

export function AddBoxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M8 5.5v5M5.5 8h5" />
    </Icon>
  );
}

export function HandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5.5 8V3.5a1 1 0 012 0V7m0-4.5a1 1 0 012 0V7m0-3a1 1 0 012 0v5.5a4.5 4.5 0 01-9 0V5.5a1 1 0 012 0V8" />
    </Icon>
  );
}

export function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 6l4 4 4-4" />
    </Icon>
  );
}

export function UndoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 4.5L3 7.5l3 3" />
      <path d="M3 7.5h6a3.5 3.5 0 010 7H7" />
    </Icon>
  );
}

export function RedoIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 4.5l3 3-3 3" />
      <path d="M13 7.5H7a3.5 3.5 0 000 7h2" />
    </Icon>
  );
}
