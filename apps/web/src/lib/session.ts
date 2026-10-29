import { API_URL } from './api';
import { useAuthStore } from '../stores/authStore';

/**
 * Pulihkan sesi setelah halaman dimuat ulang.
 *
 * Access token hanya hidup di memori (tidak dipersist), jadi setelah refresh
 * halaman nilainya hilang. Refresh token tetap ada sebagai cookie httpOnly,
 * sehingga cukup memanggil /auth/refresh sekali untuk mendapatkan access token
 * baru. Tanpa langkah ini router akan menganggap user belum login dan
 * melemparnya ke /login pada setiap reload.
 */
export async function restoreSession(): Promise<void> {
  const { user, accessToken } = useAuthStore.getState();

  // Sudah punya token di memori, atau belum pernah login di browser ini.
  if (accessToken || !user) return;

  try {
    const response = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!response.ok) {
      useAuthStore.getState().logout();
      return;
    }

    const data = (await response.json()) as {
      user: { id: string; name: string; email: string; role: any };
      accessToken: string;
    };

    useAuthStore.getState().setAuth(data.user, data.accessToken);
  } catch {
    useAuthStore.getState().logout();
  }
}
