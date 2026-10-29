import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

test("an unclear mark keeps only its image, and an experiment already running does not count it", async () => {
  const db = new PGlite();
  try {
    for (const file of [
      "0000_init.sql",
      "0001_training_control.sql",
      "0002_model_registry.sql",
      "0003_inference_execution.sql",
      "0004_observation_counted_classes.sql",
      "0005_unclear_images.sql",
    ])
      await db.exec(await Bun.file(`drizzle/${file}`).text());
    const digest = "a".repeat(64);
    await db.query(
      "insert into images(id,width,height,bytes,received_at) values($1,10,10,1,now())",
      [digest],
    );
    await db.query(
      "insert into users(id,name,email,role,created_at,updated_at) values('u1','Reviewer','r@example.com','member',now(),now())",
    );
    await db.query(
      "insert into unclear_images(image_id,recorded_by,recorded_at,counted,note) values($1,'u1',now(),true,'Lid fogged')",
      [digest],
    );
    await db.query(
      "insert into experiments(id,name,plant_material,explant_type,base_medium,notes,inoculated_on,created_at) values('4f1d3c57-2d0e-4c4c-9d43-3b5bb35c1a01','Existing','','','','','2026-09-01',now())",
    );

    await db.exec(
      await Bun.file("drizzle/0006_experiment_unclear_policy.sql").text(),
    );
    expect((await db.query("select * from unclear_images")).rows).toEqual([
      { image_id: digest },
    ]);
    expect(
      (await db.query("select counts_unclear from experiments")).rows,
    ).toEqual([{ counts_unclear: false }]);
  } finally {
    await db.close();
  }
});
