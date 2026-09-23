import {
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import { searchProject } from "../src/ripgrep";
import { researchProject } from "../src/research";

async function fixture(
  run: (
    root: string,
    context: {
      workspacePath: string;
      sessionId: string;
      runId: string;
      signal: AbortSignal;
    },
  ) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "df-files-")));
  try {
    await run(root, {
      workspacePath: root,
      sessionId: "s",
      runId: "r",
      signal: new AbortController().signal,
    });
  } finally {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  }
}

it("ripgrep supports regex/globs, filename paging, ignore rules, invalid patterns and path isolation", () =>
  fixture(async (root, context) => {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(
      join(root, "src", "a.ts"),
      "const HELLO = 42;\nhello again",
    );
    await writeFile(join(root, "src", "b.ts"), "hello");
    await writeFile(join(root, "src", "skip.txt"), "hello");
    await writeFile(join(root, ".ignore"), "skip.txt\n");
    await writeFile(join(root, "node_modules", "skip.ts"), "hello");
    const first = await searchProject(
      { glob: "**/*.ts", limit: 1 },
      context,
      true,
    );
    expect(first.files).toEqual(["src/a.ts"]);
    expect(first.nextOffset).toBe(1);
    expect(
      (await searchProject({ glob: "**/*.ts", offset: 1 }, context, true))
        .files,
    ).toEqual(["src/b.ts"]);
    expect(
      (
        await searchProject(
          {
            pattern: "hello.*42",
            regex: true,
            caseSensitive: false,
            glob: "**/*.ts",
          },
          context,
        )
      ).matches,
    ).toMatchObject([{ path: "src/a.ts", line: 1 }]);
    expect(
      (await searchProject({ pattern: "hello" }, context)).matches?.some(
        (item) => item.path.endsWith("skip.txt"),
      ),
    ).toBe(false);
    // Explicit rg --glob takes precedence over ignore files, matching ripgrep semantics.
    expect(
      (await searchProject({ pattern: "hello", glob: "**/*.txt" }, context))
        .matches,
    ).toHaveLength(1);
    await expect(
      searchProject({ pattern: "[", regex: true }, context),
    ).rejects.toThrow();
    await expect(
      searchProject({ pattern: "x", path: "../" }, context),
    ).rejects.toThrow("outside");
    await symlink(
      root,
      join(root, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      searchProject({ pattern: "x", path: "linked" }, context),
    ).rejects.toThrow("Symlink");
    await expect(
      searchProject(
        { pattern: "x" },
        { ...context, signal: AbortSignal.abort() },
      ),
    ).rejects.toThrow();
  }));

it("combines bounded read-only research with exact evidence and uncertainties", () =>
  fixture(async (root, context) => {
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "service.ts"),
      "export function recoverRun() {}\n",
    );
    await writeFile(
      join(root, "src", "view.ts"),
      "const status = 'interrupted';\n",
    );
    const result = await researchProject(
      {
        objective: "locate run recovery",
        queries: [
          { pattern: "recoverRun", glob: "**/*.ts" },
          { pattern: "missing evidence", glob: "**/*.ts" },
        ],
      },
      context,
    );
    expect(result).toMatchObject({
      objective: "locate run recovery",
      readOnly: true,
      evidenceCount: 1,
      groups: [
        {
          query: 1,
          evidence: [{ path: "src/service.ts", line: 1 }],
          uncertainties: [],
        },
        { query: 2, evidence: [], uncertainties: ["no matches"] },
      ],
      uncertainties: ["query 2: no matches"],
    });
    await expect(
      researchProject(
        { objective: "cancel", queries: [{ pattern: "recoverRun" }] },
        { ...context, signal: AbortSignal.abort(new Error("cancelled")) },
      ),
    ).rejects.toThrow("cancelled");
  }));
