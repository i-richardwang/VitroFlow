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

export function DatasetsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 10.5l3-3 2.5 2.5 2-2 3.5 3.5" />
      <circle cx="10.5" cy="5.5" r="1" />
    </Icon>
  );
}

export function TrainingIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M2.5 12.5l3.5-5 3 3 4.5-6.5" />
      <path d="M2.5 13.5h11" />
    </Icon>
  );
}

export function ExperimentsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 2.5h4M6.5 2.5v4.5L3 12.5a1 1 0 00.9 1.5h8.2a1 1 0 00.9-1.5L9.5 7V2.5" />
      <path d="M5 10.5h6" />
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

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="6.5" cy="5.5" r="2.5" />
      <path d="M2 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" />
      <path d="M10.5 3.2a2.5 2.5 0 010 4.6M12 9.7c1.5.5 2.5 1.8 2.5 3.8" />
    </Icon>
  );
}

export function AccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3 13.5c0-2.7 2.2-4.5 5-4.5s5 1.8 5 4.5" />
    </Icon>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 3.5L5.5 8l4.5 4.5" />
    </Icon>
  );
}

export function ChevronRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </Icon>
  );
}

export function MoreIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="3.5" cy="8" r="0.75" fill="currentColor" />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.75" fill="currentColor" />
    </Icon>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Icon>
  );
}

export function KeyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M7.7 8.3 13.5 2.5M11 5l2 2M9 7l2 2" />
    </Icon>
  );
}

export function CopyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </Icon>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3.5 8.5l3 3 6-7" />
    </Icon>
  );
}
