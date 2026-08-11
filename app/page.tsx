"use client";

import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  FileSpreadsheet,
  Filter,
  LayoutDashboard,
  LogOut,
  Mail,
  Medal,
  MessageCircle,
  MoreHorizontal,
  Phone,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UploadCloud,
  UserRoundCheck,
  Users,
  X,
} from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Tab = "overview" | "queue" | "leaderboard" | "imports";
type ContactStatus = "unassigned" | "assigned" | "contacted" | "follow-up" | "complete";

type Person = {
  id: string;
  external_id: string;
  name: string;
  email: string;
  phone?: string | null;
  country: string;
  region?: string | null;
  joined_at?: string | null;
  current_rank: string;
  target_rank?: string | null;
  ov: number;
  gap_to_rank: number;
  status: ContactStatus;
  assigned_to?: string | null;
  assigned_name?: string | null;
  is_new_distributor: boolean;
  push_level?: "rank" | "pcm" | null;
  last_contacted_at?: string | null;
  last_outcome?: string | null;
  notes?: string | null;
  priority_score: number;
};

const DEMO_PEOPLE: Person[] = [
  { id: "1", external_id: "DEMO-001", name: "Demo Distributor 01", email: "distributor-01@example.invalid", phone: "+1 202 555 0101", country: "United States", region: "Utah", joined_at: "2026-08-03", current_rank: "Manager", target_rank: "Director", ov: 3840, gap_to_rank: 1160, status: "follow-up", assigned_to: "demo", assigned_name: "Demo Admin", is_new_distributor: true, push_level: "rank", last_contacted_at: "2026-08-10T16:20:00Z", last_outcome: "Strategy call booked", notes: "Has an active prospect list and wants help with launch messaging.", priority_score: 98 },
  { id: "2", external_id: "DEMO-002", name: "Demo Distributor 02", email: "distributor-02@example.invalid", phone: "+1 202 555 0102", country: "Brazil", region: "São Paulo", joined_at: "2026-08-05", current_rank: "Executive Manager", target_rank: "Director", ov: 4260, gap_to_rank: 740, status: "assigned", assigned_to: "u2", assigned_name: "Demo Coach D", is_new_distributor: true, push_level: "rank", priority_score: 94 },
  { id: "3", external_id: "DEMO-003", name: "Demo Distributor 03", email: "distributor-03@example.invalid", phone: "+1 202 555 0103", country: "Canada", region: "British Columbia", joined_at: "2026-07-28", current_rank: "Director", target_rank: "Senior Director", ov: 8430, gap_to_rank: 1570, status: "contacted", assigned_to: "u3", assigned_name: "Demo Coach A", is_new_distributor: false, push_level: "rank", last_contacted_at: "2026-08-09T19:05:00Z", last_outcome: "WhatsApp sent", priority_score: 91 },
  { id: "4", external_id: "DEMO-004", name: "Demo Distributor 04", email: "distributor-04@example.invalid", phone: "+1 202 555 0104", country: "Mexico", region: "Jalisco", joined_at: "2026-08-07", current_rank: "Distributor", target_rank: "Manager", ov: 780, gap_to_rank: 220, status: "unassigned", is_new_distributor: true, push_level: null, priority_score: 88 },
  { id: "5", external_id: "DEMO-005", name: "Demo Distributor 05", email: "distributor-05@example.invalid", phone: "+1 202 555 0105", country: "United States", region: "Georgia", joined_at: "2026-07-18", current_rank: "Senior Director", target_rank: "Executive Director", ov: 17580, gap_to_rank: 2420, status: "follow-up", assigned_to: "u4", assigned_name: "Demo Coach B", is_new_distributor: false, push_level: "pcm", last_contacted_at: "2026-08-10T14:40:00Z", last_outcome: "Needs downline update", priority_score: 86 },
  { id: "6", external_id: "DEMO-006", name: "Demo Distributor 06", email: "distributor-06@example.invalid", phone: "+1 202 555 0106", country: "Colombia", region: "Bogotá", joined_at: "2026-08-08", current_rank: "Distributor", target_rank: "Manager", ov: 320, gap_to_rank: 680, status: "complete", assigned_to: "u5", assigned_name: "Demo Coach C", is_new_distributor: true, push_level: null, last_contacted_at: "2026-08-10T13:10:00Z", last_outcome: "Welcomed — no help needed", priority_score: 73 },
  { id: "7", external_id: "DEMO-007", name: "Demo Distributor 07", email: "distributor-07@example.invalid", phone: "+1 202 555 0107", country: "Peru", region: "Lima", joined_at: "2026-07-23", current_rank: "Executive Director", target_rank: "Presidential Manager", ov: 28200, gap_to_rank: 6800, status: "unassigned", is_new_distributor: false, push_level: "pcm", priority_score: 82 },
];

