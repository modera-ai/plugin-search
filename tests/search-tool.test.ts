import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { activate as search } from "../src";

it("Search skips generated directories, matches literal text and rejects out-of-root paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "modera-search-test-"));
  try {
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "code.ts"), "one\nfind [this]\nthree");
    await writeFile(join(root, "node_modules", "skip.txt"), "find [this]");
    const contributions = await search({
      pluginId: "search",
      storagePath: root,
      grantedPermissions: new Set(["workspace.read"]),
      signal: new AbortController().signal,
    });
    const execute = contributions!.tools![0]!.execute;
    const context = {
      workspacePath: root,
      sessionId: "s",
      runId: "r",
      signal: new AbortController().signal,
    };
    expect(await execute({ pattern: "[this]" }, context)).toMatchObject({
      matches: [{ path: "code.ts", line: 2 }],
      truncated: false,
    });
    await expect(
      execute({ pattern: "anything", path: ".." }, context),
    ).rejects.toThrow("outside");
    await expect(
      execute({ pattern: "x" }, { ...context, signal: AbortSignal.abort() }),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
