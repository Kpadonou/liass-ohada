import { UserProfileService } from "../lambda/shared/services/user-profile-service";

interface UserProfileRepairEntry {
  userId: string;
  email: string;
  emailVerified: true;
  givenName?: string;
  familyName?: string;
  displayName?: string;
  avatarUrl?: string;
}

const manifestJson = process.env.USER_PROFILE_REPAIR_MANIFEST;
const dryRun = process.env.DRY_RUN !== "false";

if (!manifestJson) {
  throw new Error(
    "USER_PROFILE_REPAIR_MANIFEST is required. Provide explicit profiles from an authoritative identity export.",
  );
}

const manifest = JSON.parse(manifestJson) as UserProfileRepairEntry[];
if (!Array.isArray(manifest) || manifest.length === 0) {
  throw new Error("USER_PROFILE_REPAIR_MANIFEST must contain at least one explicit entry.");
}

async function run(): Promise<void> {
  for (const entry of manifest) {
    if (!entry.userId || !entry.email || entry.emailVerified !== true) {
      console.warn(`Skipped invalid profile manifest entry for ${entry.userId || "unknown user"}.`);
      continue;
    }
    if (dryRun) {
      console.info(`Dry run: would synchronize profile ${entry.userId}.`);
      continue;
    }
    await UserProfileService.ensureSynchronized(entry);
    console.info(`Synchronized profile ${entry.userId}.`);
  }
}

run().catch((error) => {
  console.error("User profile repair failed.", error);
  process.exitCode = 1;
});
