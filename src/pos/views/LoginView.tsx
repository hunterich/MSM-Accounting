import React, { useState } from 'react';
import Button from '@/src/components/UI/Button';
import Input from '@/src/components/UI/Input';
import { useAuthStore } from '@/src/stores/useAuthStore';
import { t } from '../i18n/strings';

export default function LoginView(): React.ReactElement {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-xl font-semibold">{t('app.title')}</h1>
        <Input label={t('auth.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('auth.password')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} text={t('auth.login')} className="w-full" />
      </form>
    </div>
  );
}
