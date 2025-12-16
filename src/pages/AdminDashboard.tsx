import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'

type Profile = {
  user_id: string
  full_name: string | null
  role: 'admin' | 'worker'
}

type AssignmentSummary = {
  assignment_id: number
  user_id: string
  user_name: string
  status: string
}

type TaskRow = {
  id: number
  task_date: string
  room_name: string
  cleaning_level: string // 'L1' | 'L2' | 'L3'
  cleaning_level_id: number
  is_harvest_shared: boolean
  assignees: AssignmentSummary[]
}

type DayAvailability = {
  weekday: number // 0 = Sun ... 6 = Sat
  is_off: boolean
}

type WorkerRow = {
  user_id: string
  full_name: string | null
  availability: DayAvailability[]
}

type CleaningLevel = {
  id: number
  code: string // 'L1' | 'L2' | 'L3'
}

type WorkerSummaryRow = {
  user_id: string
  full_name: string
  task_count: number
  rooms: string[]
}

type WeeklySummaryRow = {
  user_id: string
  full_name: string
  total: number
  perDay: {
    [date: string]: {
      count: number
      rooms: string[]
    }
  }
}

interface Props {
  profile: Profile
}

const daysOfWeekLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// helpers for week calculations
const toISO = (d: Date): string => d.toISOString().slice(0, 10)

const getWeekStart = (dateStr: string): string => {
  const d = new Date(dateStr)
  const day = d.getDay() // 0 = Sun
  d.setDate(d.getDate() - day) // start on Sunday
  return toISO(d)
}

const getWeekEnd = (weekStartStr: string): string => {
  const d = new Date(weekStartStr)
  d.setDate(d.getDate() + 6)
  return toISO(d)
}

