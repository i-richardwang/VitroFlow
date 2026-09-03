import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  date,
  doublePrecision,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { REVIEW_STATUSES, type AnnotationDocument } from "../annotation/schema";
import { USER_ROLES } from "../auth/schema";
import {
  CULTURE_EVENT_TYPES,
  type TreatmentFactor,
} from "../experiments/schema";
import type { InferenceOutcome } from "../detection/schema";
import type { RuntimeDescriptor } from "../inference/schema";
import type { DerivedMetric } from "../models/metrics";
import type { ModelArtifact, ModelVersion } from "../models/schema";
import {
  IMAGE_SPLITS,
  TRAINING_PHASES,
  TRAINING_RUN_STATUSES,
  type TrainingRecipe,
} from "../training/schema";

/**
 * Control plane, detections, and review state live in Postgres; images
 * and model weights are blobs addressed by relative key. Relationships between
 * rows are declared here so that no combination of rows the domain forbids can
 * exist. Images are atomic assets that datasets and snapshots refer to by
 * digest; the references, not the rows, keep an image alive.
 */

const instant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" }).notNull();

/**
 * Accounts and browser sessions, owned by Better Auth over these tables. The
 * property names are the field names it addresses; the columns follow the
 * naming of the rest of the schema. A user holds exactly one workbench role.
 */

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull(),
    banned: boolean("banned").notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires", { withTimezone: true, mode: "date" }),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    check(
      "users_role_check",
      sql`${table.role} in (${sql.raw(
        USER_ROLES.map((role) => `'${role}'`).join(", "),
      )})`,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: instant("expires_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    index("accounts_user_idx").on(table.userId),
    uniqueIndex("accounts_issuer_account_idx").on(
      table.issuer,
      table.accountId,
    ),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

const optionalInstant = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Personal API keys, owned by the Better Auth API key plugin. The secret is
 * stored hashed; `start` keeps its leading characters for display and
 * `permissions` the JSON statement naming the scopes the key opens.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull(),
    name: text("name"),
    start: text("start"),
    prefix: text("prefix"),
    key: text("key").notNull(),
    referenceId: text("reference_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: optionalInstant("last_refill_at"),
    enabled: boolean("enabled").notNull().default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").notNull().default(0),
    remaining: integer("remaining"),
    lastRequest: optionalInstant("last_request"),
    expiresAt: optionalInstant("expires_at"),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("api_keys_reference_idx").on(table.referenceId),
    index("api_keys_key_idx").on(table.key),
  ],
);

/** Signing keys for the access tokens the OAuth server issues. */
export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: instant("created_at"),
  expiresAt: optionalInstant("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

/**
 * The OAuth 2.1 authorization server behind the MCP endpoint, owned by the
 * Better Auth MCP plugin: registered clients, the protected resources they
 * may address, the tokens issued to them, and the consent each account gave.
 */

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").notNull().default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes").array(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: optionalInstant("created_at"),
    updatedAt: optionalInstant("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required",
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens")
      .notNull()
      .default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("oauth_clients_user_idx").on(table.userId)],
);

export const oauthResources = pgTable("oauth_resources", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required")
    .notNull()
    .default(false),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: optionalInstant("created_at"),
  updatedAt: optionalInstant("updated_at"),
  policyVersion: integer("policy_version").notNull().default(1),
  metadata: jsonb("metadata"),
});

export const oauthClientResources = pgTable(
  "oauth_client_resources",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResources.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: optionalInstant("created_at"),
  },
  (table) => [
    uniqueIndex("oauth_client_resources_client_resource_idx").on(
      table.clientId,
      table.resourceId,
    ),
  ],
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: instant("expires_at"),
    createdAt: instant("created_at"),
    revoked: optionalInstant("revoked"),
    rotatedAt: optionalInstant("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: optionalInstant("rotation_replay_expires_at"),
    authTime: optionalInstant("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_refresh_tokens_client_idx").on(table.clientId),
    index("oauth_refresh_tokens_user_idx").on(table.userId),
  ],
);