const TEAM = [
  { name: "Demo Coach A", initials: "DA", market: "US & Canada", touches: 84, ranks: 5, points: 1280, change: "+2" },
  { name: "Demo Coach B", initials: "DB", market: "US & Canada", touches: 79, ranks: 4, points: 1160, change: "—" },
  { name: "Demo Coach C", initials: "DC", market: "LATAM", touches: 71, ranks: 4, points: 1085, change: "+1" },
  { name: "Demo Coach D", initials: "DD", market: "Americas", touches: 68, ranks: 3, points: 940, change: "-2" },
  { name: "Demo Admin", initials: "DA", market: "Americas", touches: 42, ranks: 2, points: 690, change: "+3" },
];

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? createClient(url, key) : null;
}

function formatDate(value?: string | null) {
  if (!value) return "Not contacted";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).slice(0, 2).join("");
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const headers = (rows.shift() ?? []).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

export default function Home() {
  const [supabase] = useState(() => getSupabase());
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(() => !supabase);
  const [demo, setDemo] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authStep, setAuthStep] = useState<"email" | "code">("email");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [people, setPeople] = useState<Person[]>(DEMO_PEOPLE);
  const [selected, setSelected] = useState<Person | null>(null);
  const [queueFilter, setQueueFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] = useState("Phone call");
  const [activityOutcome, setActivityOutcome] = useState("Connected — follow-up needed");
  const [activityNote, setActivityNote] = useState("");
  const [toast, setToast] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState("");

  const userEmail = session?.user.email ?? "";
  const userName = demo
    ? "Demo Admin"
    : ((session?.user.user_metadata?.full_name as string | undefined) ?? userEmail.split("@")[0]?.replace(/[._]/g, " ")) || "Team member";
  const isAdmin = demo || session?.user.app_metadata?.topup_role === "admin";

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session) return;
    const sessionEmail = session.user.email ?? "";
    const sessionName = ((session.user.user_metadata?.full_name as string | undefined)
      ?? sessionEmail.split("@")[0]?.replace(/[._]/g, " "))
      || "Team member";
    supabase.from("profiles").upsert({
      id: session.user.id,
      email: sessionEmail,
      full_name: sessionName,
    }, { onConflict: "id" }).then(() => undefined);
    supabase.from("distributors").select("*").order("priority_score", { ascending: false }).limit(250).then(({ data, error }) => {
      if (!error && data?.length) setPeople(data.map((record) => ({
        ...record,
        ov: Number(record.ov ?? 0),
        gap_to_rank: Number(record.gap_to_rank ?? 0),
        priority_score: Number(record.priority_score ?? 50),
      })) as Person[]);
    });
  }, [session, supabase]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const filteredPeople = useMemo(() => people.filter((person) => {
    const statusMatch = queueFilter === "all" || (queueFilter === "mine" ? person.assigned_name === userName : queueFilter === "rank" ? person.push_level === "rank" : queueFilter === "pcm" ? person.push_level === "pcm" : person.status === queueFilter);
    const text = `${person.name} ${person.external_id} ${person.country} ${person.current_rank}`.toLowerCase();
    return statusMatch && text.includes(query.toLowerCase());
  }), [people, queueFilter, query, userName]);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setAuthMessage("");
    if (!email.toLowerCase().endsWith("@unicity.com")) { setAuthMessage("Use your @unicity.com employee email."); return; }
    if (!supabase) { setAuthMessage("Authentication is being connected. Use the demo dashboard for now."); return; }
    setAuthBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } });
    setAuthBusy(false);
    if (error) setAuthMessage(error.message);
    else { setAuthStep("code"); setAuthMessage("We sent a secure sign-in code or link to your inbox."); }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    const { data, error } = await supabase.auth.verifyOtp({ email, token: code.replace(/\s/g, ""), type: "email" });
    setAuthBusy(false);
    if (error) setAuthMessage(error.message);
    else if (data.session) setSession(data.session);
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setDemo(false); setSession(null); setSelected(null);
  }

  async function claim(person: Person) {
    const next = { ...person, assigned_to: session?.user.id ?? "demo", assigned_name: userName, status: "assigned" as ContactStatus };
    if (supabase && session) {
      const { error } = await supabase.from("distributors").update({ assigned_to: session.user.id, assigned_name: userName, status: "assigned" }).eq("id", person.id).is("assigned_to", null);
      if (error) { setToast(error.message); return; }
    }
    setPeople((items) => items.map((item) => item.id === person.id ? next : item));
    setSelected(next); setToast(`${person.name} is now in your queue.`);
  }

  async function saveActivity(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const now = new Date().toISOString();
    const status: ContactStatus = activityOutcome.includes("Completed") || activityOutcome.includes("no help") ? "complete" : "follow-up";
    const next = { ...selected, status, last_contacted_at: now, last_outcome: activityOutcome, notes: activityNote || selected.notes };
    if (supabase && session) {
      const { error } = await supabase.from("activities").insert({ distributor_id: selected.id, user_id: session.user.id, activity_type: activityType, outcome: activityOutcome, notes: activityNote });
      if (error) { setToast(error.message); return; }
      await supabase.from("distributors").update({ status, last_contacted_at: now, last_outcome: activityOutcome, notes: activityNote || selected.notes }).eq("id", selected.id);
    }
    setPeople((items) => items.map((item) => item.id === selected.id ? next : item));
    setSelected(next); setActivityOpen(false); setActivityNote(""); setToast("Activity logged and team progress updated.");
  }

  async function importCsv(file: File) {
    setImportBusy(true); setImportResult("");
    const rows = parseCsv(await file.text());
    const records = rows.map((row, index) => ({
      external_id: row.distributor_id || row.id || row.unicity_id || `import-${Date.now()}-${index}`,
      name: row.name || row.full_name || [row.first_name, row.last_name].filter(Boolean).join(" ") || "Unnamed distributor",
      email: row.email || "",
      phone: row.phone || row.mobile || null,
      country: row.country || "Unknown",
      region: row.state || row.region || null,
      joined_at: row.join_date || row.date_joined || row.enrollment_date || null,
      current_rank: row.current_rank || row.rank || "Distributor",
      target_rank: row.next_rank || row.target_rank || null,
      ov: Number(row.ov || row.organizational_volume || 0),
      gap_to_rank: Number(row.gap_to_rank || row.volume_needed || 0),
      is_new_distributor: String(row.is_new_distributor || row.new_distributor || "false").toLowerCase() === "true",
      push_level: row.push_level || null,
      priority_score: Number(row.priority_score || 50),
    }));
    if (supabase && session) {
      const { error } = await supabase.from("distributors").upsert(records, { onConflict: "external_id" });
      if (error) { setImportResult(error.message); setImportBusy(false); return; }
      await supabase.from("imports").insert({ file_name: file.name, row_count: records.length, imported_by: session.user.id });
    }
    setImportResult(`${records.length} records validated${supabase ? " and imported" : " in preview mode"}. Duplicate distributor IDs will update the existing profile.`);
    setImportBusy(false);
  }

  if (!authReady) return <main className="loading-screen"><div className="brand-mark small">U</div><span>Preparing Top Up…</span></main>;

  if (!session && !demo) return (
    <main className="auth-shell">
      <header className="auth-header"><div className="wordmark">UNICITY<span>.</span></div><div className="header-actions"><button className="icon-button" aria-label="Toggle theme">☼</button><button className="language"><span>◎</span> EN</button></div></header>
      <section className="auth-stage">
        <div className="auth-card">
          <div className="brand-mark">U</div>
          <div className="product-kicker">TOP UP</div>
          <h1>{authStep === "email" ? "Employee Login" : "Check your inbox"}</h1>
          <p>{authStep === "email" ? "Use your Unicity email to access the Americas sales workspace." : `Enter the six-digit code sent to ${email}.`}</p>
          {authStep === "email" ? (
            <form onSubmit={requestOtp}>
              <label htmlFor="email">Email</label>
              <div className="input-wrap"><Mail size={18} /><input id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@unicity.com" type="email" required autoComplete="email" /></div>
              <button className="primary-button full" disabled={authBusy}>{authBusy ? "Sending…" : "Continue"}<ArrowRight size={17} /></button>
            </form>
          ) : (
            <form onSubmit={verifyOtp}>
              <label htmlFor="code">Secure code</label>
              <input id="code" className="code-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" inputMode="numeric" required />
              <button className="primary-button full" disabled={authBusy || code.length !== 6}>{authBusy ? "Verifying…" : "Verify & sign in"}<ShieldCheck size={17} /></button>
              <button type="button" className="text-button" onClick={() => setAuthStep("email")}>Use a different email</button>
            </form>
          )}
          {authMessage && <div className="auth-message"><CircleAlert size={16} />{authMessage}</div>}
          {!supabase && <button className="demo-button" onClick={() => setDemo(true)}><Sparkles size={16} /> Explore the product demo</button>}
          <div className="secure-note"><ShieldCheck size={15} /> Passwordless access · Unicity employees only</div>
        </div>
        <footer><a href="https://unicity.com">Unicity International</a><span>|</span><span>Employee workspace</span></footer>
      </section>
    </main>
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left"><div className="wordmark light">UNICITY<span>.</span></div><div className="topup-divider" /><div className="topup-title">TOP UP <span>AMERICAS</span></div></div>
        <div className="topbar-right"><div className="month-pill"><span className="live-dot" /> AUGUST CLOSE · 5 DAYS</div><button className="top-icon" aria-label="Notifications"><Bell size={19} /><i>3</i></button><div className="profile-menu"><div className="avatar">{initials(userName)}</div><div><strong>{userName}</strong><span>{isAdmin ? "Administrator" : "Sales manager"}</span></div><ChevronDown size={15} /></div></div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <nav>
            <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard size={19} /> Overview</button>
            <button className={tab === "queue" ? "active" : ""} onClick={() => setTab("queue")}><Users size={19} /> Work queue <span className="nav-count">{people.filter((p) => p.status !== "complete").length}</span></button>
            <button className={tab === "leaderboard" ? "active" : ""} onClick={() => setTab("leaderboard")}><Trophy size={19} /> Leaderboard</button>
            {isAdmin && <button className={tab === "imports" ? "active" : ""} onClick={() => setTab("imports")}><UploadCloud size={19} /> Imports</button>}
          </nav>
          <div className="sidebar-bottom"><div className="close-card"><span>MONTH-END</span><strong>Finish strong.</strong><p>342 of 502 priority profiles contacted.</p><div className="mini-progress"><i /></div><b>68% complete</b></div><button className="signout" onClick={signOut}><LogOut size={18} /> Sign out</button></div>
        </aside>

        <main className="main-content">
          {tab === "overview" && <Overview people={people} userName={userName} onOpen={(person) => setSelected(person)} onNavigate={setTab} />}
          {tab === "queue" && <Queue people={filteredPeople} allPeople={people} userName={userName} query={query} setQuery={setQuery} filter={queueFilter} setFilter={setQueueFilter} onOpen={setSelected} />}
          {tab === "leaderboard" && <Leaderboard />}
          {tab === "imports" && isAdmin && <Imports busy={importBusy} result={importResult} onImport={importCsv} />}
        </main>
      </div>

      {selected && <PersonDrawer person={selected} userName={userName} onClose={() => setSelected(null)} onClaim={() => claim(selected)} onLog={() => setActivityOpen(true)} />}
      {activityOpen && selected && <ActivityModal person={selected} type={activityType} setType={setActivityType} outcome={activityOutcome} setOutcome={setActivityOutcome} note={activityNote} setNote={setActivityNote} onClose={() => setActivityOpen(false)} onSave={saveActivity} />}
      {toast && <div className="toast"><Check size={18} />{toast}</div>}
    </div>
  );
}

