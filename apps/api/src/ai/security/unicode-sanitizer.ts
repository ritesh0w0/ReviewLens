// CVE-2021-42574 Trojan Source Bidi overrides
const BIDI_OVERRIDE_CHARS = /[\u202A-\u202E\u2066-\u2069]/g;

// Invisible / Zero-width format characters (excluding normal whitespace \t, \r, \n)
const INVISIBLE_CONTROL_CHARS = /[\u200B-\u200D\uFEFF\u2060\u200E\u200F]/g;

// Unicode Tag characters
const TAG_CHARACTERS = /[\u{E0000}-\u{E007F}]/gu;

function escapeControlChar(match: string): string {
  const code = match.codePointAt(0);
  if (code === undefined) return "";
  const hex = code.toString(16).toUpperCase().padStart(4, "0");
  return `[U+${hex}]`;
}

export function containsDangerousUnicode(text: string): boolean {
  BIDI_OVERRIDE_CHARS.lastIndex = 0;
  TAG_CHARACTERS.lastIndex = 0;
  INVISIBLE_CONTROL_CHARS.lastIndex = 0;
  return (
    BIDI_OVERRIDE_CHARS.test(text) ||
    TAG_CHARACTERS.test(text) ||
    INVISIBLE_CONTROL_CHARS.test(text)
  );
}

export interface UnicodeSafetyResult {
  readonly action: "keep" | "exclude_file";
  readonly content: string;
  readonly escapedCount: number;
  readonly reason?: string;
}

export function scanUnicodeSafety(text: string): UnicodeSafetyResult {
  let escapedCount = 0;
  const sanitized = text
    .replace(BIDI_OVERRIDE_CHARS, (c) => {
      escapedCount++;
      return escapeControlChar(c);
    })
    .replace(TAG_CHARACTERS, (c) => {
      escapedCount++;
      return escapeControlChar(c);
    })
    .replace(INVISIBLE_CONTROL_CHARS, (c) => {
      escapedCount++;
      return escapeControlChar(c);
    });

  return {
    action: "keep",
    content: sanitized,
    escapedCount,
  };
}

export function sanitizeUnicode(text: string): string {
  return scanUnicodeSafety(text).content;
}
