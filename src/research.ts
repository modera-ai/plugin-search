import type { ToolContext } from "@modera/plugin-sdk";
import { searchProject, type SearchInput } from "./ripgrep";

export interface ResearchInput {
  readonly objective: string;
  readonly queries: readonly SearchInput[];
}

/** Bounded fan-out over the existing read-only search primitive. */
export async function researchProject(
  input: ResearchInput,
  context: ToolContext,
) {
  const groups = await Promise.all(
    input.queries.map(async (query, index) => {
      try {
        const result = await searchProject(
          { ...query, offset: 0, limit: 12 },
          context,
        );
        const matches = result.matches ?? [];
        const uncertainties = [
          ...(!matches.length ? ["no matches"] : []),
          ...(result.truncated ? ["additional matches were truncated"] : []),
          ...(matches.some((match) => match.lineTruncated)
            ? ["one or more evidence lines were shortened"]
            : []),
        ];
        return {
          query: index + 1,
          pattern: query.pattern,
          evidence: matches,
          uncertainties,
        };
      } catch (error) {
        context.signal.throwIfAborted();
        return {
          query: index + 1,
          pattern: query.pattern,
          evidence: [],
          uncertainties: [
            `search failed: ${error instanceof Error ? error.message : String(error)}`,
          ],
        };
      }
    }),
  );
  return {
    objective: input.objective,
    readOnly: true,
    groups,
    evidenceCount: groups.reduce(
      (total, group) => total + group.evidence.length,
      0,
    ),
    uncertainties: groups.flatMap((group) =>
      group.uncertainties.map((item) => `query ${group.query}: ${item}`),
    ),
  };
}