export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: instant("expires_at"),
    createdAt: instant("created_at"),
    revoked: optionalInstant("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_access_tokens_client_idx").on(table.clientId),
    index("oauth_access_tokens_user_idx").on(table.userId),
  ],
);

export const oauthConsents = pgTable(
  "oauth_consents",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: instant("created_at"),
    updatedAt: instant("updated_at"),
  },
  (table) => [
    index("oauth_consents_client_idx").on(table.clientId),
    index("oauth_consents_user_idx").on(table.userId),
  ],
);

/** Replay protection for client assertions and DPoP proofs. */
export const oauthClientAssertions = pgTable("oauth_client_assertions", {
  id: text("id").primaryKey(),
  expiresAt: instant("expires_at"),
});

/**
 * One successful programmatic command: its replay identity and audit record.
 * The row is reserved and completed in the same transaction as the domain
 * change, so incomplete and failed commands never become durable history.
 */
export const agentExecutions = pgTable(
  "agent_executions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalKind: text("principal_kind").notNull(),
    credentialId: text("credential_id").notNull(),
    userId: text("user_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    input: jsonb("input").notNull(),
    response: jsonb("response"),
    createdAt: instant("created_at"),
    completedAt: optionalInstant("completed_at"),
  },
  (table) => [
    uniqueIndex("agent_executions_principal_key_idx").on(
      table.principalKind,
      table.credentialId,
      table.idempotencyKey,
    ),
    index("agent_executions_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    index("agent_executions_operation_created_idx").on(
      table.operation,
      table.createdAt,
    ),
    check(
      "agent_executions_principal_kind_check",
      sql`${table.principalKind} in ('api_key', 'mcp_client')`,
    ),
    check(
      "agent_executions_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "agent_executions_completion_check",
      sql`(${table.response} is null) = (${table.completedAt} is null)`,
    ),
  ],
);

export const models = pgTable("models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  task: text("task").notNull(),
  classes: jsonb("classes").$type<string[]>().notNull(),
  metrics: jsonb("metrics").$type<DerivedMetric[]>().notNull(),
});

