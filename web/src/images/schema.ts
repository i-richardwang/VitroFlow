import { sha256Schema } from "../identifiers/schema";

/**
 * An image is identified by the SHA-256 digest of its bytes everywhere: in
 * the database, in blob storage, in documents, and in URLs. Experiments and
 * datasets refer to images; they do not own them.
 */
export const imageDigestSchema = sha256Schema;
