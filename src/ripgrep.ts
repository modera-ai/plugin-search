import { isRemotePath, remotePath, workspaceUri } from "@modera/plugin-sdk/workspace-path";
import { spawn } from "@modera/plugin-sdk/workspace-process";
import { relative, isAbsolute } from "@modera/plugin-sdk/workspace-path";
import type { ToolContext } from "@modera/plugin-sdk";
import { readTarget } from "@modera/plugin-sdk";

export interface SearchInput {
  path?: string;
  glob?: string;
  offset?: number;
  limit?: number;
  pattern?: string;
  regex?: boolean;
  caseSensitive?: boolean;
}
const excluded = [
  "node_modules",
  ".git",
  "target",
  "dist",
  "out",
  "build",
  ".next",
  ".cache",
  ".venv",
  "venv",
  "coverage",
];
type Match = {
  path: string;
  line: number;
  text: string;
  lineTruncated: boolean;
};
/** No shell, no user flags/config/preprocessors; fixed binary and bounded streaming output. */
export async function searchProject(
  input: SearchInput,
  context: ToolContext,
  files = false,
) {
  context.signal.throwIfAborted();
  const { rgPath } = await import("@vscode/ripgrep");
  const { root, target } = await readTarget(
    context.workspacePath!,
    input.path ?? ".",
  );
  const offset = input.offset ?? 0,
    limit = input.limit ?? 50;
  const args = [
    "--no-config",
    "--no-follow",
    "--hidden",
    "--sort",
    "path",
    "--color",
    "never",
    "--max-filesize",
    "16M",
  ];
  if (input.glob) args.push("--glob", input.glob);
  for (const name of excluded) args.push("--glob", `!**/${name}/**`);
  if (files) args.push("--files", "--null");
  else {
    args.push("--json");
    if (!input.regex) args.push("--fixed-strings");
    if (input.caseSensitive === false) args.push("--ignore-case");
    args.push("--regexp", input.pattern!);
  }
  args.push("--", target);
  return new Promise<{
    files?: string[];
    matches?: Match[];
    backend: string;
    truncated: boolean;
    hasMore: boolean;
    nextOffset?: number;
  }>((resolve, reject) => {
    const child = spawn(isRemotePath(root) ? "rg" : rgPath, args, {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, RIPGREP_CONFIG_PATH: "" },
    });
    let pending = "",
      error = "",
      seen = 0,
      size = 0,
      responseSize = 0,
      stopped = false,
      timedOut = false;
    const results: (Match | string)[] = [];
    const stop = () => {
      stopped = true;
      child.kill();
    };
    const cancel = () => child.kill();
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 10000);
    context.signal.addEventListener("abort", cancel, { once: true });
    if (context.signal.aborted) cancel();
    const accept = (line: string) => {
      if (stopped || !line) return;
      let path: string, match: Match | undefined;
      if (files) path = line;
      else {
        const message = JSON.parse(line);
        if (
          message.type !== "match" ||
          typeof message.data.path.text !== "string" ||
          typeof message.data.lines.text !== "string"
        )
          return;
        path = message.data.path.text;
        const text = message.data.lines.text.replace(/\r?\n$/, "");
        match = {
          path: "",
          line: message.data.line_number,
          text: text.slice(0, 500),
          lineTruncated: text.length > 500,
        };
      }
      const local = relative(root, isRemotePath(root) && path.startsWith("/") ? workspaceUri(remotePath(root).profileId, path) : path).replaceAll("\\", "/");
      if (local.startsWith("../") || isAbsolute(local))
        throw new Error("Search result outside project");
      if (seen++ < offset) return;
      const result = match ? { ...match, path: local } : local;
      const length = JSON.stringify(result).length;
      if (results.length >= limit || responseSize + length > 16000) {
        stop();
        return;
      }
      responseSize += length;
      results.push(result);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stopped) return;
      size += Buffer.byteLength(chunk);
      if (size > 8 * 1024 * 1024) {
        stop();
        return;
      }
      pending += chunk;
      const separator = files ? "\0" : "\n";
      let end: number;
      try {
        while ((end = pending.indexOf(separator)) >= 0) {
          const line = pending.slice(0, end);
          pending = pending.slice(end + 1);
          accept(line);
        }
        if (pending.length > 128000) stop();
      } catch (cause) {
        error = String(cause);
        child.kill();
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      error = (error + chunk).slice(0, 2000);
    });
    const cleanup = () => {
      clearTimeout(timer);
      context.signal.removeEventListener("abort", cancel);
    };
    child.once("error", (cause) => {
      cleanup();
      reject(new Error(`ripgrep unavailable: ${cause.message}`));
    });
    child.once("close", (code) => {
      cleanup();
      if (context.signal.aborted) {
        reject(context.signal.reason);
        return;
      }
      if (timedOut) {
        reject(new Error("Search timed out; narrow the path or pattern"));
        return;
      }
      if (error || (!stopped && code !== 0 && code !== 1)) {
        reject(new Error(error || `ripgrep exited ${code}`));
        return;
      }
      resolve({
        ...(files
          ? { files: results as string[] }
          : { matches: results as Match[] }),
        backend: "ripgrep",
        truncated: stopped,
        hasMore: stopped,
        ...(stopped && results.length
          ? { nextOffset: offset + results.length }
          : {}),
      });
    });
  });
}