function Overview({ people, userName, onOpen, onNavigate }: { people: Person[]; userName: string; onOpen: (person: Person) => void; onNavigate: (tab: Tab) => void }) {
  const myQueue = people.filter((person) => person.assigned_name === userName || person.status === "unassigned").slice(0, 4);
  return <>
    <div className="page-heading"><div><span className="eyebrow">TUESDAY, AUGUST 11</span><h1>Good morning, {userName.split(" ")[0]}.</h1><p>Here’s where the Americas team stands heading into month-end.</p></div><button className="primary-button" onClick={() => onNavigate("queue")}><Target size={17} /> Open my queue</button></div>
    <section className="close-hero"><div className="hero-copy"><div className="hero-icon"><Sparkles size={22} /></div><div><span>THE FINAL PUSH</span><h2>5 days to help 47 distributors rank up.</h2><p>Director and Executive Director activity feeds the PCM opportunity. Clear the priority queue before Friday.</p></div></div><div className="hero-score"><div className="score-ring"><strong>68%</strong><span>contacted</span></div><div className="hero-metrics"><span><b>342</b> complete</span><span><b>160</b> remaining</span></div></div></section>
    <section className="stat-grid">
      <Stat icon={<UserRoundCheck />} tone="blue" label="Contact coverage" value="68%" detail="+12% since Monday" trend />
      <Stat icon={<Target />} tone="violet" label="Active rank pushes" value="47" detail="12 high priority" />
      <Stat icon={<Clock3 />} tone="amber" label="Unassigned profiles" value={String(people.filter((p) => p.status === "unassigned").length + 26)} detail="Needs an owner today" warning />
      <Stat icon={<Medal />} tone="green" label="Projected new ranks" value="12" detail="+$186K qualifying OV" trend />
    </section>
    <section className="dashboard-grid">
      <div className="panel momentum-panel"><div className="panel-heading"><div><h3>Team momentum</h3><p>Meaningful contact activity this month</p></div><button className="ghost-button">August <ChevronDown size={14} /></button></div><div className="chart-wrap"><div className="y-labels"><span>100</span><span>75</span><span>50</span><span>25</span><span>0</span></div><div className="chart-area"><div className="chart-grid-lines"><i/><i/><i/><i/></div><div className="bars">{[42, 58, 51, 68, 77, 64, 84, 93, 86, 100, 76].map((height, index) => <div className={`bar ${index === 10 ? "today" : ""}`} style={{ height: `${height}%` }} key={index}><span>{index === 10 ? "Today" : ""}</span></div>)}</div><div className="x-labels"><span>Aug 1</span><span>Aug 4</span><span>Aug 7</span><span>Aug 10</span></div></div></div><div className="chart-summary"><span><i className="legend blue" /> Contacted <b>342</b></span><span><i className="legend pale" /> Goal pace <b>412</b></span><strong>83% of pace</strong></div></div>
      <div className="panel leaderboard-mini"><div className="panel-heading"><div><h3>Team leaderboard</h3><p>Points from touches and rank wins</p></div><button className="link-button" onClick={() => onNavigate("leaderboard")}>View all <ChevronRight size={14}/></button></div><div className="team-list">{TEAM.slice(0, 4).map((member, index) => <div className="team-row" key={member.name}><span className={`place place-${index + 1}`}>{index + 1}</span><div className="avatar small-avatar">{member.initials}</div><div className="team-name"><strong>{member.name}</strong><span>{member.touches} touches · {member.ranks} rank wins</span></div><b>{member.points.toLocaleString()}</b></div>)}</div></div>
    </section>
    <section className="panel priority-panel"><div className="panel-heading"><div><h3>Priority queue</h3><p>People who need the next best action today</p></div><button className="link-button" onClick={() => onNavigate("queue")}>View full queue <ArrowRight size={14}/></button></div><div className="queue-table compact"><div className="queue-head"><span>Distributor</span><span>Opportunity</span><span>Owner</span><span>Last touch</span><span>Status</span><span></span></div>{myQueue.map((person) => <PersonRow key={person.id} person={person} onOpen={onOpen} />)}</div></section>
  </>;
}

