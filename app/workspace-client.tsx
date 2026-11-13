"use client";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Award, CalendarDays, Check, ChevronRight, Dumbbell, LayoutDashboard, LockKeyhole, LogOut, MapPin, Menu, Plus, Search, ShieldCheck, Trophy, UserPlus, Users, X } from "lucide-react";

type Role = "admin" | "coach" | "player" | "scout";
type Section = "Overview" | "Attendance" | "Athletes" | "Teams" | "Matches" | "Staff";
type Team = { id: string; name: string; sport: string; coachIds?: string[]; athleteCount?: number };
type Athlete = { id: string; name: string; age?: number; studentId?: string; sport: string; teamId: string; team: string; year: string; attendancePercent: number; matchesPlayed: number; ready: boolean };
type Row = { athleteId: string; name: string; studentId?: string; status: "present" | "absent" };
type Session = { id: string; title: string; teamId: string; team: string; sport: string; date: string; time: string; status: "open" | "closed"; attendance: Row[] };
type Match = { id: string; sessionId: string; teamId: string; team: string; sport: string; opponent: string; date: string; time: string; scores: { athleteId: string; name: string; score: number }[] };
type Staff = { id: string; name: string; email: string; role: Role };
type User = { id: string; name: string; email: string; role: Role };
type Dashboard = { user: User; organization: { name: string; type: string; city?: string } | null; teams: Team[]; athletes: Athlete[]; sessions: Session[]; matches: Match[]; metrics: { activeAthletes: number; attendanceRate: number; sessionsThisWeek: number; openSessions: number; readyCount: number } };
type Modal = "athlete" | "session" | "team" | "match" | "score" | "staff" | null;

const navigation: { name: Section; icon: typeof Users }[] = [
  { name: "Overview", icon: LayoutDashboard }, { name: "Attendance", icon: CalendarDays },
  { name: "Athletes", icon: Users }, { name: "Teams", icon: Dumbbell },
  { name: "Matches", icon: Trophy }, { name: "Staff", icon: ShieldCheck },
];
const EMPTY_TEAMS: Team[] = [];
const EMPTY_ATHLETES: Athlete[] = [];
const EMPTY_SESSIONS: Session[] = [];
const EMPTY_MATCHES: Match[] = [];
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "FH"; }
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function dateLabel(value: string) { const date = new Date(value + "T12:00:00"); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date); }
function roleLabel(role: Role) { return role === "admin" ? "Administrator" : role === "coach" ? "Coach" : role === "scout" ? "Scout" : "Athlete"; }