export const modelVersions = pgTable(
  "model_versions",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    name: text("name").notNull(),
    createdAt: instant("created_at"),
    source: jsonb("source").$type<ModelVersion["source"]>().notNull(),
    artifact: jsonb("artifact").$type<ModelArtifact>().notNull(),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`artifact->>'digest'`),
    sourceKind: text("source_kind")
      .notNull()
      .generatedAlwaysAs(sql`source->>'kind'`),
    sourceTrainingRunId: text("source_training_run_id")
      .generatedAlwaysAs(sql`source->>'trainingRunId'`)
      .references((): AnyPgColumn => trainingRuns.id),
    sourceTrainingAttempt: integer("source_training_attempt").generatedAlwaysAs(
      sql`(source->>'trainingAttempt')::integer`,
    ),
    sourceDatasetSnapshotId: text("source_dataset_snapshot_id")
      .generatedAlwaysAs(sql`source->>'datasetSnapshotId'`)
      .references((): AnyPgColumn => datasetSnapshots.id),
    artifactKind: text("artifact_kind")
      .notNull()
      .generatedAlwaysAs(sql`artifact->>'kind'`),
    weightsDigest: text("weights_digest").generatedAlwaysAs(
      sql`artifact->'weights'->>'digest'`,
    ),
    weightsBytes: integer("weights_bytes").generatedAlwaysAs(
      sql`(artifact->'weights'->>'bytes')::integer`,
    ),
  },
  (table) => [
    index("model_versions_model_idx").on(table.modelId, table.createdAt),
    /** Lets referencing rows assert that a version belongs to their model. */
    unique("model_versions_id_model").on(table.id, table.modelId),
    /** Runtime records bind to executable content, not just a version name. */
    unique("model_versions_id_digest").on(table.id, table.artifactDigest),
    unique("model_versions_publication_identity").on(
      table.id,
      table.sourceTrainingRunId,
      table.sourceTrainingAttempt,
      table.sourceDatasetSnapshotId,
      table.modelId,
    ),
    check(
      "model_versions_digest_check",
      sql`${table.artifactDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "model_versions_source_artifact_check",
      sql`case ${table.sourceKind}
        when 'builtin' then ${table.artifactKind} = 'traditional' and ${table.sourceTrainingRunId} is null and ${table.sourceTrainingAttempt} is null and ${table.sourceDatasetSnapshotId} is null and ${table.weightsDigest} is null and ${table.weightsBytes} is null
        when 'training_run' then ${table.artifactKind} = 'ultralytics' and ${table.sourceTrainingRunId} is not null and ${table.sourceTrainingAttempt} >= 1 and ${table.sourceDatasetSnapshotId} is not null and ${table.weightsDigest} ~ '^[0-9a-f]{64}$' and ${table.weightsBytes} > 0
        else false
      end`,
    ),
  ],
);

/**
 * A training set for one model: the images whose reviews for that model
 * train its next version. Datasets draw from experiment images; they
 * never receive uploads of their own.
 */
export const datasets = pgTable(
  "datasets",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    createdAt: instant("created_at"),
  },
  (table) => [
    /** Lets snapshot rows assert that they froze this dataset for its model. */
    unique("datasets_id_model").on(table.id, table.modelId),
  ],
);

/**
 * An image, identified by the SHA-256 digest of its bytes. Images belong
 * to nothing; experiments, datasets, snapshots, and annotations refer to them.
 * Every column describes the bytes themselves.
 *
 * An image with no reference is unclaimed: bytes arrive before the observation they
 * join is submitted. `receivedAt` is when the bytes last arrived and bounds
 * how long that submission may still be in progress.
 */
export const images = pgTable(
  "images",
  {
    id: text("id").primaryKey(),
    /** The pixels the bytes hold, with orientation already applied. */
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    receivedAt: instant("received_at"),
  },
  (table) => [
    check("images_id_check", sql`${table.id} ~ '^[0-9a-f]{64}$'`),
    check("images_bytes_check", sql`${table.bytes} > 0`),
    check("images_size_check", sql`${table.width} > 0 and ${table.height} > 0`),
    /** The collector reads unreferenced images oldest first. */
    index("images_received_idx").on(table.receivedAt),
  ],
);

/** An image's membership in a dataset, with the split it keeps across snapshots. */
export const datasetImages = pgTable(
  "dataset_images",
  {
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    /** The name the image was added under; shown, never matched. */
    filename: text("filename").notNull(),
    addedAt: instant("added_at"),
    /** Assigned the first time the image enters a snapshot; stable afterwards. */
    split: text("split", { enum: IMAGE_SPLITS }),
  },
  (table) => [
    primaryKey({ columns: [table.datasetId, table.imageId] }),
    index("dataset_images_image_idx").on(table.imageId),
    check(
      "dataset_images_split_check",
      sql`${table.split} is null or ${table.split} in ('train', 'val')`,
    ),
  ],
);

/**
 * What a model version found in an image, addressed by its canonical business
 * key. Experiments read the row under the version they were created with;
 * reviews may show one as a reference but never own it. A row is written once:
 * an identical resubmission is accepted and a different one refused, so the
 * result stays a record and never a cache.
 */
export const inferenceOutcomes = pgTable(
  "inference_outcomes",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id").notNull(),
    document: jsonb("document").$type<InferenceOutcome>().notNull(),
    recordedAt: instant("recorded_at"),
    status: text("status", { enum: ["succeeded", "failed"] })
      .notNull()
      .generatedAlwaysAs(
        sql`case when document ? 'instances' then 'succeeded' when document ? 'error' then 'failed' end`,
      ),
    artifactDigest: text("artifact_digest")
      .notNull()
      .generatedAlwaysAs(sql`document->'producer'->>'artifactDigest'`),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelVersionId] }),
    index("inference_outcomes_version_idx").on(table.modelVersionId),
    index("inference_outcomes_status_idx").on(table.status, table.recordedAt),
    /** The document was produced by the registered artifact of its version. */
    foreignKey({
      columns: [table.modelVersionId, table.artifactDigest],
      foreignColumns: [modelVersions.id, modelVersions.artifactDigest],
    }),
    check(
      "inference_outcomes_document_check",
      sql`document->'image'->>'digest' = ${table.imageId} and document->'producer'->>'modelVersionId' = ${table.modelVersionId}`,
    ),
    check(
      "inference_outcomes_shape_check",
      sql`case ${table.status}
        when 'succeeded' then document ? 'instances' and not document ? 'error'
        when 'failed' then document ? 'error' and not document ? 'instances'
        else false
      end`,
    ),
  ],
);

/**
 * What a reviewer decided about one image for one model: the human truth the
 * model's next version trains on. The review is the same document whether it
 * is opened from an experiment or from a dataset, because it belongs to the
 * image and the model, not to the place it was opened from. It refers to no
 * detection: what a version found is that version's record, and the review
 * outlives every version it was compared with.
 */
export const annotations = pgTable(
  "annotations",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    document: jsonb("document").$type<AnnotationDocument>().notNull(),
    updatedAt: instant("updated_at"),
    /** Projections of `document` the workbench queries by. */
    status: text("status", { enum: REVIEW_STATUSES })
      .notNull()
      .generatedAlwaysAs(sql`document->>'status'`),
    revision: integer("revision")
      .notNull()
      .generatedAlwaysAs(sql`(document->>'revision')::integer`),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelId] }),
    index("annotations_model_status_idx").on(table.modelId, table.status),
    check(
      "annotations_status_check",
      sql`${table.status} in ('in_progress', 'complete', 'excluded')`,
    ),
    check("annotations_revision_check", sql`${table.revision} >= 0`),
    check(
      "annotations_image_check",
      sql`document->'image'->>'digest' = ${table.imageId}`,
    ),
  ],
);

/**
 * Measurements of the same observation units on successive occasions. The version is fixed
 * when the experiment is created, so every observation comes from the same
 * model: the builtin baseline until a trained version exists, and whichever
 * version the experiment was started with after that.
 */
export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    /** The plant under culture: species, cultivar, or line. */
    plantMaterial: text("plant_material").notNull(),
    /** The type of tissue used to initiate the observation units. */
    explantType: text("explant_type").notNull(),
    /** The base medium every treatment shares. */
    baseMedium: text("base_medium").notNull(),
    /** The rest of the notebook page: conditions, goals, remarks. */
    notes: text("notes").notNull(),
    /** Day zero: when the explants entered culture. */
    inoculatedOn: date("inoculated_on", { mode: "string" }).notNull(),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id),
    createdAt: instant("created_at"),
  },
  (table) => [
    index("experiments_version_idx").on(table.modelVersionId),
    unique("experiments_id_inoculated").on(table.id, table.inoculatedOn),
    check(
      "experiments_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120`,
    ),
    check(
      "experiments_plant_material_check",
      sql`${table.plantMaterial} = btrim(${table.plantMaterial}) and length(${table.plantMaterial}) <= 120`,
    ),
    check(
      "experiments_explant_type_check",
      sql`${table.explantType} = btrim(${table.explantType}) and length(${table.explantType}) <= 120`,
    ),
    check(
      "experiments_base_medium_check",
      sql`${table.baseMedium} = btrim(${table.baseMedium}) and length(${table.baseMedium}) <= 200`,
    ),
    check(
      "experiments_notes_check",
      sql`${table.notes} = btrim(${table.notes}) and length(${table.notes}) <= 2000`,
    ),
  ],
);

