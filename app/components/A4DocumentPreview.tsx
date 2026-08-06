"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  buildCoverLetterDocument,
  buildCVDocument,
} from "@/lib/cvDocument";
import { CoverLetterHtmlTemplate } from "@/lib/pdf/CoverLetterHtmlTemplate";
import { getCvTemplateComponent } from "@/lib/pdf/cvTemplates";
import type { Analysis, Job, Profile } from "@/lib/types";

// The existing screen templates use 794px for A4's 210mm width. Keep that
// natural canvas untouched and scale only this preview wrapper so the same
// template remains the source for both the in-app view and print-to-PDF.
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = Math.round((A4_WIDTH_PX * 297) / 210);

interface PreviewMetrics {
  scale: number;
  naturalHeight: number;
}

export interface A4DocumentPreviewProps {
  variant: "cv" | "cover-letter";
  profile: Profile;
  job: Job;
  analysis: Analysis;
  className?: string;
  /** Maximum height of the scrollable panel. Pass `undefined` to use the default. */
  maxHeight?: CSSProperties["maxHeight"];
}

/**
 * Read-only preview of the real CV or cover-letter print template.
 *
 * This component only derives a document from the supplied props. It does not
 * fetch, tailor, persist, print, or download anything.
 */
export function A4DocumentPreview({
  variant,
  profile,
  job,
  analysis,
  className = "",
  maxHeight = "min(70vh, 720px)",
}: A4DocumentPreviewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState<PreviewMetrics>({
    scale: 1,
    naturalHeight: A4_HEIGHT_PX,
  });

  const documentTemplate = useMemo(() => {
    if (variant === "cv") {
      const SelectedCvTemplate = getCvTemplateComponent(profile.cvTemplate);
      const document = buildCVDocument(profile, analysis.tailoredCV);
      return <SelectedCvTemplate doc={document} />;
    }

    const document = buildCoverLetterDocument(
      profile,
      job,
      analysis.coverLetter
    );
    return <CoverLetterHtmlTemplate doc={document} />;
  }, [analysis.coverLetter, analysis.tailoredCV, job, profile, variant]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const paper = paperRef.current;
    if (!viewport || !paper) return;

    let animationFrame = 0;
    let active = true;

    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (!active) return;

        const availableWidth = viewport.clientWidth;
        if (availableWidth <= 0) return;

        const scale = Math.min(1, availableWidth / A4_WIDTH_PX);
        const naturalHeight = Math.max(
          A4_HEIGHT_PX,
          paper.offsetHeight,
          paper.scrollHeight
        );

        setMetrics((current) => {
          if (
            Math.abs(current.scale - scale) < 0.001 &&
            current.naturalHeight === naturalHeight
          ) {
            return current;
          }
          return { scale, naturalHeight };
        });
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(paper);
    window.addEventListener("resize", measure);
    measure();

    // Lato can change line wrapping once its files have loaded. Re-measure so
    // the scaled stage always reserves the full final document height.
    void document.fonts?.ready.then(measure).catch(() => undefined);

    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [documentTemplate]);

  const scaledWidth = A4_WIDTH_PX * metrics.scale;
  const scaledHeight = metrics.naturalHeight * metrics.scale;
  const label =
    variant === "cv" ? "Tailored CV preview" : "Cover letter preview";

  return (
    <div
      className={`scroll-thin overflow-auto rounded-lg border border-line bg-ink/80 ${className}`.trim()}
      style={{ maxHeight }}
      role="region"
      aria-label={label}
      tabIndex={0}
      data-testid="a4-document-preview"
      data-document-variant={variant}
    >
      <div className="p-3 sm:p-5">
        <div ref={viewportRef} className="w-full min-w-0">
          <div
            className="relative mx-auto"
            style={{ width: scaledWidth, height: scaledHeight }}
          >
            <div
              ref={paperRef}
              style={{
                position: "absolute",
                inset: "0 auto auto 0",
                width: A4_WIDTH_PX,
                minHeight: A4_HEIGHT_PX,
                background: "#fdfdfd",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
                transform: `scale(${metrics.scale})`,
                transformOrigin: "top left",
              }}
            >
              {documentTemplate}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default A4DocumentPreview;
