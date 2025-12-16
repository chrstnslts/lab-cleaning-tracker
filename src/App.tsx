import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import LoginPage from './pages/LoginPage'
import AdminDashboard from './pages/AdminDashboard'
import WorkerDashboard from './pages/WorkerDashboard'

type Profile = {
  user_id: string
  full_name: string | null
  role: 'admin' | 'worker'
}

const App: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [sessionUserId, setSessionUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const getSessionAndProfile = async () => {
      setLoading(true)
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user ?? null
      setSessionUserId(user?.id ?? null)

      if (user) {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
          .maybeSingle()

        if (error) {
          console.error('Error loading profile', error)
        } else if (data) {
          setProfile(data as Profile)
        }
      } else {
        setProfile(null)
      }
      setLoading(false)
    }

    getSessionAndProfile()

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null
      setSessionUserId(user?.id ?? null)
      if (!user) {
        setProfile(null)
        navigate('/login')
      } else {
        getSessionAndProfile()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [navigate])

  if (loading) {
    return <div style={{ padding: '1rem' }}>Loading…</div>
  }

  const isAuthed = !!sessionUserId

  return (
    <Routes>
      <Route
        path="/login"
        element={
          isAuthed && profile
            ? <Navigate to={profile.role === 'admin' ? '/admin' : '/worker'} replace />
            : <LoginPage />
        }
      />

      <Route
        path="/admin"
        element={
          isAuthed && profile?.role === 'admin'
            ? <AdminDashboard profile={profile} />
            : <Navigate to="/login" replace />
        }
      />

      <Route
        path="/worker"
        element={
          isAuthed && profile?.role === 'worker'
            ? <WorkerDashboard profile={profile} />
            : <Navigate to="/login" replace />
        }
      />

      <Route
        path="*"
        element={
          isAuthed && profile
            ? <Navigate to={profile.role === 'admin' ? '/admin' : '/worker'} replace />
            : <Navigate to="/login" replace />
        }
      />
    </Routes>
  )
}

export default App

