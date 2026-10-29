import { useAuthStore } from '../stores/authStore';

// Diekspor agar halaman Login bisa memakai URL yang sama tanpa hardcode.
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const { accessToken, logout } = useAuthStore.getState();
  
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
  });

  if (response.status === 401) {
    // Basic implementation: logout on 401. 
    // In a real app, this should try to use the refresh token first.
    logout();
    // Redirect to login page after session expired
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || 'An error occurred during the request');
  }

  return response.json();
}
