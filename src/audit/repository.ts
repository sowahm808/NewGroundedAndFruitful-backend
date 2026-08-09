import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
export class AuditRepository {
  constructor(private db: Firestore) {}
  async record(event: string, data: Record<string, unknown>) {
    await this.db
      .collection("auditLogs")
      .add({ event, ...data, createdAt: FieldValue.serverTimestamp() });
  }
}
