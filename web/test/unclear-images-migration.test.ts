import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

test("an unclear mark belongs to its image, outlives the account that made it, and goes with the image", async () => {
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
      "insert into unclear_images(image_id,recorded_by,recorded_at) values($1,'u1',now())",
      [digest],
    );
    // A new mark is not counted and says nothing until someone writes a note.
    expect(
      (
        await db.query<{ counted: boolean; note: string }>(
          "select counted, note from unclear_images",
        )
      ).rows,
    ).toEqual([{ counted: false, note: "" }]);
    await expect(
      db.query("update unclear_images set note=$1", ["x".repeat(501)]),
    ).rejects.toThrow();
    await expect(
      db.query(
        "insert into unclear_images(image_id,recorded_at) values($1,now())",
        ["b".repeat(64)],
      ),
    ).rejects.toThrow();

    await db.query("delete from users where id='u1'");
    expect(
      (await db.query("select recorded_by from unclear_images")).rows,
    ).toEqual([{ recorded_by: null }]);
    await db.query("delete from images where id=$1", [digest]);
    expect((await db.query("select * from unclear_images")).rows).toEqual([]);
  } finally {
    await db.close();
  }
});
