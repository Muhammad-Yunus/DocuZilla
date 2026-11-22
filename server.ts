import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import multer from 'multer';
import { initDatabase, isDbConnected } from './server/db_bridge.ts';
import { DocuZillaRepository, makeSamplePdfBuffer } from './server/services/repository.ts';
import {
  hashPassword,
  verifyPassword,
  signAuthToken,
  requireAuth,
  optionalAuth,
  type AuthenticatedRequest,
} from './server/services/auth.ts';
import { RustFSStorageService } from './server/services/rustfs.ts';
import {
  buildWorkspaceRagContext,
  isAiConfigured,
  processDocumentWithOpenAiCompatible,
  type AiAssistantMode,
} from './server/services/aiAssistant.ts';

const PORT = Number(process.env.PORT) || 3000;

// Simple in-memory rate limiter for auth routes
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function authRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 30) {
    res.status(429).json({ error: 'Too many authentication attempts. Please wait a minute.' });
    return;
  }
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25MB max
  },
});

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'text/csv',
  'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
]);

async function startServer() {
  const dbInit = await initDatabase();
  if (dbInit.connected) {
    console.log('[DocuZilla] Connected to PostgreSQL via Drizzle ORM');
  } else {
    console.log('[DocuZilla] Running with transient in-memory repository:', dbInit.error);
  }

  await DocuZillaRepository.seedIfEmpty();

  if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim().length < 16)) {
    console.warn('[DocuZilla] Warning: SESSION_SECRET is not set in production; active sessions will reset on server restart.');
  }

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '4mb' }));

  // Health endpoint (no secrets exposed)
  app.get('/api/health', async (req, res) => {
    const base = {
      status: 'ok',
      database: isDbConnected() ? 'postgresql-drizzle' : 'in-memory-fallback',
      storage: RustFSStorageService.getStorageMode(),
      bucket: RustFSStorageService.getBucketName(),
      aiConfigured: isAiConfigured(),
    };
    if (req.query.probe === 'storage') {
      const probe = await RustFSStorageService.probeConnection();
      res.json({ ...base, storageProbe: probe });
      return;
    }
    res.json(base);
  });

  // Auth status
  app.get('/api/auth/status', optionalAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const hasAdminAccount = await DocuZillaRepository.hasPasswordProtectedAdmin();
      let currentUser = null;
      if (req.authUser) {
        const row = await DocuZillaRepository.getUserById(req.authUser.userId);
        if (row) {
          const { passwordHash: _omit, ...pub } = row;
          currentUser = pub;
        }
      }
      res.json({ hasAdminAccount, currentUser });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load auth status' });
    }
  });

  // First-run Admin Setup / Claim (locks automatically once any admin has a password)
  app.post('/api/auth/claim-admin', authRateLimit, async (req, res) => {
    try {
      const alreadyClaimed = await DocuZillaRepository.hasPasswordProtectedAdmin();
      if (alreadyClaimed) {
        res.status(403).json({ error: 'Workspace administrator account is already claimed. Please sign in.' });
        return;
      }

      const { email, password, name } = req.body as {
        email?: string;
        password?: string;
        name?: string;
      };

      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      const targetEmail = (email || 'kerlin.kors@docuzilla.io').trim().toLowerCase();
      const existing = await DocuZillaRepository.getUserByEmail(targetEmail);
      const pwHash = hashPassword(password);

      let adminUser;
      if (existing && existing.role === 'admin' && !existing.passwordHash) {
        adminUser = await DocuZillaRepository.claimOrSetPassword(existing.id, pwHash);
      } else if (!existing) {
        adminUser = await DocuZillaRepository.createUser({
          name: (name || 'Kerlin Kors').trim(),
          email: targetEmail,
          passwordHash: pwHash,
          role: 'admin',
          department: 'Executive Audit',
          title: 'Managing Partner',
          managerId: null,
          canApprove: true,
        });
      } else {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      if (!adminUser) {
        res.status(500).json({ error: 'Failed to claim admin account.' });
        return;
      }

      const token = signAuthToken({
        userId: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
      });
      res.status(201).json({ token, user: adminUser });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Admin setup failed' });
    }
  });

  // Register user
  app.post('/api/auth/register', authRateLimit, async (req, res) => {
    try {
      const { name, email, password, role, department, title, managerId } = req.body as {
        name?: string;
        email?: string;
        password?: string;
        role?: string;
        department?: string;
        title?: string;
        managerId?: number | null;
      };

      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        res.status(400).json({ error: 'Full name is required.' });
        return;
      }
      if (!email || typeof email !== 'string' || !email.includes('@')) {
        res.status(400).json({ error: 'Valid email address is required.' });
        return;
      }
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      const existing = await DocuZillaRepository.getUserByEmail(email);
      if (existing && existing.passwordHash) {
        res.status(409).json({ error: 'An account with this email already exists.' });
        return;
      }

      // If user claims an un-claimed showcase roster email (non-admin), allow setting their password
      if (existing && !existing.passwordHash) {
        if (existing.role === 'admin') {
          res.status(403).json({ error: 'Admin account must be claimed via first-run Admin Setup.' });
          return;
        }
        const claimed = await DocuZillaRepository.claimOrSetPassword(existing.id, hashPassword(password));
        if (!claimed) {
          res.status(500).json({ error: 'Failed to activate account.' });
          return;
        }
        const token = signAuthToken({
          userId: claimed.id,
          email: claimed.email,
          role: claimed.role,
        });
        res.status(201).json({ token, user: claimed });
        return;
      }

      const allowedRoles = new Set(['analyst', 'auditor', 'manager']);
      const safeRole = role && allowedRoles.has(role) ? role : 'analyst';
      const canApprove = safeRole === 'manager';

      let validManagerId: number | null = null;
      if (typeof managerId === 'number' && Number.isInteger(managerId)) {
        const mgr = await DocuZillaRepository.getUserById(managerId);
        if (!mgr || !mgr.canApprove) {
          res.status(400).json({ error: 'Selected direct manager must have approval authority.' });
          return;
        }
        validManagerId = mgr.id;
      } else {
        // Auto-assign to first available approver in hierarchy
        const allUsers = await DocuZillaRepository.listUsers();
        const defaultMgr = allUsers.find((u) => u.canApprove && u.role === 'manager') || allUsers.find((u) => u.canApprove);
        validManagerId = defaultMgr ? defaultMgr.id : null;
      }

      const created = await DocuZillaRepository.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        passwordHash: hashPassword(password),
        role: safeRole,
        department: (department || 'Financial Controls').trim(),
        title: (title || (safeRole === 'manager' ? 'Audit Manager' : 'Audit Analyst')).trim(),
        managerId: validManagerId,
        canApprove,
      });

      const token = signAuthToken({
        userId: created.id,
        email: created.email,
        role: created.role,
      });
      res.status(201).json({ token, user: created });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Registration failed' });
    }
  });

  // Login
  app.post('/api/auth/login', authRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const user = await DocuZillaRepository.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        res.status(401).json({
          error: 'Invalid credentials or account not yet activated. Register or claim Admin Setup first.',
        });
        return;
      }

      const ok = verifyPassword(password, user.passwordHash);
      if (!ok) {
        res.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const token = signAuthToken({
        userId: user.id,
        email: user.email,
        role: user.role,
      });
      const { passwordHash: _omit, ...pub } = user;
      res.json({ token, user: pub });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Login failed' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = await DocuZillaRepository.getUserById(req.authUser!.userId);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    const { passwordHash: _omit, ...pub } = user;
    res.json({ user: pub });
  });

  // Dashboard summary
  app.get('/api/dashboard/summary', async (_req, res) => {
    try {
      const summary = await DocuZillaRepository.getDashboardSummary();
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load summary' });
    }
  });

  // Global live search
  app.get('/api/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toLowerCase();
      if (!q) {
        res.json({ projects: [], documents: [], users: [] });
        return;
      }
      const [allProjects, allDocs, allUsers] = await Promise.all([
        DocuZillaRepository.listProjects(),
        DocuZillaRepository.listDocuments({ search: q }),
        DocuZillaRepository.listUsers(),
      ]);

      res.json({
        projects: allProjects
          .filter((p) => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || p.department.toLowerCase().includes(q))
          .slice(0, 5),
        documents: allDocs.slice(0, 6),
        users: allUsers
          .filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q))
          .slice(0, 5),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Search failed' });
    }
  });

  // Users & Management Hierarchy
  app.get('/api/users', async (_req, res) => {
    try {
      const list = await DocuZillaRepository.listUsers();
      res.json({ users: list });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load users' });
    }
  });

  app.patch('/api/users/:id/hierarchy', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const caller = await DocuZillaRepository.getUserById(req.authUser!.userId);
      if (!caller || (caller.role !== 'admin' && caller.role !== 'manager')) {
        res.status(403).json({ error: 'Only Admins or Managers can modify reporting hierarchy.' });
        return;
      }

      const targetId = Number(req.params.id);
      if (!Number.isInteger(targetId)) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }

      const { managerId, canApprove, role, department, title } = req.body as {
        managerId?: number | null;
        canApprove?: boolean;
        role?: string;
        department?: string;
        title?: string;
      };

      // Non-admin managers can only reassign analyst/auditor roles, not promote to admin
      if (caller.role !== 'admin' && role === 'admin') {
        res.status(403).json({ error: 'Only Admins can assign the Admin role.' });
        return;
      }

      if (managerId !== undefined && managerId !== null) {
        const mgr = await DocuZillaRepository.getUserById(managerId);
        if (!mgr || !mgr.canApprove) {
          res.status(400).json({ error: 'Assigned manager must exist and have approval authority.' });
          return;
        }
      }

      const updated = await DocuZillaRepository.updateUserHierarchy(targetId, {
        managerId,
        canApprove,
        role,
        department,
        title,
      });

      if (!updated) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user: updated });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Hierarchy update failed' });
    }
  });

  // Projects
  app.get('/api/projects', async (_req, res) => {
    try {
      const list = await DocuZillaRepository.listProjects();
      res.json({ projects: list });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list projects' });
    }
  });

  app.post('/api/projects', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { name, code, department } = req.body as {
        name?: string;
        code?: string;
        department?: string;
      };
      if (!name || !code) {
        res.status(400).json({ error: 'Project name and code are required.' });
        return;
      }
      const created = await DocuZillaRepository.createProject({
        name,
        code,
        department: department || 'Financial Controls',
        ownerId: req.authUser!.userId,
      });
      res.status(201).json({ project: created });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create project' });
    }
  });

  // Documents
  app.get('/api/documents', async (req, res) => {
    try {
      const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
      const status = req.query.status ? String(req.query.status) : undefined;
      const search = req.query.search ? String(req.query.search) : undefined;
      const docs = await DocuZillaRepository.listDocuments({ projectId, status, search });
      res.json({ documents: docs });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list documents' });
    }
  });

  app.get('/api/documents/:id/events', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'Invalid document ID' });
        return;
      }
      const events = await DocuZillaRepository.listApprovalEvents(id);
      res.json({ events });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load events' });
    }
  });

  app.post('/api/documents/upload', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'Please select a document file to upload.' });
        return;
      }

      if (!ALLOWED_MIME_TYPES.has(file.mimetype) && !file.originalname.toLowerCase().endsWith('.pdf')) {
        res.status(400).json({ error: 'Unsupported file format. Upload PDF, CSV, XLSX, DOCX, TXT, or image.' });
        return;
      }

      const projectId = Number(req.body.projectId);
      if (!Number.isInteger(projectId)) {
        res.status(400).json({ error: 'Valid projectId is required.' });
        return;
      }

      const uploader = await DocuZillaRepository.getUserById(req.authUser!.userId);
      if (!uploader) {
        res.status(401).json({ error: 'Uploader account not found.' });
        return;
      }

      const submitMode = req.body.submitForApproval === 'false' ? 'draft' : 'pending';
      // 1-level approval resolution from Management Hierarchy:
      // Use uploader's direct managerId; if uploader is top-level (managerId null), allow specifying a peer approver who isn't self.
      let assignedApproverId: number | null = uploader.managerId ?? null;
      if (!assignedApproverId && req.body.approverId) {
        const requestedApproverId = Number(req.body.approverId);
        if (Number.isInteger(requestedApproverId) && requestedApproverId !== uploader.id) {
          const candidate = await DocuZillaRepository.getUserById(requestedApproverId);
          if (candidate && candidate.canApprove) {
            assignedApproverId = candidate.id;
          }
        }
      }
      if (!assignedApproverId && submitMode === 'pending') {
        const allUsers = await DocuZillaRepository.listUsers();
        const fallbackApprover = allUsers.find((u) => u.canApprove && u.id !== uploader.id);
        assignedApproverId = fallbackApprover ? fallbackApprover.id : null;
      }

      const rustfsResult = await RustFSStorageService.putObject({
        projectId,
        fileName: file.originalname,
        mimeType: file.mimetype || 'application/pdf',
        buffer: file.buffer,
      });

      let aiSummary: string | null = null;
      if (req.body.runAiSummary === 'true' && isAiConfigured()) {
        try {
          aiSummary = await processDocumentWithOpenAiCompatible({
            question: 'Summarize this uploaded document and flag any financial discrepancies or compliance risks.',
            mode: 'Summary',
            fileBuffer: file.buffer,
            mimeType: file.mimetype,
            fileName: file.originalname,
          });
        } catch (aiErr) {
          console.warn('[DocuZilla AI Upload Summary skipped]:', aiErr instanceof Error ? aiErr.message : aiErr);
        }
      }

      const doc = await DocuZillaRepository.createDocument({
        projectId,
        title: String(req.body.title || file.originalname.replace(/\.[^.]+$/, '')),
        fileName: file.originalname,
        mimeType: file.mimetype || 'application/pdf',
        sizeBytes: rustfsResult.sizeBytes,
        rustfsBucket: rustfsResult.bucket,
        rustfsKey: rustfsResult.key,
        sha256: rustfsResult.sha256,
        category: String(req.body.category || 'Financial Statement'),
        uploadedById: uploader.id,
        assignedApproverId,
        approvalStatus: submitMode,
        aiSummary,
      });

      res.status(201).json({
        document: doc,
        storageMode: rustfsResult.storageMode,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Document upload failed' });
    }
  });

  app.post('/api/documents/:id/submit', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const docId = Number(req.params.id);
      const doc = await DocuZillaRepository.getDocumentById(docId);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      const actor = await DocuZillaRepository.getUserById(req.authUser!.userId);
      if (!actor || (doc.uploadedById !== actor.id && actor.role !== 'admin')) {
        res.status(403).json({ error: 'Only the document owner or Admin can submit for approval.' });
        return;
      }

      let approverId = doc.assignedApproverId ?? actor.managerId ?? null;
      if (!approverId) {
        const allUsers = await DocuZillaRepository.listUsers();
        const fallback = allUsers.find((u) => u.canApprove && u.id !== doc.uploadedById);
        approverId = fallback ? fallback.id : null;
      }

      if (!approverId) {
        res.status(400).json({ error: 'No approver found in management hierarchy. Assign a manager first.' });
        return;
      }

      const updated = await DocuZillaRepository.submitDocumentForApproval(docId, actor.id, approverId);
      res.json({ document: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Submit failed' });
    }
  });

  // 1-Level Approval / Rejection Decision
  app.post('/api/documents/:id/decision', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const docId = Number(req.params.id);
      const { decision, comment } = req.body as {
        decision?: 'approved' | 'rejected';
        comment?: string;
      };

      if (decision !== 'approved' && decision !== 'rejected') {
        res.status(400).json({ error: 'Decision must be "approved" or "rejected".' });
        return;
      }

      const doc = await DocuZillaRepository.getDocumentById(docId);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      const actor = await DocuZillaRepository.getUserById(req.authUser!.userId);
      if (!actor) {
        res.status(401).json({ error: 'User not found' });
        return;
      }

      // Enforce 1-level management hierarchy authorization & segregation of duties
      if (doc.uploadedById === actor.id) {
        res.status(403).json({
          error: 'Segregation of duties: you cannot approve or reject a document you uploaded.',
        });
        return;
      }

      const isAssignedApprover = doc.assignedApproverId === actor.id;
      const isAdmin = actor.role === 'admin';
      if (!isAssignedApprover && !isAdmin) {
        res.status(403).json({
          error: `Only the assigned approver (${doc.assignedApproverName || 'Manager'}) or an Admin can decide this document.`,
        });
        return;
      }

      if (doc.approvalStatus !== 'pending') {
        res.status(400).json({ error: `Document is currently "${doc.approvalStatus}", not pending review.` });
        return;
      }

      const updated = await DocuZillaRepository.decideDocument({
        documentId: docId,
        actorId: actor.id,
        decision,
        comment,
      });

      res.json({ document: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Approval decision failed' });
    }
  });

  // Download from RustFS
  app.get('/api/documents/:id/download', optionalAuth, async (req, res) => {
    try {
      const docId = Number(req.params.id);
      if (!Number.isInteger(docId)) {
        res.status(400).json({ error: 'Invalid document ID' });
        return;
      }
      const doc = await DocuZillaRepository.getDocumentById(docId);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }

      let buffer = await RustFSStorageService.getObjectBuffer(doc.rustfsBucket, doc.rustfsKey);
      // If running on ephemeral disk without external RustFS and seeded sample doc is requested, regenerate sample PDF deterministically
      if (!buffer && RustFSStorageService.getStorageMode() === 'rustfs-local-vault' && doc.aiSummary) {
        buffer = makeSamplePdfBuffer(doc.title, doc.projectCode, doc.aiSummary);
      }
      if (!buffer) {
        res.status(404).json({ error: 'Object not found in RustFS storage.' });
        return;
      }

      res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${doc.fileName.replace(/"/g, '')}"`);
      res.send(buffer);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Download failed' });
    }
  });

  // Delete document from PostgreSQL & RustFS
  app.delete('/api/documents/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const docId = Number(req.params.id);
      if (!Number.isInteger(docId)) {
        res.status(400).json({ error: 'Invalid document ID' });
        return;
      }
      const doc = await DocuZillaRepository.getDocumentById(docId);
      if (!doc) {
        res.status(404).json({ error: 'Document not found' });
        return;
      }
      const actor = await DocuZillaRepository.getUserById(req.authUser!.userId);
      if (!actor || (doc.uploadedById !== actor.id && actor.role !== 'admin')) {
        res.status(403).json({ error: 'Only the document uploader or Admin can delete this document.' });
        return;
      }
      await RustFSStorageService.deleteObject(doc.rustfsBucket, doc.rustfsKey);
      await DocuZillaRepository.deleteDocument(docId);
      res.json({ deleted: true, id: docId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Delete failed' });
    }
  });

  // AI Assistant Messages & PDF Processing
  app.get('/api/ai/messages', async (_req, res) => {
    try {
      const messages = await DocuZillaRepository.listAiMessages();
      res.json({ messages });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load AI chat' });
    }
  });

  app.post('/api/ai/analyze', optionalAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
    try {
      const question = String(req.body.question || '').trim();
      const mode = (String(req.body.mode || 'GPT-4o') as AiAssistantMode);
      const documentId = req.body.documentId ? Number(req.body.documentId) : null;
      const uploadedFile = req.file;

      if (!question && !uploadedFile && !documentId) {
        res.status(400).json({ error: 'Provide a question, PDF file, or Data Room document.' });
        return;
      }

      let fileBuffer: Buffer | null = uploadedFile ? uploadedFile.buffer : null;
      let mimeType: string | undefined = uploadedFile?.mimetype;
      let fileName: string | undefined = uploadedFile?.originalname;
      let documentContextText: string | undefined;

      if (!fileBuffer && documentId && Number.isInteger(documentId)) {
        const doc = await DocuZillaRepository.getDocumentById(documentId);
        if (doc) {
          fileBuffer = await RustFSStorageService.getObjectBuffer(doc.rustfsBucket, doc.rustfsKey);
          mimeType = doc.mimeType;
          fileName = doc.fileName;
          documentContextText = `Title: ${doc.title}\nProject: ${doc.projectName} (${doc.projectCode})\nCategory: ${doc.category}\nApproval Status: ${doc.approvalStatus}\nDiscrepancy Rate: ${doc.discrepancyRate}\nExisting Summary: ${doc.aiSummary || 'N/A'}`;
        }
      }

      const userPromptText =
        question ||
        (fileName ? `Process and analyze ${fileName} using ${mode}.` : 'Analyze the current data room context.');

      const [allUsers, allProjects, allDocs, summary, recentMessages] = await Promise.all([
        DocuZillaRepository.listUsers(),
        DocuZillaRepository.listProjects(),
        DocuZillaRepository.listDocuments(),
        DocuZillaRepository.getDashboardSummary(),
        DocuZillaRepository.listAiMessages(),
      ]);

      const userById = new Map(allUsers.map((u) => [u.id, u]));
      const enrichedUsers = allUsers.map((u) => ({
        ...u,
        managerName: u.managerId ? userById.get(u.managerId)?.name ?? null : null,
      }));
      const currentRagUser = req.authUser?.userId
        ? enrichedUsers.find((u) => u.id === req.authUser!.userId) ?? null
        : null;

      const workspaceContextText = await buildWorkspaceRagContext({
        question: userPromptText,
        currentUser: currentRagUser,
        projects: allProjects,
        documents: allDocs,
        users: enrichedUsers,
        kpis: summary.kpis,
        excludeDocId: documentId,
        fetchObjectBuffer: (bucket, key) => RustFSStorageService.getObjectBuffer(bucket, key),
      });

      const conversationHistory = recentMessages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));

      const aiReplyText = await processDocumentWithOpenAiCompatible({
        question: userPromptText,
        mode,
        fileBuffer,
        mimeType,
        fileName,
        documentContextText,
        workspaceContextText,
        conversationHistory,
      });

      const userMsg = await DocuZillaRepository.addAiMessage({
        userId: req.authUser?.userId ?? null,
        documentId,
        role: 'user',
        mode,
        content: userPromptText,
        attachmentName: fileName ?? null,
      });

      if (req.authUser && documentId && Number.isInteger(documentId)) {
        await DocuZillaRepository.updateDocumentAiSummary(
          documentId,
          aiReplyText.slice(0, 500),
          req.authUser.userId,
        );
      }

      const assistantMsg = await DocuZillaRepository.addAiMessage({
        userId: req.authUser?.userId ?? null,
        documentId,
        role: 'assistant',
        mode,
        content: aiReplyText,
        attachmentName: null,
      });

      res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI processing failed';
      res.status(500).json({ error: msg });
    }
  });

  // Unknown API routes return clean JSON 404 instead of SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Global JSON error handler (handles Multer size limits & malformed JSON)
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json({ error: 'Uploaded file exceeds the 25 MB size limit.' });
        return;
      }
      res.status(400).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  // Frontend middleware / static serving
  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distDir)) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[DocuZilla] Server listening on http://0.0.0.0:${PORT}`);
  });

  const shutdown = () => {
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('[DocuZilla] Fatal startup error:', err);
  process.exit(1);
});
