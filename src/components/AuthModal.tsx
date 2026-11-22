import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, UserPlus, X } from 'lucide-react';
import { docuzillaApi } from '../lib/api.ts';
import type { PublicUser } from '../types/docuzilla.ts';

interface AuthModalProps {
  open: boolean;
  hasAdminAccount: boolean;
  users: PublicUser[];
  onClose: () => void;
  onAuthenticated: (user: PublicUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  hasAdminAccount,
  users,
  onClose,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'claim'>(
    hasAdminAccount ? 'login' : 'claim',
  );
  const [name, setName] = useState('Kerlin Kors');
  const [email, setEmail] = useState(hasAdminAccount ? '' : 'kerlin.kors@docuzilla.io');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('analyst');
  const [department, setDepartment] = useState('Financial Controls');
  const [title, setTitle] = useState('Audit Analyst');
  const [managerId, setManagerId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setPassword('');
      if (!hasAdminAccount) {
        setMode('claim');
        setName('Kerlin Kors');
        setEmail('kerlin.kors@docuzilla.io');
      } else if (mode === 'claim') {
        setMode('login');
        setEmail('');
      }
    }
  }, [open, hasAdminAccount]);

  useEffect(() => {
    if (managerId === '' && users.length > 0) {
      const defaultMgr = users.find((u) => u.canApprove && u.role === 'manager') || users.find((u) => u.canApprove);
      if (defaultMgr) setManagerId(defaultMgr.id);
    }
  }, [users, managerId]);

  if (!open) return null;

  const approvers = users.filter((u) => u.canApprove);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      if (mode === 'claim') {
        const res = await docuzillaApi.claimAdmin({ email, password, name });
        onAuthenticated(res.user);
        onClose();
      } else if (mode === 'login') {
        const res = await docuzillaApi.login({ email, password });
        onAuthenticated(res.user);
        onClose();
      } else {
        const res = await docuzillaApi.register({
          name,
          email,
          password,
          role,
          department,
          title,
          managerId: managerId === '' ? null : Number(managerId),
        });
        onAuthenticated(res.user);
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-[24px] shadow-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#EEF4FF] flex items-center justify-center text-[#3B66F5]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">DocuZilla Access</h3>
              <p className="text-xs text-slate-500">
                PostgreSQL Authenticated Data Room Session
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 cursor-pointer"
            aria-label="Close authentication modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {!hasAdminAccount && (
              <button
                type="button"
                onClick={() => {
                  setMode('claim');
                  setEmail('kerlin.kors@docuzilla.io');
                  setName('Kerlin Kors');
                  setError(null);
                }}
                className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  mode === 'claim'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Admin Setup
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setName('');
                setEmail('');
                setError(null);
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Register
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {mode === 'claim' && (
            <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-100 text-xs text-blue-900 leading-relaxed">
              First-run setup: claim the initial Workspace Admin account (Kerlin Kors) with your
              password. This bootstrap locks automatically once claimed.
            </div>
          )}

          {(mode === 'register' || mode === 'claim') && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Abhishek Patel"
                className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@docuzilla.io"
              className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Password <span className="text-slate-400 font-normal">(min 8 chars)</span>
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-10 px-3.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {mode === 'register' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="analyst">Analyst (Submitter)</option>
                    <option value="auditor">Auditor (Submitter)</option>
                    <option value="manager">Manager (Approver)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Job Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Direct Approver
                  </label>
                  <select
                    value={managerId}
                    onChange={(e) =>
                      setManagerId(e.target.value ? Number(e.target.value) : '')
                    }
                    className="w-full h-10 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">Auto-assign Approver</option>
                    {approvers.map((mgr) => (
                      <option key={mgr.id} value={mgr.id}>
                        {mgr.name} ({mgr.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="px-3.5 py-2.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-xl bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {mode === 'register' ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <Lock className="w-4 h-4" />
            )}
            {submitting
              ? 'Authenticating...'
              : mode === 'claim'
                ? 'Claim Admin & Sign In'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
};
