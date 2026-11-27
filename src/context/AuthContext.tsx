import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, setAuthToken } from '../lib/api';
import type { UserProfile, UserRole } from '../types/domain';

export const ROLE_HOME_ROUTES: Record<UserRole, string> = {
  super_admin: '/admin/dashboard',
  company_admin: '/empresa/dashboard',
  partner_requester: '/parceiro/servicos',
  technician: '/tecnico/agenda',
  customer: '/cliente/servicos',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin · Confiança',
  company_admin: 'Centro Técnico / Empresa',
  partner_requester: 'Parceiro Contratante',
  technician: 'Técnico',
  customer: 'Cliente Particular',
};

interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  nif?: string;
  iban?: string;
  address?: string;
  city?: string;
  postalCode?: string;
  role: 'customer' | 'technician' | 'company_admin' | 'partner_requester';
  organizationName?: string;
}

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<UserProfile>;
  demoLogin: (userId: string) => Promise<UserProfile>;
  register: (payload: RegisterInput) => Promise<UserProfile>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/auth/me');
      setUser(res.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const demoLogin = async (userId: string) => {
    const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    });
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const register = async (payload: RegisterInput) => {
    const res = await apiFetch<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, demoLogin, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
