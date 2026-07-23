export type ReassessmentVisibilityInput = {
  globalOrigin: boolean;
  hasPermission: boolean;
  hasStoredArtifact: boolean;
  analysisStatus?: string | null;
  hasReport: boolean;
};

export function canShowReassessment(input: ReassessmentVisibilityInput) {
  return input.globalOrigin
    && input.hasPermission
    && input.hasStoredArtifact
    && input.analysisStatus === "COMPLETED"
    && input.hasReport;
}
