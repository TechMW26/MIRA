import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export default function AuthPage() {
  const { user, login, register, error, authLoading } = useAuth();
  const navigate = useNavigate();
  const [isLogin, setIsLogin] = useState(true);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [showPw, setShowPw] = useState(false);

  // Redirect when user becomes authenticated
  useEffect(() => {
    if (user) {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (isLogin) {
      await login(form.email, form.password);
    } else {
      await register(form.email, form.password, form.name);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <div className="relative z-10 w-full max-w-md animate-fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <img src="/mira-logo.png" alt="MIRA" className="relative w-16 h-16 rounded-2xl object-cover" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Welcome to MIRA
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {isLogin ? 'Sign in to continue' : 'Create your account'}
          </p>
        </div>

        {/* Card */}
        <div className="glass-strong rounded-3xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <div>
                <label className="block text-xs font-medium mb-2 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full glass-input rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)]"
                  style={{ color: 'var(--text-primary)' }}
                  placeholder="Your name"
                  required={!isLogin}
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium mb-2 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full glass-input rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)]"
                style={{ color: 'var(--text-primary)' }}
                placeholder="you@example.com"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2 tracking-wide uppercase" style={{ color: 'var(--text-tertiary)' }}>Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full glass-input rounded-xl px-4 py-3 pr-12 text-sm outline-none transition-all duration-200 focus:ring-1 focus:ring-[var(--border)]"
                  style={{ color: 'var(--text-primary)' }}
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-500/10 text-red-400 text-sm animate-fade-in" style={{ border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={authLoading}
              className="w-full py-3 rounded-xl font-medium text-sm transition-all duration-200 hover:opacity-90 disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              {authLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <>
                  {isLogin ? 'Sign in' : 'Create account'}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsLogin(!isLogin)}
              className="text-sm transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {isLogin ? "Don't have an account? " : 'Already have an account? '}
              <span style={{ color: 'var(--accent)' }} className="font-medium">
                {isLogin ? 'Sign up' : 'Sign in'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
