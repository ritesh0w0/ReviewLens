import type {
  InlineCommentGroup,
  PresentationPlan,
  ValidatedFinding,
} from "@reviewlens/core";

export const MAX_SUMMARY_BYTES = 32 * 1024; // 32 KiB
export const MAX_INLINE_COMMENT_BYTES = 4 * 1024; // 4 KiB

export interface GitHubInlineCommentPayload {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
}

export interface BuiltReviewPayload {
  summaryBody: string;
  comments: GitHubInlineCommentPayload[];
  hasOmittedFindingsDueToSize: boolean;
}

export interface ReviewPayloadInput {
  runId: string;
  plan: PresentationPlan;
  overallCoverage: "complete" | "partial" | "no_rules";
  coverageWarnings: readonly string[];
  repoName?: string;
  aiCoverageNotice?: string;
}

export function sanitizeMarkdown(text: string): string {
  // Neutralize GitHub @mentions by inserting a zero-width space after @
  const noMentions = text.replace(/@([a-zA-Z0-9_-]+)/g, "@\u200B$1");
  // Neutralize HTML script tags or dangerous tags
  return noMentions
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatReviewMarker(runId: string): string {
  return `<!-- reviewlens:run:${runId} -->`;
}

export function buildInlineCommentBody(group: InlineCommentGroup): string {
  const parts: string[] = ["### ReviewLens Advisory Finding"];

  for (const finding of group.findings) {
    const sev = finding.severity.toUpperCase();
    const title = sanitizeMarkdown(finding.title);
    const message = sanitizeMarkdown(finding.message);
    parts.push(`- **[${sev}] ${title}**\n  ${message}`);
  }

  const fullBody = parts.join("\n\n");
  const byteLength = Buffer.byteLength(fullBody, "utf8");

  if (byteLength <= MAX_INLINE_COMMENT_BYTES) {
    return fullBody;
  }

  // Bound inline body if needed
  const truncatedParts: string[] = ["### ReviewLens Advisory Finding"];
  let curBytes = Buffer.byteLength(truncatedParts[0]!, "utf8");
  let omitted = 0;

  for (const finding of group.findings) {
    const entry = `- **[${finding.severity.toUpperCase()}] ${sanitizeMarkdown(finding.title)}**\n  ${sanitizeMarkdown(finding.message)}`;
    const entryBytes = Buffer.byteLength(`\n\n${entry}`, "utf8");
    if (curBytes + entryBytes + 100 < MAX_INLINE_COMMENT_BYTES) {
      truncatedParts.push(entry);
      curBytes += entryBytes;
    } else {
      omitted++;
    }
  }

  if (omitted > 0) {
    truncatedParts.push(
      `\n*(...${omitted} additional finding(s) omitted due to size limit)*`,
    );
  }

  return truncatedParts.join("\n\n");
}

export function buildReviewPayload(
  input: ReviewPayloadInput,
): BuiltReviewPayload {
  const { runId, plan, overallCoverage, coverageWarnings } = input;
  const marker = formatReviewMarker(runId);

  // 1. Build inline comments
  const comments: GitHubInlineCommentPayload[] = [];
  for (const group of plan.inlineGroups) {
    comments.push({
      path: group.path,
      line: group.line,
      side: group.side,
      body: buildInlineCommentBody(group),
    });
  }

  // 2. Build summary sections
  const headerSection = [
    "## ReviewLens Advisory Review",
    "",
    "> [!NOTE]",
    "> ReviewLens provides evidence-first, automated advisory pull-request reviews. This review is advisory only: it never approves, requests changes, blocks merging, or modifies code.",
  ].join("\n");

  let coverageSection = "";
  if (coverageWarnings.length > 0) {
    const warningItems = coverageWarnings
      .map((w) => `- ${sanitizeMarkdown(w)}`)
      .join("\n");
    const warningTitle =
      overallCoverage === "partial"
        ? "**Partial Review Coverage**: Some eligible files could not be inspected because patches were unavailable or malformed. ReviewLens did not inspect the entire pull request."
        : "**Review Notices**";
    coverageSection = [
      "",
      "> [!WARNING]",
      `> ${warningTitle}`,
      ">",
      warningItems.replace(/^/gm, "> "),
    ].join("\n");
  }

  // Group summary findings by scope
  const prFindings: ValidatedFinding[] = [];
  const fileFindings: ValidatedFinding[] = [];
  const lineSummaryFindings: ValidatedFinding[] = [];

  for (const f of plan.summaryFindings) {
    if (f.scope === "pull_request") prFindings.push(f);
    else if (f.scope === "file") fileFindings.push(f);
    else if (f.scope === "line") lineSummaryFindings.push(f);
  }

  const sections: string[] = [headerSection];
  if (coverageSection) {
    sections.push(coverageSection);
  }

  // PR-level findings section
  if (prFindings.length > 0) {
    const items = prFindings.map(
      (f) =>
        `- **[${f.severity.toUpperCase()}] ${sanitizeMarkdown(f.title)}**\n  ${sanitizeMarkdown(f.message)}`,
    );
    sections.push(`\n### Pull Request Level Findings\n\n${items.join("\n\n")}`);
  }

  // File-level findings section
  if (fileFindings.length > 0) {
    const items = fileFindings.map((f) => {
      const path =
        f.primaryEvidence.kind === "file_relationship"
          ? f.primaryEvidence.sourcePath
          : "";
      return `- \`${path}\`: **[${f.severity.toUpperCase()}] ${sanitizeMarkdown(f.title)}**\n  ${sanitizeMarkdown(f.message)}`;
    });
    sections.push(`\n### File Level Findings\n\n${items.join("\n\n")}`);
  }

  // Line-level findings displayed in summary (when cap=0 or summary-only fallback)
  if (lineSummaryFindings.length > 0) {
    const items = lineSummaryFindings.map((f) => {
      const ev = f.primaryEvidence as {
        path: string;
        line: number;
        side: string;
      };
      return `- \`${ev.path}:${ev.line}\`: **[${f.severity.toUpperCase()}] ${sanitizeMarkdown(f.title)}**\n  ${sanitizeMarkdown(f.message)}`;
    });
    sections.push(
      `\n### Inline Findings (Summary View)\n\n${items.join("\n\n")}`,
    );
  }

  // Statistics section
  const totalFindings =
    plan.inlineGroups.reduce((acc, g) => acc + g.findings.length, 0) +
    plan.summaryFindings.length +
    plan.suppressedFindings.length;

  const statsLines = [
    `\n### Review Summary Statistics`,
    `- Total findings detected: ${totalFindings}`,
    `- Inline comment groups posted: ${comments.length}`,
  ];

  if (input.aiCoverageNotice) {
    statsLines.push(`- ${input.aiCoverageNotice}`);
  }

  if (plan.omittedInlineGroupsCount > 0) {
    statsLines.push(
      `- Findings omitted due to comment limit: ${plan.omittedInlineFindingsCount} (${plan.omittedInlineGroupsCount} anchor groups)`,
    );
  }

  sections.push(statsLines.join("\n"));

  // Check overall size and ensure marker is always preserved
  let hasOmittedFindingsDueToSize = false;
  const markerBlock = `\n\n${marker}`;
  const markerBytes = Buffer.byteLength(markerBlock, "utf8");

  let fullSummary = sections.join("\n\n") + markerBlock;
  if (Buffer.byteLength(fullSummary, "utf8") > MAX_SUMMARY_BYTES) {
    hasOmittedFindingsDueToSize = true;
    // Bounded truncation: preserve header and stats, drop findings from end
    const boundedSections: string[] = [headerSection];
    if (coverageSection) boundedSections.push(coverageSection);

    let curBytes =
      Buffer.byteLength(boundedSections.join("\n\n"), "utf8") +
      markerBytes +
      200;

    let omittedFindings = 0;
    // Keep as many complete sections as possible
    for (let i = coverageSection ? 2 : 1; i < sections.length - 1; i++) {
      const secBytes = Buffer.byteLength(`\n\n${sections[i]}`, "utf8");
      if (curBytes + secBytes < MAX_SUMMARY_BYTES - 500) {
        boundedSections.push(sections[i]!);
        curBytes += secBytes;
      } else {
        omittedFindings++;
      }
    }

    if (omittedFindings > 0) {
      boundedSections.push(
        `\n*(Some finding entries omitted to keep review summary under ${MAX_SUMMARY_BYTES / 1024} KiB limit)*`,
      );
    }

    boundedSections.push(sections[sections.length - 1]!); // Stats
    fullSummary = boundedSections.join("\n\n") + markerBlock;
  }

  return {
    summaryBody: fullSummary,
    comments,
    hasOmittedFindingsDueToSize,
  };
}
