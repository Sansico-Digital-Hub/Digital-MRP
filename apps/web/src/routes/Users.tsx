import React, { useState } from 'react';
import { useUsers, useCreateUser, useDeleteUser, useUpdateUser } from '../hooks/useUsers';
import { Plus, Trash2, Shield, UserX, UserCheck } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useTranslation } from '../i18n';

export function Users() {
  const { t } = useTranslation();
  const currentUser = useAuthStore(state => state.user);
  const { data, isLoading } = useUsers();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'USER' });

  const users = data?.data || [];

  if (currentUser?.role !== 'SUPER_ADMIN') {
    return (
      <div className="bg-destructive/10 text-destructive border-destructive/20 border p-6 rounded-lg text-center">
        <Shield className="mx-auto mb-2 opacity-50" size={48} />
        <h2 className="text-xl font-bold">{t('users.accessDenied')}</h2>
        <p className="text-sm mt-2">{t('users.accessDeniedDesc')}</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createUser.mutateAsync(formData);
      setFormData({ name: '', email: '', password: '', role: 'USER' });
      setShowForm(false);
    } catch (err: any) {
      alert(err.message || t('users.errors.createFailed'));
    }
  };

  const handleChangeRole = async (id: string, newRole: string) => {
    try {
      await updateUser.mutateAsync({ id, data: { role: newRole } });
    } catch (err: any) {
      alert(err.message || t('users.errors.updateRoleFailed'));
    }
  };

  const handleToggleStatus = async (id: string, currentStatus: boolean) => {
    try {
      await updateUser.mutateAsync({ id, data: { isActive: !currentStatus } });
    } catch (err: any) {
      alert(err.message || t('users.errors.updateStatusFailed'));
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm(t('users.confirmDelete'))) {
      try {
        await deleteUser.mutateAsync(id);
      } catch (err: any) {
        alert(err.message || t('users.errors.deleteFailed'));
      }
    }
  };

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">{t('users.loading')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t('users.title')}</h2>
          <p className="text-muted-foreground text-sm">{t('users.subtitle')}</p>
        </div>
        <button 
          onClick={() => setShowForm(!showForm)}
          className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center space-x-2"
        >
          <Plus size={16} />
          <span>{t('users.addNew')}</span>
        </button>
      </div>

      {showForm && (
        <div className="bg-card text-card-foreground border rounded-lg p-6 shadow-sm">
          <h3 className="font-semibold mb-4">{t('users.registerTitle')}</h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('users.fullName')}</label>
              <input 
                type="text" required
                className="w-full h-10 px-3 border rounded-md"
                value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('users.emailAddress')}</label>
              <input 
                type="email" required
                className="w-full h-10 px-3 border rounded-md"
                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('users.temporaryPassword')}</label>
              <input 
                type="password" required minLength={6}
                className="w-full h-10 px-3 border rounded-md"
                value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('users.systemRole')}</label>
              <select 
                className="w-full h-10 px-3 border rounded-md bg-background"
                value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})}
              >
                <option value="USER">{t('users.formRoles.USER')}</option>
                <option value="PRODUCTION_PLANNER">{t('users.formRoles.PRODUCTION_PLANNER')}</option>
                <option value="MATERIAL_PLANNER">{t('users.formRoles.MATERIAL_PLANNER')}</option>
                <option value="ADMIN">{t('users.formRoles.ADMIN')}</option>
                <option value="SUPER_ADMIN">{t('users.formRoles.SUPER_ADMIN')}</option>
              </select>
            </div>
            <div className="md:col-span-2 flex gap-3 mt-2">
              <button 
                type="submit" 
                disabled={createUser.isPending}
                className="h-10 bg-primary text-primary-foreground px-6 rounded-md font-medium disabled:opacity-50"
              >
                {createUser.isPending ? t('users.creating') : t('users.createAccount')}
              </button>
              <button 
                type="button" 
                onClick={() => setShowForm(false)}
                className="h-10 border px-6 rounded-md font-medium"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-card text-card-foreground border rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-secondary/50 text-muted-foreground uppercase text-xs font-medium">
              <tr>
                <th className="px-6 py-3">{t('common.name')}</th>
                <th className="px-6 py-3">{t('users.email')}</th>
                <th className="px-6 py-3">{t('users.role')}</th>
                <th className="px-6 py-3 text-center">{t('common.status')}</th>
                <th className="px-6 py-3 text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-muted/50 transition-colors">
                  <td className="px-6 py-4 font-medium">{user.name}</td>
                  <td className="px-6 py-4">{user.email}</td>
                  <td className="px-6 py-4">
                    <select
                      value={user.role}
                      onChange={(e) => handleChangeRole(user.id, e.target.value)}
                      disabled={updateUser.isPending || user.id === currentUser?.id}
                      className={`px-2 py-1 rounded text-xs font-bold border-0 outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                        user.role === 'SUPER_ADMIN' ? 'bg-destructive/10 text-destructive' :
                        user.role === 'ADMIN' ? 'bg-primary/10 text-primary' :
                        user.role === 'PRODUCTION_PLANNER' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' :
                        user.role === 'MATERIAL_PLANNER' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                        'bg-secondary text-foreground'
                      }`}
                    >
                      <option value="USER">{t('users.roles.USER')}</option>
                      <option value="PRODUCTION_PLANNER">{t('users.roles.PRODUCTION_PLANNER')}</option>
                      <option value="MATERIAL_PLANNER">{t('users.roles.MATERIAL_PLANNER')}</option>
                      <option value="ADMIN">{t('users.roles.ADMIN')}</option>
                      <option value="SUPER_ADMIN">{t('users.roles.SUPER_ADMIN')}</option>
                    </select>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {user.isActive ? (
                      <span className="text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-500 px-2 py-1 rounded-full text-xs font-medium flex items-center justify-center w-fit mx-auto gap-1">
                        <UserCheck size={14} /> {t('users.active')}
                      </span>
                    ) : (
                      <span className="text-muted-foreground bg-secondary px-2 py-1 rounded-full text-xs font-medium flex items-center justify-center w-fit mx-auto gap-1">
                        <UserX size={14} /> {t('users.inactive')}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2 flex justify-end">
                    <button 
                      onClick={() => handleToggleStatus(user.id, user.isActive)}
                      disabled={updateUser.isPending || user.id === currentUser?.id}
                      className="text-muted-foreground hover:text-foreground p-1 rounded-md transition-colors disabled:opacity-30"
                      title={user.isActive ? t('users.deactivateUser') : t('users.activateUser')}
                    >
                      {user.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                    <button 
                      onClick={() => handleDelete(user.id)}
                      disabled={deleteUser.isPending || user.id === currentUser?.id}
                      className="text-muted-foreground hover:text-destructive p-1 rounded-md hover:bg-destructive/10 transition-colors disabled:opacity-30"
                      title={t('users.deleteUser')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
