import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import Button from '../components/UI/Button';
import Input from '../components/UI/Input';
import { useAuthStore } from '../stores/useAuthStore';

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((s) => s.login);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const googleEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const [email, setEmail] = useState('admin@demo.com');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const navigateAfterLogin = () => {
    const target = location.state?.from?.pathname || '/';
    navigate(target, { replace: true });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(email, password);
      navigateAfterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    if (!credentialResponse?.credential) {
      setError('Google login failed');
      return;
    }

    setError('');
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle(credentialResponse.credential);
      navigateAfterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google login failed');
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-neutral-50 via-primary-50 to-neutral-100 px-4 py-8 sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute -left-16 -top-16 h-48 w-48 rounded-full bg-primary-200/60 blur-3xl sm:h-72 sm:w-72" />
      <div className="pointer-events-none absolute -right-12 bottom-8 h-44 w-44 rounded-full bg-primary-100/80 blur-3xl sm:h-64 sm:w-64" />

      <div className="mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden rounded-2xl border border-neutral-200/80 bg-neutral-0/70 p-8 shadow-md backdrop-blur-sm lg:block">
          <p className="mb-3 inline-flex rounded-full bg-primary-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-primary-800">
            MSM Accounting
          </p>
          <h1 className="max-w-md text-4xl font-semibold leading-tight text-neutral-900">
            Keep your books clean, fast, and under control.
          </h1>
          <p className="mt-4 max-w-lg text-base text-neutral-700">
            Manage invoices, vendor bills, stock movements, and reporting from one focused workspace.
          </p>

          <div className="mt-8 grid gap-3 text-sm text-neutral-700">
            <div className="rounded-xl border border-neutral-200 bg-neutral-0 px-4 py-3">
              Live AP/AR visibility with accurate balances.
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-0 px-4 py-3">
              Structured access by role and organization.
            </div>
            <div className="rounded-xl border border-neutral-200 bg-neutral-0 px-4 py-3">
              Journal-ready records for monthly close.
            </div>
          </div>
        </section>

        <section className="w-full rounded-2xl border border-neutral-200 bg-neutral-0 p-6 shadow-lg sm:p-8">
          <div className="mb-7">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
              Welcome back
            </p>
            <h2 className="text-3xl font-semibold text-neutral-900">Sign in</h2>
            <p className="mt-2 text-sm text-neutral-600">Use your MSM Accounting credentials.</p>
          </div>

          <form onSubmit={handleSubmit}>
            <Input
              label="Email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            {error ? (
              <div className="mb-4 rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-600">
                {error}
              </div>
            ) : null}

            <Button
              type="submit"
              variant="primary"
              className="w-full rounded-lg"
              disabled={submitting}
              text={submitting ? 'Signing in...' : 'Sign in to dashboard'}
            />
          </form>

          {googleEnabled ? (
            <div className="mt-5 border-t border-neutral-200 pt-5">
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.12em] text-neutral-500">
                Or continue with Google
              </div>
              <div className={googleSubmitting ? 'pointer-events-none opacity-70' : ''}>
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => setError('Google sign-in was cancelled or failed')}
                  useOneTap={false}
                />
              </div>
            </div>
          ) : null}

          <p className="mt-6 text-xs text-neutral-500">
            By signing in, you access your organization workspace and accounting records.
          </p>
        </section>
      </div>
    </div>
  );
};

export default Login;
