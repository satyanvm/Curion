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
