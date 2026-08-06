import type { ComponentType } from "react";
import { CVDocument } from "../cvDocument";
import { CvHtmlTemplate } from "./CvHtmlTemplate";
// Template 2 ("Sidebar Blue") is fully built (CvHtmlTemplate2.tsx,
// cvTemplate2Styles.ts) but temporarily hidden from selection while it's
// still being refined — re-add its entry below (and the Profile-page CV
// Template dropdown) to bring it back.
// import { CvHtmlTemplate2 } from "./CvHtmlTemplate2";

// Every CV template takes exactly this shape — content stays entirely
// template-agnostic (same CVDocument, whichever template renders it), only
// presentation differs. Profile.cvTemplate stores the key into this map.
export interface CvTemplateEntry {
  label: string;
  component: ComponentType<{ doc: CVDocument }>;
}

export const CV_TEMPLATES: Record<string, CvTemplateEntry> = {
  "sidebar-v1": { label: "Sidebar (Photo)", component: CvHtmlTemplate },
  // "sidebar-blue-v1": { label: "Sidebar (Blue)", component: CvHtmlTemplate2 },
};

export const DEFAULT_CV_TEMPLATE = "sidebar-v1";

// Safe fallback for an unknown/stale stored value (including profiles that
// still have "sidebar-blue-v1" saved from before it was hidden) — never
// throws, always returns a renderable component.
export function getCvTemplateComponent(templateId: string): ComponentType<{ doc: CVDocument }> {
  return (CV_TEMPLATES[templateId] ?? CV_TEMPLATES[DEFAULT_CV_TEMPLATE]).component;
}
