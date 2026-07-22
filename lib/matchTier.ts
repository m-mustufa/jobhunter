export type MatchTierKey = "strong" | "good" | "partial" | "weak";

export interface MatchTier {
  key: MatchTierKey;
  label: string;
}

// Thresholds per the agent spec: 85-100 Strong, 70-84 Good, 55-69 Partial, below 55 shown too.
export function getMatchTier(score: number): MatchTier {
  if (score >= 85) return { key: "strong", label: "Strong match" };
  if (score >= 70) return { key: "good", label: "Good match" };
  if (score >= 55) return { key: "partial", label: "Partial match" };
  return { key: "weak", label: "Limited match" };
}
