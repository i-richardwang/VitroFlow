import { m } from "../paraglide/messages";

/** The browser tab's title: the page's name followed by the app's, or the app's alone. */
export function documentTitle(page?: string): string {
  return page === undefined
    ? m.app_name()
    : m.document_title({ page, app: m.app_name() });
}
