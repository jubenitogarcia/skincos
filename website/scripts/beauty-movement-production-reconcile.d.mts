export type BeautyMovementReleaseCheckpoint = {
  version: 1;
  phase: "prepared" | "candidate";
  releaseSha: string;
  releaseOwner: string;
  previousVersionId: string;
  candidateVersionId: string | null;
  beautyMovementActiveCampaignCount: number;
  previousBuildSha: string;
};

export function buildBeautyMovementSyntheticCampaignId(runId: string, runAttempt: string): string;
export function buildBeautyMovementReleaseOwner(runId: string, runAttempt: string): string;
export function readBeautyMovementReleaseCheckpoint(
  filePath: string,
  expectedReleaseSha: string,
  expectedReleaseOwner: string,
): BeautyMovementReleaseCheckpoint | null;
export function decideBeautyMovementRollback(input: {
  conclusion: "success" | "failure" | "cancelled" | "timed_out";
  checkpoint: BeautyMovementReleaseCheckpoint;
  currentVersionId: string;
  currentBuildSha: string;
  currentReleaseOwner: string | null;
}):
  | { action: "none"; reason: string }
  | { action: "rollback"; candidateVersionId: string; inferred?: boolean };
export function resolveBeautyMovementReleaseConclusion(input: {
  conclusion: "success" | "failure" | "cancelled" | "timed_out";
  durableValidation: boolean;
  validationReadFailed: boolean;
}): "success" | "failure" | "cancelled" | "timed_out" | null;
