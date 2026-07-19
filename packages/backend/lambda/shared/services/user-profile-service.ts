import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import { AppError } from "../app-error";
import {
  UserProfileRecord,
  UserProfileRepository,
} from "../repositories/user-profile-repository";

export interface AuthenticatedIdentityProjection {
  userId: string;
  email?: unknown;
  emailVerified?: unknown;
  givenName?: unknown;
  familyName?: unknown;
  displayName?: unknown;
  avatarUrl?: unknown;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function verified(value: unknown): boolean {
  return value === true || value === "true";
}

function profileFromIdentity(
  identity: AuthenticatedIdentityProjection,
  existing?: UserProfileRecord,
): UserProfileRecord {
  if (!verified(identity.emailVerified) || !optionalString(identity.email)) {
    throw new AppError(403, "USER_PROFILE_EMAIL_NOT_VERIFIED");
  }
  const email = optionalString(identity.email)!;
  const normalizedEmail = email.toLowerCase();
  const givenName = optionalString(identity.givenName) ?? existing?.givenName;
  const familyName = optionalString(identity.familyName) ?? existing?.familyName;
  const displayName =
    optionalString(identity.displayName) ??
    ([givenName, familyName].filter(Boolean).join(" ") ||
      existing?.displayName ||
      email);
  const avatarUrl = optionalString(identity.avatarUrl) ?? existing?.avatarUrl;
  const now = new Date().toISOString();
  return {
    userId: identity.userId,
    email,
    normalizedEmail,
    emailVerified: true,
    givenName,
    familyName,
    displayName,
    avatarUrl,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastSyncedFromIdentityAt: now,
  };
}

function unchanged(
  existing: UserProfileRecord,
  profile: UserProfileRecord,
): boolean {
  return (
    existing.email === profile.email &&
    existing.normalizedEmail === profile.normalizedEmail &&
    existing.givenName === profile.givenName &&
    existing.familyName === profile.familyName &&
    existing.displayName === profile.displayName &&
    existing.avatarUrl === profile.avatarUrl
  );
}

export class UserProfileService {
  static async ensureSynchronized(
    identity: AuthenticatedIdentityProjection,
  ): Promise<UserProfileRecord> {
    const existing = await UserProfileRepository.get(identity.userId);
    const profile = profileFromIdentity(identity, existing);
    if (existing && unchanged(existing, profile)) return existing;

    try {
      if (!existing) {
        await UserProfileRepository.create(profile);
      } else if (existing.normalizedEmail === profile.normalizedEmail) {
        await UserProfileRepository.update(profile);
      } else {
        await UserProfileRepository.changeEmail(existing, profile);
      }
      return profile;
    } catch (error) {
      if (error instanceof TransactionCanceledException) {
        const lookup = await UserProfileRepository.resolveByEmail(
          profile.normalizedEmail,
        );
        if (lookup && lookup.userId !== profile.userId) {
          throw new AppError(409, "USER_PROFILE_EMAIL_CONFLICT");
        }
        if (lookup?.userId === profile.userId) {
          const concurrentProfile = await UserProfileRepository.get(
            profile.userId,
          );
          if (
            concurrentProfile?.normalizedEmail === profile.normalizedEmail
          ) {
            return concurrentProfile;
          }
        }
      }
      throw new AppError(500, "USER_PROFILE_SYNC_FAILED");
    }
  }
}
