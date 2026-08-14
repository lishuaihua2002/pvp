import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import LoginPage from './pages/LoginPage'
import LobbyPage from './pages/LobbyPage'
import ArenaPage from './pages/ArenaPage'
import FighterEditorPage from './pages/FighterEditorPage'
import LocalTestPage from './pages/LocalTestPage'

function Protected({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthStore()
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-arcade-cyan text-xl">
        加载中...
      </div>
    )
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  const init = useAuthStore((s) => s.init)
  useEffect(() => {
    void init()
  }, [init])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/local-test" element={<LocalTestPage />} />
        <Route
          path="/"
          element={
            <Protected>
              <LobbyPage />
            </Protected>
          }
        />
        <Route
          path="/editor"
          element={
            <Protected>
              <FighterEditorPage />
            </Protected>
          }
        />
        <Route
          path="/arena"
          element={
            <Protected>
              <ArenaPage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
