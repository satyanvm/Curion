export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "password"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "unknown";

export type LabelSource =
  | "aria-label"
  | "aria-labelledby"
  | "label"
  | "parent-label"
  | "placeholder"
  | "name"
  | "id"
  | "llm";

export interface FormField {
  label: string;
  selector: string;
  type: FieldType;
  labelSource: LabelSource;
  name?: string;
  placeholder?: string;
  tagName: string;
  options?: string[];
}

export interface UserProfile {
  name: string;
  email: string;
  phone: string;
  company: string;
  jobTitle: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  linkedin: string;
  website: string;
  preferredContactMethod: string;
  notes: string;
  acceptTerms: string;
}

export type FieldValueMap = Record<string, string>;

export type MappingMethod = "rule" | "semantic" | "llm" | "unmapped";

export interface ExtractionFieldConfidence {
  selector: string;
  label: string;
  score: number;
  reasons: string[];
  weaknesses: string[];
  recommendedAction: "trust" | "repair-with-llm" | "review";
}

export interface  ExtractionConfidenceReport {
  overallScore: number;
  shouldUseLLM: boolean;
  reasons: string[];
  fieldReports: ExtractionFieldConfidence[];
  weakFieldRatio: number;
}

export type ExtractionFallbackRecommendation =
  | "none"
  | "dom-repair"
  | "llm-html"
  | "vision";

export interface HtmlAdequacyReport {
  overallScore: number;
  recommendedFallback: ExtractionFallbackRecommendation;
  reasons: string[];
  weaknesses: string[];
  nativeControlCount: number;
  strongSemanticCoverage: number;
  readableAttributeCoverage: number;
  machineGeneratedAttributeRatio: number;
  customWidgetSuspicion: number;
  hasMeaningfulVisibleText: boolean;
}

export interface MappingCandidateScore {
  key: keyof UserProfile;
  score: number;
}

export interface FieldMappingConfidence {
  label: string;
  selector: string;
  score: number;
  extractionScore: number;
  method: MappingMethod;
  mappedKey?: keyof UserProfile;
  mappedValue?: string;
  reasons: string[];
  weaknesses: string[];
  candidateScores: MappingCandidateScore[];
  shouldUseLLM: boolean;
}

export interface MappingConfidenceReport {
  overallScore: number;
  shouldUseLLM: boolean;
  reasons: string[];
  fieldReports: FieldMappingConfidence[];
  unresolvedCount: number;
}
