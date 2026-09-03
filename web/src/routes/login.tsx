import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { authClient, continuation } from "../auth/client";
import { carriesAuthorizationRequest, returnPath } from "../auth/navigation";
import { BrandLogo } from "../components/BrandLogo";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { readSession, redirect } from "../server/session";

/**
 * A signed-in visitor is sent on to their destination, unless the visit is
 * an OAuth authorization request that asked for a fresh sign-in: the query
 * on the page is what resumes that request once they sign in again.
 */
export const Route = createFileRoute("/login")({
  validateSearch: z.object({ returnTo: z.string().optional() }).loose(),
  head: () => ({ meta: [{ title: "Sign in · VitroFlow" }] }),
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
    <main className="flex flex-1 flex-col items-center justify-center bg-surface-secondary p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex items-center gap-2.5 self-center">
          <BrandLogo className="size-10" />
          <span className="text-sm font-semibold">VitroFlow</span>
        </header>
        <Card className="w-full">
          <Card.Header>
            <Card.Title render={(props) => <h1 {...props} />}>
              Sign in
            </Card.Title>
          </Card.Header>
          <Form
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
              }, "Sign-in failed").then(async (result) => {
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
            <Card.Content className="flex flex-col gap-4">
              <TextField
                variant="secondary"
                fullWidth
                isRequired
                isDisabled={busy}
                autoFocus
                name="email"
                type="email"
                onChange={() => setRejected(false)}
              >
                <Label>Email</Label>
                <Input autoComplete="email" />
              </TextField>
              <TextField
                variant="secondary"
                fullWidth
                isRequired
                isDisabled={busy}
                isInvalid={rejected}
                name="password"
                type="password"
                onChange={() => setRejected(false)}
              >
                <Label>Password</Label>
                <Input autoComplete="current-password" />
                <FieldError>Incorrect email or password.</FieldError>
              </TextField>
            </Card.Content>
            <Card.Footer className="mt-4 flex flex-col items-stretch gap-2">
              <Button
                type="submit"
                variant="primary"
                fullWidth
                isDisabled={busy}
              >
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </Card.Footer>
          </Form>
        </Card>
      </div>
    </main>
  );
}
