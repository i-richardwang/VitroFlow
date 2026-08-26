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

export function BrandIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="8" r="5.5" />
    </Icon>
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

export function RunsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 4.5h10M3 8h10M3 11.5h6" />
    </Icon>
  );
}

export function JobsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path d="M5.5 3.5V3a1 1 0 011-1h3a1 1 0 011 1v.5" />
    </Icon>
  );
}

export function StatusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 12V8.5M8 12V4M13 12V6.5" />
    </Icon>
  );
}

export function LogoutIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M7 3H4.5A1.5 1.5 0 003 4.5v7A1.5 1.5 0 004.5 13H7" />
      <path d="M7 8h6M10.5 5.5L13 8l-2.5 2.5" />
    </Icon>
  );
}

export function PanelRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </Icon>
  );
}
