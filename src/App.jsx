import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import AuthPage from './components/Auth/AuthPage';
import MainLayout from './components/Layout/MainLayout';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

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

  return user ? children : <Navigate to="/auth" />;
}

export default function App() {
  return (
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
  );
}