function Stat({ icon, tone, label, value, detail, trend, warning }: { icon: React.ReactNode; tone: string; label: string; value: string; detail: string; trend?: boolean; warning?: boolean }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-top"><span>{label}</span><MoreHorizontal size={17}/></div><strong>{value}</strong><p className={warning ? "warning" : trend ? "trend" : ""}>{trend ? "↗ " : warning ? "● " : ""}{detail}</p></article>;
}

function Queue({ people, allPeople, userName, query, setQuery, filter, setFilter, onOpen }: { people: Person[]; allPeople: Person[]; userName: string; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; onOpen: (person: Person) => void }) {
  const filters = [{ id: "all", label: "All", count: allPeople.length }, { id: "mine", label: "My queue", count: allPeople.filter((p) => p.assigned_name === userName).length }, { id: "unassigned", label: "Unassigned", count: allPeople.filter((p) => p.status === "unassigned").length }, { id: "rank", label: "Rank push", count: allPeople.filter((p) => p.push_level === "rank").length }, { id: "pcm", label: "PCM", count: allPeople.filter((p) => p.push_level === "pcm").length }];
  return <><div className="page-heading queue-title"><div><span className="eyebrow">ONE PROFILE · ONE OWNER</span><h1>Work queue</h1><p>New distributors and rank opportunities stay connected without duplicate outreach.</p></div><button className="secondary-button"><Download size={17}/> Export view</button></div><div className="queue-toolbar"><div className="filter-tabs">{filters.map((item) => <button className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label}<span>{item.count}</span></button>)}</div><div className="toolbar-actions"><div className="search-box"><Search size={17}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, ID or market" /></div><button className="filter-button"><Filter size={17}/> Filters</button></div></div><section className="panel queue-panel"><div className="queue-table"><div className="queue-head"><span>Distributor</span><span>Opportunity</span><span>Owner</span><span>Last touch</span><span>Status</span><span></span></div>{people.map((person) => <PersonRow key={person.id} person={person} onOpen={onOpen} />)}{!people.length && <div className="empty-state"><Search size={28}/><strong>No matching profiles</strong><span>Try another search or queue filter.</span></div>}</div></section></>;
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: (person: Person) => void }) {
  return <button className="queue-row" onClick={() => onOpen(person)}><span className="person-cell"><span className="avatar person-avatar">{initials(person.name)}</span><span><strong>{person.name}</strong><small>#{person.external_id} · {person.country}</small></span></span><span className="opportunity-cell"><strong>{person.target_rank ?? "Welcome"}</strong><small>{person.push_level === "pcm" ? "PCM pathway" : person.is_new_distributor && person.push_level ? "New + rank push" : person.is_new_distributor ? "New distributor" : "Rank push"}</small></span><span className="owner-cell">{person.assigned_name ? <><span className="avatar tiny-avatar">{initials(person.assigned_name)}</span><span>{person.assigned_name}</span></> : <span className="unassigned">Unassigned</span>}</span><span className="touch-cell"><strong>{formatDate(person.last_contacted_at)}</strong><small>{person.last_outcome ?? "No activity yet"}</small></span><span><Status status={person.status}/></span><ChevronRight size={17}/></button>;
}