export default function WorkspaceClient() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [section, setSection] = useState<Section>("Overview");
  const [sessionId, setSessionId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [query, setQuery] = useState("");
  const [sportFilter, setSportFilter] = useState("All sports");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [assigningTeamId, setAssigningTeamId] = useState("");
  const [savingAttendance, setSavingAttendance] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/dashboard", { cache: "no-store" });
    const result = await response.json() as Dashboard & { error?: string };
    if (response.status === 401) { router.replace("/login"); return; }
    if (!response.ok) throw new Error(result.error || "Could not load this workspace.");
    setData(result);
    if (result.user.role === "admin" || result.user.role === "coach") {
      const staffResponse = await fetch("/api/staff", { cache: "no-store" });
      if (staffResponse.ok) setStaff((await staffResponse.json() as { staff: Staff[] }).staff);
    }
  }, [router]);
  useEffect(() => {
    let active = true;
    // Bootstrap the authenticated workspace from the server on first mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Workspace unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  const user = data?.user;
  const manager = user?.role === "admin" || user?.role === "coach";
  const sections = navigation.filter((item) => item.name === "Overview" ||
    (manager && ["Attendance", "Athletes", "Teams", "Matches"].includes(item.name)) ||
    (user?.role === "player" && ["Attendance", "Matches"].includes(item.name)) ||
    (user?.role === "scout" && item.name === "Athletes") ||
    ((user?.role === "admin" || user?.role === "coach") && item.name === "Staff"));
  const teams = data?.teams ?? EMPTY_TEAMS;
  const athletes = data?.athletes ?? EMPTY_ATHLETES;
  const sessions = data?.sessions ?? EMPTY_SESSIONS;
  const matches = data?.matches ?? EMPTY_MATCHES;
  const selectedSession = sessions.find((item) => item.id === sessionId) || sessions[0];
  const selectedMatch = matches.find((item) => item.id === matchId);
  const scoringSession = sessions.find((item) => item.id === selectedMatch?.sessionId && item.status === "closed");
  const scoreCandidates = athletes.filter((athlete) => scoringSession?.attendance.some((row) => row.athleteId === athlete.id && row.status === "present"));
  const sports = useMemo(() => Array.from(new Set(athletes.map((item) => item.sport))).sort(), [athletes]);
  const visibleAthletes = useMemo(() => athletes.filter((item) =>
    (item.name + " " + (item.studentId || "") + " " + item.team).toLowerCase().includes(query.toLowerCase()) &&
    (sportFilter === "All sports" || item.sport === sportFilter)), [athletes, query, sportFilter]);
  function toast(message: string) { setNotice(message); window.setTimeout(() => setNotice(""), 3500); }
  async function send(path: string, method: string, body?: Record<string, unknown>) {
    const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json() as { error?: string; session?: { id: string }; updated?: number };
    if (response.status === 401) { router.replace("/login"); throw new Error("Please sign in again."); }
    if (!response.ok) throw new Error(result.error || "The change could not be saved.");
    return result;
  }
  async function reload(message: string) { await load(); toast(message); }
  async function attendance(session: Session, athleteId: string, status: "present" | "absent") {
    setSavingAttendance(true);
    try { await send("/api/sessions/" + session.id, "PATCH", { action: "mark", athleteId, status }); await reload("Attendance saved."); }
    catch (reason) { toast(reason instanceof Error ? reason.message : "Attendance could not be saved."); }
    finally { setSavingAttendance(false); }
  }
  async function attendanceAll(session: Session, status: "present" | "absent") {
    const changed = session.attendance.filter((row) => row.status !== status).length;
    if (!changed) { toast(status === "present" ? "Everyone is already marked present." : "Everyone is already marked absent."); return; }
    const prompt = status === "present"
      ? `Mark all ${session.attendance.length} athletes present? You can still adjust individual rows before closing.`
      : `Mark all ${session.attendance.length} athletes absent? This resets the open register.`;
    if (!window.confirm(prompt)) return;
    setSavingAttendance(true);
    try {
      const result = await send("/api/sessions/" + session.id, "PATCH", { action: "markAll", status });
      const updated = result.updated ?? changed;
      await reload(`${updated} attendance ${updated === 1 ? "record" : "records"} updated.`);
    } catch (reason) { toast(reason instanceof Error ? reason.message : "Attendance could not be saved."); }
    finally { setSavingAttendance(false); }
  }
  async function closeSession(session: Session) {
    if (!window.confirm("Close and lock this attendance register? It cannot be edited afterward.")) return;
    try { await send("/api/sessions/" + session.id, "PATCH", { action: "close" }); await reload("Register closed and locked."); }
    catch (reason) { toast(reason instanceof Error ? reason.message : "Session could not be closed."); }
  }
  async function assignCoach(team: Team, coachId: string, assigned: boolean) {
    const current = team.coachIds ?? [];
    const coachIds = assigned ? Array.from(new Set([...current, coachId])) : current.filter((id) => id !== coachId);
    setAssigningTeamId(team.id);
    try {
      await send("/api/teams/" + team.id, "PATCH", { coachIds });
      await reload("Coach assignments updated.");
    } catch (reason) { toast(reason instanceof Error ? reason.message : "Coach assignments could not be updated."); }
    finally { setAssigningTeamId(""); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const teamId = String(values.get("teamId") || "");
    const team = teams.find((item) => item.id === teamId);
    try {
      if (modal === "athlete") {
        if (!team) throw new Error("Create a team before adding athletes.");
        await send("/api/players", "POST", { name: String(values.get("name")).trim(), age: Number(values.get("age")), studentId: String(values.get("studentId")).trim(), year: String(values.get("year")).trim(), teamId, sport: String(values.get("sport")).trim(), joinedAt: String(values.get("joinedAt")) || today(), email: String(values.get("email") || ""), password: String(values.get("password") || "") });
        setModal(null); await reload("Athlete added to the official roster.");
      } else if (modal === "session") {
        const result = await send("/api/sessions", "POST", { teamId, title: String(values.get("title")).trim(), date: String(values.get("date")), startTime: String(values.get("time")) });
        if (result.session?.id) setSessionId(result.session.id);
        setModal(null); setSection("Attendance"); await reload("Session opened. Every athlete starts as Absent.");
      } else if (modal === "team") {
        await send("/api/teams", "POST", { name: String(values.get("name")).trim(), sport: String(values.get("sport")).trim() });
        setModal(null); await reload("Team created.");
      } else if (modal === "match") {
        await send("/api/matches", "POST", { sessionId: String(values.get("sessionId")), date: String(values.get("date")), sport: String(values.get("sport")).trim(), opponent: String(values.get("opponent")).trim(), startTime: String(values.get("time")) });
        setModal(null); await reload("Match recorded.");
      } else if (modal === "score") {
        await send("/api/matches/" + matchId + "/scores", "POST", { athleteId: String(values.get("athleteId")), score: Number(values.get("score")) });
        setModal(null); await reload("Match performance saved.");
      } else if (modal === "staff") {
        await send("/api/staff", "POST", { name: String(values.get("name")).trim(), email: String(values.get("email")).trim(), role: String(values.get("role")), password: String(values.get("password")) });
        setModal(null); await reload("Staff account created.");
      }
    } catch (reason) { toast(reason instanceof Error ? reason.message : "The record could not be saved."); }
  }
  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/login"); }
  if (loading) return <div className="fh-gate"><span className="fh-mark"><ShieldCheck size={22} /></span><strong>Opening Fieldhouse</strong><span>Loading your academy workspace.</span></div>;
  if (!data || error) return <div className="fh-gate"><span className="fh-mark"><ShieldCheck size={22} /></span><strong>Workspace unavailable</strong><span>{error || "Sign in to continue."}</span><Link className="fh-button primary" href="/login">Sign in or create an academy</Link><button className="fh-link" onClick={() => { setError(""); setLoading(true); load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Workspace unavailable.")).finally(() => setLoading(false)); }}>Try again <ChevronRight size={15} /></button></div>;

  return <div className="fh-shell">
    {mobileNav && <button className="fh-scrim" onClick={() => setMobileNav(false)} aria-label="Close navigation" />}
    <aside className={"fh-sidebar" + (mobileNav ? " open" : "")}>
      <Link className="fh-brand" href="/"><span className="fh-mark"><ShieldCheck size={20} /></span><strong>fieldhouse<span>.</span></strong></Link>
      <div className="fh-org"><span className="fh-org-mark">{initials(data.organization?.name || "FH")}</span><span><strong>{data.organization?.name || "Your academy"}</strong><small><MapPin size={12} /> {data.organization?.city || "Sports academy"}</small></span></div>
      <div className="fh-nav-label">WORKSPACE</div><nav className="fh-nav">{sections.map((item) => { const Icon = item.icon; return <button key={item.name} className={section === item.name ? "active" : ""} onClick={() => { setSection(item.name); setMobileNav(false); }}><Icon size={18} /><span>{item.name}</span>{item.name === "Attendance" && data.metrics.openSessions > 0 && <i>{data.metrics.openSessions}</i>}</button>; })}</nav>
      <div className="fh-sidebar-foot"><div className="fh-user"><span className="fh-avatar">{initials(user?.name || "")}</span><span><strong>{user?.name}</strong><small>{roleLabel(user?.role || "player")}</small></span><button onClick={logout} aria-label="Sign out"><LogOut size={16} /></button></div></div>
    </aside>
    <div className="fh-main"><header className="fh-topbar"><button className="fh-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><div className="fh-crumb">{data.organization?.name} <ChevronRight size={14} /><strong>{section}</strong></div><span className="fh-top-user">{user?.name} · {roleLabel(user?.role || "player")}</span></header>
      <main className="fh-content">{notice && <div className="fh-notice" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss"><X size={15} /></button></div>}
        {section === "Overview" && <Overview data={data} manager={Boolean(manager)} open={() => setModal("session")} navigate={setSection} onModal={setModal} onAttendance={attendance} savingAttendance={savingAttendance} onClose={closeSession} />}
        {section === "Attendance" && <AttendancePage sessions={sessions} selected={selectedSession} onSelect={setSessionId} onAttendance={attendance} onBulkAttendance={attendanceAll} savingAttendance={savingAttendance} onClose={closeSession} manager={Boolean(manager)} onNew={() => setModal("session")} />}
        {section === "Athletes" && <AthletesPage athletes={visibleAthletes} sports={sports} sport={sportFilter} query={query} manager={Boolean(manager)} onSport={setSportFilter} onQuery={setQuery} onNew={() => setModal("athlete")} />}
        {section === "Teams" && <TeamsPage teams={teams} athletes={athletes} staff={staff} role={data.user.role} assigningTeamId={assigningTeamId} onAssign={assignCoach} onNew={() => setModal("team")} />}
        {section === "Matches" && <MatchesPage matches={matches} sessions={sessions} athletes={athletes} manager={Boolean(manager)} onNew={() => setModal("match")} onScore={(id) => { setMatchId(id); setModal("score"); }} />}
        {section === "Staff" && <StaffPage staff={staff} onNew={() => setModal("staff")} />}
      </main>
    </div>
    {modal && <RecordModal kind={modal} teams={teams} sessions={sessions} candidates={scoreCandidates} selectedMatch={selectedMatch} onSubmit={submit} onClose={() => setModal(null)} />}
  </div>;
}

function Heading({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: React.ReactNode }) {
  return <div className="fh-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{text}</p></div>{action}</div>;
}
function Action({ children, onClick, secondary = false, disabled = false }: { children: React.ReactNode; onClick: () => void; secondary?: boolean; disabled?: boolean }) {
  return <button className={"fh-button " + (secondary ? "secondary" : "primary")} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <div className="fh-empty"><span><Activity size={20} /></span><strong>{title}</strong><p>{text}</p>{action}</div>;
}
function Stat({ icon: Icon, label, value, detail }: { icon: typeof Users; label: string; value: string | number; detail: string }) {
  return <article className="fh-stat"><span><Icon size={18} /></span><small>{label}</small><strong>{value}</strong><em>{detail}</em></article>;
}

function Overview({ data, manager, open, navigate, onModal, onAttendance, savingAttendance, onClose }: { data: Dashboard; manager: boolean; open: () => void; navigate: (section: Section) => void; onModal: (kind: Modal) => void; onAttendance: (session: Session, athleteId: string, status: "present" | "absent") => void; savingAttendance: boolean; onClose: (session: Session) => void }) {
  const session = data.sessions.find((item) => item.status === "open") || data.sessions[0];
  const ready = data.athletes.filter((item) => item.ready);
  const present = session?.attendance.filter((item) => item.status === "present").length || 0;
  const setupStep = data.teams.length === 0 ? 1 : data.athletes.length === 0 ? 2 : data.sessions.length === 0 ? 3 : 0;
  const setupTitle = setupStep === 1 ? "Create your first team" : setupStep === 2 ? "Build the athlete roster" : "Open the first attendance session";
  const setupText = setupStep === 1 ? "Choose a sport and name for your team." : setupStep === 2 ? "Add athletes and optional player sign-ins to this team." : "Take roll call and create the first attendance record.";
  const setupAction = setupStep === 1 ? () => navigate("Teams") : setupStep === 2 ? () => onModal("athlete") : open;
  const setupLabel = setupStep === 1 ? "Create a team" : setupStep === 2 ? "Add athletes" : "Open a session";
  return <><Heading eyebrow={dateLabel(today())} title={"Good day, " + data.user.name.split(" ")[0]} text={manager ? "Your teams, attendance, and trial readiness in one place." : data.user.role === "scout" ? "Review athletes who meet the readiness rule." : "Your player record, all in one place."} action={manager ? <Action onClick={setupStep === 1 ? () => navigate("Teams") : setupStep === 2 ? () => onModal("athlete") : open}><Plus size={16} /> {setupStep === 1 ? "Create a team" : setupStep === 2 ? "Add athletes" : "Start a session"}</Action> : undefined} />
    <section className="fh-hero"><div><small>YOUR SPORTS ACADEMY, IN SYNC</small><h2>Every practice<br />counts toward <em>something.</em></h2><p>Keep attendance, match scores, and readiness in one place.</p><button className="fh-link" onClick={() => navigate(data.user.role === "scout" ? "Athletes" : "Attendance")}>Open attendance <ChevronRight size={15} /></button></div><div className="fh-hero-art">ONE TEAM.<br />ONE RECORD.</div></section>
    {manager && setupStep > 0 && <section className="fh-setup-card"><span>STEP 0{setupStep} / 03</span><div><strong>{setupTitle}</strong><small>{setupText}</small></div><Action secondary onClick={setupAction}>{setupLabel} <ChevronRight size={14} /></Action></section>}
    <section className="fh-stat-grid"><Stat icon={Users} label={data.user.role === "player" ? "MY PROFILE" : "ACTIVE ATHLETES"} value={data.metrics.activeAthletes} detail={data.user.role === "player" ? "Private athlete record" : "Across active teams"} /><Stat icon={Activity} label="ATTENDANCE RATE" value={data.metrics.attendanceRate + "%"} detail="From closed sessions" /><Stat icon={CalendarDays} label="SESSIONS THIS WEEK" value={data.metrics.sessionsThisWeek} detail={manager ? data.metrics.openSessions + " open registers" : data.user.role === "scout" ? "Not shown to scouts" : "On your team since Monday"} /><Stat icon={Award} label="TRIAL READY" value={ready.length || data.metrics.readyCount} detail="75% attendance + 2 matches" /></section>
    <div className="fh-overview-grid"><section className="fh-card"><div className="fh-card-head"><div><small>{manager ? "LIVE ROLL CALL" : "YOUR ATTENDANCE"}</small><h2>{session?.team || "Your session record"}</h2><p>{session ? session.title + " · " + dateLabel(session.date) : "Your coach’s sessions will appear here."}</p></div>{session && <span className={"fh-pill " + session.status}>{session.status === "open" ? "Open" : "Locked"}</span>}</div>
      {session ? <><div className="fh-session-summary"><span><b>{session.attendance.length}</b> rostered</span><span><b>{present}</b> present</span><span><b>{session.attendance.length - present}</b> absent</span></div>{session.attendance.slice(0, manager ? 5 : 1).map((row) => <div className="fh-person" key={row.athleteId}><span className="fh-avatar">{initials(row.name)}</span><span><b>{row.name}</b><small>{row.studentId || "Attendance record"}</small></span>{manager && session.status === "open" ? <span className="fh-choice"><button disabled={savingAttendance} className={row.status === "present" ? "selected" : ""} onClick={() => onAttendance(session, row.athleteId, "present")}>Present</button><button disabled={savingAttendance} className={row.status === "absent" ? "selected absent" : ""} onClick={() => onAttendance(session, row.athleteId, "absent")}>Absent</button></span> : <span className={"fh-pill " + row.status}>{row.status}</span>}</div>)}{manager && session.status === "open" && <div className="fh-card-foot"><span><LockKeyhole size={13} /> Closing locks this register.</span><Action disabled={savingAttendance} onClick={() => onClose(session)}><LockKeyhole size={14} /> Review & close</Action></div>}</> : <Empty title="No sessions yet" text={manager ? "Open a team session to take your first register." : "Your attendance records will appear here."} action={manager ? <Action onClick={open}><Plus size={14} /> Open session</Action> : undefined} />}</section>
    <section className="fh-card"><div className="fh-card-head"><div><small>ELIGIBILITY TRACKER</small><h2>Trial-ready athletes</h2><p>Attendance and match requirements met.</p></div><button className="fh-round" onClick={() => navigate("Athletes")}><ChevronRight size={16} /></button></div>{ready.slice(0, 5).map((person) => <div className="fh-person" key={person.id}><span className="fh-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{person.sport} · {person.team}</small></span><strong className="fh-readiness">{person.attendancePercent}%<small>{person.matchesPlayed} matches</small></strong></div>)}{!ready.length && <Empty title="Readiness builds over time" text="Players qualify at 75% attendance with two match scores." />}</section></div>
  </>;
}

function AttendancePage({ sessions, selected, onSelect, onAttendance, onBulkAttendance, savingAttendance, onClose, manager, onNew }: { sessions: Session[]; selected?: Session; onSelect: (id: string) => void; onAttendance: (session: Session, athleteId: string, status: "present" | "absent") => void; onBulkAttendance: (session: Session, status: "present" | "absent") => void; savingAttendance: boolean; onClose: (session: Session) => void; manager: boolean; onNew: () => void }) {
  const session = sessions.find((item) => item.id === selected?.id) || sessions[0];
  const present = session?.attendance.filter((row) => row.status === "present").length || 0;
  return <><Heading eyebrow="OFFICIAL SESSION RECORDS" title="Attendance" text={manager ? "Mark attendance and lock the register once it is reviewed." : "Your attendance history across team sessions."} action={manager ? <Action onClick={onNew}><Plus size={15} /> New session</Action> : undefined} /><div className="fh-two-col"><section className="fh-card"><div className="fh-card-head"><div><small>SESSION REGISTER</small><h2>Recent sessions</h2></div></div>{sessions.map((item) => <button key={item.id} className={"fh-session-option " + (session?.id === item.id ? "current" : "")} onClick={() => onSelect(item.id)}><span><b>{item.team}</b><small>{item.title} · {dateLabel(item.date)}</small></span><span className={"fh-pill " + item.status}>{item.status === "open" ? "Open" : "Locked"}</span></button>)}{!sessions.length && <Empty title="No sessions yet" text="Your attendance history will appear here." />}</section>
    <section className="fh-card"><div className="fh-card-head"><div><small>{session ? dateLabel(session.date).toUpperCase() + " · " + session.time : "SESSION DETAILS"}</small><h2>{session?.team || "Choose a session"}</h2><p>{session?.title || "Attendance register"}</p></div>{session && <span className={"fh-pill " + session.status}>{session.status === "open" ? "Open" : "Locked"}</span>}</div>{session && <><div className="fh-session-summary"><span><b>{session.attendance.length}</b> rostered</span><span><b>{present}</b> present</span><span><b>{session.attendance.length - present}</b> absent</span></div>{manager && session.status === "open" && <div className="fh-attendance-bulk"><div><b aria-live="polite">{savingAttendance ? "Saving attendance…" : "Quick mark"}</b><small>Applies to all {session.attendance.length} athletes. Review individual rows before closing.</small></div><div><button type="button" disabled={savingAttendance} onClick={() => onBulkAttendance(session, "present")}><Check size={14} /> Mark all present</button><button type="button" disabled={savingAttendance} onClick={() => onBulkAttendance(session, "absent")}><X size={14} /> Mark all absent</button></div></div>}<div className="fh-table-scroll"><table className="fh-table"><thead><tr><th>ATHLETE</th><th>STUDENT ID</th><th>STATUS</th></tr></thead><tbody>{session.attendance.map((row) => <tr key={row.athleteId}><td><b>{row.name}</b></td><td>{row.studentId || (manager ? "—" : "Private")}</td><td>{manager && session.status === "open" ? <span className="fh-choice"><button disabled={savingAttendance} className={row.status === "present" ? "selected" : ""} onClick={() => onAttendance(session, row.athleteId, "present")}>Present</button><button disabled={savingAttendance} className={row.status === "absent" ? "selected absent" : ""} onClick={() => onAttendance(session, row.athleteId, "absent")}>Absent</button></span> : <span className={"fh-pill " + row.status}>{row.status}</span>}</td></tr>)}</tbody></table></div>{manager && session.status === "open" && <div className="fh-card-foot"><span><LockKeyhole size={13} /> This register locks after closing.</span><Action disabled={savingAttendance} onClick={() => onClose(session)}>Review & close</Action></div>}</>}</section></div></>;
}

function AthletesPage({ athletes, sports, sport, query, manager, onSport, onQuery, onNew }: { athletes: Athlete[]; sports: string[]; sport: string; query: string; manager: boolean; onSport: (value: string) => void; onQuery: (value: string) => void; onNew: () => void }) {
  return <><Heading eyebrow={manager ? "PEOPLE & ELIGIBILITY" : "SCOUTING ROSTER"} title={manager ? "Athlete directory" : "Trial-ready athletes"} text={manager ? "A verified roster across every sport and team." : "Only athletes who meet the trial criteria are shown."} action={manager ? <Action onClick={onNew}><UserPlus size={15} /> Add athlete</Action> : undefined} /><section className="fh-card"><div className="fh-toolbar"><div><small>{manager ? "ACTIVE ATHLETES" : "ELIGIBLE ATHLETES"}</small><b>{athletes.length} records</b></div><label className="fh-search"><Search size={15} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search name, ID, team" /></label><select value={sport} onChange={(event) => onSport(event.target.value)}><option>All sports</option>{sports.map((item) => <option key={item}>{item}</option>)}</select></div><div className="fh-table-scroll"><table className="fh-table"><thead><tr><th>ATHLETE</th><th>SPORT / TEAM</th><th>ATTENDANCE</th><th>MATCHES</th><th>READINESS</th></tr></thead><tbody>{athletes.map((person) => <tr key={person.id}><td><span className="fh-table-person"><span className="fh-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>Age {person.age ?? "—"} · {person.studentId || "Private profile"} · {person.year}</small></span></span></td><td><b>{person.sport}</b><small className="fh-subline">{person.team}</small></td><td><b>{person.attendancePercent}%</b><div className="fh-progress"><i style={{ width: person.attendancePercent + "%" }} /></div></td><td>{person.matchesPlayed}</td><td><span className={"fh-pill " + (person.ready ? "present" : "absent")}>{person.ready ? "Trial ready" : "Building"}</span></td></tr>)}</tbody></table></div>{!athletes.length && <Empty title="No athletes found" text={manager ? "Add an athlete to start your roster." : "No eligible profiles are available yet."} />}</section></>;
}

function TeamsPage({ teams, athletes, staff, role, assigningTeamId, onAssign, onNew }: { teams: Team[]; athletes: Athlete[]; staff: Staff[]; role: Role; assigningTeamId: string; onAssign: (team: Team, coachId: string, assigned: boolean) => void; onNew: () => void }) {
  const coaches = staff.filter((person) => person.role === "coach");
  return <><Heading eyebrow="TEAM ROSTERS" title="Teams" text="Organize players by sport." action={<Action onClick={onNew}><Plus size={15} /> Create team</Action>} /><div className="fh-team-grid">{teams.map((team) => { const roster = athletes.filter((item) => item.teamId === team.id); const rate = roster.length ? Math.round(roster.reduce((sum, item) => sum + item.attendancePercent, 0) / roster.length) : 0; return <article className="fh-card fh-team-card" key={team.id}><span className="fh-team-icon"><Dumbbell size={18} /></span><small>{team.sport.toUpperCase()}</small><h2>{team.name}</h2><footer>{team.athleteCount ?? roster.length} athletes <strong>{rate}% attendance</strong></footer>{(role === "admin" || role === "coach") && <details className="fh-assignment"><summary>Assign coaches</summary>{coaches.length ? coaches.map((coach) => <label key={coach.id}><input type="checkbox" disabled={assigningTeamId === team.id} checked={(team.coachIds ?? []).includes(coach.id)} onChange={(event) => onAssign(team, coach.id, event.target.checked)} />{coach.name}</label>) : <small>Add a coach in Staff first.</small>}</details>}</article>; })}<button className="fh-add-team" onClick={onNew}><Plus size={20} /><b>Build your next team</b><small>Add a sport and team name</small></button></div>{teams.length === 0 && <Empty title="Create the first team" text="Teams organize rosters, attendance, and match records." action={<Action onClick={onNew}><Plus size={14} /> Create team</Action>} />}</>;
}

function MatchesPage({ matches, sessions, athletes, manager, onNew, onScore }: { matches: Match[]; sessions: Session[]; athletes: Athlete[]; manager: boolean; onNew: () => void; onScore: (id: string) => void }) {
  return <><Heading eyebrow="COMPETITION CALENDAR" title="Matches & events" text="Each match is linked to the exact closed attendance register used for score eligibility." action={manager ? <Action onClick={onNew}><Plus size={15} /> Add match</Action> : undefined} /><section className="fh-card"><div className="fh-card-head"><div><small>SEASON RECORD</small><h2>Matches</h2></div></div>{matches.map((match) => { const linked = sessions.find((item) => item.id === match.sessionId && item.status === "closed"); const eligible = athletes.some((person) => linked?.attendance.some((row) => row.athleteId === person.id && row.status === "present")); return <article className="fh-match-row" key={match.id}><span className="fh-date-chip">{dateLabel(match.date)}</span><span className="fh-match-copy"><small>{match.team} · {match.sport}</small><b>{match.opponent}</b><span>{match.time}</span>{match.scores.map((score) => <small key={score.athleteId}>{score.name}: <strong>{score.score}</strong></small>)}</span><span className={"fh-pill " + (linked ? "present" : "absent")}>{linked ? "Register linked" : "Register unavailable"}</span>{manager && linked && eligible && <Action secondary onClick={() => onScore(match.id)}><Award size={14} /> Record score</Action>}</article>; })}{!matches.length && <Empty title="No matches recorded" text={manager ? "Add a match after closing attendance for its team and date." : "Your match records will appear here."} action={manager ? <Action onClick={onNew}><Plus size={14} /> Add match</Action> : undefined} />}</section></>;
}

function StaffPage({ staff, onNew }: { staff: Staff[]; onNew: () => void }) {
  return <><Heading eyebrow="COACH & SCOUT ACCOUNTS" title="Staff" text="Add coaches or scouts to your academy." action={<Action onClick={onNew}><UserPlus size={15} /> Add staff</Action>} /><section className="fh-card"><div className="fh-card-head"><div><small>TEAM ACCOUNTS</small><h2>Coaches & scouts</h2></div></div>{staff.map((person) => <div className="fh-person" key={person.id}><span className="fh-avatar">{initials(person.name)}</span><span><b>{person.name}</b><small>{person.email}</small></span><span className="fh-pill present">{roleLabel(person.role)}</span></div>)}</section></>;
}

function RecordModal({ kind, teams, sessions, candidates, selectedMatch, onSubmit, onClose }: { kind: Exclude<Modal, null>; teams: Team[]; sessions: Session[]; candidates: Athlete[]; selectedMatch?: Match; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void }) {
  const heading = kind === "athlete" ? "Add an athlete" : kind === "session" ? "Open a session" : kind === "team" ? "Create a team" : kind === "match" ? "Add a match" : kind === "score" ? "Record a score" : "Add staff access";
  return <div className="fh-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="fh-modal" role="dialog" aria-modal="true" aria-labelledby="fh-modal-heading"><header><div><small>FIELDHOUSE RECORD</small><h2 id="fh-modal-heading">{heading}</h2></div><button onClick={onClose} aria-label="Close"><X size={18} /></button></header><form onSubmit={onSubmit}>
    {kind === "athlete" && <><label>Full name<input name="name" required autoFocus /></label><div className="fh-form-grid"><label>Age<input name="age" type="number" min="5" max="100" required /></label><label>Student ID<input name="studentId" required /></label></div><label>Class / year<input name="year" required placeholder="Year 1" /></label><label>Sport<input name="sport" list="fh-sports" required /></label><datalist id="fh-sports">{Array.from(new Set(teams.map((team) => team.sport))).map((item) => <option key={item} value={item} />)}</datalist><label>Team<select name="teamId" required defaultValue=""><option value="" disabled>Select team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.sport}</option>)}</select></label><div className="fh-form-grid"><label>Player email (optional)<input name="email" type="email" /></label><label>Temporary password (12+ chars)<input name="password" type="password" minLength={12} /></label></div></>}
    {kind === "session" && <><label>Session title<input name="title" required minLength={2} autoFocus /></label><label>Team<select name="teamId" required defaultValue=""><option value="" disabled>Select team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.sport}</option>)}</select></label><div className="fh-form-grid"><label>Date<input name="date" type="date" defaultValue={today()} required /></label><label>Start time<input name="time" type="time" defaultValue="15:30" required /></label></div><p className="fh-modal-note"><LockKeyhole size={14} /> Closing locks this record.</p></>}
    {kind === "team" && <><label>Team name<input name="name" required autoFocus /></label><label>Sport<input name="sport" required /></label></>}
    {kind === "match" && <><div className="fh-form-grid"><label>Match date<input name="date" type="date" required /></label><label>Sport<input name="sport" list="fh-sports" required /></label></div><datalist id="fh-sports">{Array.from(new Set(teams.map((team) => team.sport))).map((item) => <option key={item} value={item} />)}</datalist><label>Closed attendance register<select name="sessionId" required defaultValue=""><option value="" disabled>Select a locked register</option>{sessions.filter((session) => session.status === "closed").map((session) => <option key={session.id} value={session.id}>{session.team} · {session.title} · {dateLabel(session.date)}</option>)}</select></label><label>Opponent<input name="opponent" required autoFocus /></label><label>Match start time<input name="time" type="time" defaultValue="16:00" required /></label><p className="fh-modal-note">Date and sport must match the selected closed register. Only athletes marked Present can receive scores.</p></>}
    {kind === "score" && <><p>{selectedMatch?.team} vs. {selectedMatch?.opponent} · {selectedMatch ? dateLabel(selectedMatch.date) : ""}</p><label>Present athlete<select name="athleteId" required defaultValue=""><option value="" disabled>Select athlete</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>Score / points<input name="score" type="number" min="0" max="10000" step="0.1" required /></label></>}
    {kind === "staff" && <><label>Full name<input name="name" required autoFocus /></label><label>Work email<input name="email" type="email" required /></label><label>Role<select name="role"><option value="coach">Coach</option><option value="scout">Scout</option></select></label><label>Sign-in password<input name="password" type="password" minLength={12} required /></label></>}
    <div className="fh-modal-actions"><button type="button" className="fh-button secondary" onClick={onClose}>Cancel</button><button type="submit" className="fh-button primary"><Check size={15} /> Save record</button></div>
  </form></section></div>;
}
