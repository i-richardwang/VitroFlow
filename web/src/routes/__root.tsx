/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { Link, RouterProvider } from "@heroui/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";

import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "VitroFlow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  const navigate = useNavigate();
  return (
    <RootDocument>
      <RouterProvider navigate={(href) => navigate({ to: href })}>
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-separator bg-surface px-6">
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            VitroFlow
          </Link>
          <span className="text-xs text-muted">Annotation workbench</span>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </div>
      </RouterProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-background text-[13px] leading-normal text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
