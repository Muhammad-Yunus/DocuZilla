import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  FolderPlus,
  GitBranch,
  HardDrive,
  Lock,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { docuzillaApi } from '../lib/api.ts';
import type {
  ApprovalEventItem,
  DashboardSummary,
  DocumentItem,
  ProjectItem,
  PublicUser,
  WorkspaceTab,
} from '../types/docuzilla.ts';

interface WorkspaceModalProps {
  open: boolean;
  activeTab: WorkspaceTab;
  onChangeTab: (tab: WorkspaceTab) => void;
  onClose: () => void;
  currentUser: PublicUser | null;
  onRequireAuth: () => void;
  summary: DashboardSummary;
  documents: DocumentItem[];
  projects: ProjectItem[];
  users: PublicUser[];
  onRefreshAll: () => Promise<void>;
  onAskAiAboutDoc: (doc: DocumentItem) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function StatusLabel({ status }: { status: string }) {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
        Approved
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
        <XCircle className="w-3.5 h-3.5 text-red-600" />
        Rejected
      </span>
    );
  }
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
        <Clock className="w-3.5 h-3.5 text-amber-600" />
        Pending Review
      </span>
    );
  }
  return <span className="text-xs font-medium text-slate-500">Draft</span>;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  open,
  activeTab,
  onChangeTab,
  onClose,
  currentUser,
  onRequireAuth,
  summary,
  documents,
  projects,
  users,
  onRefreshAll,
  onAskAiAboutDoc,
}) => {
  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const uploadFileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadProjectId, setUploadProjectId] = useState<number>(projects[0]?.id ?? 0);
  const [uploadCategory, setUploadCategory] = useState('Financial Statement');
  const [customApproverId, setCustomApproverId] = useState<number | ''>('');
  const [submitImmediately, setSubmitImmediately] = useState(true);
  const [runAiSummary, setRunAiSummary] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Filters & Feedback
  const [docStatusFilter, setDocStatusFilter] = useState<string>('all');
  const [approvalScopeFilter, setApprovalScopeFilter] = useState<'all' | 'mine'>('all');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null,
  );

  // Approval comments & events
  const [decisionComments, setDecisionComments] = useState<Record<number, string>>({});
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [expandedEventsDocId, setExpandedEventsDocId] = useState<number | null>(null);
  const [docEvents, setDocEvents] = useState<ApprovalEventItem[]>([]);

  // New project form
  const [newProjName, setNewProjName] = useState('');
  const [newProjCode, setNewProjCode] = useState('');
  const [newProjDept, setNewProjDept] = useState('Financial Controls');
  const [creatingProject, setCreatingProject] = useState(false);

  // Hierarchy edits
  const [savingHierarchyId, setSavingHierarchyId] = useState<number | null>(null);

  useEffect(() => {
    if (projects.length > 0 && !projects.some((p) => p.id === uploadProjectId)) {
      setUploadProjectId(projects[0].id);
    }
  }, [projects, uploadProjectId]);

  if (!open) return null;

  const userMap = new Map(users.map((u) => [u.id, u]));
  const approvers = users.filter((u) => u.canApprove);
  const currentUserManager =
    currentUser?.managerId ? userMap.get(currentUser.managerId) : null;

  const filteredDocs = documents.filter((d) =>
    docStatusFilter === 'all' ? true : d.approvalStatus === docStatusFilter,
  );
  const pendingApprovalDocs = documents.filter((d) => d.approvalStatus === 'pending');

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!uploadProjectId) {
      setFeedback({ type: 'error', text: 'Create or select a Data Room Project before uploading.' });
      return;
    }
    if (!uploadFile) {
      setFeedback({ type: 'error', text: 'Select a PDF or document file to upload.' });
      return;
    }
    setUploading(true);
    setFeedback(null);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile);
      fd.append('projectId', String(uploadProjectId));
      fd.append('title', uploadTitle.trim() || uploadFile.name.replace(/\.[^.]+$/, ''));
      fd.append('category', uploadCategory);
      fd.append('submitForApproval', submitImmediately ? 'true' : 'false');
      fd.append('runAiSummary', runAiSummary ? 'true' : 'false');
      if (customApproverId !== '') {
        fd.append('approverId', String(customApproverId));
      }

      const res = await docuzillaApi.uploadDocument(fd);
      await onRefreshAll();
      setUploadFile(null);
      if (uploadFileInputRef.current) {
        uploadFileInputRef.current.value = '';
      }
      setUploadTitle('');
      setFeedback({
        type: 'success',
        text: `Stored "${res.document.fileName}" in RustFS (${res.storageMode}) · Status: ${res.document.approvalStatus}`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Upload failed',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDoc = async (docId: number, title: string) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setFeedback(null);
    try {
      await docuzillaApi.deleteDocument(docId);
      await onRefreshAll();
      setFeedback({ type: 'success', text: `Deleted "${title}" from PostgreSQL and RustFS.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Delete failed',
      });
    }
  };

  const handleDecision = async (docId: number, decision: 'approved' | 'rejected') => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setDecidingId(docId);
    setFeedback(null);
    try {
      await docuzillaApi.decideDocument(docId, decision, decisionComments[docId]);
      await onRefreshAll();
      setFeedback({
        type: 'success',
        text: `Document ${decision === 'approved' ? 'approved' : 'rejected'} and logged to PostgreSQL audit trail.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Decision failed',
      });
    } finally {
      setDecidingId(null);
    }
  };

  const handleSubmitDraft = async (docId: number) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setFeedback(null);
    try {
      await docuzillaApi.submitDocument(docId);
      await onRefreshAll();
      setFeedback({
        type: 'success',
        text: 'Document submitted to direct manager for 1-level approval.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Submit failed',
      });
    }
  };

  const toggleEvents = async (docId: number) => {
    if (expandedEventsDocId === docId) {
      setExpandedEventsDocId(null);
      return;
    }
    setExpandedEventsDocId(docId);
    try {
      const res = await docuzillaApi.getDocumentEvents(docId);
      setDocEvents(res.events);
    } catch {
      setDocEvents([]);
    }
  };

  const handleHierarchyUpdate = async (
    targetUserId: number,
    patch: { managerId?: number | null; canApprove?: boolean; role?: string },
  ) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setSavingHierarchyId(targetUserId);
    setFeedback(null);
    try {
      await docuzillaApi.updateUserHierarchy(targetUserId, patch);
      await onRefreshAll();
      setFeedback({
        type: 'success',
        text: 'Management hierarchy updated in PostgreSQL.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Hierarchy update failed',
      });
    } finally {
      setSavingHierarchyId(null);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    setCreatingProject(true);
    setFeedback(null);
    try {
      await docuzillaApi.createProject({
        name: newProjName,
        code: newProjCode,
        department: newProjDept,
      });
      await onRefreshAll();
      setNewProjName('');
      setNewProjCode('');
      setFeedback({ type: 'success', text: 'Data Room project created.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to create project',
      });
    } finally {
      setCreatingProject(false);
    }
  };

  const TABS: Array<{ id: WorkspaceTab; label: string; icon: React.ReactNode }> = [
    { id: 'documents', label: 'Data Room & RustFS', icon: <FileText className="w-4 h-4" /> },
    {
      id: 'approvals',
      label: `1-Level Approvals (${pendingApprovalDocs.length})`,
      icon: <Clock className="w-4 h-4" />,
    },
    { id: 'hierarchy', label: 'Management Hierarchy', icon: <GitBranch className="w-4 h-4" /> },
    { id: 'projects', label: 'Projects', icon: <FolderPlus className="w-4 h-4" /> },
    { id: 'analytics', label: 'Audit Metrics', icon: <BarChart3 className="w-4 h-4" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-2 sm:p-5">
      <div className="w-full max-w-6xl max-h-[92vh] bg-[#F8FAFD] rounded-[26px] shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-white px-5 sm:px-7 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#EEF4FF] text-[#3B66F5] flex items-center justify-center">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                DocuZilla Operations Workspace
              </h2>
              <p className="text-xs text-slate-500">
                Bucket: <span className="font-mono-tabular">{summary.storageBucket}</span> ·{' '}
                {summary.storageBackend === 'rustfs-s3' ? 'RustFS S3 Gateway' : 'RustFS Local Vault'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {currentUser ? (
              <span className="text-xs text-slate-600 px-3 py-1.5 bg-slate-100 rounded-lg">
                Signed in as <strong className="text-slate-900">{currentUser.name}</strong> (
                {currentUser.role})
              </span>
            ) : (
              <button
                type="button"
                onClick={onRequireAuth}
                className="px-3.5 py-2 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5" />
                Sign In to Edit
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
              aria-label="Close workspace"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="bg-white px-5 sm:px-7 py-2.5 border-b border-slate-200/80 flex items-center gap-2 overflow-x-auto thin-scrollbar">
          {TABS.map((t) => {
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onChangeTab(t.id);
                  setFeedback(null);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-medium flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[#111827] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`mx-5 sm:mx-7 mt-4 px-4 py-3 rounded-xl text-xs font-medium flex items-center justify-between ${
              feedback.type === 'success'
                ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="opacity-70 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 space-y-6">
          {/* TAB 1: DATA ROOM & UPLOAD */}
          {activeTab === 'documents' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Upload to RustFS Card */}
              <form
                onSubmit={handleUpload}
                className="lg:col-span-4 bg-white rounded-2xl p-5 border border-slate-200/80 space-y-4 h-fit"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Upload Document to RustFS
                  </h3>
                  <Upload className="w-4 h-4 text-blue-600" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Data Room Project
                  </label>
                  <select
                    value={uploadProjectId}
                    onChange={(e) => setUploadProjectId(Number(e.target.value))}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Document Title
                  </label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="e.g. Nov Balance Sheet Audit"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={uploadCategory}
                    onChange={(e) => setUploadCategory(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option>Financial Statement</option>
                    <option>Audit Ledger</option>
                    <option>Month Closure</option>
                    <option>Tax Filing</option>
                    <option>Legal &amp; M&amp;A</option>
                    <option>Compliance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PDF / File Attachment
                  </label>
                  <input
                    ref={uploadFileInputRef}
                    type="file"
                    accept=".pdf,.csv,.txt,.docx,.xlsx,.png,.jpg,.jpeg"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={submitImmediately}
                      onChange={(e) => setSubmitImmediately(e.target.checked)}
                      className="mt-0.5 rounded border-slate-300"
                    />
                    <span>
                      Submit immediately for 1-level approval
                      {currentUser && (
                        <span className="block text-[11px] text-slate-500">
                          Routes to:{' '}
                          <strong>
                            {currentUserManager?.name || 'Selected Peer Approver'}
                          </strong>
                        </span>
                      )}
                    </span>
                  </label>

                  {submitImmediately && currentUser && !currentUser.managerId && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Peer Approver (Top-Level Uploader)
                      </label>
                      <select
                        value={customApproverId}
                        onChange={(e) =>
                          setCustomApproverId(e.target.value ? Number(e.target.value) : '')
                        }
                        className="w-full h-9 px-2.5 rounded-xl border border-slate-200 text-xs bg-white"
                      >
                        <option value="">Auto-assign Peer Manager</option>
                        {approvers
                          .filter((a) => a.id !== currentUser.id)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name} ({a.title})
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={runAiSummary}
                      onChange={(e) => setRunAiSummary(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>Generate AI audit summary on upload</span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={uploading}
                  className="w-full h-10 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-xs font-medium flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {uploading ? 'Uploading to RustFS...' : 'Upload & Store Object'}
                </button>
              </form>

              {/* Documents Table */}
              <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Data Room Ledger ({filteredDocs.length})
                  </h3>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
                    {['all', 'pending', 'approved', 'rejected', 'draft'].map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setDocStatusFilter(st)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize cursor-pointer ${
                          docStatusFilter === st
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-500">
                        <th className="py-3 px-4">Document &amp; RustFS Key</th>
                        <th className="py-3 px-3">1-Level Routing</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredDocs.map((doc) => (
                        <tr key={doc.id} className="hover:bg-slate-50/80">
                          <td className="py-3.5 px-4 max-w-[260px]">
                            <div className="font-medium text-slate-900 truncate">{doc.title}</div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {doc.projectCode} · {doc.fileName} · {formatBytes(doc.sizeBytes)}
                            </div>
                            <div className="text-[10px] font-mono-tabular text-slate-400 truncate mt-0.5">
                              s3://{doc.rustfsBucket}/{doc.rustfsKey}
                            </div>
                          </td>
                          <td className="py-3.5 px-3">
                            <div className="text-slate-700 font-medium">{doc.uploadedByName}</div>
                            <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                              <ArrowRight className="w-3 h-3 text-slate-400" />
                              {doc.assignedApproverName || 'Unassigned'}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <StatusLabel status={doc.approvalStatus} />
                            {doc.discrepancyRate && (
                              <div className="text-[10.5px] text-slate-400 tabular-nums mt-0.5">
                                Discrepancy: {doc.discrepancyRate}
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  docuzillaApi.downloadDocument(doc.id, doc.fileName).catch((err) =>
                                    setFeedback({
                                      type: 'error',
                                      text: err instanceof Error ? err.message : 'Download failed',
                                    }),
                                  )
                                }
                                className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 cursor-pointer"
                                title="Download from RustFS"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onAskAiAboutDoc(doc);
                                  onClose();
                                }}
                                className="px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3" />
                                Ask AI
                              </button>
                              {(doc.approvalStatus === 'draft' ||
                                doc.approvalStatus === 'rejected') && (
                                <button
                                  type="button"
                                  onClick={() => handleSubmitDraft(doc.id)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Send className="w-3 h-3" />
                                  Submit
                                </button>
                              )}
                              {currentUser &&
                                (doc.uploadedById === currentUser.id ||
                                  currentUser.role === 'admin') && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteDoc(doc.id, doc.title)}
                                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-red-50 hover:border-red-200 text-slate-500 hover:text-red-600 cursor-pointer"
                                    title="Delete document"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 1-LEVEL APPROVAL QUEUE */}
          {activeTab === 'approvals' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    1-Level Document Approval Queue
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each submission routes directly to the uploader&apos;s assigned Manager in the
                    Management Hierarchy. Self-approval is blocked by segregation-of-duties rules.
                  </p>
                </div>

                {currentUser && (
                  <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setApprovalScopeFilter('all')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                        approvalScopeFilter === 'all'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      All Pending ({pendingApprovalDocs.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setApprovalScopeFilter('mine')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                        approvalScopeFilter === 'mine'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Assigned to Me (
                      {
                        pendingApprovalDocs.filter(
                          (d) => d.assignedApproverId === currentUser.id,
                        ).length
                      }
                      )
                    </button>
                  </div>
                )}
              </div>

              {pendingApprovalDocs.filter((d) =>
                approvalScopeFilter === 'mine' && currentUser
                  ? d.assignedApproverId === currentUser.id
                  : true,
              ).length === 0 ? (
                <div className="bg-white rounded-2xl p-10 text-center border border-slate-200/80">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <div className="text-sm font-medium text-slate-900">
                    No documents awaiting approval
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Upload a document in the Data Room tab to route a new 1-level approval request.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingApprovalDocs
                    .filter((d) =>
                      approvalScopeFilter === 'mine' && currentUser
                        ? d.assignedApproverId === currentUser.id
                        : true,
                    )
                    .map((doc) => {
                    const canUserDecide =
                      currentUser &&
                      doc.uploadedById !== currentUser.id &&
                      (doc.assignedApproverId === currentUser.id || currentUser.role === 'admin');

                    return (
                      <div
                        key={doc.id}
                        className="bg-white rounded-2xl p-5 border border-slate-200/80 space-y-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">
                                {doc.title}
                              </span>
                              <span className="text-xs text-slate-400">·</span>
                              <span className="text-xs text-slate-500">{doc.projectName}</span>
                            </div>
                            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
                              <span>
                                Submitted by <strong>{doc.uploadedByName}</strong>
                              </span>
                              <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                              <span>
                                Assigned Approver:{' '}
                                <strong className="text-blue-700">
                                  {doc.assignedApproverName || 'Admin'}
                                </strong>{' '}
                                ({doc.assignedApproverRole || 'Approver'})
                              </span>
                            </div>
                            {doc.aiSummary && (
                              <p className="text-xs text-slate-600 bg-slate-50 rounded-xl px-3 py-2 mt-2 border border-slate-100">
                                <strong className="text-slate-800">Audit Summary:</strong>{' '}
                                {doc.aiSummary}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => docuzillaApi.downloadDocument(doc.id, doc.fileName)}
                              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              Inspect File
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleEvents(doc.id)}
                              className="px-3 py-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                            >
                              Audit Trail
                            </button>
                          </div>
                        </div>

                        {/* Approval Action Bar */}
                        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                          <input
                            type="text"
                            value={decisionComments[doc.id] || ''}
                            onChange={(e) =>
                              setDecisionComments((prev) => ({
                                ...prev,
                                [doc.id]: e.target.value,
                              }))
                            }
                            placeholder="Add 1-level review note or audit comment..."
                            className="flex-1 min-w-[220px] h-9 px-3 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={decidingId === doc.id || !canUserDecide}
                              onClick={() => handleDecision(doc.id, 'rejected')}
                              className="px-3.5 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-45 text-red-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={decidingId === doc.id || !canUserDecide}
                              onClick={() => handleDecision(doc.id, 'approved')}
                              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-45 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Approve
                            </button>
                          </div>
                        </div>

                        {!canUserDecide && (
                          <div className="text-[11px] text-amber-700">
                            {!currentUser
                              ? 'Sign in as the assigned approver or Admin to approve/reject this document.'
                              : doc.uploadedById === currentUser.id
                                ? 'Segregation of duties: you cannot approve your own uploaded document.'
                                : `Restricted to assigned approver (${doc.assignedApproverName}) or Admin.`}
                          </div>
                        )}

                        {expandedEventsDocId === doc.id && (
                          <div className="pt-2 space-y-1.5">
                            {docEvents.map((ev) => (
                              <div
                                key={ev.id}
                                className="text-[11px] text-slate-600 flex items-center justify-between bg-slate-50 px-3 py-1.5 rounded-lg"
                              >
                                <span>
                                  <strong className="capitalize">{ev.action}</strong> by{' '}
                                  {ev.actorName} ({ev.actorRole}) — {ev.comment}
                                </span>
                                <span className="text-slate-400 tabular-nums">
                                  {new Date(ev.createdAt).toLocaleDateString()}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MANAGEMENT HIERARCHY */}
          {activeTab === 'hierarchy' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  1-Level Management &amp; Approval Hierarchy
                </h3>
                <p className="text-xs text-slate-500">
                  Configure who submits documents to whom. When a team member uploads a document, it
                  automatically routes to their Direct Approver.
                </p>
              </div>

              {/* Visual Reporting Tree */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {users
                  .filter((u) => u.canApprove)
                  .map((approver) => {
                    const directReports = users.filter((r) => r.managerId === approver.id);
                    return (
                      <div
                        key={approver.id}
                        className="bg-white rounded-2xl p-4 border border-slate-200/80 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-full bg-[#1C2434] text-white text-xs font-semibold flex items-center justify-center">
                              {approver.avatarInitials}
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-slate-900">
                                {approver.name}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {approver.title} · {approver.role}
                              </div>
                            </div>
                          </div>
                          <span className="text-[11px] font-medium text-emerald-700">
                            Approver
                          </span>
                        </div>

                        <div className="pt-2 border-t border-slate-100 space-y-1.5">
                          <div className="text-[11px] font-medium text-slate-400">
                            Submitters ({directReports.length})
                          </div>
                          {directReports.length === 0 ? (
                            <div className="text-[11px] text-slate-400 italic">
                              No direct submitters assigned
                            </div>
                          ) : (
                            directReports.map((rep) => (
                              <div
                                key={rep.id}
                                className="flex items-center justify-between text-xs bg-slate-50 px-2.5 py-1.5 rounded-lg"
                              >
                                <span className="font-medium text-slate-800">{rep.name}</span>
                                <span className="text-[11px] text-slate-500">{rep.role}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Editable Reporting Matrix Table */}
              <div className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 flex items-center gap-2">
                    <Users className="w-4 h-4 text-blue-600" />
                    Reporting &amp; Approval Matrix
                  </span>
                  {!currentUser && (
                    <span className="text-[11px] text-slate-500">
                      Sign in as Admin or Manager to edit hierarchy
                    </span>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-100 text-[11px] font-medium text-slate-500">
                        <th className="py-3 px-4">Team Member</th>
                        <th className="py-3 px-3">Role</th>
                        <th className="py-3 px-3">Department</th>
                        <th className="py-3 px-3">Submits To (1-Level Approver)</th>
                        <th className="py-3 px-4 text-right">Approval Authority</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {users.map((u) => {
                        const canEdit =
                          currentUser &&
                          (currentUser.role === 'admin' || currentUser.role === 'manager');
                        return (
                          <tr key={u.id} className="hover:bg-slate-50/70">
                            <td className="py-3 px-4">
                              <div className="font-medium text-slate-900">{u.name}</div>
                              <div className="text-[11px] text-slate-500">{u.email}</div>
                            </td>
                            <td className="py-3 px-3 capitalize text-slate-700">{u.role}</td>
                            <td className="py-3 px-3 text-slate-600">{u.department}</td>
                            <td className="py-3 px-3">
                              <select
                                disabled={!canEdit || savingHierarchyId === u.id}
                                value={u.managerId ?? ''}
                                onChange={(e) =>
                                  handleHierarchyUpdate(u.id, {
                                    managerId: e.target.value ? Number(e.target.value) : null,
                                  })
                                }
                                className="h-8 px-2.5 rounded-lg border border-slate-200 text-xs bg-white disabled:bg-slate-50 disabled:text-slate-500"
                              >
                                <option value="">Top-Level (No Manager)</option>
                                {approvers
                                  .filter((a) => a.id !== u.id)
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name} ({a.role})
                                    </option>
                                  ))}
                              </select>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <label className="inline-flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  disabled={!canEdit || savingHierarchyId === u.id || u.role === 'admin'}
                                  checked={u.canApprove}
                                  onChange={(e) =>
                                    handleHierarchyUpdate(u.id, {
                                      canApprove: e.target.checked,
                                    })
                                  }
                                  className="rounded border-slate-300"
                                />
                                <span className="text-[11px] text-slate-600">
                                  {u.canApprove ? 'Can Approve' : 'Submitter Only'}
                                </span>
                              </label>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PROJECTS */}
          {activeTab === 'projects' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form
                onSubmit={handleCreateProject}
                className="lg:col-span-4 bg-white rounded-2xl p-5 border border-slate-200/80 space-y-4 h-fit"
              >
                <h3 className="text-sm font-semibold text-slate-900">Create Data Room Project</h3>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Project Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newProjName}
                    onChange={(e) => setNewProjName(e.target.value)}
                    placeholder="e.g. FY26 Q4 Audit Close"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Project Code
                  </label>
                  <input
                    type="text"
                    required
                    value={newProjCode}
                    onChange={(e) => setNewProjCode(e.target.value)}
                    placeholder="e.g. PRJ-2625"
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={newProjDept}
                    onChange={(e) => setNewProjDept(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  disabled={creatingProject}
                  className="w-full h-10 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-xs font-medium cursor-pointer"
                >
                  {creatingProject ? 'Creating...' : 'Create Project'}
                </button>
              </form>

              <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4 h-fit">
                {projects.map((p) => (
                  <div
                    key={p.id}
                    className="bg-white rounded-2xl p-5 border border-slate-200/80 flex flex-col justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-mono-tabular font-medium text-blue-700">
                          {p.code}
                        </span>
                        <span className="capitalize">{p.status}</span>
                      </div>
                      <h4 className="text-sm font-semibold text-slate-900 mt-1">{p.name}</h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {p.department} · Owner: {p.ownerName || 'Assigned'}
                      </p>
                    </div>
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600 tabular-nums">
                      <span>{p.docCount} active files</span>
                      <span>{formatBytes(p.storageUsedBytes)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 5: AUDIT ANALYTICS DRILLDOWN */}
          {activeTab === 'analytics' && (() => {
            const approvedDocsCount = documents.filter((d) => d.approvalStatus === 'approved').length;
            const pendingDocsCount = documents.filter((d) => d.approvalStatus === 'pending').length;
            const rejectedDocsCount = documents.filter((d) => d.approvalStatus === 'rejected').length;
            const aiSummarizedDocsCount = documents.filter((d) => Boolean(d.aiSummary?.trim())).length;
            const discrepancyValues = documents.map((d) => {
              const num = parseFloat(String(d.discrepancyRate || '0').replace('%', '').trim());
              return Number.isFinite(num) ? Math.max(0, num) : 0;
            });
            const maxDiscrepancy =
              discrepancyValues.length > 0 ? Math.max(...discrepancyValues) : 0;

            return (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 space-y-2">
                  <div className="text-xs text-slate-500">Approval Completion Rate</div>
                  <div className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {summary.analytics.month_closures?.headlineValue || '0,00%'}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {approvedDocsCount} approved, {pendingDocsCount} pending review, and{' '}
                    {rejectedDocsCount} rejected across {documents.length} total documents in{' '}
                    {projects.length} projects.
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 space-y-2">
                  <div className="text-xs text-slate-500">Average Audit Discrepancy</div>
                  <div className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {summary.analytics.discrepancies?.headlineValue || '0,00%'}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Computed from {documents.length} persisted ledger records (peak recorded
                    discrepancy: {maxDiscrepancy.toFixed(2)}%).
                  </p>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-slate-200/80 space-y-2">
                  <div className="text-xs text-slate-500">Data Room Storage &amp; AI Coverage</div>
                  <div className="text-2xl font-semibold text-slate-900 tabular-nums">
                    {summary.kpis.dataRoomSizeFormatted || `${summary.kpis.dataRoomSizeGb} GB`}
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {aiSummarizedDocsCount} of {documents.length} documents AI-summarized · Stored
                    in RustFS bucket <span className="font-mono">{summary.storageBucket || 'docuzilla'}</span>.
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
