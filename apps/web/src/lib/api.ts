import { useAuthStore } from '../stores/authStore';

// Diekspor agar halaman Login bisa memakai URL yang sama tanpa hardcode.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

let refreshPromise: Promise<string | null> | null = null;

/**
 * Minta access token baru memakai cookie refresh httpOnly.
 *
 * Permintaan yang berjalan bersamaan berbagi satu promise yang sama, supaya
 * sepuluh request yang kena 401 sekaligus tidak memicu sepuluh kali refresh
 * (dan tidak saling membatalkan cookie hasil rotasi).
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function performRefresh(): Promise<string | null> {
  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { accessToken?: string };
    if (!data.accessToken) return null;

    useAuthStore.getState().updateAccessToken(data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

/** Hapus sesi di server (cookie refresh) lalu bersihkan state lokal. */
export async function logoutSession(): Promise<void> {
  useAuthStore.getState().logout();
  try {
    await fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Tidak apa-apa: state lokal sudah dibersihkan.
  }
}

export function redirectToLogin(): void {
  if (window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {},
  allowRetry = true
): Promise<T> {
  const { accessToken } = useAuthStore.getState();
  
  const headers = new Headers(options.headers || {});
  // Content-Type hanya dikirim KALAU ada body.
  // Kalau tidak, Fastify menolak dengan "Body cannot be empty when content-type
  // is set to 'application/json'" — ini menjebak semua POST tanpa body
  // (mis. hitung kalkulasi, tandai notifikasi sudah dibaca).
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    // Access token berumur pendek (default 5 jam) dan dipegang di memori.
    // Coba perpanjang sekali memakai cookie refresh, lalu ulangi request yang
    // sama. Endpoint /auth/* dikecualikan agar tidak terjadi perulangan.
    if (allowRetry && !endpoint.startsWith('/auth/')) {
      const token = await refreshAccessToken();
      if (token) return fetchApi<T>(endpoint, options, false);
    }

    useAuthStore.getState().logout();
    redirectToLogin();
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'An error occurred during the request');
  }

  return response.json();
}
