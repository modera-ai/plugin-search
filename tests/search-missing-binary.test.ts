import { it, expect, vi } from "vitest";
import { readPluginManifest } from "@modera/plugin-host/testing";

const manifest = readPluginManifest(new URL("..", import.meta.url));
vi.mock("@vscode/ripgrep", () => {
  throw new Error("platform binary unavailable");
});
it("search manifest remains importable when its optional runtime binary is missing", async () => {
  const plugin = await import("../src");
  expect(manifest.id).toBe("modera.search");
  await expect(
    plugin.activate({
      pluginId: manifest.id,
      storagePath: "unused",
      signal: new AbortController().signal,
      grantedPermissions: new Set(manifest.permissions),
    }),
  ).rejects.toThrow();
});