export const experimentTreatments = pgTable(
  "experiment_treatments",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    name: text("name").notNull(),
    nameKey: text("name_key")
      .notNull()
      .generatedAlwaysAs(
        sql`trim(both '-' from lower(regexp_replace(normalize(name, NFKC), '[-[:space:]._]+', '-', 'g')))`,
      ),
    factor: jsonb("factor").$type<TreatmentFactor>(),
    note: text("note").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    unique("experiment_treatments_name").on(table.experimentId, table.nameKey),
    unique("experiment_treatments_position").on(
      table.experimentId,
      table.position,
    ),
    check(
      "experiment_treatments_name_check",
      sql`${table.name} = btrim(${table.name}) and length(${table.name}) between 1 and 120 and ${table.nameKey} <> ''`,
    ),
    check(
      "experiment_treatments_note_check",
      sql`${table.note} = btrim(${table.note}) and length(${table.note}) <= 1000`,
    ),
    check(
      "experiment_treatments_factor_check",
      sql`${table.factor} is null or (
        jsonb_typeof(${table.factor}) = 'object'
        and coalesce(${table.factor}->>'name', '') <> ''
        and coalesce(${table.factor}->>'level', '') <> ''
        and (${table.factor}->>'unit') is not null
      )`,
    ),
    check("experiment_treatments_position_check", sql`${table.position} >= 1`),
  ],
);

