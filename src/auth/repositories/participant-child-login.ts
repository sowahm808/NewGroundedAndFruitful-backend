import type {
  Firestore,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";

export type ParticipantLoginRecord = {
  id: string;
  firebaseUid: string;
  organizationId: string;
  displayName: string;
  teamId: string | null;
  quarterId: string | null;
  pin?: string;
  pinHash?: string;
  pinSalt?: string;
};

/** Resolves the legacy participant-owned credential contract without crossing tenants. */
export class ParticipantChildLoginRepository {
  constructor(private readonly db: Firestore) {}

  async find(familyCode: string, handle: string) {
    const context = await this.context(familyCode);
    if (!context) return undefined;

    const constraints: Array<[string, string]> = context.organizationId
      ? [["organizationId", context.organizationId]]
      : [["guardianUserId", context.guardianUserId!]];
    for (const [field, value] of constraints) {
      const exact = await this.db
        .collection("participants")
        .where(field, "==", value)
        .where("handle", "==", handle)
        .limit(2)
        .get();
      const participant = exact.docs.find(
        (doc) => doc.get("status") === "active",
      );
      if (participant) return this.record(participant, context.organizationId);

      // displayName is a migration fallback. Filter in memory so casing does not
      // accidentally select a similarly named participant in another household.
      const scoped = await this.db
        .collection("participants")
        .where(field, "==", value)
        .limit(100)
        .get();
      const byName = scoped.docs.find(
        (doc) =>
          doc.get("status") === "active" &&
          String(doc.get("displayName") ?? "")
            .trim()
            .toLocaleLowerCase("en-US") === handle,
      );
      if (byName) return this.record(byName, context.organizationId);
    }
    return undefined;
  }

  private async context(code: string) {
    const variants = [
      ...new Set([
        code,
        code.toLocaleLowerCase("en-US"),
        code.toLocaleUpperCase("en-US"),
      ]),
    ];
    for (const value of variants) {
      const direct = await this.db.doc(`organizations/${value}`).get();
      if (direct.exists) return { organizationId: direct.id };
      for (const field of ["slug", "code"] as const) {
        const result = await this.db
          .collection("organizations")
          .where(field, "==", value)
          .limit(1)
          .get();
        if (result.docs[0]) return { organizationId: result.docs[0].id };
      }
    }
    for (const collection of [
      "users",
      "personalWorkspaceBootstraps",
    ] as const) {
      for (const value of variants) {
        const result = await this.db
          .collection(collection)
          .where("familyCode", "==", value)
          .limit(1)
          .get();
        const owner = result.docs[0];
        if (owner) {
          const organizationId = String(
            owner.get("organizationId") ?? owner.get("workspaceId") ?? "",
          );
          return organizationId
            ? { organizationId, guardianUserId: owner.id }
            : { guardianUserId: owner.id };
        }
      }
    }
    return undefined;
  }

  private record(
    doc: QueryDocumentSnapshot,
    resolvedOrganizationId?: string,
  ): ParticipantLoginRecord {
    return {
      id: doc.id,
      firebaseUid: String(doc.get("firebaseUid") ?? doc.get("userId") ?? ""),
      organizationId: String(
        doc.get("organizationId") ?? resolvedOrganizationId ?? "",
      ),
      displayName: String(
        doc.get("approvedDisplayName") ?? doc.get("displayName") ?? "",
      ),
      teamId: stringOrNull(doc.get("activeTeamId") ?? doc.get("teamId")),
      quarterId: stringOrNull(
        doc.get("quarterId") ?? doc.get("activeQuarterId"),
      ),
      ...(typeof doc.get("pin") === "string"
        ? { pin: doc.get("pin") as string }
        : {}),
      ...(typeof doc.get("pinHash") === "string"
        ? { pinHash: doc.get("pinHash") as string }
        : {}),
      ...(typeof doc.get("pinSalt") === "string"
        ? { pinSalt: doc.get("pinSalt") as string }
        : {}),
    };
  }
}

const stringOrNull = (value: unknown) =>
  typeof value === "string" && value ? value : null;
