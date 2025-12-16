import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabaseClient";

type Profile = {
  user_id: string;
  full_name: string | null;
  role: "admin" | "worker";
};

type Room = {
  id: number;
  name: string;
  is_harvest: boolean;
};

type CleaningLevel = {
  id: number;
  name: "L1" | "L2" | "L3";
};

type TaskRow = {
  id: number;
  task_date: string; // YYYY-MM-DD
  room_id: number;
  cleaning_level_id: number;
  is_harvest_shift: boolean;
};

type TaskDisplay = {
  task_id: number;
  room_id: number;
  room_name: string;
  cleaning_level_id: number;
  cleaning_level_name: string;
  is_harvest_shift: boolean;
  assigned_to_names: string[];
};

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeekMonday(d: Date) {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // move to Monday
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(d: Date, days: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export default function AdminDashboard({ profile }: { profile: Profile }) {
  const [selectedDate, setSelectedDate] = useState<string>(() => toISODate(new Date()));
  const [rooms, setRooms] = useState<Room[]>([]);
  const [levels, setLevels] = useState<CleaningLevel[]>([]);
  const [tasks, setTasks] = useState<TaskDisplay[]>([]);
  const [daysOffMap, setDaysOffMap] = useState<Record<string, Set<number>>>({}); // user_id -> set(weekday)
  const [workers, setWorkers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Weekly rotation view state
  const [rotationWeekStart, setRotationWeekStart] = useState<string>(() => toISODate(startOfWeekMonday(new Date())));
  const rotationWeekEnd = useMemo(() => {
    const d = new Date(rotationWeekStart);
    const end = addDays(d, 6);
    return toISODate(end);
  }, [rotationWeekStart]);

  useEffect(() => {
    let t: any;
    if (toast) {
      t = setTimeout(() => setToast(null), 2500);
    }
    return () => t && clearTimeout(t);
  }, [toast]);

  async function loadBasics() {
    const [roomsRes, levelsRes, workersRes] = await Promise.all([
      supabase.from("rooms").select("id,name,is_harvest").eq("active", true).order("id"),
      supabase.from("cleaning_levels").select("id,name").order("id"),
      supabase.from("profiles").select("user_id,full_name,role").eq("role", "worker").order("full_name", { ascending: true }),
    ]);

    if (roomsRes.error) throw roomsRes.error;
    if (levelsRes.error) throw levelsRes.error;
    if (workersRes.error) throw workersRes.error;

    setRooms((roomsRes.data ?? []) as Room[]);
    setLevels((levelsRes.data ?? []) as CleaningLevel[]);
    setWorkers((workersRes.data ?? []) as Profile[]);
  }

  async function loadDaysOff() {
    // worker_availability rows only exist for "off" days in our approach
    const res = await supabase.from("worker_availability").select("user_id,weekday,is_off");
    if (res.error) throw res.error;

    const map: Record<string, Set<number>> = {};
    for (const row of res.data ?? []) {
      if (!row.is_off) continue;
      if (!map[row.user_id]) map[row.user_id] = new Set<number>();
      map[row.user_id].add(row.weekday);
    }
    setDaysOffMap(map);
  }

  async function loadTasksForDate(date: string) {
    // 1) tasks for date
    const tasksRes = await supabase
      .from("tasks")
      .select("id,task_date,room_id,cleaning_level_id,is_harvest_shift")
      .eq("task_date", date)
      .order("room_id");

    if (tasksRes.error) throw tasksRes.error;

    const baseTasks = (tasksRes.data ?? []) as TaskRow[];

    // 2) assignments for those tasks
    const taskIds = baseTasks.map((t) => t.id);
    let assignments: { task_id: number; user_id: string }[] = [];
    if (taskIds.length > 0) {
      const assRes = await supabase.from("task_assignments").select("task_id,user_id").in("task_id", taskIds);
      if (assRes.error) throw assRes.error;
      assignments = (assRes.data ?? []) as any;
    }

    // 3) map user_id -> full_name
    const userIds = Array.from(new Set(assignments.map((a) => a.user_id)));
    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const profRes = await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds);
      if (profRes.error) throw profRes.error;
      for (const p of profRes.data ?? []) {
        profileMap[p.user_id] = p.full_name ?? "Unknown";
      }
    }

    // 4) maps
    const roomMap = new Map<number, Room>();
    rooms.forEach((r) => roomMap.set(r.id, r));

    const levelMap = new Map<number, CleaningLevel>();
    levels.forEach((l) => levelMap.set(l.id, l));

    // 5) build display list
    const byTask: Record<number, string[]> = {};
    for (const a of assignments) {
      if (!byTask[a.task_id]) byTask[a.task_id] = [];
      byTask[a.task_id].push(profileMap[a.user_id] ?? "Unknown");
    }

    const display: TaskDisplay[] = baseTasks.map((t) => {
      const r = roomMap.get(t.room_id);
      const l = levelMap.get(t.cleaning_level_id);
      return {
        task_id: t.id,
        room_id: t.room_id,
        room_name: r?.name ?? `Room ${t.room_id}`,
        cleaning_level_id: t.cleaning_level_id,
        cleaning_level_name: (l?.name ?? "L1") as any,
        is_harvest_shift: !!t.is_harvest_shift,
        assigned_to_names: (byTask[t.id] ?? []).sort(),
      };
    });

    setTasks(display);
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadBasics();
        await loadDaysOff();
      } catch (e: any) {
        console.error(e);
        setToast(e?.message ?? "Failed loading data");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload tasks whenever selectedDate changes OR once rooms/levels are loaded
  useEffect(() => {
    if (rooms.length === 0 || levels.length === 0) return;
    (async () => {
      try {
        setLoading(true);
        await loadTasksForDate(selectedDate);
      } catch (e: any) {
        console.error(e);
        setToast(e?.message ?? "Failed loading tasks");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, rooms.length, levels.length]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  async function handleGenerateAssignments() {
    try {
      setLoading(true);
      // Option 2 generator is the SQL function we created earlier:
      // generate_daily_assignments(p_date date)
      const { error } = await supabase.rpc("generate_daily_assignments", { p_date: selectedDate });
      if (error) throw error;

      await loadTasksForDate(selectedDate);
      setToast("Assignments generated");
    } catch (e: any) {
      console.error(e);
      setToast(e?.message ?? "Failed generating assignments");
    } finally {
      setLoading(false);
    }
  }

  async function updateTaskLevel(taskId: number, newLevelId: number) {
    try {
      const { error } = await supabase.from("tasks").update({ cleaning_level_id: newLevelId }).eq("id", taskId);
      if (error) throw error;

      // Update local state immediately
      setTasks((prev) =>
        prev.map((t) =>
          t.task_id === taskId
            ? {
                ...t,
                cleaning_level_id: newLevelId,
                cleaning_level_name: levels.find((l) => l.id === newLevelId)?.name ?? t.cleaning_level_name,
              }
            : t
        )
      );
      setToast("Level updated");
    } catch (e: any) {
      console.error(e);
      setToast(e?.message ?? "Failed updating level");
    }
  }

  async function toggleWorkerOffDay(userId: string, weekday: number, isOff: boolean) {
    try {
      if (isOff) {
        const { error } = await supabase.from("worker_availability").upsert(
          {
            user_id: userId,
            weekday,
            is_off: true,
          },
          { onConflict: "user_id,weekday" }
        );
        if (error) throw error;
      } else {
        // delete the row if turning "off" false
        const { error } = await supabase.from("worker_availability").delete().eq("user_id", userId).eq("weekday", weekday);
        if (error) throw error;
      }

      setDaysOffMap((prev) => {
        const copy: Record<string, Set<number>> = {};
        for (const k of Object.keys(prev)) copy[k] = new Set(prev[k]);

        if (!copy[userId]) copy[userId] = new Set<number>();
        if (isOff) copy[userId].add(weekday);
        else copy[userId].delete(weekday);

        return copy;
      });

      setToast("Worker days off updated");
    } catch (e: any) {
      console.error(e);
      setToast(e?.message ?? "Failed updating days off");
    }
  }

  const workerSummary = useMemo(() => {
    // Summary: worker -> count & rooms
    const map: Record<string, { count: number; rooms: string[] }> = {};
    for (const t of tasks) {
      for (const n of t.assigned_to_names) {
        if (!map[n]) map[n] = { count: 0, rooms: [] };
        map[n].count += 1;
        map[n].rooms.push(t.room_name);
      }
    }
    return Object.entries(map)
      .map(([name, v]) => ({ name, count: v.count, rooms: v.rooms }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [tasks]);

  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // --- Weekly Worker Rotation data (simple view) ---
  // We’ll compute the week’s dates and show which rooms each worker gets per day based on generated assignments.
  const [rotationRows, setRotationRows] = useState<
    { date: string; worker: string; rooms: string[]; total: number }[]
  >([]);

  async function loadWeeklyRotation() {
    try {
      setLoading(true);

      const start = new Date(rotationWeekStart);
      const end = addDays(start, 6);
      const startStr = toISODate(start);
      const endStr = toISODate(end);

      // Pull all assignments for the week
      const assRes = await supabase
        .from("task_assignments")
        .select(
          `
          id,
          user_id,
          task:tasks (
            task_date,
            room:rooms ( name )
          )
        `
        )
        .gte("task.task_date", startStr)
        .lte("task.task_date", endStr);

      if (assRes.error) throw assRes.error;

      const data = assRes.data ?? [];

      // Build user map
      const userIds = Array.from(new Set(data.map((x: any) => x.user_id)));
      let profileMap: Record<string, string> = {};
      if (userIds.length) {
        const pr = await supabase.from("profiles").select("user_id,full_name").in("user_id", userIds);
        if (pr.error) throw pr.error;
        for (const p of pr.data ?? []) profileMap[p.user_id] = p.full_name ?? "Unknown";
      }

      // Aggregate: date + worker -> rooms
      const bucket: Record<string, { date: string; worker: string; rooms: string[]; total: number }> = {};
      for (const row of data as any[]) {
        const date = row.task?.task_date;
        const roomName = row.task?.room?.name ?? "Unknown room";
        const worker = profileMap[row.user_id] ?? "Unknown";

        if (!date) continue;

        const key = `${date}__${worker}`;
        if (!bucket[key]) bucket[key] = { date, worker, rooms: [], total: 0 };
        bucket[key].rooms.push(roomName);
        bucket[key].total += 1;
      }

      const out = Object.values(bucket)
        .map((r) => ({ ...r, rooms: r.rooms.sort() }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.worker.localeCompare(b.worker));

      setRotationRows(out);
    } catch (e: any) {
      console.error(e);
      setToast(e?.message ?? "Failed loading weekly rotation");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Always render section; load data when week changes
    if (!rotationWeekStart) return;
    loadWeeklyRotation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotationWeekStart]);

  return (
    <div className="container">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Admin Dashboard</h1>
          <div style={{ opacity: 0.7, marginTop: 4 }}>
            Logged in as: {profile.full_name ?? "Admin"} (Admin)
          </div>
        </div>

        <button onClick={handleLogout} style={{ height: 44 }}>
          Log out
        </button>
      </div>

      {toast && (
        <div style={{ marginBottom: 12, padding: 10, borderRadius: 12, background: "rgba(255,255,255,0.08)" }}>
          {toast}
        </div>
      )}

      <h2 style={{ marginTop: 18 }}>Daily Tasks</h2>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Date:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            style={{ height: 44 }}
          />
        </label>

        <button onClick={handleGenerateAssignments} disabled={loading} style={{ height: 44 }}>
          {loading ? "Working..." : "Generate Assignments for Date"}
        </button>
      </div>

      <div style={{ margin: "10px 0 8px", opacity: 0.85 }}>
        <strong>Tasks for {selectedDate}</strong>
      </div>

      <div className="tableWrap">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Room</th>
              <th style={{ padding: "10px 8px" }}>Level</th>
              <th style={{ padding: "10px 8px" }}>Harvest?</th>
              <th style={{ padding: "10px 8px" }}>Assigned To</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.task_id} style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                <td style={{ padding: "10px 8px" }}>{t.room_name}</td>
                <td style={{ padding: "10px 8px" }}>
                  <select
                    value={t.cleaning_level_id}
                    onChange={(e) => updateTaskLevel(t.task_id, Number(e.target.value))}
                    style={{ height: 36 }}
                  >
                    {levels.map((lvl) => (
                      <option key={lvl.id} value={lvl.id}>
                        {lvl.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: "10px 8px" }}>{t.is_harvest_shift ? "Yes" : "No"}</td>
                <td style={{ padding: "10px 8px" }}>
                  {t.assigned_to_names.length ? t.assigned_to_names.join(", ") : <span style={{ opacity: 0.7 }}>—</span>}
                </td>
              </tr>
            ))}
            {!tasks.length && (
              <tr>
                <td colSpan={4} style={{ padding: "12px 8px", opacity: 0.75 }}>
                  No tasks found for this date. Click “Generate Assignments for Date”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>Worker Assignment Summary (for {selectedDate})</h2>

      <div className="tableWrap">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Worker</th>
              <th style={{ padding: "10px 8px" }}># of Tasks</th>
              <th style={{ padding: "10px 8px" }}>Rooms</th>
            </tr>
          </thead>
          <tbody>
            {workerSummary.map((w) => (
              <tr key={w.name} style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                <td style={{ padding: "10px 8px" }}>{w.name}</td>
                <td style={{ padding: "10px 8px" }}>{w.count}</td>
                <td style={{ padding: "10px 8px" }}>{w.rooms.join(", ")}</td>
              </tr>
            ))}
            {!workerSummary.length && (
              <tr>
                <td colSpan={3} style={{ padding: "12px 8px", opacity: 0.75 }}>
                  No assignments yet for this date.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>Worker Days Off</h2>

      <div className="tableWrap">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Worker</th>
              {weekdayLabels.map((d) => (
                <th key={d} style={{ padding: "10px 8px" }}>
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => {
              const set = daysOffMap[w.user_id] ?? new Set<number>();
              return (
                <tr key={w.user_id} style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                  <td style={{ padding: "10px 8px" }}>{w.full_name ?? "Worker"}</td>
                  {weekdayLabels.map((_, idx) => {
                    const checked = set.has(idx);
                    return (
                      <td key={idx} style={{ padding: "10px 8px" }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleWorkerOffDay(w.user_id, idx, e.target.checked)}
                          style={{ transform: "scale(1.1)" }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!workers.length && (
              <tr>
                <td colSpan={8} style={{ padding: "12px 8px", opacity: 0.75 }}>
                  No workers found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Weekly Worker Rotation */}
      <h2 style={{ marginTop: 28 }}>
        Weekly Worker Rotation (Week of {rotationWeekStart} to {rotationWeekEnd})
      </h2>

      <div className="toolbar" style={{ marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Week starting (Mon):</span>
          <input
            type="date"
            value={rotationWeekStart}
            onChange={(e) => setRotationWeekStart(e.target.value)}
            style={{ height: 44 }}
          />
        </label>

        <button onClick={loadWeeklyRotation} disabled={loading} style={{ height: 44 }}>
          {loading ? "Loading..." : "Refresh Weekly Rotation"}
        </button>
      </div>

      <div className="tableWrap" style={{ marginBottom: 30 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th style={{ padding: "10px 8px" }}>Date</th>
              <th style={{ padding: "10px 8px" }}>Worker</th>
              <th style={{ padding: "10px 8px" }}># Tasks</th>
              <th style={{ padding: "10px 8px" }}>Rooms</th>
            </tr>
          </thead>
          <tbody>
            {rotationRows.map((r, idx) => (
              <tr key={`${r.date}-${r.worker}-${idx}`} style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                <td style={{ padding: "10px 8px" }}>{r.date}</td>
                <td style={{ padding: "10px 8px" }}>{r.worker}</td>
                <td style={{ padding: "10px 8px" }}>{r.total}</td>
                <td style={{ padding: "10px 8px" }}>{r.rooms.join(", ")}</td>
              </tr>
            ))}
            {!rotationRows.length && (
              <tr>
                <td colSpan={4} style={{ padding: "12px 8px", opacity: 0.75 }}>
                  No assignments found for this week. Generate assignments for each day to populate the rotation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