/**
 * One occasion on which the experiment was observed. The day it happened
 * places it in the series and, against the inoculation date, names it.
 */
export const experimentObservations = pgTable(
  "experiment_observations",
  {
    experimentId: uuid("experiment_id").notNull(),
    id: uuid("id").notNull(),
    inoculatedOn: date("inoculated_on", { mode: "string" }).notNull(),
    observedOn: date("observed_on", { mode: "string" }).notNull(),
    note: text("note").notNull(),
    createdAt: instant("created_at"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    foreignKey({
      columns: [table.experimentId, table.inoculatedOn],
      foreignColumns: [experiments.id, experiments.inoculatedOn],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    /** An experiment observes its observation units once a day at most. */
    unique("experiment_observations_day").on(
      table.experimentId,
      table.observedOn,
    ),
    index("experiment_observations_observed_idx").on(
      table.experimentId,
      table.observedOn,
    ),
    check(
      "experiment_observations_note_check",
      sql`${table.note} = btrim(${table.note}) and length(${table.note}) <= 500`,
    ),
    check(
      "experiment_observations_date_check",
      sql`${table.observedOn} >= ${table.inoculatedOn}`,
    ),
  ],
);

/**
 * The units to which treatments are assigned and on which measurements are
 * made. A unit exists before any image and keeps its identity when its code is
 * corrected.
 */
export const experimentObservationUnits = pgTable(
  "experiment_observation_units",
  {
    experimentId: uuid("experiment_id")
      .notNull()
      .references(() => experiments.id, { onDelete: "cascade" }),
    id: uuid("id").notNull(),
    code: text("code").notNull(),
    codeKey: text("code_key")
      .notNull()
      .generatedAlwaysAs(
        sql`trim(both '-' from lower(regexp_replace(normalize(code, NFKC), '[-[:space:]._]+', '-', 'g')))`,
      ),
    /** The treatment this observation unit replicates. */
    treatmentId: uuid("treatment_id"),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    unique("experiment_observation_units_code").on(
      table.experimentId,
      table.codeKey,
    ),
    foreignKey({
      columns: [table.experimentId, table.treatmentId],
      foreignColumns: [
        experimentTreatments.experimentId,
        experimentTreatments.id,
      ],
    }),
    index("experiment_observation_units_treatment_idx").on(
      table.experimentId,
      table.treatmentId,
    ),
    check(
      "experiment_observation_units_code_check",
      sql`${table.code} = btrim(${table.code}) and length(${table.code}) between 1 and 60 and ${table.codeKey} <> ''`,
    ),
  ],
);

/** An observed culture event; corrections void the event without erasing it. */
export const experimentCultureEvents = pgTable(
  "experiment_culture_events",
  {
    experimentId: uuid("experiment_id").notNull(),
    id: uuid("id").notNull(),
    observationUnitId: uuid("observation_unit_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    type: text("type", { enum: CULTURE_EVENT_TYPES }).notNull(),
    /** Whether this unit leaves analysis from the recorded observation onward. */
    excludeFromObservation: boolean("exclude_from_observation").notNull(),
    note: text("note").notNull(),
    recordedAt: instant("recorded_at"),
    voidedAt: timestamp("voided_at", {
      withTimezone: true,
      mode: "date",
    }),
    voidReason: text("void_reason").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    foreignKey({
      columns: [table.experimentId, table.observationUnitId],
      foreignColumns: [
        experimentObservationUnits.experimentId,
        experimentObservationUnits.id,
      ],
    }),
    foreignKey({
      columns: [table.experimentId, table.observationId],
      foreignColumns: [
        experimentObservations.experimentId,
        experimentObservations.id,
      ],
    }),
    index("experiment_culture_events_unit_idx").on(
      table.experimentId,
      table.observationUnitId,
      table.recordedAt,
    ),
    uniqueIndex("experiment_culture_events_one_active_kind")
      .on(
        table.experimentId,
        table.observationUnitId,
        table.observationId,
        table.type,
      )
      .where(sql`${table.voidedAt} is null`),
    uniqueIndex("experiment_culture_events_one_active_terminal")
      .on(table.experimentId, table.observationUnitId)
      .where(
        sql`${table.voidedAt} is null and ${table.type} in ('discarded', 'harvested', 'missing')`,
      ),
    check(
      "experiment_culture_events_note_check",
      sql`${table.note} = btrim(${table.note}) and length(${table.note}) <= 500`,
    ),
    check(
      "experiment_culture_events_type_check",
      sql`${table.type} in ('contaminated', 'nonviable', 'discarded', 'harvested', 'missing')`,
    ),
    check(
      "experiment_culture_events_void_check",
      sql`(${table.voidedAt} is null) = (${table.voidReason} = '')`,
    ),
  ],
);

/**
 * One image assigned to an observation unit and an observation. The filename
 * records the image's origin and identifies nothing.
 */
export const experimentObservationImages = pgTable(
  "experiment_observation_images",
  {
    experimentId: uuid("experiment_id").notNull(),
    id: uuid("id").notNull(),
    observationUnitId: uuid("observation_unit_id").notNull(),
    observationId: uuid("observation_id").notNull(),
    /** An assigned observation image is a reference root; deletion is refused. */
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    filename: text("filename").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.experimentId, table.id] }),
    foreignKey({
      columns: [table.experimentId, table.observationUnitId],
      foreignColumns: [
        experimentObservationUnits.experimentId,
        experimentObservationUnits.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.experimentId, table.observationId],
      foreignColumns: [
        experimentObservations.experimentId,
        experimentObservations.id,
      ],
    }).onDelete("cascade"),
    /** One observation unit has one image per observation. */
    unique("experiment_observation_images_cell").on(
      table.experimentId,
      table.observationUnitId,
      table.observationId,
    ),
    /** The same image cannot represent two units or two occasions. */
    unique("experiment_observation_images_image").on(
      table.experimentId,
      table.imageId,
    ),
    index("experiment_observation_images_image_idx").on(table.imageId),
  ],
);

/**
 * An inference process by the runtimes it can execute. Which versions it
 * detects with follows from current demand; the version it holds in memory is
 * reported for display only.
 */
export const inferenceWorkers = pgTable(
  "inference_workers",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    startedAt: instant("started_at"),
    runtimes: jsonb("runtimes").$type<RuntimeDescriptor[]>().notNull(),
    loadedModelVersionId: text("loaded_model_version_id").references(
      () => modelVersions.id,
    ),
    /** The image being processed, by digest. */
    currentImageId: text("current_image_id").references(() => images.id, {
      onDelete: "set null",
    }),
    lastSeenAt: instant("last_seen_at"),
  },
  (table) => [index("inference_workers_seen_idx").on(table.lastSeenAt)],
);

