import manifest from "../plugin.json";
import { declaredTool } from "@modera/plugin-sdk";

/**
 * Tool metadata declared in `plugin.json`.
 *
 * Schemas, titles and permissions live in the manifest so the host can list
 * them without loading this plugin; this module only names them for `index.ts`.
 */
export const searchDefinition = declaredTool(manifest, "grep_search");
export const filesDefinition = declaredTool(manifest, "glob_files");
export const researchDefinition = declaredTool(manifest, "research_project");
