import type { ReactNode } from "react";
import { Card } from "./Card";

/**
 * Sign-in card centered on the workspace canvas. Fills its parent and scrolls
 * itself when the card is taller than the viewport.
 */
export function AuthLayout({
  brand,
  children,
  description,
  title,
}: {
  /** Home mark rendered in the corner. */
  brand: ReactNode;
  children?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="ui-auth-layout">
      <header className="ui-auth-layout-header">{brand}</header>
      <main className="ui-auth-layout-main">
        <Card className="ui-auth-layout-card">
          <div className="ui-auth-layout-heading">
            <h1 className="ui-auth-layout-title">{title}</h1>
            {description ? (
              <div className="ui-auth-layout-description">{description}</div>
            ) : null}
          </div>
          {children}
        </Card>
      </main>
    </div>
  );
}