/**
 * A bounded inference task leased to exactly one worker session. Demand is
 * materialized lazily when a worker claims work; the durable outcome remains
 * the source of truth and completing the task removes its lease.
 */
export const inferenceJobs = pgTable(
  "inference_jobs",
  {
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    modelVersionId: text("model_version_id")
      .notNull()
      .references(() => modelVersions.id, { onDelete: "cascade" }),
    workerId: text("worker_id")
      .notNull()
      .references(() => inferenceWorkers.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    attempt: integer("attempt").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.imageId, table.modelVersionId] }),
    index("inference_jobs_claimable_idx").on(table.leaseExpiresAt),
    index("inference_jobs_worker_idx").on(table.workerId, table.sessionId),
    check("inference_jobs_attempt_check", sql`${table.attempt} >= 1`),
  ],
);

export const datasetSnapshots = pgTable(
  "dataset_snapshots",
  {
    id: text("id").primaryKey(),
    datasetId: text("dataset_id").notNull(),
    modelId: text("model_id").notNull(),
    createdAt: instant("created_at"),
  },
  (table) => [
    /** A snapshot's model is its dataset's model. */
    foreignKey({
      columns: [table.datasetId, table.modelId],
      foreignColumns: [datasets.id, datasets.modelId],
    }),
    unique("dataset_snapshots_id_model").on(table.id, table.modelId),
    index("dataset_snapshots_dataset_idx").on(table.datasetId),
  ],
);

