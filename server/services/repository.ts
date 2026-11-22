import { eq, desc, asc, sql } from 'drizzle-orm';
import { getDb } from '../db_bridge.ts';
import {
  users,
  projects,
  documents,
  approvalEvents,
  aiConversations,
  analyticsSnapshots,
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

// Baseline historical volume so KPI counters match enterprise archive scale
// while reacting live to newly created projects, users, uploads, and approvals.
const BASELINE = {
  projectsOffset: 19, // 5 seeded + 19 = 24
  usersOffset: 180,   // 6 seeded + 180 = 186
  docsOffset: 8634,   // 8 seeded + 8634 = 8,642
  sizeGbOffset: 428,
  pendingOffset: 14,  // 3 seeded pending + 14 = 17
};

// In-memory store used automatically if PostgreSQL is not yet configured in environment
interface MemoryStore {
  seeded: boolean;
  nextIds: Record<string, number>;
  users: UserRow[];
  projects: ProjectRow[];
  documents: DocumentRow[];
  approvalEvents: ApprovalEventRow[];
  aiConversations: AiConversationRow[];
  analytics: Array<{
    metricKey: string;
    headlineValue: string;
    deltaDirection: string;
    seriesJson: string;
    subMetricsJson: string | null;
  }>;
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
  analytics: [],
};

function toPublicUser(u: UserRow): PublicUser {
  const { passwordHash: _omit, ...rest } = u;
  return rest;
}

function getDefaultAnalyticsSeed() {
  return [
    {
      metricKey: 'document_uploads',
      headlineValue: '72,52%',
      deltaDirection: 'up',
      seriesJson: JSON.stringify({
        minLabel: '15.6K',
        maxLabel: '17K',
        bars: [22, 34, 42, 38, 52, 64, 72, 85, 78, 92, 80, 68, 76, 62, 54, 48, 58, 46, 36, 42, 34, 28],
      }),
      subMetricsJson: null,
    },
    {
      metricKey: 'data_processed',
      headlineValue: '61,23%',
      deltaDirection: 'up',
      seriesJson: JSON.stringify({
        minLabel: '183 GB',
        maxLabel: '240 GB',
        bars: [18, 28, 36, 48, 58, 74, 88, 92, 84, 76, 82, 74, 68, 62, 56, 48, 42, 38, 32, 26, 22, 18],
      }),
      subMetricsJson: null,
    },
    {
      metricKey: 'discrepancies',
      headlineValue: '13,78%',
      deltaDirection: 'down',
      seriesJson: JSON.stringify({
        minLabel: '2.9K',
        maxLabel: '11.5K',
        bars: [32, 46, 58, 76, 84, 92, 82, 74, 68, 72, 64, 58, 54, 46, 40, 34, 30, 26, 22, 18, 16, 14],
      }),
      subMetricsJson: null,
    },
    {
      metricKey: 'month_closures',
      headlineValue: '77,24%',
      deltaDirection: 'up',
      seriesJson: JSON.stringify({
        bars: [
          10, 18, 32, 16, 42, 26, 44, 58, 76, 62, 34, 88, 66, 48, 36, 68, 84, 94, 82, 72,
          12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
        ],
        redIndices: [8, 11],
        pins: [
          { index: 4, type: 'up', label: 'Q1 Timely +12%' },
          { index: 11, type: 'down', label: 'Variance spike -4.2%' },
          { index: 19, type: 'up', label: 'Close velocity +18%' },
        ],
      }),
      subMetricsJson: JSON.stringify([
        { value: '88', label: 'Closed', badge: 'up' },
        { value: '19', label: 'Open', badge: 'alert' },
        { value: '19/5', label: 'Timely', badge: 'warn' },
        { value: '84/0', label: 'On Time', badge: 'up' },
      ]),
    },
    {
      metricKey: 'usage_rate',
      headlineValue: '46,36%',
      deltaDirection: 'up',
      seriesJson: JSON.stringify({
        bars: [
          12, 22, 18, 28, 14, 34, 24, 46, 62, 84, 52, 74, 42, 24, 38, 48, 66, 78, 92, 68,
          12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
        ],
        redIndices: [9, 13],
        pins: [
          { index: 6, type: 'up', label: 'Sync throughput +14%' },
          { index: 13, type: 'down', label: 'Retry threshold' },
          { index: 19, type: 'up', label: 'Retrieval peak +21%' },
        ],
      }),
      subMetricsJson: JSON.stringify([
        { value: '56%', label: 'Syncs Accounts', badge: 'up' },
        { value: '11%', label: 'Auto Send', badge: 'alert' },
        { value: '32%', label: 'Manual Send', badge: 'warn' },
        { value: '74%', label: 'Retrieval', badge: 'up' },
      ]),
    },
  ];
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
      // Always ensure analytics snapshots exist (safe idempotent backfill)
      for (const snap of getDefaultAnalyticsSeed()) {
        await db.insert(analyticsSnapshots).values(snap).onConflictDoNothing();
      }

      const existingUsers = await db.select().from(users).limit(1);
      let allDbUsers = existingUsers.length > 0 ? await db.select().from(users).orderBy(asc(users.id)) : [];
      let allDbProjects = existingUsers.length > 0 ? await db.select().from(projects).orderBy(asc(projects.id)) : [];

      if (existingUsers.length === 0) {
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
            { name: 'FY26 Q3 Consolidated Close', code: 'PRJ-2603', department: 'Financial Controls', status: 'active', ownerId: elena.id, storageUsedBytes: 142_000_000 },
            { name: 'Apex Holdings Series C Data Room', code: 'PRJ-2611', department: 'M&A Data Room', status: 'active', ownerId: marcus.id, storageUsedBytes: 98_500_000 },
            { name: 'APAC Subsidiary Tax Audit', code: 'PRJ-2614', department: 'Treasury & Tax', status: 'audit', ownerId: elena.id, storageUsedBytes: 64_200_000 },
            { name: 'Vendor Reconciliation Ledger', code: 'PRJ-2618', department: 'Financial Controls', status: 'active', ownerId: kerlin.id, storageUsedBytes: 51_000_000 },
            { name: 'SOC2 Type II Compliance Vault', code: 'PRJ-2620', department: 'Executive Audit', status: 'active', ownerId: marcus.id, storageUsedBytes: 72_300_000 },
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

      const existingAi = await db.select().from(aiConversations).limit(1);
      if (existingAi.length === 0 && abhishekUser) {
        await db.insert(aiConversations).values([
          {
            userId: abhishekUser.id,
            documentId: null,
            role: 'assistant',
            mode: 'GPT-4o',
            content: 'Please upload a PDF for data processing.',
            attachmentName: null,
          },
          {
            userId: abhishekUser.id,
            documentId: null,
            role: 'user',
            mode: 'GPT-4o',
            content: "Sure, I'm uploading the document now. Let me know what's next.",
            attachmentName: 'Q3_GL_Variance_Report.pdf',
          },
          {
            userId: abhishekUser.id,
            documentId: null,
            role: 'assistant',
            mode: 'GPT-4o',
            content: 'Thank you! Processing your file now.',
            attachmentName: null,
          },
        ]);
      }

      const existingDocs = await db.select().from(documents).limit(1);
      if (
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

    const p1: ProjectRow = { id: mem.nextIds.projects++, name: 'FY26 Q3 Consolidated Close', code: 'PRJ-2603', department: 'Financial Controls', status: 'active', ownerId: elena.id, storageUsedBytes: 142_000_000, createdAt: now };
    const p2: ProjectRow = { id: mem.nextIds.projects++, name: 'Apex Holdings Series C Data Room', code: 'PRJ-2611', department: 'M&A Data Room', status: 'active', ownerId: marcus.id, storageUsedBytes: 98_500_000, createdAt: now };
    const p3: ProjectRow = { id: mem.nextIds.projects++, name: 'APAC Subsidiary Tax Audit', code: 'PRJ-2614', department: 'Treasury & Tax', status: 'audit', ownerId: elena.id, storageUsedBytes: 64_200_000, createdAt: now };
    const p4: ProjectRow = { id: mem.nextIds.projects++, name: 'Vendor Reconciliation Ledger', code: 'PRJ-2618', department: 'Financial Controls', status: 'active', ownerId: kerlin.id, storageUsedBytes: 51_000_000, createdAt: now };
    const p5: ProjectRow = { id: mem.nextIds.projects++, name: 'SOC2 Type II Compliance Vault', code: 'PRJ-2620', department: 'Executive Audit', status: 'active', ownerId: marcus.id, storageUsedBytes: 72_300_000, createdAt: now };
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

    mem.analytics = getDefaultAnalyticsSeed();

    mem.aiConversations.push(
      {
        id: mem.nextIds.aiConversations++,
        userId: abhishek.id,
        documentId: null,
        role: 'assistant',
        mode: 'GPT-4o',
        content: 'Please upload a PDF for data processing.',
        attachmentName: null,
        createdAt: now,
      },
      {
        id: mem.nextIds.aiConversations++,
        userId: abhishek.id,
        documentId: null,
        role: 'user',
        mode: 'GPT-4o',
        content: "Sure, I'm uploading the document now. Let me know what's next.",
        attachmentName: 'Q3_GL_Variance_Report.pdf',
        createdAt: now,
      },
      {
        id: mem.nextIds.aiConversations++,
        userId: abhishek.id,
        documentId: null,
        role: 'assistant',
        mode: 'GPT-4o',
        content: 'Thank you! Processing your file now.',
        attachmentName: null,
        createdAt: now,
      },
    );
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

  static async listProjects(): Promise<Array<ProjectRow & { ownerName: string | null; docCount: number }>> {
    const allUsers = await this.listUsers();
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const db = getDb();
    const projs = db
      ? await db.select().from(projects).orderBy(desc(projects.id))
      : [...mem.projects].sort((a, b) => b.id - a.id);
    const docs = db ? await db.select().from(documents) : mem.documents;

    return projs.map((p) => ({
      ...p,
      ownerName: p.ownerId ? userMap.get(p.ownerId)?.name ?? null : null,
      docCount: docs.filter((d) => d.projectId === p.id).length,
    }));
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
    const allUsers = await this.listUsers();
    const allProjects = await this.listProjects();
    const allDocs = await this.listDocuments();
    const db = getDb();
    const snaps = db ? await db.select().from(analyticsSnapshots) : mem.analytics;

    const pendingCount = allDocs.filter((d) => d.approvalStatus === 'pending').length;
    const extraBytes = allDocs.slice(0, Math.max(0, allDocs.length - 8)).reduce((acc, d) => acc + d.sizeBytes, 0);
    const extraGb = Math.round(extraBytes / (1024 * 1024 * 1024));

    const analyticsMap: Record<string, {
      headlineValue: string;
      deltaDirection: string;
      series: Record<string, unknown>;
      subMetrics: Array<{ value: string; label: string; badge: string }> | null;
    }> = {};

    for (const s of snaps) {
      analyticsMap[s.metricKey] = {
        headlineValue: s.headlineValue,
        deltaDirection: s.deltaDirection,
        series: JSON.parse(s.seriesJson),
        subMetrics: s.subMetricsJson ? JSON.parse(s.subMetricsJson) : null,
      };
    }

    return {
      kpis: {
        activeProjects: BASELINE.projectsOffset + allProjects.length,
        activeProjectsDelta: '12%',
        totalUsers: BASELINE.usersOffset + allUsers.length,
        totalUsersDelta: '8%',
        totalDocuments: BASELINE.docsOffset + allDocs.length,
        totalDocumentsDelta: '18%',
        dataRoomSizeGb: BASELINE.sizeGbOffset + extraGb,
        dataRoomSizeDelta: '11%',
        pendingReviews: BASELINE.pendingOffset + pendingCount,
      },
      analytics: analyticsMap,
      storageBackend: RustFSStorageService.getStorageMode(),
      storageBucket: RustFSStorageService.getBucketName(),
    };
  }
}
