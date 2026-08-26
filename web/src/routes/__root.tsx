/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { Link, RouterProvider, Toast } from "@heroui/react";
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
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  const navigate = useNavigate();
  return (
    <RootDocument>
      <RouterProvider navigate={(href) => navigate({ to: href })}>
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        <Toast.Provider placement="bottom end" />
      </RouterProvider>
    </RootDocument>
  );
}

function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-full max-w-lg flex-col items-center justify-center px-8 text-center">
      <p className="font-mono text-xs text-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-2 text-sm text-muted">
        The requested page does not exist in this workbench.
      </p>
      <Link href="/" className="mt-5 text-sm font-medium">
        Return to runs
      </Link>
    </main>
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
