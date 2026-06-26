'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  KeyRound,
  LogOut,
  ScrollText,
  User,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { BenzEmptyState } from '@/components/BenzEmptyState';
import Link from 'next/link';
import { toast } from 'sonner';
import { api, type TechnicianUser } from '@/lib/api';
import type { TechnicianSession } from '@/types';
import { DealershipBranding } from '@/components/DealershipBranding';
import { SecurityComplianceSection } from '@/components/SecurityComplianceSection';

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
  const [newUser, setNewUser] = useState({ d7Number: '', name: '', password: '', role: 'technician' as 'technician' | 'manager' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const isManager = session.role === 'manager';
  const isAdmin = session.isAdmin === true;
  const visibleUsers = useMemo(() => users.filter((user) => !user.deletedAt), [users]);

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
      setNewUser({ d7Number: '', name: '', password: '', role: 'technician' });
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

  const handleDeleteUser = async (user: TechnicianUser) => {
    const confirmed = window.confirm(
      `Remove ${user.name} (${user.d7Number}) from Technician Accounts?\n\nThey will be deactivated and hidden from this list. Their repair orders and audit history are preserved.`
    );
    if (!confirmed) return;

    setDeletingUserId(user.id);
    try {
      await api.deleteUser(user.id);
      toast.success('Technician removed');
      if (resetTargetId === user.id) {
        setResetTargetId(null);
        setResetPassword('');
      }
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove technician');
    } finally {
      setDeletingUserId(null);
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
    <div className="benz-page">
      <button onClick={onBack} className="benz-nav-back">
        <ArrowLeft size={18} /> Back
      </button>

      <h2 className="benz-page-title">Settings</h2>

      <div className="benz-card p-5 mb-5">
        <div className="flex items-center gap-4 mb-5">
          <div className="benz-avatar text-benz-blue">
            <User size={20} />
          </div>
          <div>
            <div className="font-semibold text-base tracking-tight">{session.name}</div>
            <div className="text-xs text-benz-secondary font-mono tracking-wide mt-0.5">{session.d7Number}</div>
            <div className="text-xs text-benz-muted capitalize mt-1 font-medium">{session.role}</div>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 pt-2 benz-divider">
          <Building2 size={14} className="text-benz-muted" />
          <DealershipBranding size="sm" />
        </div>
      </div>

      <div className="benz-card p-5 mb-5">
        <div className="flex items-center gap-2.5 mb-4">
          <KeyRound size={18} className="text-benz-blue" />
          <div className="font-semibold text-sm tracking-tight">Change Password</div>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="benz-input"
            required
          />
          <input
            type="password"
            placeholder="New password (min 8 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="benz-input"
            minLength={8}
            required
          />
          <button type="submit" disabled={changingPassword} className="primary-btn w-full h-12 text-sm disabled:opacity-50">
            {changingPassword ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>

      <SecurityComplianceSection consentAt={session.consentAt} />

      {isAdmin && (
        <Link href="/admin/usage" className="benz-settings-nav mb-4 block no-underline text-inherit">
          <div className="flex items-center gap-3">
            <BarChart3 size={18} className="text-benz-blue shrink-0" />
            <div>
              <div className="font-semibold text-sm">Usage</div>
              <div className="benz-hint mt-0.5">Daily AI usage limits & technician analytics</div>
            </div>
          </div>
          <span className="text-benz-blue text-xs font-semibold">Open</span>
        </Link>
      )}

      {isManager && onOpenServiceAdvisors && (
        <button onClick={onOpenServiceAdvisors} className="benz-settings-nav mb-4">
          <div className="flex items-center gap-3">
            <UserRound size={18} className="text-benz-blue shrink-0" />
            <div>
              <div className="font-semibold text-sm">Service Advisors</div>
              <div className="benz-hint mt-0.5">Advisor Intelligence profiles & complaint patterns</div>
            </div>
          </div>
          <span className="text-benz-blue text-xs font-semibold">Open</span>
        </button>
      )}

      {isManager && onOpenAuditLogs && (
        <button onClick={onOpenAuditLogs} className="benz-settings-nav mb-4">
          <div className="flex items-center gap-3">
            <ScrollText size={18} className="text-benz-blue shrink-0" />
            <div>
              <div className="font-semibold text-sm">Audit Log</div>
              <div className="benz-hint mt-0.5">View and export dealership activity</div>
            </div>
          </div>
          <span className="text-benz-blue text-xs font-semibold">Open</span>
        </button>
      )}

      {isManager && (
        <div className="benz-card p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <Users size={18} className="text-benz-blue" />
              <div>
                <div className="font-semibold text-sm tracking-tight">Technician accounts</div>
                <div className="benz-hint mt-0.5">{visibleUsers.length} active listing{visibleUsers.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className={`secondary-btn text-xs h-9 px-3 flex items-center gap-1.5 font-medium ${showCreateForm ? 'benz-btn-accent-outline' : ''}`}
            >
              <UserPlus size={14} /> {showCreateForm ? 'Cancel' : 'Add user'}
            </button>
          </div>

          {showCreateForm && (
            <form onSubmit={handleCreateUser} className="benz-admin-form-panel space-y-3">
              <div className="benz-section-title mb-1">New account</div>
              <input
                type="text"
                placeholder="Full name"
                value={newUser.name}
                onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))}
                className="benz-input"
                required
              />
              <input
                type="text"
                placeholder="D7 number (e.g. D7HARRIH)"
                value={newUser.d7Number}
                onChange={(e) => setNewUser((u) => ({ ...u, d7Number: e.target.value.toUpperCase() }))}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="benz-input benz-input-mono uppercase"
                required
              />
              <input
                type="password"
                placeholder="Password (min 8 characters)"
                value={newUser.password}
                onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                className="benz-input"
                minLength={8}
                required
              />
              <select
                value={newUser.role}
                onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value as 'technician' | 'manager' }))}
                className="benz-input"
              >
                <option value="technician">Technician</option>
                <option value="manager">Manager</option>
              </select>
              <button type="submit" disabled={creating} className="primary-btn w-full h-11 text-sm disabled:opacity-50">
                {creating ? 'Creating…' : 'Create account'}
              </button>
            </form>
          )}

          {usersLoading ? (
            <div className="text-xs text-benz-secondary py-4 text-center">Loading accounts…</div>
          ) : visibleUsers.length === 0 ? (
            <BenzEmptyState
              icon={Users}
              title="No technician accounts"
              hint="Add your first technician or manager account to enable multi-user shop access."
              compact
            />
          ) : (
            <div className="space-y-3">
              {visibleUsers.map((user) => (
                <div
                  key={user.id}
                  className={`benz-admin-user-card ${!user.isActive ? 'benz-admin-user-card-inactive' : ''}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="benz-avatar text-benz-blue shrink-0 w-10 h-10">
                        <User size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold tracking-tight truncate">{user.name}</div>
                        <div className="text-xs text-benz-secondary font-mono mt-0.5">{user.d7Number}</div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span className="status-pill bg-benz-surface-3 text-benz-silver border border-benz-surface-3 capitalize">
                            {user.role}
                          </span>
                          {!user.isActive && (
                            <span className="status-pill status-pill-warn">Deactivated</span>
                          )}
                          {user.id === session.technicianId && (
                            <span className="text-xs text-benz-muted">You</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {user.id !== session.technicianId && (
                      <div className="benz-admin-actions shrink-0">
                        <button
                          onClick={() => {
                            setResetTargetId(resetTargetId === user.id ? null : user.id);
                            setResetPassword('');
                          }}
                          className={`benz-admin-action-btn benz-admin-action-btn-accent ${resetTargetId === user.id ? 'bg-benz-accent/10' : ''}`}
                        >
                          <KeyRound size={12} /> Reset
                        </button>
                        <button
                          onClick={() => toggleUserActive(user)}
                          className={`benz-admin-action-btn ${user.isActive ? 'benz-admin-action-btn-warn' : 'benz-admin-action-btn-accent'}`}
                        >
                          {user.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user)}
                          disabled={deletingUserId === user.id}
                          className="benz-admin-action-btn benz-admin-action-btn-danger disabled:opacity-50"
                        >
                          {deletingUserId === user.id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    )}
                  </div>
                  {resetTargetId === user.id && (
                    <div className="benz-admin-reset-panel flex gap-2 items-center">
                      <input
                        type="password"
                        placeholder="New password (min 8 characters)"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        className="benz-input flex-1"
                        minLength={8}
                      />
                      <button
                        onClick={() => handleResetPassword(user.id)}
                        className="secondary-btn benz-btn-success-outline h-10 px-4 text-xs font-medium shrink-0"
                      >
                        Save
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="benz-card p-5 mb-6">
        <div className="font-semibold mb-2 text-sm">Multi-Technician Access</div>
        <p className="text-xs text-benz-secondary leading-relaxed">
          Each technician signs in with their own account. Repair orders are owned by the creating technician. Service
          managers can view all ROs, manage accounts, reset passwords, and review audit logs.
        </p>
      </div>

      <button
        onClick={handleLogout}
        className="w-full secondary-btn h-13 flex items-center justify-center gap-2 text-sm font-medium"
      >
        <LogOut size={18} /> Sign out
      </button>
    </div>
  );
}