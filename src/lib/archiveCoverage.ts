import { writable } from "svelte/store";
import { NothingPublished, fetchArchive } from "../api";
import type { ArchiveCoverage } from "./archive";

/**
 * What the archive covers, as `/v3/archive` last said: asked for when the
 * picker opens, or a link needs it, and not with the page, which most
 * visits never need. Kept a minute: the archive's newest step moves every
 * five.
 */
export type CoverageState =
  | { state: "unknown" }
  | { state: "loading" }
  | { state: "empty" }
  | { state: "failed" }
  | { state: "kept"; coverage: ArchiveCoverage };

export const archiveCoverage = writable<CoverageState>({ state: "unknown" });

const FRESH_MS = 60_000;

let asked: { at: number; answer: Promise<ArchiveCoverage | null> } | null = null;

/**
 * The archive's coverage, or null when nothing is kept (a 404) or the
 * request failed; which of the two is in `archiveCoverage`.
 */
export function loadCoverage(): Promise<ArchiveCoverage | null> {
  if (asked && Date.now() - asked.at < FRESH_MS) return asked.answer;
  archiveCoverage.update((current) => (current.state === "kept" ? current : { state: "loading" }));
  const answer = fetchArchive()
    .then(({ since, until }) => {
      const coverage = { since, until };
      archiveCoverage.set({ state: "kept", coverage });
      return coverage;
    })
    .catch((error) => {
      archiveCoverage.set({ state: error instanceof NothingPublished ? "empty" : "failed" });
      // A failure is asked again next time; an empty archive is a minute's answer.
      if (!(error instanceof NothingPublished)) asked = null;
      return null;
    });
  asked = { at: Date.now(), answer };
  return answer;
}
