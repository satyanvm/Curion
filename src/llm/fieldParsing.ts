import { FieldType, FormField, LabelSource } from "../types/types";

export type LlmExtractedField = {
  label?: string;
  selector?: string;
  type?: string;
  name?: string;
  placeholder?: string;
  options?: string[];
};

export function normalizeFieldType(type: string | undefined): FieldType {
  const normalizedType = (type ?? "").toLowerCase();

  if (normalizedType === "textarea") return "textarea";
  if (normalizedType === "select") return "select";
  if (normalizedType === "checkbox") return "checkbox";
  if (normalizedType === "radio") return "radio";
  if (normalizedType === "email") return "email";
  if (normalizedType === "tel") return "tel";
  if (normalizedType === "url") return "url";
  if (normalizedType === "number") return "number";
  if (normalizedType === "password") return "password";
  if (normalizedType === "text") return "text";

  return "unknown";
}

function tagNameForType(type: FieldType): string {
  if (type === "textarea") return "textarea";
  if (type === "select") return "select";
  return "input";
}

export function parseLlmExtractedFields(
  fields: LlmExtractedField[],
  labelSource: LabelSource = "llm"
): FormField[] {
  return fields
    .filter((field) => field.label && field.selector)
    .map((field) => {
      const type = normalizeFieldType(field.type);
      return {
        label: field.label!.trim(),
        labelSource,
        selector: field.selector!.trim(),
        type,
        tagName: tagNameForType(type),
        name: field.name?.trim(),
        placeholder: field.placeholder?.trim(),
        options: field.options?.map((option) => option.trim()).filter(Boolean),
      };
    });
}
