export type ReassessmentVisibilityInput = {
  globalOrigin: boolean;
  hasPermission: boolean;
  hasStoredArtifact: boolean;
  analysisStatus?: string | null;
  hasReport: boolean;
};

export function reassessmentUnavailableReason(input: ReassessmentVisibilityInput) {
  if (!input.globalOrigin) return "Herbeoordeling is uitsluitend beschikbaar voor beheerders uit de Global-tenant.";
  if (!input.hasPermission) return "Je rol mist de permission security.analyses.reassess.";
  if (!input.hasStoredArtifact) return "Deze backup heeft geen gekoppeld configuratieartifact.";
  if (!input.analysisStatus) return "Voor deze opgeslagen configuratie bestaat nog geen analyse.";
  if (input.analysisStatus !== "COMPLETED") return `De analyse is nog niet voltooid (status: ${input.analysisStatus}).`;
  if (!input.hasReport) return "De voltooide analyse heeft geen immutable PDF-rapport.";
  return null;
}

export function canShowReassessment(input: ReassessmentVisibilityInput) {
  return reassessmentUnavailableReason(input) === null;
}