const getWeekDates = (weekStartStr: string): string[] => {
  const d = new Date(weekStartStr)
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    dates.push(toISO(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

const AdminDashboard: React.FC<Props> = ({ profile }) => {
  const navigate = useNavigate()

  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)

  const [workers, setWorkers] = useState<WorkerRow[]>([])
  const [workersLoading, setWorkersLoading] = useState(false)

  const [cleaningLevels, setCleaningLevels] = useState<CleaningLevel[]>([])
  const [savingAvailability, setSavingAvailability] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [workerSummary, setWorkerSummary] = useState<WorkerSummaryRow[]>([])
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummaryRow[]>([])
  const [weeklyLoading, setWeeklyLoading] = useState(false)

  const logout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // ---------- LOAD CLEANING LEVELS ----------

  const loadCleaningLevels = async () => {
    const { data, error } = await supabase
      .from('cleaning_levels')
      .select('id, code')
      .order('code', { ascending: true })

    if (error) {
      console.error(error)
      setMessage('Error loading cleaning levels')
      return
    }

    setCleaningLevels(data || [])
  }

  // ---------- BUILD DAILY WORKER SUMMARY ----------

  const buildWorkerSummary = (taskRows: TaskRow[]) => {
    const map = new Map<string, WorkerSummaryRow>()

    // start with all workers (so off workers still appear)
    workers.forEach(w => {
      map.set(w.user_id, {
        user_id: w.user_id,
        full_name: w.full_name || 'Worker',
        task_count: 0,
        rooms: [],
      })
    })

    taskRows.forEach(task => {
      task.assignees.forEach(a => {
        const existing = map.get(a.user_id)
        if (!existing) {
          map.set(a.user_id, {
            user_id: a.user_id,
            full_name: a.user_name,
            task_count: 1,
            rooms: [task.room_name],
          })
        } else {
          existing.task_count += 1
          if (!existing.rooms.includes(task.room_name)) {
            existing.rooms.push(task.room_name)
          }
        }
      })
    })

    const summary = Array.from(map.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    )

    setWorkerSummary(summary)
  }

  // ---------- LOAD TASKS + ASSIGNEES FOR A DATE ----------

  const loadTasks = async (forDate: string) => {
    setTasksLoading(true)
    setMessage(null)

    // 1) Load tasks for that date
    const { data, error } = await supabase
      .from('tasks')
      .select(`
        id,
        task_date,
        cleaning_level_id,
        is_harvest_shared,
        rooms ( name ),
        cleaning_levels ( code )
      `)
      .eq('task_date', forDate)
      .order('id', { ascending: true })

    if (error) {
      console.error(error)
      setMessage('Error loading tasks')
      setTasks([])
      setTasksLoading(false)
      setWorkerSummary([])
      return
    }

    const baseTasks: TaskRow[] = (data || []).map((row: any) => ({
      id: row.id,
      task_date: row.task_date,
      room_name: row.rooms.name,
      cleaning_level: row.cleaning_levels.code,
      cleaning_level_id: row.cleaning_level_id,
      is_harvest_shared: row.is_harvest_shared,
      assignees: [],
    }))

    const taskIds = baseTasks.map(t => t.id)

    if (taskIds.length === 0) {
      setTasks(baseTasks)
      buildWorkerSummary(baseTasks)
      setTasksLoading(false)
      return
    }

    // 2) Load assignments for those tasks
    const { data: assigns, error: assignsError } = await supabase
      .from('task_assignments')
      .select('id, task_id, status, user_id')
      .in('task_id', taskIds)
      .order('id', { ascending: true })

    if (assignsError) {
      console.error(assignsError)
      setTasks(baseTasks)
      buildWorkerSummary(baseTasks)
      setTasksLoading(false)
      return
    }

    // 3) Map user_id → name
    const nameByUserId = new Map<string, string>()
    workers.forEach(w => {
      nameByUserId.set(w.user_id, w.full_name || 'Worker')
    })

    const assigneesByTaskId: Record<number, AssignmentSummary[]> = {}

    ;(assigns || []).forEach((row: any) => {
      const taskId = row.task_id as number
      const userId = row.user_id as string
      const userName = nameByUserId.get(userId) || userId

      if (!assigneesByTaskId[taskId]) {
        assigneesByTaskId[taskId] = []
      }

      assigneesByTaskId[taskId].push({
        assignment_id: row.id as number,
        user_id: userId,
        user_name: userName,
        status: row.status as string,
      })
    })

    const merged = baseTasks.map(t => ({
      ...t,
      assignees: assigneesByTaskId[t.id] || [],
    }))

    setTasks(merged)
    buildWorkerSummary(merged)
    setTasksLoading(false)
  }

  const handleGenerate = async () => {
    setTasksLoading(true)
    setMessage(null)

    const { error } = await supabase.rpc('generate_daily_assignments', {
      p_date: date,
    })

    if (error) {
      console.error(error)
      setMessage('Error generating assignments')
      setTasksLoading(false)
      return
    }

    setMessage('Assignments generated!')
    await loadTasks(date)
    await loadWeeklySummary(date)
  }

  // ---------- UPDATE CLEANING LEVEL FOR A TASK ----------

  const updateTaskLevel = async (taskId: number, newLevelCode: string) => {
    const level = cleaningLevels.find(l => l.code === newLevelCode)
    if (!level) return

    const { error } = await supabase
      .from('tasks')
      .update({ cleaning_level_id: level.id })
      .eq('id', taskId)

    if (error) {
      console.error(error)
      setMessage('Error updating cleaning level')
      return
    }

    setTasks(prev =>
      prev.map(t =>
        t.id === taskId
          ? { ...t, cleaning_level: newLevelCode, cleaning_level_id: level.id }
          : t,
      ),
    )
    setMessage('Cleaning level updated')
  }

  // ---------- WEEKLY ROTATION SUMMARY ----------

  const loadWeeklySummary = async (anchorDate: string) => {
    if (workers.length === 0) {
      setWeeklySummary([])
      return
    }

    setWeeklyLoading(true)

    const weekStart = getWeekStart(anchorDate)
    const weekEnd = getWeekEnd(weekStart)

    const { data, error } = await supabase
      .from('task_assignments')
      .select(
        `
        id,
        user_id,
        tasks (
          task_date,
          rooms ( name )
        )
      `,
      )
      .gte('tasks.task_date', weekStart)
      .lte('tasks.task_date', weekEnd)
      .order('id', { ascending: true })

    if (error) {
      console.error(error)
      setWeeklySummary([])
      setWeeklyLoading(false)
      return
    }

    const map = new Map<string, WeeklySummaryRow>()

    // start with all workers so zero-load people appear
    workers.forEach(w => {
      map.set(w.user_id, {
        user_id: w.user_id,
        full_name: w.full_name || 'Worker',
        total: 0,
        perDay: {},
      })
    })

    ;(data || []).forEach((row: any) => {
      const userId = row.user_id as string
      const taskDate = row.tasks?.task_date as string | undefined
      const roomName = row.tasks?.rooms?.name as string | undefined
      if (!taskDate) return

      const summary =
        map.get(userId) ||
        (() => {
          const created: WeeklySummaryRow = {
            user_id: userId,
            full_name: userId,
            total: 0,
            perDay: {},
          }
          map.set(userId, created)
          return created
        })()

      summary.total += 1

      if (!summary.perDay[taskDate]) {
        summary.perDay[taskDate] = { count: 0, rooms: [] }
      }

      summary.perDay[taskDate].count += 1
      if (roomName && !summary.perDay[taskDate].rooms.includes(roomName)) {
        summary.perDay[taskDate].rooms.push(roomName)
      }
    })

    const summaryArray = Array.from(map.values()).sort((a, b) =>
      a.full_name.localeCompare(b.full_name),
    )

    setWeeklySummary(summaryArray)
    setWeeklyLoading(false)
  }

  // ---------- WORKER AVAILABILITY (DAYS OFF) ----------

  const loadWorkersAvailability = async () => {
    setWorkersLoading(true)

    const { data, error } = await supabase
      .from('profiles')
      .select(`
        user_id,
        full_name,
        worker_availability (
          weekday,
          is_off
        )
      `)
      .eq('role', 'worker')
      .eq('active', true)
      .order('full_name', { ascending: true })

    setWorkersLoading(false)

    if (error) {
      console.error(error)
      setMessage('Error loading worker availability')
      return
    }

    const mapped: WorkerRow[] = (data || []).map((row: any) => {
      const existing: DayAvailability[] = (row.worker_availability || []).map(
        (d: any) => ({
          weekday: d.weekday,
          is_off: d.is_off,
        }),
      )

      const fullWeek: DayAvailability[] = Array.from({ length: 7 }).map((_, idx) => {
        const found = existing.find(d => d.weekday === idx)
        return found ?? { weekday: idx, is_off: false }
      })

      return {
        user_id: row.user_id,
        full_name: row.full_name,
        availability: fullWeek,
      }
    })

    setWorkers(mapped)
  }

  const toggleDayOff = async (userId: string, weekday: number, newIsOff: boolean) => {
    setSavingAvailability(true)
    setMessage(null)

    const { error } = await supabase
      .from('worker_availability')
      .upsert(
        [
          {
            user_id: userId,
            weekday,
            is_off: newIsOff,
          },
        ],
        {
          onConflict: 'user_id,weekday',
        },
      )

    if (error) {
      console.error(error)
      setMessage('Error saving days off')
      setSavingAvailability(false)
      return
    }

    setWorkers(prev =>
      prev.map(w =>
        w.user_id === userId
          ? {
              ...w,
              availability: w.availability.map(d =>
                d.weekday === weekday ? { ...d, is_off: newIsOff } : d,
              ),
            }
          : w,
      ),
    )

    setSavingAvailability(false)
    setMessage('Worker days off updated')
  }

  // ---------- INITIAL LOAD ----------

  useEffect(() => {
    const init = async () => {
      await loadCleaningLevels()
      await loadWorkersAvailability()
      await loadTasks(date)
      await loadWeeklySummary(date)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const weekStart = getWeekStart(date)
  const weekEnd = getWeekEnd(weekStart)
  const weekDates = getWeekDates(weekStart)

  // ---------- RENDER ----------

  return (
    <div style={{ padding: '1rem', maxWidth: '1100px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <div>
          <h2>Admin Dashboard</h2>
          <div style={{ fontSize: '0.9rem', color: '#aaa' }}>
            Logged in as: {profile.full_name || 'Admin'}
          </div>
        </div>
        <button onClick={logout}>Log out</button>
      </header>

      {message && (
        <div style={{ marginBottom: '0.75rem', color: '#333', background: '#eef', padding: '6px' }}>
          {message}
        </div>
      )}

      {/* DAILY TASKS + ASSIGNEES */}
      <section style={{ marginBottom: '2rem' }}>
        <h3>Daily Tasks</h3>
        <label>
          Date:{' '}
          <input
            type="date"
            value={date}
            onChange={async e => {
              const newDate = e.target.value
              setDate(newDate)
              await loadTasks(newDate)
              await loadWeeklySummary(newDate)
            }}
          />
        </label>
        <button
          onClick={handleGenerate}
          disabled={tasksLoading}
          style={{ marginLeft: '0.5rem' }}
        >
          {tasksLoading ? 'Working…' : 'Generate Assignments for Date'}
        </button>

        <h4 style={{ marginTop: '1rem' }}>Tasks for {date}</h4>
        {tasksLoading && <div>Loading tasks…</div>}
        {!tasksLoading && tasks.length === 0 && <div>No tasks for this date.</div>}
        {!tasksLoading && tasks.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}>Room</th>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}>Level</th>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}>Harvest?</th>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}>Assigned To</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(t => (
                <tr key={t.id}>
                  <td style={{ borderBottom: '1px solid #ddd' }}>{t.room_name}</td>
                  <td style={{ borderBottom: '1px solid #ddd' }}>
                    <select
                      value={t.cleaning_level}
                      onChange={e => updateTaskLevel(t.id, e.target.value)}
                    >
                      {cleaningLevels.map(l => (
                        <option key={l.id} value={l.code}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd' }}>
                    {t.is_harvest_shared ? 'Yes' : 'No'}
                  </td>
                  <td style={{ borderBottom: '1px solid #ddd' }}>
                    {t.assignees.length === 0
                      ? '—'
                      : t.assignees.map(a => a.user_name).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* WORKER ASSIGNMENT SUMMARY FOR THE DAY */}
      <section style={{ marginBottom: '2rem' }}>
        <h3>Worker Assignment Summary (for {date})</h3>
        {workerSummary.length === 0 ? (
          <div>No workers or no assignments for this date.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}>Worker</th>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}># of Tasks</th>
                <th style={{ borderBottom: '1px solid #555', textAlign: 'left' }}>Rooms</th>
              </tr>
            </thead>
            <tbody>
              {workerSummary.map(w => (
                <tr key={w.user_id}>
                  <td style={{ borderBottom: '1px solid #ddd' }}>{w.full_name}</td>
                  <td style={{ borderBottom: '1px solid #ddd' }}>{w.task_count}</td>
                  <td style={{ borderBottom: '1px solid #ddd' }}>
                    {w.task_count === 0 ? '—' : w.rooms.join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* WEEKLY ROTATION / LOAD VIEW */}
      <section style={{ marginBottom: '2rem' }}>
        <h3>
          Weekly Worker Rotation (Week of {weekStart} to {weekEnd})
        </h3>
        {weeklyLoading && <div>Loading weekly summary…</div>}
        {!weeklyLoading && weeklySummary.length === 0 && (
          <div>No workers or no assignments in this week.</div>
        )}
        {!weeklyLoading && weeklySummary.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: '1px solid #555', textAlign: 'left', padding: '4px' }}>
                    Worker
                  </th>
                  {weekDates.map(d => {
                    const dt = new Date(d)
                    const label = dt.toLocaleDateString(undefined, {
                      weekday: 'short',
                      month: 'numeric',
                      day: 'numeric',
                    })
                    return (
                      <th
                        key={d}
                        style={{
                          borderBottom: '1px solid #555',
                          textAlign: 'center',
                          padding: '4px',
                        }}
                      >
                        {label}
                      </th>
                    )
                  })}
                  <th style={{ borderBottom: '1px solid #555', textAlign: 'center', padding: '4px' }}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeklySummary.map(w => (
                  <tr key={w.user_id}>
                    <td style={{ borderBottom: '1px solid #ddd', padding: '4px' }}>{w.full_name}</td>
                    {weekDates.map(d => {
                      const cell = w.perDay[d]
                      const count = cell?.count ?? 0
                      const rooms = cell?.rooms?.join(', ') ?? ''
                      return (
                        <td
                          key={d}
                          style={{
                            borderBottom: '1px solid #ddd',
                            textAlign: 'center',
                            padding: '4px',
                            backgroundColor: count >= 3 ? '#ffe0e0' : count === 0 ? '#f9f9f9' : '#eef5ff',
                          }}
                          title={rooms}
                        >
                          {count === 0 ? '' : count}
                        </td>
                      )
                    })}
                    <td
                      style={{
                        borderBottom: '1px solid #ddd',
                        textAlign: 'center',
                        padding: '4px',
                        fontWeight: 'bold',
                      }}
                    >
                      {w.total}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* WORKER DAYS OFF */}
      <section>
        <h3>Worker Days Off</h3>
        {workersLoading && <div>Loading workers…</div>}
        {!workersLoading && workers.length === 0 && (
          <div>No workers found. Make sure worker profiles exist.</div>
        )}

        {!workersLoading && workers.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
              <thead>
                <tr>
                  <th style={{ borderBottom: '1px solid #555', textAlign: 'left', padding: '4px' }}>
                    Worker
                  </th>
                  {daysOfWeekLabels.map((label, idx) => (
                    <th
                      key={idx}
                      style={{ borderBottom: '1px solid #555', textAlign: 'center', padding: '4px' }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {workers.map(worker => (
                  <tr key={worker.user_id}>
                    <td style={{ borderBottom: '1px solid #ddd', padding: '4px' }}>
                      {worker.full_name || worker.user_id}
                    </td>
                    {worker.availability.map(day => (
                      <td
                        key={day.weekday}
                        style={{
                          borderBottom: '1px solid #ddd',
                          textAlign: 'center',
                          padding: '4px',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={day.is_off}
                          disabled={savingAvailability}
                          onChange={() =>
                            toggleDayOff(worker.user_id, day.weekday, !day.is_off)
                          }
                          title={day.is_off ? 'Off' : 'Working'}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {savingAvailability && (
          <div style={{ marginTop: '0.5rem' }}>Saving changes…</div>
        )}
      </section>
    </div>
  )
}

export default AdminDashboard
