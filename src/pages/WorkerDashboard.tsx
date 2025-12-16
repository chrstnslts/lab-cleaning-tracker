import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

type Profile = {
  user_id: string
  full_name: string | null
  role: 'admin' | 'worker'
}

type WorkerTask = {
  assignment_id: number
  task_id: number
  task_date: string
  room_name: string
  cleaning_level: string
  is_harvest_shared: boolean
  status: string
}

interface Props {
  profile: Profile
}

const WorkerDashboard: React.FC<Props> = ({ profile }) => {
  const navigate = useNavigate()
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [tasks, setTasks] = useState<WorkerTask[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const logout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const loadTasks = async (forDate: string) => {
    setLoading(true)
    setMessage(null)

    const { data, error } = await supabase
      .from('task_assignments')
      .select(`
        id,
        status,
        tasks (
          id,
          task_date,
          is_harvest_shared,
          rooms ( name ),
          cleaning_levels ( code )
        )
      `)
      .eq('user_id', profile.user_id)
      .order('id', { ascending: true })

    setLoading(false)

    if (error) {
      console.error(error)
      setMessage('Error loading your tasks')
      return
    }

    // Filter by date on the client side to avoid any nested filter weirdness
    const filtered = (data || []).filter((row: any) => row.tasks?.task_date === forDate)

    const mapped: WorkerTask[] = filtered.map((row: any) => ({
      assignment_id: row.id,
      task_id: row.tasks.id,
      task_date: row.tasks.task_date,
      room_name: row.tasks.rooms.name,
      cleaning_level: row.tasks.cleaning_levels.code,
      is_harvest_shared: row.tasks.is_harvest_shared,
      status: row.status,
    }))

    setTasks(mapped)
  }

  useEffect(() => {
    loadTasks(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateStatus = async (
    assignmentId: number,
    newStatus: 'not_started' | 'in_progress' | 'completed'
  ) => {
    setLoading(true)
    setMessage(null)

    const { error } = await supabase
      .from('task_assignments')
      .update({ status: newStatus })
      .eq('id', assignmentId)

    setLoading(false)

    if (error) {
      console.error(error)
      setMessage('Error updating status')
      return
    }

    setMessage('Status updated')
    await loadTasks(date)
  }

  return (
    <div style={{ padding: '1rem', maxWidth: '900px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h2>Worker Dashboard</h2>
          <div style={{ fontSize: '0.9rem', color: '#555' }}>
            Logged in as: {profile.full_name || 'Worker'}
          </div>
        </div>
        <button onClick={logout}>Log out</button>
      </header>

      <section style={{ marginBottom: '1rem' }}>
        <label>
          Date:{' '}
          <input
            type="date"
            value={date}
            onChange={e => {
              const newDate = e.target.value
              setDate(newDate)
              loadTasks(newDate)
            }}
          />
        </label>
      </section>

      {message && <div style={{ marginBottom: '0.5rem' }}>{message}</div>}

      <section>
        <h3>Your Tasks for {date}</h3>
        {loading && <div>Loading…</div>}
        {!loading && tasks.length === 0 && <div>No tasks assigned for this date.</div>}
        {!loading && tasks.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Room</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Level</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Harvest?</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Status</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.assignment_id}>
                  <td style={{ borderBottom: '1px solid #eee' }}>{t.room_name}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{t.cleaning_level}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>
                    {t.is_harvest_shared ? 'Yes' : 'No'}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee' }}>{t.status}</td>
                  <td style={{ borderBottom: '1px solid #eee' }}>
                    <button onClick={() => updateStatus(t.assignment_id, 'in_progress')}>
                      Start
                    </button>{' '}
                    <button onClick={() => updateStatus(t.assignment_id, 'completed')}>
                      Complete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

export default WorkerDashboard
