import { forbidRegexRule } from "./forbid-regex.js";
import { requireCompanionRule } from "./require-companion.js";
import { maxPrSizeRule } from "./max-pr-size.js";
import type { DeterministicRule } from "../types/rules.js";

const RULE_REGISTRY: Readonly<Record<string, DeterministicRule>> =
  Object.freeze({
    forbid_regex: forbidRegexRule,
    require_companion: requireCompanionRule,
    max_pr_size: maxPrSizeRule,
  });

export function getRegisteredRule(type: string): DeterministicRule | undefined {
  return RULE_REGISTRY[type];
}

export function isRegisteredRuleType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(RULE_REGISTRY, type);
}

export const SUPPORTED_RULE_TYPES = [
  "forbid_regex",
  "require_companion",
  "max_pr_size",
] as const;