function Status({ status }: { status: ContactStatus }) {
  const labels: Record<ContactStatus, string> = { unassigned: "Unassigned", assigned: "Ready", contacted: "Contacted", "follow-up": "Follow-up", complete: "Complete" };
  return <span className={`status status-${status}`}><i/>{labels[status]}</span>;
}

function Leaderboard() {
  return <><div className="page-heading"><div><span className="eyebrow">RECOGNIZE THE WORK</span><h1>Team leaderboard</h1><p>Points reward meaningful outreach, cross-market support, and distributor rank wins.</p></div><button className="secondary-button"><BarChart3 size={17}/> Scoring guide</button></div><section className="podium"><div className="podium-card second"><Medal/><div className="avatar podium-avatar">DB</div><span>2nd</span><h3>Demo Coach B</h3><strong>1,160 pts</strong><p>79 touches · 4 rank wins</p></div><div className="podium-card first"><Trophy/><div className="avatar podium-avatar">DA</div><span>1st</span><h3>Demo Coach A</h3><strong>1,280 pts</strong><p>84 touches · 5 rank wins</p></div><div className="podium-card third"><Medal/><div className="avatar podium-avatar">DC</div><span>3rd</span><h3>Demo Coach C</h3><strong>1,085 pts</strong><p>71 touches · 4 rank wins</p></div></section><section className="panel leaderboard-full"><div className="panel-heading"><div><h3>August standings</h3><p>Updated from logged activity</p></div><button className="ghost-button">All markets <ChevronDown size={14}/></button></div><div className="standings-head"><span>Rank</span><span>Team member</span><span>Market</span><span>Touches</span><span>Rank wins</span><span>Points</span><span>Movement</span></div>{TEAM.map((member, index) => <div className="standing-row" key={member.name}><strong>#{index + 1}</strong><span className="standing-person"><span className="avatar tiny-avatar">{member.initials}</span><b>{member.name}</b></span><span>{member.market}</span><b>{member.touches}</b><b>{member.ranks}</b><strong>{member.points.toLocaleString()}</strong><span className={member.change.startsWith("+") ? "movement up" : member.change.startsWith("-") ? "movement down" : "movement"}>{member.change}</span></div>)}</section></>;
}

function Imports({ busy, result, onImport }: { busy: boolean; result: string; onImport: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  return <><div className="page-heading"><div><span className="eyebrow">ADMIN TOOLS</span><h1>Monthly data imports</h1><p>Bring in the new distributor and rank reports; existing IDs update one shared profile.</p></div><div className="admin-badge"><ShieldCheck size={16}/> Admin only</div></div><section className="import-grid"><div className="panel import-panel"><div className="panel-heading"><div><h3>Upload report</h3><p>CSV files exported from Unicity Reports</p></div><FileSpreadsheet size={22}/></div><label className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) onImport(file); }}><input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}/><span className="upload-icon"><UploadCloud size={28}/></span><strong>{busy ? "Validating your report…" : "Drop a CSV here or browse"}</strong><p>New distributors, rank opportunities, or a combined report</p><small>Maximum 10 MB</small></label>{result && <div className="import-result"><Check size={17}/>{result}</div>}<div className="mapping-note"><CircleAlert size={17}/><p><strong>Automatic field matching</strong><span>Distributor ID is the permanent key. Owner and activity history are preserved when a later report updates rank or volume.</span></p></div></div><div className="panel import-guide"><div className="panel-heading"><div><h3>Import sequence</h3><p>Recommended monthly rhythm</p></div></div><ol><li><span>1</span><div><strong>New distributors</strong><p>Around the 10th · begin welcome outreach</p></div></li><li><span>2</span><div><strong>Rank opportunity refresh</strong><p>Mid-month · Director through Executive Director</p></div></li><li><span>3</span><div><strong>PCM final push</strong><p>Final five days · informed by downline progress</p></div></li></ol><div className="privacy-card"><ShieldCheck size={20}/><div><strong>Protected employee workspace</strong><p>Only authenticated Unicity employees can see or update distributor data.</p></div></div></div></section><section className="panel recent-imports"><div className="panel-heading"><div><h3>Recent imports</h3><p>Audit trail for report updates</p></div></div>{[{name:"Americas_Rank_Report_Aug10.csv",rows:"502",by:"Demo Admin",time:"Yesterday, 9:42 AM"},{name:"New_Distributors_Aug.csv",rows:"617",by:"Demo Admin",time:"Aug 10, 8:15 AM"}].map((file) => <div className="import-row" key={file.name}><span className="file-icon"><FileSpreadsheet size={20}/></span><div><strong>{file.name}</strong><span>{file.rows} records · Imported by {file.by}</span></div><time>{file.time}</time><span className="status status-complete"><i/>Complete</span><button><MoreHorizontal size={18}/></button></div>)}</section></>;
}

