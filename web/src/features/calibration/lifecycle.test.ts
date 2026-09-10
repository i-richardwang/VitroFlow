import { expect, test } from "bun:test";

test("viewing/editing transitions retain the mounted viewport's manual zoom and pan", async () => {
  const child = Bun.spawn(
    [Bun.which("bun")!, "test/calibration-lifecycle.tsx"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exit).toBe(0);
  expect(stdout).toContain("Calibration retains one viewport");
});
