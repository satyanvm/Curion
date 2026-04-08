import { readFile } from "node:fs/promises";
import path from "node:path";
import { UserProfile } from "../types/types";

function isUserProfile(value: unknown): value is UserProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const requiredKeys: Array<keyof UserProfile> = [
    "name",
    "email",
    "phone",
    "company",
    "jobTitle",
    "address",
    "city",
    "state",
    "postalCode",
    "country",
    "linkedin",
    "website",
    "preferredContactMethod",
    "notes",
    "acceptTerms",
  ];

  return requiredKeys.every((key) => typeof candidate[key] === "string");
}

export function resolveProfilePath(inputPath?: string): string {
  if (!inputPath) {
    return path.resolve(process.cwd(), "data", "profile.json");
  }

  return path.resolve(process.cwd(), inputPath);
}

export async function loadUserProfile(inputPath?: string): Promise<UserProfile> {
  const profilePath = resolveProfilePath(inputPath);
  const fileContents = await readFile(profilePath, "utf8");
  const parsed = JSON.parse(fileContents) as unknown;

  if (!isUserProfile(parsed)) {
    throw new Error(
      `Profile JSON at ${profilePath} is invalid. Expected all UserProfile fields as strings.`
    );
  }

  return parsed;
}
