import { sql, type SQLWrapper } from "drizzle-orm";

/**
 * The version that reads for a model: its newest. A model that has never been
 * trained has none, and its images wait for a reviewer instead of a worker.
 */
export function newestVersion(modelId: SQLWrapper | string) {
  return sql`(
    select v.id
    from model_versions v
    where v.model_id = ${modelId}
    order by v.created_at desc, v.id desc
    limit 1
  )`;
}

/** The newest of the model's versions that has detected the image. */
export function newestDetectingVersion(
  imageId: SQLWrapper,
  modelId: SQLWrapper | string,
) {
  return sql`(
    select d.model_version_id
    from inference_outcomes d
    join model_versions v on v.id = d.model_version_id
    where d.image_id = ${imageId}
      and v.model_id = ${modelId}
      and d.status = 'succeeded'
    order by v.created_at desc, v.id desc
    limit 1
  )`;
}
