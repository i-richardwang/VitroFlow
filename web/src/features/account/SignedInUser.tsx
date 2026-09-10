import { Button } from "@heroui/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { authClient } from "./client";
import type { WorkbenchUser } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import { Hint } from "../../ui/Hint";
import { LogoutIcon } from "../../ui/icons";

export function SignedInUser({ user }: { user: WorkbenchUser }) {
  const router = useRouter();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await authClient.signOut();
      await router.invalidate();
      await navigate({ to: "/login" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-1 py-1">
      <div
        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
        data-sidebar="label"
      >
        {user.name}
      </div>
      <Hint text={m.sign_out()}>
        <Button
          variant="ghost"
          isIconOnly
          size="sm"
          aria-label={m.sign_out()}
          isDisabled={busy}
          onPress={() => void signOut()}
        >
          <LogoutIcon />
        </Button>
      </Hint>
    </div>
  );
}
