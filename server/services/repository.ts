import { eq, desc, asc, sql } from 'drizzle-orm';
import { getDb } from '../db_bridge.ts';
import {
  users,
  projects,
  documents,
  approvalEvents,
  aiConversations,
  type UserRow,
  type ProjectRow,
  type DocumentRow,
  type ApprovalEventRow,
  type AiConversationRow,
} from '../../src/db/schema.ts';
import { RustFSStorageService } from './rustfs.ts';

export type PublicUser = Omit<UserRow, 'passwordHash'>;

export interface DocumentWithRelations extends DocumentRow {
  projectName: string;
  projectCode: string;
  uploadedByName: string;
  uploadedByEmail: string;
  assignedApproverName: string | null;
  assignedApproverRole: string | null;
  approvedByName: string | null;
}

export interface ApprovalEventWithActor extends ApprovalEventRow {
  actorName: string;
  actorRole: string;
}

function formatBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCommaPercent(pct: number): string {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return `${clamped.toFixed(2).replace('.', ',')}%`;
}

// In-memory store used automatically if PostgreSQL is not yet configured in environment
interface MemoryStore {
  seeded: boolean;
  nextIds: Record<string, number>;
  users: UserRow[];
  projects: ProjectRow[];
  documents: DocumentRow[];
  approvalEvents: ApprovalEventRow[];
  aiConversations: AiConversationRow[];
}

const mem: MemoryStore = {
  seeded: false,
  nextIds: {
    users: 1,
    projects: 1,
    documents: 1,
    approvalEvents: 1,
    aiConversations: 1,
  },
  users: [],
  projects: [],
  documents: [],
  approvalEvents: [],
  aiConversations: [],
};

