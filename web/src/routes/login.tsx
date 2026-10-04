import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { KeyRound, Mail } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { authClient, continuation } from "../features/account/client";
import {
  carriesAuthorizationRequest,
  returnPath,
} from "../domain/auth/navigation";
import { AppBrand } from "../ui/BrandLogo";
import { useAsyncAction } from "../ui/hooks/useAsyncAction";
import { AuthLayout } from "../ui/kit/AuthLayout";
import { Button } from "../ui/kit/Button";
import { Form } from "../ui/kit/Form";
import { Icon } from "../ui/kit/Icon";
import { Input, InputPassword } from "../ui/kit/Input";
import { m } from "../paraglide/messages";
import { readSession, redirect } from "../server/transport/http/session";

/**
 * A signed-in visitor is sent on to their destination, unless the visit is
 * an OAuth authorization request that asked for a fresh sign-in: the query
 * on the page is what resumes that request once they sign in again.
 */
export const Route = createFileRoute("/login")({
  validateSearch: z.object({ returnTo: z.string().optional() }).loose(),
  head: () => ({
    meta: [{ title: `${m.login_title()} · ${m.app_name()}` }],
  }),
  server: {
    handlers: {
      GET: async ({ request, next }) => {
        const { searchParams } = new URL(request.url);
        if (carriesAuthorizationRequest(searchParams)) return next();
        return (await readSession(request.headers))
          ? redirect(returnPath(searchParams.get("returnTo")))
          : next();
      },
    },
  },
  component: LoginPage,
});

function LoginPage() {
  const { returnTo } = Route.useSearch();
  const destination = returnPath(returnTo);
  const navigate = useNavigate();
  const router = useRouter();
  const { busy, run } = useAsyncAction();
  const [rejected, setRejected] = useState(false);

  return (
    <AuthLayout brand={<AppBrand />} title={m.login_title()}>
      <Form
        errors={rejected ? { password: m.login_rejected() } : undefined}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(async () => {
            const { data, error } = await authClient.signIn.email({
              email: String(form.get("email") ?? ""),
              password: String(form.get("password") ?? ""),
            });
            if (error) {
              setRejected(true);
              return null;
            }
            return continuation(data) ?? destination;
          }, m.login_failed()).then(async (result) => {
            if (!result.ok || result.value === null) return;
            if (result.value !== destination) {
              window.location.assign(result.value);
              return;
            }
            await router.invalidate();
            await navigate({ href: destination });
          });
        }}
      >
        <Form.Field name="email" label={m.login_email()}>
          <Input
            size="large"
            required
            disabled={busy}
            autoFocus
            type="email"
            autoComplete="email"
            prefix={<Icon icon={Mail} />}
            onChange={() => setRejected(false)}
          />
        </Form.Field>
        <Form.Field name="password" label={m.login_password()}>
          <InputPassword
            size="large"
            required
            disabled={busy}
            autoComplete="current-password"
            prefix={<Icon icon={KeyRound} />}
            onChange={() => setRejected(false)}
          />
        </Form.Field>
        <Button
          block
          htmlType="submit"
          size="large"
          type="primary"
          loading={busy}
        >
          {m.login_submit()}
        </Button>
      </Form>
    </AuthLayout>
  );
}
