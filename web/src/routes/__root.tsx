/// <reference types="vite/client" />
import type { ReactNode } from "react";

import { I18nProvider, RouterProvider, Toast } from "@heroui/react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from "@tanstack/react-router";

import { WorkbenchNotice } from "../ui/shell/WorkbenchNotice";
import { m } from "../paraglide/messages";
import { getLocale } from "../paraglide/runtime";
import appCss from "../styles/app.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: m.app_name() },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/logo.svg", type: "image/svg+xml" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  const navigate = useNavigate();
  return (
    <RootDocument>
      <I18nProvider locale={getLocale()}>
        <RouterProvider navigate={(href) => navigate({ to: href })}>
          <div className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </div>
          <Toast.Provider placement="bottom end" />
        </RouterProvider>
      </I18nProvider>
    </RootDocument>
  );
}

function NotFoundPage() {
  return <WorkbenchNotice title={m.page_not_found()} />;
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-background text-foreground antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
