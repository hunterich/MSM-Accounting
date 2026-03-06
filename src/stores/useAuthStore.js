import { create } from 'zustand';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const useAuthStore = create((set) => ({
  user: null,
  org: null,
  roleType: null,
  permissions: [],
  isLoading: true,

  checkSession: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API}/api/v1/auth/me`, {
        credentials: 'include',
      });

      if (res.ok) {
        const data = await res.json();
        set({
          user: data.user,
          org: data.org,
          roleType: data.role?.type || null,
          permissions: data.role?.permissions || [],
          isLoading: false,
        });
        return;
      }

      set({
        user: null,
        org: null,
        roleType: null,
        permissions: [],
        isLoading: false,
      });
    } catch {
      set({
        user: null,
        org: null,
        roleType: null,
        permissions: [],
        isLoading: false,
      });
    }
  },

  login: async (email, password) => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Login failed');
    }

    const data = await res.json();

    set({
      user: data.user,
      org: data.org,
      roleType: data.roleType,
      permissions: data.permissions || [],
      isLoading: false,
    });

    return data;
  },

  loginWithGoogle: async (credential) => {
    const res = await fetch(`${API}/api/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
      credentials: 'include',
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? 'Google login failed');
    }

    const data = await res.json();

    set({
      user: data.user,
      org: data.org,
      roleType: data.roleType,
      permissions: data.permissions || [],
      isLoading: false,
    });

    return data;
  },

  logout: async () => {
    try {
      await fetch(`${API}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      set({
        user: null,
        org: null,
        roleType: null,
        permissions: [],
        isLoading: false,
      });
    }
  },
}));
