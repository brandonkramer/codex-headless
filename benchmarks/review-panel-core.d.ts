declare module "../../workflows/lib/review-panel-core.js" {
  export const EVIDENCE_BYTE_BUDGET: number;
  export const DEFAULT_LENSES: readonly {
    id: string;
    title: string;
    focus: string;
  }[];
  export function buildEvidencePacket(
    sections: { diff?: string; context?: string; tests?: string },
    budget?: number,
  ): {
    body: string;
    bytesUsed: number;
    byteBudget: number;
    truncated: boolean;
    digest: string;
    fullBytes: number;
  };
  export function buildLensReviewPrompt(
    lens: { id: string; title: string; focus: string },
    scope: string,
    cwd: string,
    packet: { body: string; truncated: boolean; digest: string; bytesUsed: number; byteBudget: number },
  ): string;
  export function buildPrepPrompt(scope: string, cwd: string): string;
}

declare module "../../../workflows/lib/review-panel-core.js" {
  export const EVIDENCE_BYTE_BUDGET: number;
  export const DEFAULT_LENSES: readonly {
    id: string;
    title: string;
    focus: string;
  }[];
  export function buildEvidencePacket(
    sections: { diff?: string; context?: string; tests?: string },
    budget?: number,
  ): {
    body: string;
    bytesUsed: number;
    byteBudget: number;
    truncated: boolean;
    digest: string;
    fullBytes: number;
  };
  export function buildLensReviewPrompt(
    lens: { id: string; title: string; focus: string },
    scope: string,
    cwd: string,
    packet: { body: string; truncated: boolean; digest: string; bytesUsed: number; byteBudget: number },
  ): string;
  export function buildPrepPrompt(scope: string, cwd: string): string;
}
