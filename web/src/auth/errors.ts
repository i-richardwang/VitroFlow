import { ConflictError, NotFoundError } from "../experiments/errors";

export class UserNotFoundError extends NotFoundError {}

/** The directory would be left without a usable administrator, or an administrator would act on their own account. */
export class UserRejectedError extends ConflictError {}

export class ApiKeyNotFoundError extends NotFoundError {}

export class McpClientNotFoundError extends NotFoundError {}
