import type { PluginManifest, PluginModule } from "@modera/plugin-sdk";
import {
  searchDefinition,
  filesDefinition,
  researchDefinition,
} from "./definitions";
import { searchProject, type SearchInput } from "./ripgrep";
import { researchProject, type ResearchInput } from "./research";
export const activate: PluginModule["activate"] = async () => {
  // Missing platform packages fail this plugin's activation, never desktop module loading.
  await import("@vscode/ripgrep");
  return {
    tools: [searchDefinition, filesDefinition, researchDefinition].map(
      (definition) => ({
        definition,
        isAvailable: (context) => !!context.workspacePath,
        execute: (raw, context) =>
          definition === researchDefinition
            ? researchProject(raw as ResearchInput, context)
            : searchProject(
                raw as SearchInput,
                context,
                definition === filesDefinition,
              ),
      }),
    ),
  };
};
