import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  FileText,
  Folder,
  LogIn,
  LogOut,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { HeroGlassFan } from './HeroGlassFan.tsx';
import { docuzillaApi } from '../lib/api.ts';
import type {
  DashboardSummary,
  DocumentItem,
  ProjectItem,
  PublicUser,
  WorkspaceTab,
} from '../types/docuzilla.ts';

interface HeroBannerProps {
  summary: DashboardSummary;
  currentUser: PublicUser | null;
  pendingDocs: DocumentItem[];
  onOpenWorkspace: (tab: WorkspaceTab) => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onSelectDocument: (doc: DocumentItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  summary,
  currentUser,
  pendingDocs,
  onOpenWorkspace,
  onOpenAuth,
  onLogout,
  onSelectDocument,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    projects: ProjectItem[];
    documents: DocumentItem[];
    users: PublicUser[];
  }>({ projects: [], documents: [], users: [] });

  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(target)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults({ projects: [], documents: [], users: [] });
      return;
    }
    const timer = setTimeout(() => {
      docuzillaApi
        .searchAll(q)
        .then((res) => setSearchResults(res))
        .catch(() => {});
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const greetingText = currentUser
    ? `Welcome back, ${currentUser.name.split(' ')[0]}`
    : 'Welcome to DocuZilla';
  const displayProfileName = currentUser ? currentUser.name : 'Sign In';
  const displayProfileRole = currentUser
    ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)
    : 'Guest Session';

  const hasSearchResults =
    searchResults.projects.length > 0 ||
    searchResults.documents.length > 0 ||
    searchResults.users.length > 0;

  return (
    <section className="docuzilla-hero-bg relative rounded-[26px] sm:rounded-[30px] text-white shadow-[0_12px_36px_-12px_rgba(37,99,235,0.35)]">
      {/* 3D Glass Tubes Sculpture */}
      <HeroGlassFan />

      {/* Top Bar inside Hero */}
      <div className="relative z-30 flex items-center justify-between gap-4 px-5 sm:px-7 pt-5 sm:pt-6">
        {/* Search Pill */}
        <div ref={searchRef} className="relative w-full max-w-[270px] sm:max-w-[320px]">
          <div className="flex items-center gap-2.5 h-10 sm:h-11 px-4 rounded-full bg-white/15 backdrop-blur-md border border-white/20 focus-within:bg-white/22 focus-within:border-white/40 transition-colors">
            <Search className="w-4 h-4 text-white/85 shrink-0" strokeWidth={1.8} />
            <input
              type="text"
              value={searchQuery}
              onFocus={() => setSearchOpen(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchOpen(true);
              }}
              placeholder="Search projects, documents, users..."
              className="w-full bg-transparent text-[13px] text-white placeholder:text-white/75 focus:outline-none truncate"
              aria-label="Search projects, documents, users"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="text-white/70 hover:text-white"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {searchOpen && searchQuery.trim().length > 0 && (
            <div className="absolute left-0 right-0 mt-2 bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden z-50">
              {!hasSearchResults ? (
                <div className="px-4 py-3 text-xs text-slate-500">
                  No matching projects, documents, or users found.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {searchResults.documents.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">
                        Documents
                      </div>
                      {searchResults.documents.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onSelectDocument(doc);
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2 transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-900 truncate">
                              {doc.title}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {doc.projectName} · {doc.approvalStatus}
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.projects.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">
                        Projects
                      </div>
                      {searchResults.projects.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onOpenWorkspace('projects');
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-900 truncate">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {p.code} · {p.department}
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                  {searchResults.users.length > 0 && (
                    <div className="p-2">
                      <div className="px-2 py-1 text-[11px] font-semibold text-slate-400">
                        Team &amp; Hierarchy
                      </div>
                      {searchResults.users.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setSearchOpen(false);
                            onOpenWorkspace('hierarchy');
                          }}
                          className="w-full text-left px-2.5 py-2 rounded-xl hover:bg-slate-50 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-900 truncate">
                              {u.name}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {u.title} · {u.department}
                            </div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Controls: Bell + Profile Pill */}
        <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
          {/* Notification Bell */}
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen((v) => !v);
                setProfileOpen(false);
              }}
              className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-white/15 backdrop-blur-md border border-white/20 hover:bg-white/25 flex items-center justify-center transition-colors cursor-pointer"
              aria-label="Pending approval notifications"
            >
              <Bell className="w-[18px] h-[18px] text-white" strokeWidth={1.8} />
              {pendingDocs.length > 0 && (
                <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-[#EF4444] ring-2 ring-[#6482EF]" />
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">
                    1-Level Approval Queue
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen(false);
                      onOpenWorkspace('approvals');
                    }}
                    className="text-[11px] font-medium text-blue-600 hover:underline"
                  >
                    Open Queue
                  </button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                  {pendingDocs.length === 0 ? (
                    <div className="px-4 py-5 text-xs text-slate-500 text-center">
                      All documents are reviewed.
                    </div>
                  ) : (
                    pendingDocs.slice(0, 5).map((doc) => (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          onOpenWorkspace('approvals');
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="text-xs font-medium text-slate-900 truncate">
                          {doc.title}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          Submitted by {doc.uploadedByName} → {doc.assignedApproverName || 'Approver'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile Pill */}
          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileOpen((v) => !v);
                setNotifOpen(false);
              }}
              className="h-10 sm:h-11 rounded-full bg-white/15 backdrop-blur-md border border-white/20 hover:bg-white/25 pl-1.5 pr-3.5 flex items-center gap-2.5 transition-colors cursor-pointer"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#1C2434] flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
                {currentUser ? (
                  currentUser.avatarInitials
                ) : (
                  <ShieldCheck className="w-4 h-4 text-white" strokeWidth={1.8} />
                )}
              </div>
              <div className="text-left leading-tight hidden sm:block">
                <div className="text-[13px] font-medium text-white whitespace-nowrap">
                  {displayProfileName}
                </div>
                <div className="text-[10.5px] text-white/75 whitespace-nowrap">
                  {displayProfileRole}
                </div>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-white/80 ml-0.5 shrink-0" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200/80 overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-slate-100">
                  <div className="text-xs font-semibold text-slate-900">
                    {currentUser ? currentUser.name : 'DocuZilla Workspace'}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate mt-0.5">
                    {currentUser
                      ? `${currentUser.email} · ${currentUser.title}`
                      : 'Sign in to upload & approve documents'}
                  </div>
                </div>
                <div className="p-1.5 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenWorkspace('documents');
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-blue-600" />
                    Data Room &amp; Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenWorkspace('approvals');
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <Clock className="w-3.5 h-3.5 text-amber-600" />
                    1-Level Approval Queue
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileOpen(false);
                      onOpenWorkspace('hierarchy');
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                  >
                    <Users className="w-3.5 h-3.5 text-emerald-600" />
                    Management Hierarchy
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  {currentUser ? (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        onLogout();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign Out
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        onOpenAuth();
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl text-xs font-semibold text-blue-600 hover:bg-blue-50 flex items-center gap-2"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Sign In / Claim Admin
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hero Editorial Headline */}
      <div className="relative z-20 px-5 sm:px-8 lg:px-10 pt-7 sm:pt-9 pb-7 sm:pb-10 max-w-xl">
        <p className="text-[13px] sm:text-[13.5px] font-normal text-white/85 mb-2.5 tracking-[-0.01em]">
          {greetingText} <span aria-hidden="true">👋</span>
        </p>
        <h1 className="text-[34px] sm:text-[42px] lg:text-[46px] font-light tracking-[-0.025em] leading-[1.09] text-white mb-4">
          Your Data,
          <br />
          Smarter Insights
        </h1>
        <p className="text-[13px] sm:text-[14px] font-normal text-white/80 leading-[1.45] max-w-[300px]">
          Manage, analyze and secure your documents with AI-powered insights.
        </p>
      </div>

      {/* 5 Floating KPI Cards along the bottom edge */}
      <div className="relative z-20 px-4 sm:px-6 lg:px-7 pb-4 lg:pb-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-3.5 items-end">
        {/* 1. Active Projects */}
        <button
          type="button"
          onClick={() => onOpenWorkspace('projects')}
          className="group text-left mb-0 lg:mb-4 rounded-[20px] bg-white/18 hover:bg-white/24 backdrop-blur-xl border border-white/28 px-4 py-3.5 flex items-center justify-between gap-2.5 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[12px] border border-white/30 bg-white/10 flex items-center justify-center shrink-0">
              <Folder className="w-[18px] h-[18px] text-white/90" strokeWidth={1.6} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-white/80 font-normal truncate">
                Active Projects
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[20px] font-normal text-white tabular-nums tracking-tight leading-none">
                  {summary.kpis.activeProjects}
                </span>
                <span className="text-[10.5px] font-medium text-[#86EFAC] tabular-nums">
                  ↑ {summary.kpis.activeProjectsDelta}
                </span>
              </div>
            </div>
          </div>
          <span className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center text-white/90 group-hover:bg-white/15 shrink-0 transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>

        {/* 2. Total Users */}
        <button
          type="button"
          onClick={() => onOpenWorkspace('hierarchy')}
          className="group text-left mb-0 lg:mb-4 rounded-[20px] bg-white/18 hover:bg-white/24 backdrop-blur-xl border border-white/28 px-4 py-3.5 flex items-center justify-between gap-2.5 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[12px] border border-white/30 bg-white/10 flex items-center justify-center shrink-0">
              <Users className="w-[18px] h-[18px] text-white/90" strokeWidth={1.6} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-white/80 font-normal truncate">
                Total Users
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[20px] font-normal text-white tabular-nums tracking-tight leading-none">
                  {summary.kpis.totalUsers}
                </span>
                <span className="text-[10.5px] font-medium text-[#86EFAC] tabular-nums">
                  ↑ {summary.kpis.totalUsersDelta}
                </span>
              </div>
            </div>
          </div>
          <span className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center text-white/90 group-hover:bg-white/15 shrink-0 transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>

        {/* 3. Total Documents — Center Elevated Active White Notch Tab */}
        <button
          type="button"
          onClick={() => onOpenWorkspace('documents')}
          className="active-kpi-tab group text-left rounded-[20px] lg:rounded-t-[24px] lg:rounded-b-none px-4 sm:px-5 pt-4 pb-4 lg:pt-5 lg:pb-7 flex items-center justify-between gap-2.5 text-slate-900 shadow-[0_-6px_24px_-6px_rgba(15,23,42,0.12)] lg:shadow-none transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[12px] bg-[#EFF4FF] border border-[#DCE7FE] flex items-center justify-center shrink-0">
              <FileText className="w-[18px] h-[18px] text-[#3B66F5]" strokeWidth={1.7} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-slate-500 font-normal truncate">
                Total Documents
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[21px] font-medium text-slate-900 tabular-nums tracking-tight leading-none">
                  {summary.kpis.totalDocuments.toLocaleString('en-US')}
                </span>
                <span className="text-[10.5px] font-medium text-[#16A34A] tabular-nums">
                  ↑ {summary.kpis.totalDocumentsDelta}
                </span>
              </div>
            </div>
          </div>
          <span className="w-7 h-7 rounded-full border border-slate-200 bg-white flex items-center justify-center text-slate-600 group-hover:border-blue-300 group-hover:text-blue-600 shrink-0 transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>

        {/* 4. Data Room Size */}
        <button
          type="button"
          onClick={() => onOpenWorkspace('documents')}
          className="group text-left mb-0 lg:mb-4 rounded-[20px] bg-white/18 hover:bg-white/24 backdrop-blur-xl border border-white/28 px-4 py-3.5 flex items-center justify-between gap-2.5 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[12px] border border-white/30 bg-white/10 flex items-center justify-center shrink-0">
              <Database className="w-[18px] h-[18px] text-white/90" strokeWidth={1.6} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-white/80 font-normal truncate">
                Data Room Size
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[20px] font-normal text-white tabular-nums tracking-tight leading-none whitespace-nowrap">
                  {summary.kpis.dataRoomSizeFormatted || `${summary.kpis.dataRoomSizeGb} GB`}
                </span>
                <span className="text-[10.5px] font-medium text-[#86EFAC] tabular-nums">
                  ↑ {summary.kpis.dataRoomSizeDelta}
                </span>
              </div>
            </div>
          </div>
          <span className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center text-white/90 group-hover:bg-white/15 shrink-0 transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>

        {/* 5. Pending Reviews */}
        <button
          type="button"
          onClick={() => onOpenWorkspace('approvals')}
          className="group text-left mb-0 lg:mb-4 rounded-[20px] bg-white/18 hover:bg-white/24 backdrop-blur-xl border border-white/28 px-4 py-3.5 flex items-center justify-between gap-2.5 transition-all cursor-pointer"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-[12px] border border-white/30 bg-white/10 flex items-center justify-center shrink-0">
              <Clock className="w-[18px] h-[18px] text-white/90" strokeWidth={1.6} />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-white/80 font-normal truncate">
                Pending Reviews
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-[20px] font-normal text-white tabular-nums tracking-tight leading-none">
                  {summary.kpis.pendingReviews}
                </span>
              </div>
            </div>
          </div>
          <span className="w-7 h-7 rounded-full border border-white/30 flex items-center justify-center text-white/90 group-hover:bg-white/15 shrink-0 transition-colors">
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </button>
      </div>
    </section>
  );
};
