import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AuthPage from './components/Auth/AuthPage';
import MainLayout from './components/Layout/MainLayout';
import DesktopCompanion from './components/Desktop/DesktopCompanion';
import DesktopPermissionOnboarding from './components/Desktop/DesktopPermissionOnboarding';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg-primary)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 rounded-full animate-spin" style={{ borderColor: 'var(--hud-cyan-dim)', borderTopColor: 'transparent' }} />
          <span className="text-xs tracking-[0.3em] uppercase" style={{ color: 'var(--hud-cyan-soft)' }}>Initializing MIRA…</span>
        </div>
      </div>
    );
  }

  if (user) return children;
  const next = `${location.pathname}${location.search}${location.hash}`;
  return <Navigate to={`/auth?next=${encodeURIComponent(next)}`} replace />;
}

export default function App() {
  const companion = typeof window !== 'undefined'
    && Boolean(window.miraDesktop)
    && new URLSearchParams(window.location.search).get('desktopCompanion') === '1';

  if (companion) return <DesktopCompanion />;

  return (
    <>
      {typeof window !== 'undefined' && window.miraDesktop && <DesktopPermissionOnboarding />}
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      />
    </Routes>
    </>
  );
}
