'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Building2, KeyRound, LogOut, ScrollText, Shield, User, UserPlus, UserRound, Users } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, type TechnicianUser } from '@/lib/api';
import type { TechnicianSession } from '@/types';
import { DealershipBranding } from '@/components/DealershipBranding';
import { CONSENT_VERSION } from '@/types';

interface SettingsViewProps {
  session: TechnicianSession;
  onBack: () => void;
  onLogout: () => Promise<void>;
  onOpenAuditLogs?: () => void;
  onOpenServiceAdvisors?: () => void;
}

export function SettingsView({ session, onBack, onLogout, onOpenAuditLogs, onOpenServiceAdvisors }: SettingsViewProps) {
  const [users, setUsers] = useState<TechnicianUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', name: '', password: '', role: 'technician' as 'technician' | 'manager' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const isManager = session.role === 'manager';
  const isAdmin = session.isAdmin === true;

  const loadUsers = useCallback(async () => {
    if (!isManager) return;
    setUsersLoading(true);
    try {
      const { users: list } = await api.listUsers();
      setUsers(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, [isManager]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleLogout = async () => {
    try {
      await onLogout();
      toast.success('Signed out');
    } catch {
      toast.error('Logout failed');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      const result = await api.changePassword(currentPassword, newPassword);
      if (result.requiresReauth) {
        toast.success('Password updated — please sign in again');
        await onLogout();
        return;
      }
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await api.createUser(newUser);
      toast.success('Technician account created');
      setNewUser({ email: '', name: '', password: '', role: 'technician' });
      setShowCreateForm(false);
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const toggleUserActive = async (user: TechnicianUser) => {
    try {
      await api.updateUser(user.id, { isActive: !user.isActive });
      toast.success(user.isActive ? 'Account deactivated' : 'Account reactivated');
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update account');
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!resetPassword || resetPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    try {
      await api.resetUserPassword(userId, resetPassword);
      toast.success('Password reset successfully');
      setResetTargetId(null);
      setResetPassword('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset password');
    }
  };

  return (
    <div className="px-5 pt-6 pb-10">
      <button onClick={onBack} className="flex items-center text-[#0a84ff] mb-6">
        <ArrowLeft size={18} className="mr-1" /> Back
      </button>

      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

      <div className="ios-card p-5 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-[#2c2c2e] flex items-center justify-center">
            <User size={18} className="text-[#0a84ff]" />
          </div>
          <div>
            <div className="font-semibold">{session.name}</div>
            <div className="text-xs text-[#8e8e93]">{session.email}</div>
            <div className="text-[10px] text-[#666] capitalize">{session.role}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 pt-1">
          <Building2 size={14} className="text-[#8e8e93]" />
          <DealershipBranding size="sm" />
        </div>
      </div>

      <div className="ios-card p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={16} className="text-[#0a84ff]" />
          <div className="font-semibold text-sm">Change Password</div>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-2">
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full bg-[#1c1c1e] rounded px-3 py-2 text-sm"
            required
          />
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full bg-[#1c1c1e] rounded px-3 py-2 text-sm"
            minLength={8}
            required
          />
          <button type="submit" disabled={changingPassword} className="primary-btn w-full h-10 text-sm disabled:opacity-60">
            {changingPassword ? 'UPDATING...' : 'UPDATE PASSWORD'}
          </button>
        </form>
      </div>

      <div className="ios-card p-5 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={16} className="text-[#30d158]" />
          <div className="font-semibold text-sm">Security & Compliance</div>
        </div>
        <ul className="text-xs text-[#8e8e93] space-y-2 leading-relaxed">
          <li>✓ Grok API key secured server-side — never in browser</li>
          <li>✓ Customer name, VIN, complaints, OCR text, technician notes, and warranty stories encrypted at rest (AES-256-GCM)</li>
          <li>✓ Diagnostic images stored privately in Vercel Blob (session-gated access)</li>
          <li>✓ Session-based technician authentication (12h)</li>
          <li>✓ Audit-safe warranty prompt — no fabricated data</li>
          <li>
            Consent accepted:{' '}
            {session.consentAt ? new Date(session.consentAt).toLocaleDateString() : 'Pending'} (v{CONSENT_VERSION})
          </li>
        </ul>
      </div>

      {isAdmin && (
        <Link
          href="/admin/usage"
          className="ios-card p-5 mb-4 w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-[#0a84ff]" />
            <div>
              <div className="font-semibold text-sm">Usage</div>
              <div className="text-[10px] text-[#8e8e93]">Daily AI usage limits & technician analytics</div>
            </div>
          </div>
          <span className="text-[#0a84ff] text-xs">OPEN</span>
        </Link>
      )}

      {isManager && onOpenServiceAdvisors && (
        <button
          onClick={onOpenServiceAdvisors}
          className="ios-card p-5 mb-4 w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <UserRound size={16} className="text-[#0a84ff]" />
            <div>
              <div className="font-semibold text-sm">Service Advisors</div>
              <div className="text-[10px] text-[#8e8e93]">Advisor Intelligence profiles & complaint patterns</div>
            </div>
          </div>
          <span className="text-[#0a84ff] text-xs">OPEN</span>
        </button>
      )}

      {isManager && onOpenAuditLogs && (
        <button
          onClick={onOpenAuditLogs}
          className="ios-card p-5 mb-4 w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <ScrollText size={16} className="text-[#0a84ff]" />
            <div>
              <div className="font-semibold text-sm">Audit Log</div>
              <div className="text-[10px] text-[#8e8e93]">View and export dealership activity</div>
            </div>
          </div>
          <span className="text-[#0a84ff] text-xs">OPEN</span>
        </button>
      )}

      {isManager && (
        <div className="ios-card p-5 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-[#0a84ff]" />
              <div className="font-semibold text-sm">Technician Accounts</div>
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="text-[10px] text-[#0a84ff] flex items-center gap-1"
            >
              <UserPlus size={12} /> {showCreateForm ? 'CANCEL' : 'ADD USER'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="mb-4 space-y-2 border-b border-[#38383a] pb-4">
              <input
                type="text"
                placeholder="Full name"
                value={newUser.name}
                onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))}
                className="w-full bg-[#1c1c1e] rounded px-3 py-2 text-sm"
                required
              />
              <input
                type="email"
                placeholder="Email"
                value={newUser.email}
                onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
                className="w-full bg-[#1c1c1e] rounded px-3 py-2 text-sm"
                required
              />
              <input
                type="password"
                placeholder="Password (min 8 characters)"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                className="w-full bg-[#1c1c1e] rounded px-3 py-2 text-sm"
                minLength={8}
                required
              />
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value as 'technician' | 'manager' }))}
                className="w-full bg-[#1c1c1e] rounded px-3 py-2 text-sm"
              >
                <option value="technician">Technician</option>
                <option value="manager">Manager</option>
              </select>
              <button type="submit" disabled={creating} className="primary-btn w-full h-10 text-sm disabled:opacity-60">
                {creating ? 'CREATING...' : 'CREATE ACCOUNT'}
              </button>
            </form>
          )}

          {usersLoading ? (
            <div className="text-xs text-[#8e8e93]">Loading accounts...</div>
          ) : users.length === 0 ? (
            <div className="text-xs text-[#8e8e93]">No accounts found.</div>
          ) : (
            <div className="space-y-2">
              {users.map((user) => (
                <div key={user.id} className="bg-[#1c1c1e] rounded px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="text-[10px] text-[#8e8e93]">
                        {user.email} · {user.role}
                        {!user.isActive && <span className="text-[#ff3b30] ml-1">(deactivated)</span>}
                      </div>
                    </div>
                    {user.id !== session.technicianId && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setResetTargetId(resetTargetId === user.id ? null : user.id);
                            setResetPassword('');
                          }}
                          className="text-[10px] px-2 py-1 rounded text-[#0a84ff]"
                        >
                          RESET PW
                        </button>
                        <button
                          onClick={() => toggleUserActive(user)}
                          className={`text-[10px] px-2 py-1 rounded ${user.isActive ? 'text-[#ff9f0a]' : 'text-[#30d158]'}`}
                        >
                          {user.isActive ? 'DEACTIVATE' : 'REACTIVATE'}
                        </button>
                      </div>
                    )}
                  </div>
                  {resetTargetId === user.id && (
                    <div className="mt-2 flex gap-2">
                      <input
                        type="password"
                        placeholder="New password"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        className="flex-1 bg-[#2c2c2e] rounded px-2 py-1 text-xs"
                        minLength={8}
                      />
                      <button
                        onClick={() => handleResetPassword(user.id)}
                        className="text-[10px] text-[#30d158] px-2"
                      >
                        SAVE
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="ios-card p-5 mb-6">
        <div className="font-semibold mb-1 text-sm">Multi-Technician Access</div>
        <p className="text-xs text-[#8e8e93] leading-relaxed">
          Each technician signs in with their own account. Repair orders are owned by the creating technician. Service
          managers can view all ROs, manage accounts, reset passwords, and review audit logs.
        </p>
      </div>

      <button
        onClick={handleLogout}
        className="w-full secondary-btn h-12 flex items-center justify-center gap-2 text-[#ff9f0a] text-sm font-semibold"
      >
        <LogOut size={16} /> SIGN OUT
      </button>
    </div>
  );
}