import { UserProfile } from "../types/types";
import { MappingDecisionInput } from "../confidence/mappingConfidence";

export const PROFILE_SCHEMA: Record<keyof UserProfile, string> = {
  firstName: "A person's first or given name.",
  lastName: "A person's last name, surname, or family name.",
  name: "A person's full name.",
  email: "An email address.",
  phone: "A phone or mobile number.",
  company: "A company, organization, employer, or account name.",
  jobTitle: "A person's work role, position, designation, or title.",
  address: "A street or mailing address.",
  city: "A city, town, locality, or business market location.",
  state: "A state, province, region, or sales territory.",
  postalCode: "A postal code, ZIP code, postcode, or delivery zone.",
  country: "A country, nation, or geographic country-level value.",
  linkedin: "A LinkedIn profile URL.",
  website: "A website, homepage, portfolio, or company site URL.",
  preferredContactMethod: "The preferred contact, outreach, or follow-up channel.",
  notes: "Freeform notes, comments, message, memo, or contextual details.",
  acceptTerms: "A consent, agreement, opt-in, privacy, or terms checkbox value.",
};

export function buildMappedAnchors(decisions: Map<string, MappingDecisionInput>): Array<{
  label: string;
  mappedKey: keyof UserProfile;
  mappedValue: string;
  method: MappingDecisionInput["method"];
  score: number;
}> {
  return Array.from(decisions.values()).map((decision) => ({
    label: decision.label,
    mappedKey: decision.mappedKey,
    mappedValue: decision.mappedValue,
    method: decision.method,
    score: decision.baseScore,
  }));
}

export function buildAvailableProfileOptions(
  decisions: Map<string, MappingDecisionInput>,
  userProfile: UserProfile
): Array<{
  key: keyof UserProfile;
  description: string;
  value: string;
}> {
  const mappedKeys = new Set(Array.from(decisions.values()).map((decision) => decision.mappedKey));
  const enrichedProfile = {
    ...userProfile,
    ...derivedNameParts(userProfile),
  };

  return (Object.keys(enrichedProfile) as Array<keyof UserProfile>)
    .filter((key) => !mappedKeys.has(key))
    .filter((key) => enrichedProfile[key])
    .map((key) => ({
      key,
      description: PROFILE_SCHEMA[key],
      value: enrichedProfile[key] ?? "",
    }));
}

function derivedNameParts(userProfile: UserProfile): Pick<UserProfile, "firstName" | "lastName"> {
  if (userProfile.firstName || userProfile.lastName) {
    return {
      firstName: userProfile.firstName,
      lastName: userProfile.lastName,
    };
  }

  const parts = userProfile.name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
  };
}