function PersonDrawer({ person, userName, onClose, onClaim, onLog }: { person: Person; userName: string; onClose: () => void; onClaim: () => void; onLog: () => void }) {
  const canWork = !person.assigned_name || person.assigned_name === userName;
  return <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="drawer"><div className="drawer-header"><div><span className="eyebrow">DISTRIBUTOR PROFILE</span><h2>{person.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close profile"><X size={20}/></button></div><div className="profile-summary"><div className="avatar profile-avatar">{initials(person.name)}</div><div><strong>{person.name}</strong><span>#{person.external_id} · Joined {person.joined_at ? new Date(person.joined_at).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "—"}</span><div className="profile-tags">{person.is_new_distributor && <b>New distributor</b>}{person.push_level === "rank" && <b>Rank push</b>}{person.push_level === "pcm" && <b>PCM pathway</b>}</div></div></div><div className="contact-actions"><a href={`tel:${person.phone}`}><Phone size={17}/> Call</a><a href={`mailto:${person.email}`}><Mail size={17}/> Email</a><a href={`https://wa.me/${(person.phone ?? "").replace(/\D/g, "")}`}><MessageCircle size={17}/> WhatsApp</a></div><section className="profile-section"><h3>Opportunity</h3><div className="rank-path"><div><span>CURRENT RANK</span><strong>{person.current_rank}</strong></div><ArrowRight size={18}/><div><span>NEXT RANK</span><strong>{person.target_rank ?? "—"}</strong></div></div><div className="volume-card"><div><span>Current OV</span><strong>{person.ov.toLocaleString()}</strong></div><div><span>Gap to rank</span><strong>{person.gap_to_rank.toLocaleString()}</strong></div><div className="volume-bar"><i style={{ width: `${Math.min(100, Math.round((person.ov / Math.max(1, person.ov + person.gap_to_rank)) * 100))}%` }}/></div></div></section><section className="profile-section"><h3>Ownership</h3>{person.assigned_name ? <div className="owner-card"><span className="avatar tiny-avatar">{initials(person.assigned_name)}</span><div><strong>{person.assigned_name}</strong><span>Primary owner · prevents duplicate outreach</span></div><Status status={person.status}/></div> : <div className="unclaimed-card"><Users size={20}/><div><strong>This profile needs an owner</strong><span>Claim it before reaching out.</span></div></div>}</section><section className="profile-section"><h3>Latest activity</h3>{person.last_contacted_at ? <div className="timeline"><i/><div><strong>{person.last_outcome}</strong><span>{formatDate(person.last_contacted_at)} · {person.assigned_name}</span>{person.notes && <p>{person.notes}</p>}</div></div> : <div className="no-activity"><Clock3 size={20}/> No outreach has been logged yet.</div>}</section><div className="drawer-footer">{!person.assigned_name ? <button className="primary-button full" onClick={onClaim}><UserRoundCheck size={17}/> Claim profile</button> : canWork ? <button className="primary-button full" onClick={onLog}><MessageCircle size={17}/> Log an activity</button> : <button className="secondary-button full" disabled><ShieldCheck size={17}/> Owned by {person.assigned_name}</button>}</div></aside></div>;
}

function ActivityModal({ person, type, setType, outcome, setOutcome, note, setNote, onClose, onSave }: { person: Person; type: string; setType: (value: string) => void; outcome: string; setOutcome: (value: string) => void; note: string; setNote: (value: string) => void; onClose: () => void; onSave: (event: FormEvent) => void }) {
  return <div className="modal-backdrop"><form className="modal" onSubmit={onSave}><div className="modal-header"><div><span className="eyebrow">LOG ACTIVITY</span><h2>Update {person.name}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={20}/></button></div><label>Contact method<select value={type} onChange={(e) => setType(e.target.value)}><option>Phone call</option><option>Email</option><option>WhatsApp</option><option>Zoom meeting</option></select></label><label>Outcome<select value={outcome} onChange={(e) => setOutcome(e.target.value)}><option>Connected — follow-up needed</option><option>Strategy call booked</option><option>Sent message — awaiting reply</option><option>Welcomed — no help needed</option><option>Completed — rank plan confirmed</option><option>No response</option></select></label><label>Notes<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Questions, next action, or context for the team…" rows={4}/></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button"><Check size={17}/> Save activity</button></div></form></div>;
}