function toPublicUser(u: UserRow): PublicUser {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

export function makeSamplePdfBuffer(title: string, projectCode: string, summaryText: string): Buffer {
  const safeText = `${title} (${projectCode}) - ${summaryText}`.replace(/[()\\]/g, ' ');
  const contentStream = `BT /F1 12 Tf 50 740 Td (${safeText.slice(0, 88)}) Tj 0 -24 Td (DocuZilla Data Room Audit Record - Verified RustFS Object) Tj ET`;
  const header = '%PDF-1.4\n';
  const obj1 = '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n';
  const obj2 = '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n';
  const obj3 = '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n';
  const obj4 = `4 0 obj << /Length ${Buffer.byteLength(contentStream, 'utf8')} >> stream\n${contentStream}\nendstream endobj\n`;
  const obj5 = '5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n';

  const o1 = Buffer.byteLength(header, 'utf8');
  const o2 = o1 + Buffer.byteLength(obj1, 'utf8');
  const o3 = o2 + Buffer.byteLength(obj2, 'utf8');
  const o4 = o3 + Buffer.byteLength(obj3, 'utf8');
  const o5 = o4 + Buffer.byteLength(obj4, 'utf8');
  const xrefStart = o5 + Buffer.byteLength(obj5, 'utf8');

  const pad = (n: number) => String(n).padStart(10, '0');
  const xref =
    `xref\n0 6\n` +
    `0000000000 65535 f \n` +
    `${pad(o1)} 00000 n \n` +
    `${pad(o2)} 00000 n \n` +
    `${pad(o3)} 00000 n \n` +
    `${pad(o4)} 00000 n \n` +
    `${pad(o5)} 00000 n \n` +
    `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(header + obj1 + obj2 + obj3 + obj4 + obj5 + xref, 'utf8');
}

export class DocuZillaRepository {
  static async seedIfEmpty(): Promise<void> {
    const db = getDb();
    if (db) {

      const existingUsers = await db.select().from(users).limit(1);
      const isFirstRunEmptyDb = existingUsers.length === 0;
      let allDbUsers = !isFirstRunEmptyDb ? await db.select().from(users).orderBy(asc(users.id)) : [];
      let allDbProjects = !isFirstRunEmptyDb ? await db.select().from(projects).orderBy(asc(projects.id)) : [];

      if (isFirstRunEmptyDb) {
        const [kerlin] = await db
          .insert(users)
          .values({
            name: 'Kerlin Kors',
            email: 'kerlin.kors@docuzilla.io',
            passwordHash: null,
            role: 'admin',
            department: 'Executive Audit',
            title: 'Managing Partner',
            managerId: null,
            canApprove: true,
            avatarInitials: 'KK',
          })
          .returning();

        const [elena] = await db
          .insert(users)
          .values({
            name: 'Elena Rostova',
            email: 'elena.rostova@docuzilla.io',
            passwordHash: null,
            role: 'manager',
            department: 'Financial Controls',
            title: 'Audit Director',
            managerId: kerlin.id,
            canApprove: true,
            avatarInitials: 'ER',
          })
          .returning();

        const [marcus] = await db
          .insert(users)
          .values({
            name: 'Marcus Vance',
            email: 'marcus.vance@docuzilla.io',
            passwordHash: null,
            role: 'manager',
            department: 'M&A Data Room',
            title: 'VP Compliance',
            managerId: kerlin.id,
            canApprove: true,
            avatarInitials: 'MV',
          })
          .returning();

        const [abhishek] = await db
          .insert(users)
          .values({
            name: 'Abhishek Patel',
            email: 'abhishek@docuzilla.io',
            passwordHash: null,
            role: 'analyst',
            department: 'Financial Controls',
            title: 'Senior Audit Analyst',
            managerId: elena.id,
            canApprove: false,
            avatarInitials: 'AP',
          })
          .returning();

        const [nadia] = await db
          .insert(users)
          .values({
            name: 'Nadia Tan',
            email: 'nadia.tan@docuzilla.io',
            passwordHash: null,
            role: 'analyst',
            department: 'M&A Data Room',
            title: 'Due Diligence Associate',
            managerId: marcus.id,
            canApprove: false,
            avatarInitials: 'NT',
          })
          .returning();

        const [david] = await db
          .insert(users)
          .values({
            name: 'David Chen',
            email: 'david.chen@docuzilla.io',
            passwordHash: null,
            role: 'auditor',
            department: 'Treasury & Tax',
            title: 'External Auditor',
            managerId: elena.id,
            canApprove: false,
            avatarInitials: 'DC',
          })
          .returning();

        allDbUsers = [kerlin, elena, marcus, abhishek, nadia, david];

        allDbProjects = await db
          .insert(projects)
          .values([
            { name: 'FY26 Q3 Consolidated Close', code: 'PRJ-2603', department: 'Financial Controls', status: 'active', ownerId: elena.id, storageUsedBytes: 0 },
            { name: 'Apex Holdings Series C Data Room', code: 'PRJ-2611', department: 'M&A Data Room', status: 'active', ownerId: marcus.id, storageUsedBytes: 0 },
            { name: 'APAC Subsidiary Tax Audit', code: 'PRJ-2614', department: 'Treasury & Tax', status: 'audit', ownerId: elena.id, storageUsedBytes: 0 },
            { name: 'Vendor Reconciliation Ledger', code: 'PRJ-2618', department: 'Financial Controls', status: 'active', ownerId: kerlin.id, storageUsedBytes: 0 },
            { name: 'SOC2 Type II Compliance Vault', code: 'PRJ-2620', department: 'Executive Audit', status: 'active', ownerId: marcus.id, storageUsedBytes: 0 },
          ])
          .returning();
      }

      const byEmail = new Map(allDbUsers.map((u) => [u.email.toLowerCase(), u]));
      const byCode = new Map(allDbProjects.map((p) => [p.code.toUpperCase(), p]));
      const abhishekUser = byEmail.get('abhishek@docuzilla.io') || allDbUsers[0];
      const elenaUser = byEmail.get('elena.rostova@docuzilla.io') || allDbUsers.find((u) => u.canApprove) || allDbUsers[0];
      const marcusUser = byEmail.get('marcus.vance@docuzilla.io') || elenaUser;
      const nadiaUser = byEmail.get('nadia.tan@docuzilla.io') || abhishekUser;
      const davidUser = byEmail.get('david.chen@docuzilla.io') || abhishekUser;

      const existingDocs = await db.select().from(documents).limit(1);
      if (
        isFirstRunEmptyDb &&
        existingDocs.length === 0 &&
        byCode.has('PRJ-2603') &&
        byCode.has('PRJ-2611') &&
        byCode.has('PRJ-2614') &&
        byCode.has('PRJ-2618') &&
        byCode.has('PRJ-2620')
      ) {
        const p2603 = byCode.get('PRJ-2603')!;
        const p2611 = byCode.get('PRJ-2611')!;
        const p2614 = byCode.get('PRJ-2614')!;
        const p2618 = byCode.get('PRJ-2618')!;
        const p2620 = byCode.get('PRJ-2620')!;

        const sampleDocsSpec = [
          {
            project: p2603,
            title: 'Q3 General Ledger Variance Report',
            fileName: 'Q3_GL_Variance_Report.pdf',
            category: 'Audit Ledger',
            uploader: abhishekUser,
            approver: elenaUser,
            status: 'pending',
            discrepancyRate: '1.42%',
            summary: 'Identified $42,180 accrued vendor variance across 3 cost centers; pending Audit Director sign-off.',
          },
          {
            project: p2603,
            title: 'October Month-End Closure Pack',
            fileName: 'Oct_Month_End_Closure.pdf',
            category: 'Month Closure',
            uploader: abhishekUser,
            approver: elenaUser,
            status: 'approved',
            discrepancyRate: '0.18%',
            summary: 'All 88 sub-ledger reconciliations balanced within materiality threshold.',
          },
          {
            project: p2611,
            title: 'Apex Capital CapTable & SPA Schedule',
            fileName: 'Apex_CapTable_SPA_Schedule.pdf',
            category: 'Legal & M&A',
            uploader: nadiaUser,
            approver: marcusUser,
            status: 'pending',
            discrepancyRate: '0.00%',
            summary: 'Fully diluted share schedule verified against Series B preferred conversion ratios.',
          },
          {
            project: p2614,
            title: 'Singapore Intercompany Transfer Pricing',
            fileName: 'SG_Transfer_Pricing_2026.pdf',
            category: 'Tax Filing',
            uploader: davidUser,
            approver: elenaUser,
            status: 'pending',
            discrepancyRate: '3.15%',
            summary: 'Flagged 3 intercompany FX conversion differences requiring controller review.',
          },
          {
            project: p2618,
            title: 'Cloud Infrastructure Invoice Reconciliation',
            fileName: 'Cloud_Invoice_Recon_Nov.pdf',
            category: 'Financial Statement',
            uploader: abhishekUser,
            approver: elenaUser,
            status: 'approved',
            discrepancyRate: '0.04%',
            summary: 'Matched 142 line items cleanly against procurement POs.',
          },
          {
            project: p2620,
            title: 'Access Control & Encryption Attestation',
            fileName: 'SOC2_Access_Attestation.pdf',
            category: 'Compliance',
            uploader: nadiaUser,
            approver: marcusUser,
            status: 'approved',
            discrepancyRate: '0.00%',
            summary: 'Zero policy exceptions noted across RustFS object encryption controls.',
          },
          {
            project: p2611,
            title: 'Customer Cohort Revenue Recognition',
            fileName: 'Revenue_Rec_ASC606.pdf',
            category: 'Financial Statement',
            uploader: nadiaUser,
            approver: marcusUser,
            status: 'rejected',
            discrepancyRate: '5.84%',
            summary: 'Deferred revenue schedule omitted 2 multi-year enterprise renewals; returned for revision.',
          },
          {
            project: p2614,
            title: 'Jakarta Entity Bank Statement Audit',
            fileName: 'JKT_Bank_Audit_Q3.pdf',
            category: 'Bank Audit',
            uploader: davidUser,
            approver: elenaUser,
            status: 'approved',
            discrepancyRate: '0.12%',
            summary: 'Bank balances reconciled to treasury cash ledger.',
          },
        ];

        for (const spec of sampleDocsSpec) {
          try {
            const buf = makeSamplePdfBuffer(spec.title, spec.project.code, spec.summary);
            const stored = await RustFSStorageService.putObject({
              projectId: spec.project.id,
              fileName: spec.fileName,
              mimeType: 'application/pdf',
              buffer: buf,
            });
            const [doc] = await db
              .insert(documents)
              .values({
                projectId: spec.project.id,
                title: spec.title,
                fileName: spec.fileName,
                mimeType: 'application/pdf',
                sizeBytes: stored.sizeBytes,
                rustfsBucket: stored.bucket,
                rustfsKey: stored.key,
                sha256: stored.sha256,
                category: spec.category,
                uploadedById: spec.uploader.id,
                assignedApproverId: spec.approver.id,
                approvalStatus: spec.status,
                approvalNote:
                  spec.status === 'approved'
                    ? 'Verified and approved in 1-level audit review.'
                    : spec.status === 'rejected'
                      ? 'ASC 606 renewal schedule incomplete. Please re-upload.'
                      : 'Awaiting 1-level manager approval.',
                approvedById: spec.status === 'approved' || spec.status === 'rejected' ? spec.approver.id : null,
                approvedAt: spec.status === 'approved' || spec.status === 'rejected' ? new Date() : null,
                discrepancyRate: spec.discrepancyRate,
                aiSummary: spec.summary,
              })
              .returning();

            await db.insert(approvalEvents).values({
              documentId: doc.id,
              actorId: spec.uploader.id,
              action: 'submitted',
              comment: `Submitted to ${spec.approver.name} for 1-level approval`,
            });
            if (spec.status === 'approved' || spec.status === 'rejected') {
              await db.insert(approvalEvents).values({
                documentId: doc.id,
                actorId: spec.approver.id,
                action: spec.status,
                comment: doc.approvalNote,
              });
            }
          } catch (seedDocErr) {
            console.warn('[DocuZilla Seed] Skipped sample document:', spec.fileName, seedDocErr instanceof Error ? seedDocErr.message : seedDocErr);
          }
        }
      }
      return;
    }

    // Memory fallback seed
    if (mem.seeded) return;
    mem.seeded = true;

    const now = new Date();
    const kerlin: UserRow = {
      id: mem.nextIds.users++,
      name: 'Kerlin Kors',
      email: 'kerlin.kors@docuzilla.io',
      passwordHash: null,
      role: 'admin',
      department: 'Executive Audit',
      title: 'Managing Partner',
      managerId: null,
      canApprove: true,
      avatarInitials: 'KK',
      createdAt: now,
    };
    const elena: UserRow = {
      id: mem.nextIds.users++,
      name: 'Elena Rostova',
      email: 'elena.rostova@docuzilla.io',
      passwordHash: null,
      role: 'manager',
      department: 'Financial Controls',
      title: 'Audit Director',
      managerId: kerlin.id,
      canApprove: true,
      avatarInitials: 'ER',
      createdAt: now,
    };
    const marcus: UserRow = {
      id: mem.nextIds.users++,
      name: 'Marcus Vance',
      email: 'marcus.vance@docuzilla.io',
      passwordHash: null,
      role: 'manager',
      department: 'M&A Data Room',
      title: 'VP Compliance',
      managerId: kerlin.id,
      canApprove: true,
      avatarInitials: 'MV',
      createdAt: now,
    };
    const abhishek: UserRow = {
      id: mem.nextIds.users++,
      name: 'Abhishek Patel',
      email: 'abhishek@docuzilla.io',
      passwordHash: null,
      role: 'analyst',
      department: 'Financial Controls',
      title: 'Senior Audit Analyst',
      managerId: elena.id,
      canApprove: false,
      avatarInitials: 'AP',
      createdAt: now,
    };
    const nadia: UserRow = {
      id: mem.nextIds.users++,
      name: 'Nadia Tan',
      email: 'nadia.tan@docuzilla.io',
      passwordHash: null,
      role: 'analyst',
      department: 'M&A Data Room',
      title: 'Due Diligence Associate',
      managerId: marcus.id,
      canApprove: false,
      avatarInitials: 'NT',
      createdAt: now,
    };
    const david: UserRow = {
      id: mem.nextIds.users++,
      name: 'David Chen',
      email: 'david.chen@docuzilla.io',
      passwordHash: null,
      role: 'auditor',
      department: 'Treasury & Tax',
      title: 'External Auditor',
      managerId: elena.id,
      canApprove: false,
      avatarInitials: 'DC',
      createdAt: now,
    };
    mem.users.push(kerlin, elena, marcus, abhishek, nadia, david);

    const p1: ProjectRow = { id: mem.nextIds.projects++, name: 'FY26 Q3 Consolidated Close', code: 'PRJ-2603', department: 'Financial Controls', status: 'active', ownerId: elena.id, storageUsedBytes: 0, createdAt: now };
    const p2: ProjectRow = { id: mem.nextIds.projects++, name: 'Apex Holdings Series C Data Room', code: 'PRJ-2611', department: 'M&A Data Room', status: 'active', ownerId: marcus.id, storageUsedBytes: 0, createdAt: now };
    const p3: ProjectRow = { id: mem.nextIds.projects++, name: 'APAC Subsidiary Tax Audit', code: 'PRJ-2614', department: 'Treasury & Tax', status: 'audit', ownerId: elena.id, storageUsedBytes: 0, createdAt: now };
    const p4: ProjectRow = { id: mem.nextIds.projects++, name: 'Vendor Reconciliation Ledger', code: 'PRJ-2618', department: 'Financial Controls', status: 'active', ownerId: kerlin.id, storageUsedBytes: 0, createdAt: now };
    const p5: ProjectRow = { id: mem.nextIds.projects++, name: 'SOC2 Type II Compliance Vault', code: 'PRJ-2620', department: 'Executive Audit', status: 'active', ownerId: marcus.id, storageUsedBytes: 0, createdAt: now };
    mem.projects.push(p1, p2, p3, p4, p5);

    const sampleDocsSpec = [
      { project: p1, title: 'Q3 General Ledger Variance Report', fileName: 'Q3_GL_Variance_Report.pdf', category: 'Audit Ledger', uploader: abhishek, approver: elena, status: 'pending', discrepancyRate: '1.42%', summary: 'Identified $42,180 accrued vendor variance across 3 cost centers; pending Audit Director sign-off.' },
      { project: p1, title: 'October Month-End Closure Pack', fileName: 'Oct_Month_End_Closure.pdf', category: 'Month Closure', uploader: abhishek, approver: elena, status: 'approved', discrepancyRate: '0.18%', summary: 'All 88 sub-ledger reconciliations balanced within materiality threshold.' },
      { project: p2, title: 'Apex Capital CapTable & SPA Schedule', fileName: 'Apex_CapTable_SPA_Schedule.pdf', category: 'Legal & M&A', uploader: nadia, approver: marcus, status: 'pending', discrepancyRate: '0.00%', summary: 'Fully diluted share schedule verified against Series B preferred conversion ratios.' },
      { project: p3, title: 'Singapore Intercompany Transfer Pricing', fileName: 'SG_Transfer_Pricing_2026.pdf', category: 'Tax Filing', uploader: david, approver: elena, status: 'pending', discrepancyRate: '3.15%', summary: 'Flagged 3 intercompany FX conversion differences requiring controller review.' },
      { project: p4, title: 'Cloud Infrastructure Invoice Reconciliation', fileName: 'Cloud_Invoice_Recon_Nov.pdf', category: 'Financial Statement', uploader: abhishek, approver: elena, status: 'approved', discrepancyRate: '0.04%', summary: 'Matched 142 line items cleanly against procurement POs.' },
      { project: p5, title: 'Access Control & Encryption Attestation', fileName: 'SOC2_Access_Attestation.pdf', category: 'Compliance', uploader: nadia, approver: marcus, status: 'approved', discrepancyRate: '0.00%', summary: 'Zero policy exceptions noted across RustFS object encryption controls.' },
      { project: p2, title: 'Customer Cohort Revenue Recognition', fileName: 'Revenue_Rec_ASC606.pdf', category: 'Financial Statement', uploader: nadia, approver: marcus, status: 'rejected', discrepancyRate: '5.84%', summary: 'Deferred revenue schedule omitted 2 multi-year enterprise renewals; returned for revision.' },
      { project: p3, title: 'Jakarta Entity Bank Statement Audit', fileName: 'JKT_Bank_Audit_Q3.pdf', category: 'Bank Audit', uploader: david, approver: elena, status: 'approved', discrepancyRate: '0.12%', summary: 'Bank balances reconciled to treasury cash ledger.' },
    ];

    for (const spec of sampleDocsSpec) {
      const buf = makeSamplePdfBuffer(spec.title, spec.project.code, spec.summary);
      const stored = await RustFSStorageService.putObject({
        projectId: spec.project.id,
        fileName: spec.fileName,
        mimeType: 'application/pdf',
        buffer: buf,
      });
      const docId = mem.nextIds.documents++;
      const doc: DocumentRow = {
        id: docId,
        projectId: spec.project.id,
        title: spec.title,
        fileName: spec.fileName,
        mimeType: 'application/pdf',
        sizeBytes: stored.sizeBytes,
        rustfsBucket: stored.bucket,
        rustfsKey: stored.key,
        sha256: stored.sha256,
        category: spec.category,
        uploadedById: spec.uploader.id,
        assignedApproverId: spec.approver.id,
        approvalStatus: spec.status,
        approvalNote:
          spec.status === 'approved'
            ? 'Verified and approved in 1-level audit review.'
            : spec.status === 'rejected'
              ? 'ASC 606 renewal schedule incomplete. Please re-upload.'
              : 'Awaiting 1-level manager approval.',
        approvedById: spec.status === 'approved' || spec.status === 'rejected' ? spec.approver.id : null,
        approvedAt: spec.status === 'approved' || spec.status === 'rejected' ? now : null,
        discrepancyRate: spec.discrepancyRate,
        aiSummary: spec.summary,
        createdAt: now,
        updatedAt: now,
      };
      mem.documents.push(doc);
      mem.approvalEvents.push({
        id: mem.nextIds.approvalEvents++,
        documentId: docId,
        actorId: spec.uploader.id,
        action: 'submitted',
        comment: `Submitted to ${spec.approver.name} for 1-level approval`,
        createdAt: now,
      });
      if (spec.status === 'approved' || spec.status === 'rejected') {
        mem.approvalEvents.push({
          id: mem.nextIds.approvalEvents++,
          documentId: docId,
          actorId: spec.approver.id,
          action: spec.status,
          comment: doc.approvalNote,
          createdAt: now,
        });
      }
    }
  }

  static async listUsers(): Promise<PublicUser[]> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(users).orderBy(asc(users.id));
      return rows.map(toPublicUser);
    }
    return [...mem.users].sort((a, b) => a.id - b.id).map(toPublicUser);
  }

  static async getUserById(id: number): Promise<UserRow | null> {
    const db = getDb();
    if (db) {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    }
    return mem.users.find((u) => u.id === id) ?? null;
  }

  static async getUserByEmail(email: string): Promise<UserRow | null> {
    const normalized = email.trim().toLowerCase();
    const db = getDb();
    if (db) {
      const [row] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
      return row ?? null;
    }
    return mem.users.find((u) => u.email.toLowerCase() === normalized) ?? null;
  }

  static async hasPasswordProtectedAdmin(): Promise<boolean> {
    const db = getDb();
    if (db) {
      const rows = await db.select().from(users).where(eq(users.role, 'admin'));
      return rows.some((u) => Boolean(u.passwordHash));
    }
    return mem.users.some((u) => u.role === 'admin' && Boolean(u.passwordHash));
  }

  static async claimOrSetPassword(userId: number, passwordHash: string): Promise<PublicUser | null> {
    const db = getDb();
    if (db) {
      const [updated] = await db
        .update(users)
        .set({ passwordHash })
        .where(eq(users.id, userId))
        .returning();
      return updated ? toPublicUser(updated) : null;
    }
    const u = mem.users.find((x) => x.id === userId);
    if (!u) return null;
    u.passwordHash = passwordHash;
    return toPublicUser(u);
  }

  static async createUser(input: {
    name: string;
    email: string;
    passwordHash: string;
    role: string;
    department: string;
    title: string;
    managerId: number | null;
    canApprove: boolean;
  }): Promise<PublicUser> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const initials = input.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() || '')
      .join('') || 'DZ';

    const db = getDb();
    if (db) {
      const [created] = await db
        .insert(users)
        .values({
          name: input.name.trim(),
          email: normalizedEmail,
          passwordHash: input.passwordHash,
          role: input.role,
          department: input.department,
          title: input.title,
          managerId: input.managerId,
          canApprove: input.canApprove,
          avatarInitials: initials,
        })
        .returning();
      return toPublicUser(created);
    }

    const row: UserRow = {
      id: mem.nextIds.users++,
      name: input.name.trim(),
      email: normalizedEmail,
      passwordHash: input.passwordHash,
      role: input.role,
      department: input.department,
      title: input.title,
      managerId: input.managerId,
      canApprove: input.canApprove,
      avatarInitials: initials,
      createdAt: new Date(),
    };
    mem.users.push(row);
    return toPublicUser(row);
  }

  static async updateUserHierarchy(
    userId: number,
    patch: {
      managerId?: number | null;
      canApprove?: boolean;
      role?: string;
      department?: string;
      title?: string;
    },
  ): Promise<PublicUser | null> {
    const allUsers = await this.listUsers();
    if (patch.managerId !== undefined && patch.managerId !== null) {
      if (patch.managerId === userId) {
        throw new Error('A user cannot be their own direct manager.');
      }
      // Cycle check up the hierarchy chain
      let cursor: number | null = patch.managerId;
      const visited = new Set<number>([userId]);
      while (cursor !== null) {
        if (visited.has(cursor)) {
          throw new Error('Circular reporting hierarchy detected.');
        }
        visited.add(cursor);
        const parent = allUsers.find((u) => u.id === cursor);
        cursor = parent ? parent.managerId : null;
      }
    }

    const db = getDb();
    if (db) {
      const updateSet: Partial<UserRow> = {};
      if (patch.managerId !== undefined) updateSet.managerId = patch.managerId;
      if (patch.canApprove !== undefined) updateSet.canApprove = patch.canApprove;
      if (patch.role !== undefined) updateSet.role = patch.role;
      if (patch.department !== undefined) updateSet.department = patch.department;
      if (patch.title !== undefined) updateSet.title = patch.title;

      const [updated] = await db
        .update(users)
        .set(updateSet)
        .where(eq(users.id, userId))
        .returning();
      return updated ? toPublicUser(updated) : null;
    }

    const u = mem.users.find((x) => x.id === userId);
    if (!u) return null;
    if (patch.managerId !== undefined) u.managerId = patch.managerId;
    if (patch.canApprove !== undefined) u.canApprove = patch.canApprove;
    if (patch.role !== undefined) u.role = patch.role;
    if (patch.department !== undefined) u.department = patch.department;
    if (patch.title !== undefined) u.title = patch.title;
    return toPublicUser(u);
  }

  static async listProjects(): Promise<Array<ProjectRow & { ownerName: string | null; docCount: number; pendingCount: number }>> {
    const allUsers = await this.listUsers();
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const db = getDb();
    const projs = db
      ? await db.select().from(projects).orderBy(desc(projects.id))
      : [...mem.projects].sort((a, b) => b.id - a.id);
    const docs = db ? await db.select().from(documents) : mem.documents;

    return projs.map((p) => {
      const projDocs = docs.filter((d) => d.projectId === p.id);
      const realBytes = projDocs.reduce((sum, d) => sum + d.sizeBytes, 0);
      const pendingCount = projDocs.filter((d) => d.approvalStatus === 'pending').length;
      return {
        ...p,
        storageUsedBytes: realBytes,
        ownerName: p.ownerId ? userMap.get(p.ownerId)?.name ?? null : null,
        docCount: projDocs.length,
        pendingCount,
      };
    });
  }

  static async createProject(input: {
    name: string;
    code: string;
    department: string;
    ownerId: number;
  }): Promise<ProjectRow> {
    const db = getDb();
    if (db) {
      const [created] = await db
        .insert(projects)
        .values({
          name: input.name.trim(),
          code: input.code.trim().toUpperCase(),
          department: input.department.trim(),
          status: 'active',
          ownerId: input.ownerId,
          storageUsedBytes: 0,
        })
        .returning();
      return created;
    }
    const row: ProjectRow = {
      id: mem.nextIds.projects++,
      name: input.name.trim(),
      code: input.code.trim().toUpperCase(),
      department: input.department.trim(),
      status: 'active',
      ownerId: input.ownerId,
      storageUsedBytes: 0,
      createdAt: new Date(),
    };
    mem.projects.push(row);
    return row;
  }

  static async listDocuments(filters?: {
    projectId?: number;
    status?: string;
    assignedApproverId?: number;
    search?: string;
  }): Promise<DocumentWithRelations[]> {
    const allUsers = await this.listUsers();
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const db = getDb();
    const projs = db ? await db.select().from(projects) : mem.projects;
    const projMap = new Map(projs.map((p) => [p.id, p]));
    const rows = db
      ? await db.select().from(documents).orderBy(desc(documents.updatedAt), desc(documents.id))
      : [...mem.documents].sort((a, b) => b.id - a.id);

    const searchQ = filters?.search?.trim().toLowerCase();
    return rows
      .filter((d) => {
        if (filters?.projectId && d.projectId !== filters.projectId) return false;
        if (filters?.status && filters.status !== 'all' && d.approvalStatus !== filters.status) return false;
        if (filters?.assignedApproverId && d.assignedApproverId !== filters.assignedApproverId) return false;
        if (searchQ) {
          const projName = projMap.get(d.projectId)?.name.toLowerCase() || '';
          const match =
            d.title.toLowerCase().includes(searchQ) ||
            d.fileName.toLowerCase().includes(searchQ) ||
            d.category.toLowerCase().includes(searchQ) ||
            projName.includes(searchQ);
          if (!match) return false;
        }
        return true;
      })
      .map((d) => {
        const proj = projMap.get(d.projectId);
        const uploader = userMap.get(d.uploadedById);
        const approver = d.assignedApproverId ? userMap.get(d.assignedApproverId) : undefined;
        const approvedBy = d.approvedById ? userMap.get(d.approvedById) : undefined;
        return {
          ...d,
          projectName: proj?.name || 'Data Room',
          projectCode: proj?.code || 'PRJ',
          uploadedByName: uploader?.name || 'Member',
          uploadedByEmail: uploader?.email || '',
          assignedApproverName: approver?.name || null,
          assignedApproverRole: approver?.title || approver?.role || null,
          approvedByName: approvedBy?.name || null,
        };
      });
  }

  static async getDocumentById(id: number): Promise<DocumentWithRelations | null> {
    const all = await this.listDocuments();
    return all.find((d) => d.id === id) ?? null;
  }

  static async createDocument(input: {
    projectId: number;
    title: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    rustfsBucket: string;
    rustfsKey: string;
    sha256: string;
    category: string;
    uploadedById: number;
    assignedApproverId: number | null;
    approvalStatus: 'draft' | 'pending';
    aiSummary?: string | null;
  }): Promise<DocumentWithRelations> {
    const db = getDb();
    let createdId: number;
    if (db) {
      const [created] = await db
        .insert(documents)
        .values({
          projectId: input.projectId,
          title: input.title.trim(),
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          rustfsBucket: input.rustfsBucket,
          rustfsKey: input.rustfsKey,
          sha256: input.sha256,
          category: input.category,
          uploadedById: input.uploadedById,
          assignedApproverId: input.assignedApproverId,
          approvalStatus: input.approvalStatus,
          approvalNote:
            input.approvalStatus === 'pending'
              ? 'Submitted for 1-level approval.'
              : 'Saved as draft in RustFS vault.',
          aiSummary: input.aiSummary ?? null,
        })
        .returning();
      createdId = created.id;

      await db
        .update(projects)
        .set({
          storageUsedBytes: sql`${projects.storageUsedBytes} + ${input.sizeBytes}`,
        })
        .where(eq(projects.id, input.projectId));

      await db.insert(approvalEvents).values({
        documentId: created.id,
        actorId: input.uploadedById,
        action: input.approvalStatus === 'pending' ? 'submitted' : 'uploaded',
        comment:
          input.approvalStatus === 'pending'
            ? 'Uploaded to RustFS and submitted for 1-level approval'
            : 'Uploaded to RustFS as draft',
      });
    } else {
      const now = new Date();
      const row: DocumentRow = {
        id: mem.nextIds.documents++,
        projectId: input.projectId,
        title: input.title.trim(),
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        rustfsBucket: input.rustfsBucket,
        rustfsKey: input.rustfsKey,
        sha256: input.sha256,
        category: input.category,
        uploadedById: input.uploadedById,
        assignedApproverId: input.assignedApproverId,
        approvalStatus: input.approvalStatus,
        approvalNote:
          input.approvalStatus === 'pending'
            ? 'Submitted for 1-level approval.'
            : 'Saved as draft in RustFS vault.',
        approvedById: null,
        approvedAt: null,
        discrepancyRate: '0.00%',
        aiSummary: input.aiSummary ?? null,
        createdAt: now,
        updatedAt: now,
      };
      mem.documents.push(row);
      createdId = row.id;

      const proj = mem.projects.find((p) => p.id === input.projectId);
      if (proj) {
        proj.storageUsedBytes += input.sizeBytes;
      }

      mem.approvalEvents.push({
        id: mem.nextIds.approvalEvents++,
        documentId: row.id,
        actorId: input.uploadedById,
        action: input.approvalStatus === 'pending' ? 'submitted' : 'uploaded',
        comment:
          input.approvalStatus === 'pending'
            ? 'Uploaded to RustFS and submitted for 1-level approval'
            : 'Uploaded to RustFS as draft',
        createdAt: now,
      });
    }

    const enriched = await this.getDocumentById(createdId);
    if (!enriched) throw new Error('Failed to retrieve created document');
    return enriched;
  }

  static async deleteDocument(documentId: number): Promise<DocumentWithRelations | null> {
    const existing = await this.getDocumentById(documentId);
    if (!existing) return null;

    const db = getDb();
    if (db) {
      await db.delete(documents).where(eq(documents.id, documentId));
      await db
        .update(projects)
        .set({
          storageUsedBytes: sql`GREATEST(0, ${projects.storageUsedBytes} - ${existing.sizeBytes})`,
        })
        .where(eq(projects.id, existing.projectId));
    } else {
      const idx = mem.documents.findIndex((d) => d.id === documentId);
      if (idx !== -1) mem.documents.splice(idx, 1);
      const proj = mem.projects.find((p) => p.id === existing.projectId);
      if (proj) {
        proj.storageUsedBytes = Math.max(0, proj.storageUsedBytes - existing.sizeBytes);
      }
      mem.approvalEvents = mem.approvalEvents.filter((e) => e.documentId !== documentId);
    }

    return existing;
  }

  static async submitDocumentForApproval(
    documentId: number,
    actorId: number,
    approverId: number | null,
  ): Promise<DocumentWithRelations> {
    const db = getDb();
    if (db) {
      await db
        .update(documents)
        .set({
          approvalStatus: 'pending',
          assignedApproverId: approverId,
          approvalNote: 'Submitted for 1-level approval.',
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId));
      await db.insert(approvalEvents).values({
        documentId,
        actorId,
        action: 'submitted',
        comment: 'Submitted for 1-level manager approval',
      });
    } else {
      const doc = mem.documents.find((d) => d.id === documentId);
      if (!doc) throw new Error('Document not found');
      doc.approvalStatus = 'pending';
      doc.assignedApproverId = approverId;
      doc.approvalNote = 'Submitted for 1-level approval.';
      doc.updatedAt = new Date();
      mem.approvalEvents.push({
        id: mem.nextIds.approvalEvents++,
        documentId,
        actorId,
        action: 'submitted',
        comment: 'Submitted for 1-level manager approval',
        createdAt: new Date(),
      });
    }

    const updated = await this.getDocumentById(documentId);
    if (!updated) throw new Error('Document not found');
    return updated;
  }

  static async decideDocument(params: {
    documentId: number;
    actorId: number;
    decision: 'approved' | 'rejected';
    comment?: string;
  }): Promise<DocumentWithRelations> {
    const note =
      params.comment?.trim() ||
      (params.decision === 'approved'
        ? 'Approved in 1-level compliance review.'
        : 'Returned for revision.');
    const now = new Date();

    const db = getDb();
    if (db) {
      await db
        .update(documents)
        .set({
          approvalStatus: params.decision,
          approvalNote: note,
          approvedById: params.actorId,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(documents.id, params.documentId));

      await db.insert(approvalEvents).values({
        documentId: params.documentId,
        actorId: params.actorId,
        action: params.decision,
        comment: note,
      });
    } else {
      const doc = mem.documents.find((d) => d.id === params.documentId);
      if (!doc) throw new Error('Document not found');
      doc.approvalStatus = params.decision;
      doc.approvalNote = note;
      doc.approvedById = params.actorId;
      doc.approvedAt = now;
      doc.updatedAt = now;
      mem.approvalEvents.push({
        id: mem.nextIds.approvalEvents++,
        documentId: params.documentId,
        actorId: params.actorId,
        action: params.decision,
        comment: note,
        createdAt: now,
      });
    }

    const updated = await this.getDocumentById(params.documentId);
    if (!updated) throw new Error('Document not found');
    return updated;
  }

  static async updateDocumentAiSummary(documentId: number, summary: string, actorId: number): Promise<void> {
    const db = getDb();
    if (db) {
      await db
        .update(documents)
        .set({ aiSummary: summary, updatedAt: new Date() })
        .where(eq(documents.id, documentId));
      await db.insert(approvalEvents).values({
        documentId,
        actorId,
        action: 'ai_analyzed',
        comment: 'Processed PDF via DocuZilla AI Assistant',
      });
    } else {
      const doc = mem.documents.find((d) => d.id === documentId);
      if (doc) {
        doc.aiSummary = summary;
        doc.updatedAt = new Date();
      }
      mem.approvalEvents.push({
        id: mem.nextIds.approvalEvents++,
        documentId,
        actorId,
        action: 'ai_analyzed',
        comment: 'Processed PDF via DocuZilla AI Assistant',
        createdAt: new Date(),
      });
    }
  }

  static async listApprovalEvents(documentId: number): Promise<ApprovalEventWithActor[]> {
    const allUsers = await this.listUsers();
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const db = getDb();
    const rows = db
      ? await db
          .select()
          .from(approvalEvents)
          .where(eq(approvalEvents.documentId, documentId))
          .orderBy(desc(approvalEvents.createdAt))
      : mem.approvalEvents
          .filter((e) => e.documentId === documentId)
          .sort((a, b) => b.id - a.id);

    return rows.map((e) => {
      const actor = userMap.get(e.actorId);
      return {
        ...e,
        actorName: actor?.name || 'System',
        actorRole: actor?.title || actor?.role || 'Member',
      };
    });
  }

  static async listAiMessages(): Promise<AiConversationRow[]> {
    const db = getDb();
    if (db) {
      return db.select().from(aiConversations).orderBy(asc(aiConversations.id)).limit(40);
    }
    return [...mem.aiConversations].slice(-40);
  }

  static async addAiMessage(input: {
    userId: number | null;
    documentId?: number | null;
    role: 'user' | 'assistant';
    mode: string;
    content: string;
    attachmentName?: string | null;
  }): Promise<AiConversationRow> {
    const db = getDb();
    if (db) {
      const [created] = await db
        .insert(aiConversations)
        .values({
          userId: input.userId,
          documentId: input.documentId ?? null,
          role: input.role,
          mode: input.mode,
          content: input.content,
          attachmentName: input.attachmentName ?? null,
        })
        .returning();
      return created;
    }
    const row: AiConversationRow = {
      id: mem.nextIds.aiConversations++,
      userId: input.userId,
      documentId: input.documentId ?? null,
      role: input.role,
      mode: input.mode,
      content: input.content,
      attachmentName: input.attachmentName ?? null,
      createdAt: new Date(),
    };
    mem.aiConversations.push(row);
    return row;
  }

  static async getDashboardSummary() {
    const db = getDb();
    const [allUsers, allProjects, allDocs, allEvents, allAiMsgs] = await Promise.all([
      this.listUsers(),
      this.listProjects(),
      this.listDocuments(),
      db ? db.select().from(approvalEvents).orderBy(asc(approvalEvents.createdAt)) : Promise.resolve([...mem.approvalEvents]),
      db ? db.select().from(aiConversations).orderBy(asc(aiConversations.createdAt)) : Promise.resolve([...mem.aiConversations]),
    ]);

    const totalDocs = allDocs.length;
    const totalBytes = allDocs.reduce((acc, d) => acc + d.sizeBytes, 0);
    const pendingCount = allDocs.filter((d) => d.approvalStatus === 'pending').length;
    const approvedCount = allDocs.filter((d) => d.approvalStatus === 'approved').length;
    const rejectedCount = allDocs.filter((d) => d.approvalStatus === 'rejected').length;
    const activeProjectsCount = allProjects.filter((p) => p.status !== 'archived').length;

    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentProjects = allProjects.filter((p) => new Date(p.createdAt).getTime() >= sevenDaysAgoMs).length;
    const recentUsers = allUsers.filter((u) => new Date(u.createdAt).getTime() >= sevenDaysAgoMs).length;
    const recentDocs = allDocs.filter((d) => new Date(d.createdAt).getTime() >= sevenDaysAgoMs);
    const recentBytes = recentDocs.reduce((acc, d) => acc + d.sizeBytes, 0);

    const pctDelta = (part: number, total: number) =>
      total > 0 ? `${Math.round((part / total) * 100)}%` : '0%';

    // Helper: build trailing N-day bar buckets normalized 0..100 from real timestamps
    const buildDailySeries = (items: Array<{ date: Date | string; weight?: number }>, days: number) => {
      const now = new Date();
      const dayKeys: string[] = [];
      const totals = new Map<string, number>();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().slice(0, 10);
        dayKeys.push(key);
        totals.set(key, 0);
      }
      for (const item of items) {
        const key = new Date(item.date).toISOString().slice(0, 10);
        if (totals.has(key)) {
          totals.set(key, (totals.get(key) || 0) + (item.weight ?? 1));
        }
      }
      const raw = dayKeys.map((k) => totals.get(k) || 0);
      const maxVal = Math.max(0, ...raw);
      const bars = raw.map((v) => (maxVal > 0 ? Math.round((v / maxVal) * 100) : 0));
      return { dayKeys, raw, bars, maxVal };
    };

    // 1. Document Uploads (trailing 14 days from real documents.createdAt)
    const uploadSeries = buildDailySeries(
      allDocs.map((d) => ({ date: d.createdAt, weight: 1 })),
      14,
    );
    const submittedOrApproved = approvedCount + pendingCount;
    const uploadHeadlinePct = totalDocs > 0 ? (submittedOrApproved / totalDocs) * 100 : 0;

    // 2. Data Processed (docs with AI summary or completed approval review)
    const processedDocs = allDocs.filter(
      (d) => Boolean(d.aiSummary?.trim()) || d.approvalStatus === 'approved' || d.approvalStatus === 'rejected',
    );
    const processedPct = totalDocs > 0 ? (processedDocs.length / totalDocs) * 100 : 0;
    const processedSeries = buildDailySeries(
      allDocs.map((d) => ({ date: d.createdAt, weight: d.sizeBytes })),
      14,
    );

    // 3. Discrepancies (computed from real documents.discrepancyRate)
    const parsedRates = allDocs.map((d) => {
      const num = parseFloat(String(d.discrepancyRate || '0').replace('%', '').trim());
      return Number.isFinite(num) ? Math.max(0, num) : 0;
    });
    const avgDiscrepancy =
      parsedRates.length > 0 ? parsedRates.reduce((a, b) => a + b, 0) / parsedRates.length : 0;
    const maxDiscrepancy = parsedRates.length > 0 ? Math.max(...parsedRates) : 0;
    const minDiscrepancy = parsedRates.length > 0 ? Math.min(...parsedRates) : 0;
    const discrepancyBars =
      parsedRates.length > 0
        ? parsedRates.slice(0, 14).map((r) => (maxDiscrepancy > 0 ? Math.round((r / maxDiscrepancy) * 100) : 0))
        : new Array(14).fill(0);

    // 4. On-Time Month Closures / Approval Completion (real documents & approvalEvents)
    const approvalCompletionPct = totalDocs > 0 ? (approvedCount / totalDocs) * 100 : 0;
    const closureSeries = buildDailySeries(
      [
        ...allDocs.map((d) => ({ date: d.createdAt, weight: 1 })),
        ...allEvents.map((e) => ({ date: e.createdAt, weight: 1 })),
      ],
      20,
    );
    const redIndices: number[] = [];
    const closurePins: Array<{ index: number; type: 'up' | 'down'; label: string }> = [];
    closureSeries.dayKeys.forEach((dayKey, idx) => {
      const dayEvents = allEvents.filter(
        (e) => new Date(e.createdAt).toISOString().slice(0, 10) === dayKey,
      );
      const dayRejects = dayEvents.filter((e) => e.action === 'rejected').length;
      const dayApproves = dayEvents.filter((e) => e.action === 'approved').length;
      if (dayRejects > 0) {
        redIndices.push(idx);
        closurePins.push({ index: idx, type: 'down', label: `${dayRejects} rejected (${dayKey})` });
      } else if (dayApproves > 0 && closurePins.length < 3) {
        closurePins.push({ index: idx, type: 'up', label: `${dayApproves} approved (${dayKey})` });
      }
    });

    // 5. Usage Rate (AI queries + audit trail activity across workspace)
    const aiSummarizedCount = allDocs.filter((d) => Boolean(d.aiSummary?.trim())).length;
    const aiCoveragePct = totalDocs > 0 ? Math.round((aiSummarizedCount / totalDocs) * 100) : 0;
    const usageEngagementPct =
      totalDocs > 0
        ? Math.min(100, ((allEvents.length + allAiMsgs.length) / Math.max(1, totalDocs * 3)) * 100)
        : 0;
    const usageSeries = buildDailySeries(
      [
        ...allEvents.map((e) => ({ date: e.createdAt, weight: 1 })),
        ...allAiMsgs.map((m) => ({ date: m.createdAt, weight: 1 })),
      ],
      20,
    );

    const analyticsMap = {
      document_uploads: {
        headlineValue: formatCommaPercent(uploadHeadlinePct),
        deltaDirection: 'up',
        series: {
          minLabel: `${Math.min(...uploadSeries.raw)} docs/d`,
          maxLabel: `${totalDocs} total`,
          bars: uploadSeries.bars,
        },
        subMetrics: null,
      },
      data_processed: {
        headlineValue: formatCommaPercent(processedPct),
        deltaDirection: 'up',
        series: {
          minLabel: '0 B',
          maxLabel: formatBytesLabel(totalBytes),
          bars: processedSeries.bars,
        },
        subMetrics: null,
      },
      discrepancies: {
        headlineValue: formatCommaPercent(avgDiscrepancy),
        deltaDirection: avgDiscrepancy > 2 ? 'down' : 'up',
        series: {
          minLabel: `${minDiscrepancy.toFixed(2)}% min`,
          maxLabel: `${maxDiscrepancy.toFixed(2)}% max`,
          bars: discrepancyBars,
        },
        subMetrics: null,
      },
      month_closures: {
        headlineValue: formatCommaPercent(approvalCompletionPct),
        deltaDirection: rejectedCount > approvedCount ? 'down' : 'up',
        series: {
          bars: closureSeries.bars,
          redIndices,
          pins: closurePins.slice(0, 3),
        },
        subMetrics: [
          { value: String(approvedCount), label: 'Approved', badge: 'up' as const },
          { value: String(pendingCount), label: 'Pending', badge: 'warn' as const },
          { value: String(rejectedCount), label: 'Rejected', badge: 'alert' as const },
          { value: String(totalDocs), label: 'Total Docs', badge: 'up' as const },
        ],
      },
      usage_rate: {
        headlineValue: formatCommaPercent(usageEngagementPct),
        deltaDirection: 'up',
        series: {
          bars: usageSeries.bars,
          redIndices: [],
          pins: [],
        },
        subMetrics: [
          { value: `${aiCoveragePct}%`, label: 'AI Summarized', badge: 'up' as const },
          { value: String(allEvents.length), label: 'Audit Events', badge: 'up' as const },
          { value: String(allAiMsgs.filter((m) => m.role === 'user').length), label: 'AI Queries', badge: 'warn' as const },
          { value: String(activeProjectsCount), label: 'Active Rooms', badge: 'up' as const },
        ],
      },
    };

    return {
      kpis: {
        activeProjects: activeProjectsCount,
        activeProjectsDelta: pctDelta(recentProjects, allProjects.length),
        totalUsers: allUsers.length,
        totalUsersDelta: pctDelta(recentUsers, allUsers.length),
        totalDocuments: totalDocs,
        totalDocumentsDelta: pctDelta(recentDocs.length, totalDocs),
        dataRoomSizeGb: Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2)),
        dataRoomSizeBytes: totalBytes,
        dataRoomSizeFormatted: formatBytesLabel(totalBytes),
        dataRoomSizeDelta: pctDelta(recentBytes, totalBytes),
        pendingReviews: pendingCount,
      },
      analytics: analyticsMap,
      storageBackend: RustFSStorageService.getStorageMode(),
      storageBucket: RustFSStorageService.getBucketName(),
    };
  }
}
