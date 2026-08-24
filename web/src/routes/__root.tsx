/// <reference types="vite/client" />
import type { ReactNode } from 'react'

import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

import appCss from '../styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'VitroFlow' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-neutral-200 bg-white px-6">
        <Link to="/" className="text-sm font-semibold tracking-tight hover:text-neutral-600">
          VitroFlow
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-xs text-neutral-400">Review workbench</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="flex h-dvh flex-col overflow-hidden bg-neutral-100 text-[13px] leading-normal text-neutral-900 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
