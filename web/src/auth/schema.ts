import { z } from "zod";

/**
 * Workbench accounts. Every signed-in person holds one role: administrators
 * maintain accounts, members use the workbench. Accounts are created by an
 * administrator; there is no self-service sign-up.
 */

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES);

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  member: "Member",
};

export const MIN_PASSWORD_LENGTH = 12;

export const userNameSchema = z.string().trim().min(1).max(120);
export const userEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(256);

/** The account behind a browser session, as pages see it. */
export const workbenchUserSchema = z.object({
  id: z.string(),
  name: userNameSchema,
  email: userEmailSchema,
  role: userRoleSchema,
});
export type WorkbenchUser = z.infer<typeof workbenchUserSchema>;

/** An account as the user directory lists it. */
export const userAccountSchema = workbenchUserSchema.extend({
  banned: z.boolean(),
  createdAt: z.string().datetime(),
});
export type UserAccount = z.infer<typeof userAccountSchema>;

export const userRefSchema = z.object({ user: z.string() });

export const userCreateSchema = z.object({
  name: userNameSchema,
  email: userEmailSchema,
  password: passwordSchema,
  role: userRoleSchema,
});

export const userRoleUpdateSchema = userRefSchema.extend({
  role: userRoleSchema,
});

export const userPasswordUpdateSchema = userRefSchema.extend({
  password: passwordSchema,
});

export const userBanSchema = userRefSchema.extend({
  reason: z.string().trim().max(500),
});

export function isAdmin(user: Pick<WorkbenchUser, "role">): boolean {
  return user.role === "admin";
}
