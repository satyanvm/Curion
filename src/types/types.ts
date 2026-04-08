export type FieldType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "password"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "unknown";

export interface FormField {
  label: string;
  selector: string;
  type: FieldType;
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
