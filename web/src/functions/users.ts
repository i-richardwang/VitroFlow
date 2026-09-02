import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import {
  userBanSchema,
  userCreateSchema,
  userPasswordUpdateSchema,
  userRefSchema,
  userRoleUpdateSchema,
} from "../auth/schema";
import * as directory from "../server/users";

export const getUsers = createServerFn({ method: "GET" }).handler(() =>
  directory.listUsers(getRequestHeaders()),
);

export const addUser = createServerFn({ method: "POST" })
  .validator(userCreateSchema)
  .handler(({ data }) => directory.createUser(getRequestHeaders(), data));

export const changeUserRole = createServerFn({ method: "POST" })
  .validator(userRoleUpdateSchema)
  .handler(({ data }) => directory.setUserRole(getRequestHeaders(), data));

export const resetUserPassword = createServerFn({ method: "POST" })
  .validator(userPasswordUpdateSchema)
  .handler(({ data }) => directory.setUserPassword(getRequestHeaders(), data));

export const suspendUser = createServerFn({ method: "POST" })
  .validator(userBanSchema)
  .handler(({ data }) => directory.banUser(getRequestHeaders(), data));

export const reinstateUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) => directory.unbanUser(getRequestHeaders(), data));

export const signOutUserEverywhere = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) =>
    directory.revokeUserSessions(getRequestHeaders(), data),
  );

export const removeUser = createServerFn({ method: "POST" })
  .validator(userRefSchema)
  .handler(({ data }) => directory.deleteUser(getRequestHeaders(), data));
