import {
  Button,
  Card,
  FieldError,
  Form,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { isAuthenticated, signIn } from "../server/session";

export const Route = createFileRoute("/login")({
  validateSearch: z.object({ rejected: z.boolean().optional() }),
  server: {
    handlers: {
      GET: ({ request, next }) =>
        isAuthenticated(request)
          ? Response.redirect(new URL("/", request.url), 303)
          : next(),
      POST: async ({ request }) => {
        const form = await request.formData();
        const accepted = signIn(String(form.get("password") ?? ""));
        return Response.redirect(
          new URL(accepted ? "/" : "/login?rejected=true", request.url),
          303,
        );
      },
    },
  },
  component: LoginPage,
});

function LoginPage() {
  const { rejected } = Route.useSearch();

  return (
    <main className="flex flex-1 items-center justify-center px-8 py-10">
      <Card className="w-full max-w-sm">
        <Form method="post" action="/login">
          <Card.Header>
            <Card.Title>Sign in</Card.Title>
            <Card.Description>
              Enter the workbench password to continue.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <TextField
              name="password"
              type="password"
              isRequired
              autoFocus
              isInvalid={rejected}
              fullWidth
            >
              <Label>Password</Label>
              <Input autoComplete="current-password" />
              <FieldError>Incorrect password.</FieldError>
            </TextField>
          </Card.Content>
          <Card.Footer>
            <Button type="submit" variant="primary" fullWidth>
              Sign in
            </Button>
          </Card.Footer>
        </Form>
      </Card>
    </main>
  );
}