/**
 * The reviewed images a snapshot froze, with the annotation as reviewed. The
 * image reference keeps the bytes alive for as long as the snapshot exists.
 */
export const datasetSnapshotImages = pgTable(
  "dataset_snapshot_images",
  {
    snapshotId: text("snapshot_id").notNull(),
    modelId: text("model_id").notNull(),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id),
    split: text("split", { enum: IMAGE_SPLITS }).notNull(),
    annotation: jsonb("annotation").$type<AnnotationDocument>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.imageId] }),
    foreignKey({
      columns: [table.snapshotId, table.modelId],
      foreignColumns: [datasetSnapshots.id, datasetSnapshots.modelId],
    }).onDelete("cascade"),
    index("dataset_snapshot_images_image_idx").on(table.imageId),
    check(
      "dataset_snapshot_images_split_check",
      sql`${table.split} in ('train', 'val')`,
    ),
    check(
      "dataset_snapshot_images_annotation_check",
      sql`annotation->'image'->>'digest' = ${table.imageId} and annotation->>'status' = 'complete'`,
    ),
  ],
);

export const trainingRuns = pgTable(
  "training_runs",
  {
    id: text("id").primaryKey(),
    modelId: text("model_id")
      .notNull()
      .references(() => models.id),
    datasetSnapshotId: text("dataset_snapshot_id").notNull(),
    createdAt: instant("created_at"),
    attempt: integer("attempt").notNull(),
    recipe: jsonb("recipe").$type<TrainingRecipe>().notNull(),
    status: text("status", { enum: TRAINING_RUN_STATUSES }).notNull(),
    workerId: text("worker_id"),
    sessionId: text("session_id"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    phase: text("phase", { enum: TRAINING_PHASES }),
    progress: real("progress"),
    error: text("error"),
    modelVersionId: text("model_version_id"),
  },
  (table) => [
    /** A run trains its model on a snapshot of that model's dataset. */
    foreignKey({
      columns: [table.datasetSnapshotId, table.modelId],
      foreignColumns: [datasetSnapshots.id, datasetSnapshots.modelId],
    }),
    /** A run publishes a version of its own model. */
    foreignKey({
      columns: [table.modelVersionId, table.modelId],
      foreignColumns: [modelVersions.id, modelVersions.modelId],
    }),
    foreignKey({
      columns: [
        table.modelVersionId,
        table.id,
        table.attempt,
        table.datasetSnapshotId,
        table.modelId,
      ],
      foreignColumns: [
        modelVersions.id,
        modelVersions.sourceTrainingRunId,
        modelVersions.sourceTrainingAttempt,
        modelVersions.sourceDatasetSnapshotId,
        modelVersions.modelId,
      ],
    }),
    check("training_runs_attempt_check", sql`${table.attempt} >= 0`),
    /** Each status has exactly the columns its state carries. */
    check(
      "training_runs_state_check",
      sql`case ${table.status}
        when 'queued' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is null
        when 'running' then ${table.workerId} is not null and ${table.sessionId} is not null and ${table.leaseExpiresAt} is not null and ${table.phase} in ('preparing', 'training', 'validating') and ${table.progress} is not null and ${table.progress} between 0 and 1 and ${table.error} is null and ${table.modelVersionId} is null
        when 'succeeded' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and ${table.error} is null and ${table.modelVersionId} is not null
        when 'failed' then ${table.workerId} is null and ${table.sessionId} is null and ${table.leaseExpiresAt} is null and ${table.phase} is null and ${table.progress} is null and length(${table.error}) between 1 and 2000 and ${table.modelVersionId} is null
        else false
      end`,
    ),
    /** A model trains one run at a time. */
    uniqueIndex("training_runs_one_active_per_model")
      .on(table.modelId)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("training_runs_model_idx").on(table.modelId, table.createdAt),
    index("training_runs_claimable_idx")
      .on(table.createdAt)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

/**
 * Ultralytics' per-epoch record, kept per attempt: a reclaimed run trains from
 * scratch, and the earlier attempt's curve stays part of the run's history.
 */
export const trainingEpochs = pgTable(
  "training_epochs",
  {
    runId: text("run_id")
      .notNull()
      .references(() => trainingRuns.id),
    attempt: integer("attempt").notNull(),
    epoch: integer("epoch").notNull(),
    recordedAt: instant("recorded_at"),
    trainBoxLoss: doublePrecision("train_box_loss").notNull(),
    trainClassificationLoss: doublePrecision(
      "train_classification_loss",
    ).notNull(),
    trainRegressionLoss: doublePrecision("train_regression_loss").notNull(),
    valBoxLoss: doublePrecision("val_box_loss").notNull(),
    valClassificationLoss: doublePrecision("val_classification_loss").notNull(),
    valRegressionLoss: doublePrecision("val_regression_loss").notNull(),
    precision: doublePrecision("precision").notNull(),
    recall: doublePrecision("recall").notNull(),
    map50: doublePrecision("map50").notNull(),
    map50To95: doublePrecision("map50_95").notNull(),
    fitness: doublePrecision("fitness").notNull(),
    learningRate: doublePrecision("learning_rate").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.attempt, table.epoch] }),
    check(
      "training_epochs_order_check",
      sql`${table.attempt} >= 1 and ${table.epoch} >= 1`,
    ),
  ],
);

export const trainingWorkers = pgTable(
  "training_workers",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    startedAt: instant("started_at"),
    device: text("device").notNull(),
    memoryBytes: bigint("memory_bytes", { mode: "number" }).notNull(),
    currentTrainingRunId: text("current_training_run_id").references(
      () => trainingRuns.id,
      { onDelete: "set null" },
    ),
    lastSeenAt: instant("last_seen_at"),
  },
  (table) => [index("training_workers_seen_idx").on(table.lastSeenAt)],
);
