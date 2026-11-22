import { useCallback, useEffect, useState } from 'react';
import { HeroBanner } from './components/HeroBanner.tsx';
import { AnalyticsSection } from './components/AnalyticsSection.tsx';
import { AiAssistantCard } from './components/AiAssistantCard.tsx';
import { WorkspaceModal } from './components/WorkspaceModal.tsx';
import { AuthModal } from './components/AuthModal.tsx';
import { docuzillaApi } from './lib/api.ts';
import type {
  AiMessage,
  DashboardSummary,
  DocumentItem,
  ProjectItem,
  PublicUser,
  WorkspaceTab,
} from './types/docuzilla.ts';

const INITIAL_SUMMARY: DashboardSummary = {
  kpis: {
    activeProjects: 24,
    activeProjectsDelta: '12%',
    totalUsers: 186,
    totalUsersDelta: '8%',
    totalDocuments: 8642,
    totalDocumentsDelta: '18%',
    dataRoomSizeGb: 428,
    dataRoomSizeDelta: '11%',
    pendingReviews: 17,
  },
  analytics: {},
  storageBackend: 'rustfs-local-vault',
  storageBucket: 'docuzilla-dataroom',
};

const INITIAL_AI_MESSAGES: AiMessage[] = [
  {
    id: 1,
    userId: null,
    documentId: null,
    role: 'assistant',
    mode: 'GPT-4o',
    content: 'Please upload a PDF for data processing.',
    attachmentName: null,
    createdAt: new Date().toISOString(),
  },
  {
    id: 2,
    userId: null,
    documentId: null,
    role: 'user',
    mode: 'GPT-4o',
    content: "Sure, I'm uploading the document now. Let me know what's next.",
    attachmentName: 'Q3_GL_Variance_Report.pdf',
    createdAt: new Date().toISOString(),
  },
  {
    id: 3,
    userId: null,
    documentId: null,
    role: 'assistant',
    mode: 'GPT-4o',
    content: 'Thank you! Processing your file now.',
    attachmentName: null,
    createdAt: new Date().toISOString(),
  },
];

export default function App() {
  const [summary, setSummary] = useState<DashboardSummary>(INITIAL_SUMMARY);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>(INITIAL_AI_MESSAGES);

  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [hasAdminAccount, setHasAdminAccount] = useState<boolean>(true);

  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('documents');
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [selectedDocForAi, setSelectedDocForAi] = useState<DocumentItem | null>(null);

  const refreshAll = useCallback(async () => {
    const [sumRes, docsRes, projRes, usersRes, aiRes, authRes] = await Promise.all([
      docuzillaApi.getDashboardSummary(),
      docuzillaApi.listDocuments(),
      docuzillaApi.listProjects(),
      docuzillaApi.listUsers(),
      docuzillaApi.listAiMessages(),
      docuzillaApi.getAuthStatus(),
    ]);

    setSummary(sumRes);
    setDocuments(Array.isArray(docsRes?.documents) ? docsRes.documents.filter(Boolean) : []);
    setProjects(Array.isArray(projRes?.projects) ? projRes.projects.filter(Boolean) : []);
    setUsers(Array.isArray(usersRes?.users) ? usersRes.users.filter(Boolean) : []);
    const safeMessages = Array.isArray(aiRes?.messages)
      ? aiRes.messages.filter((m): m is AiMessage => Boolean(m && typeof m === 'object' && typeof m.role === 'string'))
      : [];
    if (safeMessages.length > 0) {
      setAiMessages(safeMessages);
    }
    setHasAdminAccount(Boolean(authRes?.hasAdminAccount));
    setCurrentUser(authRes?.currentUser ?? null);
  }, []);

  useEffect(() => {
    refreshAll().catch((err) => {
      console.error('[DocuZilla] Initial load error:', err);
    });
  }, [refreshAll]);

  const handleOpenWorkspace = (tab: WorkspaceTab) => {
    setWorkspaceTab(tab);
    setWorkspaceOpen(true);
  };

  const handleLogout = () => {
    docuzillaApi.logout();
    setCurrentUser(null);
  };

  const handleSelectDocumentFromSearch = (doc: DocumentItem) => {
    setWorkspaceTab(doc.approvalStatus === 'pending' ? 'approvals' : 'documents');
    setWorkspaceOpen(true);
  };

  const pendingDocs = documents.filter((d) => d.approvalStatus === 'pending');

  return (
    <div className="min-h-screen bg-[#F3F6FB] p-2.5 sm:p-4 lg:p-5">
      <main className="max-w-[1440px] mx-auto space-y-4">
        <HeroBanner
          summary={summary}
          currentUser={currentUser}
          pendingDocs={pendingDocs}
          onOpenWorkspace={handleOpenWorkspace}
          onOpenAuth={() => setAuthModalOpen(true)}
          onLogout={handleLogout}
          onSelectDocument={handleSelectDocumentFromSearch}
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-8 flex flex-col">
            <AnalyticsSection
              analytics={summary.analytics}
              onOpenWorkspace={handleOpenWorkspace}
            />
          </div>

          <div className="lg:col-span-4 flex flex-col">
            <AiAssistantCard
              messages={aiMessages}
              onMessagesUpdate={setAiMessages}
              selectedDocForAi={selectedDocForAi}
              onClearSelectedDoc={() => setSelectedDocForAi(null)}
              onExpandAi={() => handleOpenWorkspace('documents')}
            />
          </div>
        </div>
      </main>

      <WorkspaceModal
        open={workspaceOpen}
        activeTab={workspaceTab}
        onChangeTab={setWorkspaceTab}
        onClose={() => setWorkspaceOpen(false)}
        currentUser={currentUser}
        onRequireAuth={() => setAuthModalOpen(true)}
        summary={summary}
        documents={documents}
        projects={projects}
        users={users}
        onRefreshAll={refreshAll}
        onAskAiAboutDoc={(doc) => setSelectedDocForAi(doc)}
      />

      <AuthModal
        open={authModalOpen}
        hasAdminAccount={hasAdminAccount}
        users={users}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(user) => {
          setCurrentUser(user);
          setHasAdminAccount(true);
          refreshAll().catch(() => {});
        }}
      />
    </div>
  );
}
