import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

type Profile = {
  user_id: string;
  full_name: string | null;
  role: "admin" | "worker";
};

type WorkerAssignment = {
  assignment_id: number;
  status: "not_started" | "in_progress" | "completed";
  started_at: string | null;
  completed_at: string | null;
  task: {
    id: number;
    task_date: string;
    is_harvest_shift: boolean;
    room: { name: string } | null;
    cleaning_level: { name: string } | null;
  } | null;
};

function toISODate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function WorkerDashboard({ profile }: { profile: Profile }) {
  const [selectedDate, setSelectedDate] = useState<string>(() => toISODate(new Date()));
  const [rows, setRows] = useState<WorkerAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let t: any;
    if (toast) t = setTimeout(() => setToast(null), 2500);
    return () => t && clearTimeout(t);
  }, [toast]);

  async function loadAssignments(date: string) {
    setLoading(true);
    try {
      const userRes = await supabase.auth.getUser();
      const userId = userRes.data.user?.id;
      if (!userId) {
        setRows([]);
        return;
      }

      const res = await supabase
        .from("task_assignments")
        .select(
          `
          id,
          status,
          started_at,
          completed_at,
          task:tasks (
            id,
            task_date,
            is_harvest_shift,
            room:rooms ( name ),
            cleaning_level:cleaning_levels ( name )
          )
        `
        )
        .eq("user_id", userId)
        .eq("task.task_date", date)
        .order("id", { ascending: true });

      if (res.error) throw res.error;

      const data = (res.data ?? []).map((r: any) => ({
        assignment_id: r.id,
        status: r.status,
        started_at: r.started_at,
        completed_at: r.completed_at,
        task: r.task ?? null,
      }));

      setRows(data);
    } catch (e: any) {
      console.error(e);
      setToast(e?.message ?? "Failed loading tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAssignments(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  async function setStatus(assignmentId: number, next: "in_progress" | "completed") {
    try {
      const patch: any = { status: next };
      const now = new Date().toISOString();
      if (next === "in_progress") patch.started_at = now;
      if (next === "completed") patch.completed_at = now;

      const { error } = await supabase.from("task_assignments").update(patch).eq("id", assignmentId);
      if (error) throw error;

      setRows((prev) =>
        prev.map((r) =>
          r.assignment_id === assignmentId
            ? {
                ...r,
                status: next as any,
                started_at: next === "in_progress" ? now : r.started_at,
                completed_at: next === "completed" ? now : r.completed_at,
              }
            : r
        )
      );

      setToast(next === "completed" ? "Marked complete" : "Started");
    } catch (e: any) {
      console.error(e);
      setToast(e?.message ?? "Update failed");
    }
  }

  return (
    <div className="container">
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Worker Dashboard</h1>
          <div style={{ opacity: 0.7, marginTop: 4 }}>
            Logged in as: {profile.full_name ?? "Worker"}
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

        <button onClick={() => loadAssignments(selectedDate)} disabled={loading} style={{ height: 44 }}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      <h2 style={{ marginTop: 6 }}>Your Tasks for {selectedDate}</h2>

      {/* MOBILE: CARD VIEW */}
      <div className="onlyMobile">
        <div className="cards">
          {rows.map((r) => {
            const roomName = r.task?.room?.name ?? "Unknown";
            const levelName = r.task?.cleaning_level?.name ?? "L1";
            const harvest = r.task?.is_harvest_shift ? "Yes" : "No";
            const status = r.status ?? "not_started";

            const statusLabel =
              status === "not_started" ? "Not started" : status === "in_progress" ? "In progress" : "Completed";

            return (
              <div className="card" key={r.assignment_id}>
                <div className="cardHeader">
                  <div className="cardTitle">{roomName}</div>
                  <span className="badge">{levelName}</span>
                </div>

                <div className="cardMeta">
                  <div className="metaRow">
                    <span className="metaLabel">Harvest</span>
                    <span>{harvest}</span>
                  </div>

                  <div className="metaRow">
                    <span className="metaLabel">Status</span>
                    <span>{statusLabel}</span>
                  </div>

                  <div className="metaRow">
                    <span className="metaLabel">Started</span>
                    <span>{formatTime(r.started_at)}</span>
                  </div>

                  <div className="metaRow">
                    <span className="metaLabel">Completed</span>
                    <span>{formatTime(r.completed_at)}</span>
                  </div>
                </div>

                <div className="cardActions">
                  <button
                    onClick={() => setStatus(r.assignment_id, "in_progress")}
                    disabled={status !== "not_started"}
                  >
                    Start
                  </button>

                  <button
                    onClick={() => setStatus(r.assignment_id, "completed")}
                    disabled={status === "completed"}
                  >
                    Complete
                  </button>
                </div>
              </div>
            );
          })}

          {!rows.length && (
            <div className="card">
              <div style={{ opacity: 0.8 }}>No tasks assigned for this date.</div>
            </div>
          )}
        </div>
      </div>

      {/* DESKTOP: TABLE VIEW */}
      <div className="onlyDesktop">
        <div className="tableWrap">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "10px 8px" }}>Room</th>
                <th style={{ padding: "10px 8px" }}>Level</th>
                <th style={{ padding: "10px 8px" }}>Harvest?</th>
                <th style={{ padding: "10px 8px" }}>Status</th>
                <th style={{ padding: "10px 8px" }}>Actions</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((r) => {
                const roomName = r.task?.room?.name ?? "Unknown";
                const levelName = r.task?.cleaning_level?.name ?? "L1";
                const harvest = r.task?.is_harvest_shift ? "Yes" : "No";
                const status = r.status ?? "not_started";

                return (
                  <tr key={r.assignment_id} style={{ borderTop: "1px solid rgba(255,255,255,0.15)" }}>
                    <td style={{ padding: "10px 8px" }}>{roomName}</td>
                    <td style={{ padding: "10px 8px" }}>{levelName}</td>
                    <td style={{ padding: "10px 8px" }}>{harvest}</td>
                    <td style={{ padding: "10px 8px" }}>{status}</td>
                    <td style={{ padding: "10px 8px" }}>
                      <div className="actions">
                        <button
                          onClick={() => setStatus(r.assignment_id, "in_progress")}
                          disabled={status !== "not_started"}
                          style={{ height: 40 }}
                        >
                          Start
                        </button>
                        <button
                          onClick={() => setStatus(r.assignment_id, "completed")}
                          disabled={status === "completed"}
                          style={{ height: 40 }}
                        >
                          Complete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan={5} style={{ padding: "12px 8px", opacity: 0.75 }}>
                    No tasks assigned for this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, opacity: 0.75, fontSize: 13 }}>
          Tip: On smaller screens, swipe left/right on tables if needed.
        </div>
      </div>
    </div>
  );
}
