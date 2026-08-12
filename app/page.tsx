"use client";

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  FileSpreadsheet,
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
  UserCog,
  Users,
  X,
} from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Tab = "overview" | "mine" | "queue" | "leaderboard" | "users" | "imports";
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
  current_rank?: string | null;
  target_rank?: string | null;
  gap_to_rank?: number | null;
  status: ContactStatus;
  assigned_to?: string | null;
  assigned_name?: string | null;
  source_contacted_by?: string | null;
  is_new_distributor: boolean;
  is_rank_opportunity: boolean;
  is_pcm_opportunity: boolean;
  nearest_leader_name?: string | null;
  highest_rank_name?: string | null;
  first_time_at_rank?: boolean | null;
  has_ten_pack?: boolean | null;
  source_notes?: string | null;
  source_period?: string | null;
  source_file_name?: string | null;
  last_contacted_at?: string | null;
  last_outcome?: string | null;
  notes?: string | null;
};

type ImportHistory = {
  id: string;
  file_name: string;
  row_count: number;
  imported_by_name?: string | null;
  status: "processing" | "complete" | "failed";
  created_at: string;
};

type Activity = {
  id: string;
  distributor_id: string;
  user_id: string;
  activity_type: string;
  outcome: string;
  notes?: string | null;
  created_at: string;
  author_name: string;
};

type TeamMetric = {
  name: string;
  initials: string;
  assigned: number;
  newDistributors: number;
  rank: number;
  pcm: number;
  notes: number;
};

type UserDirectoryEntry = {
  email: string;
  display_name: string;
  last_login_at?: string | null;
  is_admin: boolean;
};

type OtpFunctionResponse = {
  success?: boolean;
  message?: string;
  access_token?: string;
  refresh_token?: string;
};

async function invokeOtpFunction(
  supabase: SupabaseClient,
  body: { action: "generate" | "verify"; email: string; code?: string },
): Promise<OtpFunctionResponse> {
  const { data, error } = await supabase.functions.invoke<OtpFunctionResponse>("topup-otp", { body });
  if (!error) return data ?? {};

  let message = error.message || "The verification service is unavailable.";
  const context = (error as { context?: Response }).context;
  if (context) {
    try {
      const payload = await context.json() as { error?: string; message?: string };
      message = payload.error || payload.message || message;
    } catch {
      // Keep the SDK error when the response is not JSON.
    }
  }
  throw new Error(message);
}

function formatDate(value?: string | null) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatPeriod(value?: string | null) {
  if (!value) return "Current source";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Current source";
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(date);
}

function initials(name: string) {
  return name.split(/[\s,]+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
}

function normalizeHeader(header: string) {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizeId(value: string) {
  const normalized = value.trim().replace(/\.0$/, "");
  return /^\d+$/.test(normalized) ? normalized : "";
}

function normalizeOwner(value?: string) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || ["na", "n/a", "none"].includes(trimmed.toLowerCase())) return null;
  if (trimmed.toLowerCase() === "alex v") return "Alex V";
  return trimmed.split(/\s+/).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`).join(" ");
}

function booleanValue(value?: string) {
  return ["true", "yes", "y", "1", "firsttime", "first time"].includes((value ?? "").trim().toLowerCase());
}

function nullableNumber(value?: string) {
  if (!value?.trim()) return null;
  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value?: string) {
  if (!value?.trim()) return null;
  const iso = value.trim().match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function locationValue(value?: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized === "." ? "" : normalized;
}

function inferSourcePeriod(fileName: string) {
  const months: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
  const match = fileName.toLowerCase().match(new RegExp(`(${Object.keys(months).join("|")})[^0-9]*(20\\d{2})`));
  if (match) return `${match[2]}-${months[match[1]]}-01`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
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
  const headers = (rows.shift() ?? []).map(normalizeHeader);
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function getTeamMetrics(people: Person[], teamActivities: Activity[] = []): TeamMetric[] {
  const grouped = new Map<string, TeamMetric>();
  people.forEach((person) => {
    if (!person.assigned_name) return;
    const current = grouped.get(person.assigned_name) ?? { name: person.assigned_name, initials: initials(person.assigned_name), assigned: 0, newDistributors: 0, rank: 0, pcm: 0, notes: 0 };
    current.assigned += 1;
    current.newDistributors += person.is_new_distributor ? 1 : 0;
    current.rank += person.is_rank_opportunity ? 1 : 0;
    current.pcm += person.is_pcm_opportunity ? 1 : 0;
    current.notes += person.source_notes ? 1 : 0;
    grouped.set(current.name, current);
  });
  teamActivities.forEach((activity) => {
    if (!activity.notes?.trim()) return;
    const current = grouped.get(activity.author_name) ?? { name: activity.author_name, initials: initials(activity.author_name), assigned: 0, newDistributors: 0, rank: 0, pcm: 0, notes: 0 };
    current.notes += 1;
    grouped.set(current.name, current);
  });
  return [...grouped.values()].sort((a, b) => b.assigned - a.assigned || a.name.localeCompare(b.name));
}

function ownerMatchesUser(owner: string | null | undefined, userName: string) {
  if (!owner) return false;
  const ownerToken = owner.toLowerCase().split(/\s+/)[0];
  return userName.toLowerCase().split(/[\s._]+/).includes(ownerToken);
}

export default function Home() {
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [authStep, setAuthStep] = useState<"email" | "code">("email");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [tab, setTab] = useState<Tab>("overview");
  const [people, setPeople] = useState<Person[]>([]);
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [imports, setImports] = useState<ImportHistory[]>([]);
  const [selected, setSelected] = useState<Person | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [teamActivities, setTeamActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [queueFilter, setQueueFilter] = useState("all");
  const [countryFilter, setCountryFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] = useState("Phone call");
  const [activityOutcome, setActivityOutcome] = useState("Connected — follow-up needed");
  const [activityNote, setActivityNote] = useState("");
  const [toast, setToast] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [users, setUsers] = useState<UserDirectoryEntry[]>([]);
  const [userSaving, setUserSaving] = useState("");

  const userEmail = session?.user.email ?? "";
  const userId = session?.user.id ?? "";
  const userName = displayName || ((session?.user.user_metadata?.full_name as string | undefined) ?? userEmail.split("@")[0]?.replace(/[._]/g, " ")) || "Team member";

  useEffect(() => {
    let active = true;

    async function connect() {
      try {
        const response = await fetch("/api/supabase-config", { cache: "no-store" });
        const config = await response.json() as { url?: string; publishableKey?: string; error?: string };
        if (!response.ok || !config.url || !config.publishableKey) {
          throw new Error(config.error || "The secure database connection is unavailable.");
        }
        if (active) setSupabase(createClient(config.url, config.publishableKey));
      } catch (error) {
        if (active) {
          setConnectionError(error instanceof Error ? error.message : "The secure database connection is unavailable.");
          setAuthReady(true);
        }
      }
    }

    connect();
    return () => { active = false; };
  }, []);

  const loadPeople = useCallback(async () => {
    if (!supabase || !session) return;
    setDataReady(false);
    setDataError("");
    const records: Person[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("distributors").select("*").order("external_id").range(from, from + 999);
      if (error) { setDataError(error.message); setDataReady(true); return; }
      const page = (data ?? []).map((record) => ({ ...record, gap_to_rank: record.gap_to_rank == null ? null : Number(record.gap_to_rank) })) as Person[];
      records.push(...page);
      if (page.length < 1000) break;
    }
    records.sort((a, b) => Number(Boolean(a.assigned_name)) - Number(Boolean(b.assigned_name)) || (a.gap_to_rank ?? Number.MAX_SAFE_INTEGER) - (b.gap_to_rank ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
    setPeople(records);
    setDataReady(true);
  }, [session, supabase]);

  const loadTeamActivities = useCallback(async () => {
    if (!supabase || !session) return;
    const records: Activity[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("activities")
        .select("id,distributor_id,user_id,activity_type,outcome,notes,created_at,profiles!activities_user_id_fkey(full_name,email)")
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      if (error) { setToast(`Team activity could not be loaded: ${error.message}`); return; }
      const page = (data ?? []).map((record) => {
        const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
        return {
          id: record.id,
          distributor_id: record.distributor_id,
          user_id: record.user_id,
          activity_type: record.activity_type,
          outcome: record.outcome,
          notes: record.notes,
          created_at: record.created_at,
          author_name: profile?.full_name || profile?.email || "Top Up team member",
        } as Activity;
      });
      records.push(...page);
      if (page.length < 1000) break;
    }
    setTeamActivities(records);
  }, [session, supabase]);

  const loadUsers = useCallback(async () => {
    if (!supabase || !session) return;
    const { data: directory, error } = await supabase
      .from("topup_user_directory")
      .select("email,display_name,last_login_at,is_admin")
      .order("display_name");
    if (error) { setToast(`Users could not be loaded: ${error.message}`); return; }
    setUsers((directory ?? []) as UserDirectoryEntry[]);
  }, [session, supabase]);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session) return;
    let active = true;
    async function bootstrap() {
      const sessionEmail = session?.user.email ?? "";
      const { data: directoryEntry } = await supabase?.from("topup_user_directory").select("display_name").eq("email", sessionEmail.toLowerCase()).maybeSingle() ?? { data: null };
      const { data: currentProfile } = await supabase?.from("profiles").select("full_name").eq("id", session.user.id).maybeSingle() ?? { data: null };
      const currentName = directoryEntry?.display_name?.trim() || currentProfile?.full_name?.trim() || "";
      if (active) { setDisplayName(currentName); setProfileName(currentName); }
      const { data: adminRow } = await supabase?.from("topup_admins").select("email").eq("email", sessionEmail.toLowerCase()).maybeSingle() ?? { data: null };
      const admin = Boolean(adminRow) || session?.user.app_metadata?.topup_role === "admin";
      if (active) {
        setIsAdmin(admin);
        setTab(admin ? "overview" : "mine");
      }
      await loadPeople();
      await loadTeamActivities();
      if (admin) {
        const { data } = await supabase?.from("imports").select("id,file_name,row_count,imported_by_name,status,created_at").order("created_at", { ascending: false }).limit(10) ?? { data: [] };
        if (active) setImports((data ?? []) as ImportHistory[]);
        await loadUsers();
      }
    }
    bootstrap();
    return () => { active = false; };
  }, [loadPeople, loadTeamActivities, loadUsers, session, supabase]);

  async function saveUserName(entry: UserDirectoryEntry, nextName: string) {
    if (!supabase || !isAdmin) return;
    const normalized = nextName.trim();
    if (!normalized) { setToast("A display name is required."); return; }
    setUserSaving(entry.email);
    const { error } = await supabase.from("topup_user_directory").update({ display_name: normalized }).eq("email", entry.email);
    if (!error) await supabase.from("profiles").update({ full_name: normalized }).eq("email", entry.email);
    setUserSaving("");
    if (error) { setToast(error.message); return; }
    setUsers((items) => items.map((item) => item.email === entry.email ? { ...item, display_name: normalized } : item));
    if (entry.email === userEmail.toLowerCase()) setDisplayName(normalized);
    setToast(`${normalized}'s name was updated.`);
  }

  async function saveProfileName(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !session) return;
    const nextName = profileName.trim();
    if (!nextName) { setToast("A display name is required."); return; }
    if (nextName.length > 80) { setToast("Display names must be 80 characters or fewer."); return; }
    setProfileSaving(true);
    const { error } = await supabase.from("topup_user_directory").update({ display_name: nextName }).eq("email", userEmail.toLowerCase());
    setProfileSaving(false);
    if (error) { setToast(error.message); return; }
    setDisplayName(nextName);
    setUsers((items) => items.map((item) => item.email === userEmail.toLowerCase() ? { ...item, display_name: nextName } : item));
    setProfileOpen(false);
    setToast(`Your profile name is now ${nextName}.`);
    await Promise.all([loadPeople(), loadTeamActivities()]);
  }

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (authStep !== "code" || resendCountdown <= 0) return;
    const id = window.setTimeout(() => setResendCountdown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [authStep, resendCountdown]);

  const queuePool = useMemo(() => {
    if (tab === "mine") return people.filter((person) => person.assigned_to === userId);
    return people;
  }, [people, tab, userId]);

  const filteredPeople = useMemo(() => queuePool.filter((person) => {
    const statusMatch = queueFilter === "all"
      || (queueFilter === "mine" ? person.assigned_to === userId
        : queueFilter === "available" ? !person.assigned_to && !person.assigned_name
        : queueFilter === "rank" ? person.is_rank_opportunity
          : queueFilter === "pcm" ? person.is_pcm_opportunity
            : queueFilter === "new" ? person.is_new_distributor
              : person.status === queueFilter);
    const text = `${person.name} ${person.external_id} ${person.country} ${person.region ?? ""} ${person.current_rank ?? ""} ${person.nearest_leader_name ?? ""}`.toLowerCase();
    const countryMatch = countryFilter === "all" || locationValue(person.country) === countryFilter;
    const stateMatch = stateFilter === "all" || locationValue(person.region) === stateFilter;
    return statusMatch && countryMatch && stateMatch && text.includes(query.toLowerCase());
  }), [countryFilter, queueFilter, query, queuePool, stateFilter, userId]);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setAuthMessage("");
    if (!email.toLowerCase().endsWith("@unicity.com")) { setAuthMessage("Use your @unicity.com employee email."); return; }
    if (!supabase) { setAuthMessage("Top Up cannot sign in because its database connection is missing."); return; }
    setAuthBusy(true);
    try {
      const result = await invokeOtpFunction(supabase, { action: "generate", email: email.trim().toLowerCase() });
      if (result.success !== true) throw new Error(result.message || "The verification code could not be sent.");
      setAuthStep("code");
      setResendCountdown(60);
      setAuthMessage("We sent a secure six-digit sign-in code to your inbox.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "The verification code could not be sent.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resendOtp() {
    if (!supabase || resendCountdown > 0) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const result = await invokeOtpFunction(supabase, { action: "generate", email: email.trim().toLowerCase() });
      if (result.success !== true) throw new Error(result.message || "A new verification code could not be sent.");
      setCode("");
      setResendCountdown(60);
      setAuthMessage("A new six-digit code was sent to your inbox.");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "A new verification code could not be sent.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      const result = await invokeOtpFunction(supabase, {
        action: "verify",
        email: email.trim().toLowerCase(),
        code: code.replace(/\s/g, ""),
      });
      if (!result.access_token || !result.refresh_token) throw new Error("The secure session could not be created.");
      const { data, error } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (error) throw error;
      if (data.session) setSession(data.session);
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "The verification code could not be verified.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null); setSelected(null); setPeople([]); setUsers([]); setDisplayName(""); setProfileName(""); setProfileOpen(false); setIsAdmin(false);
  }

  async function claim(person: Person) {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from("distributors")
      .update({ assigned_to: session.user.id, assigned_name: userName, status: "assigned" })
      .eq("id", person.id)
      .is("assigned_to", null)
      .is("assigned_name", null)
      .select("id")
      .maybeSingle();
    if (error) { setToast(error.message); return; }
    if (!data) { setToast("This distributor was already claimed by another team member."); await loadPeople(); return; }
    const next = { ...person, assigned_to: session.user.id, assigned_name: userName, status: "assigned" as ContactStatus };
    setPeople((items) => items.map((item) => item.id === person.id ? next : item));
    setSelected(next); setToast(`${person.name} is now linked to your queue.`);
  }

  async function openPerson(person: Person) {
    setSelected(person);
    setActivities([]);
    if (!supabase || !session) return;
    setActivitiesLoading(true);
    const { data, error } = await supabase
      .from("activities")
      .select("id,distributor_id,user_id,activity_type,outcome,notes,created_at,profiles!activities_user_id_fkey(full_name,email)")
      .eq("distributor_id", person.id)
      .order("created_at", { ascending: false });
    if (error) {
      setToast(`Activity history could not be loaded: ${error.message}`);
    } else {
      const history = (data ?? []).map((record) => {
        const profile = Array.isArray(record.profiles) ? record.profiles[0] : record.profiles;
        return {
          id: record.id,
          distributor_id: record.distributor_id,
          user_id: record.user_id,
          activity_type: record.activity_type,
          outcome: record.outcome,
          notes: record.notes,
          created_at: record.created_at,
          author_name: profile?.full_name || profile?.email || "Top Up team member",
        } as Activity;
      });
      setActivities(history);
    }
    setActivitiesLoading(false);
  }

  async function release(person: Person) {
    if (!supabase || !session || person.assigned_to !== session.user.id) return;
    const confirmed = window.confirm(`Release ${person.name} back to the available queue? All activity notes and history will be preserved.`);
    if (!confirmed) return;
    setReleaseBusy(true);
    const { data, error } = await supabase
      .from("distributors")
      .update({ assigned_to: null, assigned_name: null, status: "unassigned" })
      .eq("id", person.id)
      .eq("assigned_to", session.user.id)
      .select("id")
      .maybeSingle();
    setReleaseBusy(false);
    if (error) { setToast(error.message); return; }
    if (!data) { setToast("This distributor is no longer assigned to you."); await loadPeople(); return; }
    const next = { ...person, assigned_to: null, assigned_name: null, status: "unassigned" as ContactStatus };
    setPeople((items) => items.map((item) => item.id === person.id ? next : item));
    setSelected(next);
    setToast(`${person.name} was released. Their notes and activity history were preserved.`);
  }

  async function saveActivity(event: FormEvent) {
    event.preventDefault();
    if (!selected || !supabase || !session) return;
    const now = new Date().toISOString();
    const status: ContactStatus = activityOutcome.includes("Completed") || activityOutcome.includes("no help") ? "complete" : "follow-up";
    const { data: activity, error } = await supabase.from("activities").insert({ distributor_id: selected.id, user_id: session.user.id, activity_type: activityType, outcome: activityOutcome, notes: activityNote }).select("id,distributor_id,user_id,activity_type,outcome,notes,created_at").single();
    if (error) { setToast(error.message); return; }
    const savedActivity = activity ? { ...activity, author_name: userName } as Activity : null;
    const canUpdateSummary = isAdmin || selected.assigned_to === session.user.id;
    let next = selected;
    if (canUpdateSummary) {
      const { error: updateError } = await supabase.from("distributors").update({ status, last_contacted_at: now, last_outcome: activityOutcome, notes: activityNote || selected.notes }).eq("id", selected.id);
      if (!updateError) {
        next = { ...selected, status, last_contacted_at: now, last_outcome: activityOutcome, notes: activityNote || selected.notes };
        setPeople((items) => items.map((item) => item.id === selected.id ? next : item));
      }
    }
    if (savedActivity) {
      setActivities((items) => [savedActivity, ...items]);
      setTeamActivities((items) => [savedActivity, ...items]);
    }
    setSelected(next); setActivityOpen(false); setActivityNote(""); setToast(canUpdateSummary ? "Activity logged." : "Team context note added.");
  }

  async function importCsv(file: File) {
    if (!supabase || !session || !isAdmin) { setImportResult("Only a signed-in Top Up administrator can import data."); return; }
    if (file.size > 10 * 1024 * 1024) { setImportResult("Import stopped: the CSV exceeds 10 MB."); return; }
    setImportBusy(true); setImportResult("");
    try {
      const rows = parseCsv(await file.text());
      if (!rows.length) throw new Error("Import stopped: the CSV has no data rows.");
      const keys = new Set(Object.keys(rows[0]));
      const lowerFile = file.name.toLowerCase();
      const newReport = lowerFile.includes("new") || keys.has("joined_date") || keys.has("10_pack") || keys.has("nearest_pcm_name");
      const pcmReport = lowerFile.includes("pcm");
      const rankReport = !newReport && !pcmReport && (lowerFile.includes("rank") || keys.has("running_for_rank"));
      const parsed = rows.map((row, index) => ({ row, index: index + 2, id: normalizeId(row.dist_id || row.distributor_id || row.unicity_id || row.id || ""), name: (row.name || row.full_name || "").trim() }));
      const invalid = parsed.filter((item) => !item.id || !item.name);
      if (invalid.length) throw new Error(`Import stopped: ${invalid.length} row${invalid.length === 1 ? "" : "s"} are missing a valid distributor ID or name (first issue: row ${invalid[0].index}). No records were written.`);
      const ids = [...new Set(parsed.map((item) => item.id))];
      const existing = new Map<string, Person>();
      for (let index = 0; index < ids.length; index += 200) {
        const { data, error } = await supabase.from("distributors").select("*").in("external_id", ids.slice(index, index + 200));
        if (error) throw error;
        (data ?? []).forEach((record) => existing.set(record.external_id, record as Person));
      }
      const sourcePeriod = inferSourcePeriod(file.name);
      const records = parsed.map(({ row, id, name }) => {
        const previous = existing.get(id);
        const owner = normalizeOwner(row.contacted_by);
        const firstTimeRaw = row.first_time_at_rank?.trim().toLowerCase();
        const isNew = newReport || booleanValue(row.is_new_distributor);
        const isPcm = pcmReport || booleanValue(row.is_pcm_opportunity) || row.push_level?.toLowerCase() === "pcm";
        const isRank = rankReport || booleanValue(row.is_rank_opportunity) || row.push_level?.toLowerCase() === "rank";
        const currentRank = (row.current_rank_name || row.rank_name || row.current_rank || row.rank || previous?.current_rank || "").trim() || null;
        return {
          external_id: id,
          name,
          email: (row.email_address || row.email || previous?.email || "").trim(),
          phone: (row.cell_phone || row.phone || row.mobile || previous?.phone || "").trim() || null,
          country: (row.country || previous?.country || "Unknown").trim(),
          region: (row.state || row.region || previous?.region || "").trim() || null,
          joined_at: dateValue(row.joined_date || row.join_date || row.date_joined || row.enrollment_date) || previous?.joined_at || null,
          current_rank: currentRank,
          target_rank: (row.running_for_rank || row.next_rank || row.target_rank || previous?.target_rank || "").trim() || null,
          gap_to_rank: nullableNumber(row.total_ov_needed || row.gap_to_rank || row.volume_needed) ?? previous?.gap_to_rank ?? null,
          status: previous?.status && previous.status !== "unassigned" ? previous.status : owner ? "contacted" : "unassigned",
          assigned_to: previous?.assigned_to ?? null,
          assigned_name: previous?.assigned_name ?? owner,
          source_contacted_by: owner ?? previous?.source_contacted_by ?? null,
          is_new_distributor: Boolean(previous?.is_new_distributor || isNew),
          is_rank_opportunity: Boolean(previous?.is_rank_opportunity || isRank),
          is_pcm_opportunity: Boolean(previous?.is_pcm_opportunity || isPcm),
          nearest_leader_name: (row.nearest_leader_name || row.nearest_pcm_name || previous?.nearest_leader_name || "").trim() || null,
          highest_rank_name: (row.highest_rank_name || previous?.highest_rank_name || "").trim() || null,
          first_time_at_rank: firstTimeRaw ? firstTimeRaw.includes("first") : previous?.first_time_at_rank ?? null,
          has_ten_pack: row["10_pack"] ? booleanValue(row["10_pack"]) : previous?.has_ten_pack ?? null,
          source_notes: (row.notes || previous?.source_notes || "").trim() || null,
          source_period: sourcePeriod,
          source_file_name: file.name,
        };
      });
      for (let index = 0; index < records.length; index += 200) {
        const { error } = await supabase.from("distributors").upsert(records.slice(index, index + 200), { onConflict: "external_id" });
        if (error) throw error;
      }
      const { error: historyError } = await supabase.from("imports").insert({ file_name: file.name, row_count: records.length, source_period: sourcePeriod, imported_by: session.user.id, imported_by_name: userName, status: "complete" });
      if (historyError) throw historyError;
      setImportResult(`${records.length.toLocaleString()} real records imported. Existing distributor IDs were updated without deleting activity or ownership.`);
      await loadPeople();
      const { data } = await supabase.from("imports").select("id,file_name,row_count,imported_by_name,status,created_at").order("created_at", { ascending: false }).limit(10);
      setImports((data ?? []) as ImportHistory[]);
    } catch (error) {
      setImportResult(error instanceof Error ? error.message : "Import failed before any records could be confirmed.");
    } finally {
      setImportBusy(false);
    }
  }

  function exportQueue() {
    const headers = ["Distributor ID", "Name", "Country", "State", "Email", "Phone", "Current Rank", "Running For Rank", "OV Needed", "Owner", "Source Notes"];
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [headers, ...filteredPeople.map((person) => [person.external_id, person.name, person.country, person.region, person.email, person.phone, person.current_rank, person.target_rank, person.gap_to_rank, person.assigned_name, person.source_notes])].map((row) => row.map(escape).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "topup-work-queue.csv"; link.click(); URL.revokeObjectURL(url);
  }

  if (!authReady) return <main className="loading-screen"><Image className="unicity-logo loading-logo" src="/unicity-corp-logo-dark.png" alt="Unicity" width={532} height={96} priority unoptimized /><span>Preparing Top Up…</span></main>;

  if (!session) return (
    <main className="auth-shell">
      <header className="auth-header"><Image className="unicity-logo auth-header-logo" src="/unicity-corp-logo-dark.png" alt="Unicity" width={532} height={96} priority unoptimized /><div className="header-actions"><button className="language"><span>◎</span> EN</button></div></header>
      <section className="auth-stage">
        <div className="auth-card">
          <Image className="unicity-logo auth-card-logo" src="/unicity-corp-logo-dark.png" alt="Unicity" width={532} height={96} priority unoptimized /><div className="product-kicker">TOP UP</div>
          {authStep === "code" && <><h1>Verify your email</h1><p>Enter the 6-digit code</p><div className="verification-email"><ShieldCheck size={17} /> Code sent to {email}</div></>}
          {authStep === "email" ? <form onSubmit={requestOtp}><label htmlFor="email">Email</label><div className="input-wrap"><Mail size={18} /><input id="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@unicity.com" type="email" required autoComplete="email" /></div><button className="primary-button full" disabled={authBusy || !supabase}>{authBusy ? "Sending…" : "Continue"}<ArrowRight size={17} /></button></form> : <form className="code-form" onSubmit={verifyOtp}><label className="sr-only" htmlFor="code">Six-digit verification code</label><div className="code-entry"><input id="code" className="code-input" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus aria-label="Six-digit verification code" /><div className="code-cells" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} className={index === code.length ? "active" : ""}>{code[index] ?? ""}</span>)}</div></div><button className="primary-button full" disabled={authBusy || code.length !== 6}>{authBusy ? "Verifying…" : "Verify & sign in"}<ShieldCheck size={17} /></button><button type="button" className="resend-button" disabled={authBusy || resendCountdown > 0} onClick={resendOtp}>{resendCountdown > 0 ? `Resend code (${resendCountdown}s)` : "Resend code"}</button><button type="button" className="text-button" onClick={() => { setAuthStep("email"); setCode(""); setAuthMessage(""); }}>Change email</button></form>}
          {(authMessage || connectionError) && <div className="auth-message"><CircleAlert size={16} />{authMessage || connectionError}</div>}
      <div className="secure-note"><ShieldCheck size={15} /> Passwordless access · Unicity employees only</div>
        </div>
        <footer><a href="https://unicity.com">Unicity International</a><span>|</span><span>Employee workspace</span></footer>
      </section>
    </main>
  );

  const contacted = people.filter((person) => person.source_contacted_by || person.last_contacted_at).length;
  const coverage = people.length ? Math.round((contacted / people.length) * 100) : 0;
  const sourcePeriod = formatPeriod(people.find((person) => person.source_period)?.source_period);

  return <div className="app-shell">
    <header className="topbar"><div className="topbar-left"><Image className="unicity-logo topbar-logo" src="/unicity-corp-logo-light.webp" alt="Unicity" width={1834} height={341} priority unoptimized /><div className="topup-divider" /><div className="topup-title">TOP UP <span>AMERICAS</span></div></div><div className="topbar-right"><div className="month-pill"><span className="live-dot" /> {sourcePeriod.toUpperCase()} · {people.length.toLocaleString()} PROFILES</div><div className="profile-menu-wrap"><button className="profile-menu" type="button" aria-expanded={profileOpen} aria-haspopup="dialog" onClick={() => { setProfileName(displayName || userName); setProfileOpen((open) => !open); }}><div className="avatar">{initials(userName)}</div><div><strong>{userName}</strong><span>{isAdmin ? "Administrator" : "Sales manager"}</span></div><ChevronDown size={15} /></button>{profileOpen && <form className="profile-dropdown" onSubmit={saveProfileName}><div><strong>Your profile</strong><span>{userEmail}</span></div><label htmlFor="profile-name">Display name</label><input id="profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={80} autoComplete="name" autoFocus /><p>Capitalization is preserved exactly as entered.</p><button className="primary-button full" disabled={profileSaving || !profileName.trim() || profileName.trim() === displayName}>{profileSaving ? "Saving…" : "Save name"}</button></form>}</div></div></header>
    <div className="workspace"><aside className="sidebar"><nav>{isAdmin && <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><LayoutDashboard size={19} /> Overview</button>}<button className={tab === "mine" ? "active" : ""} onClick={() => { setQueueFilter("all"); setTab("mine"); }}><UserRoundCheck size={19} /> My Board <span className="nav-count">{people.filter((person) => person.assigned_to === userId).length}</span></button><button className={tab === "queue" ? "active" : ""} onClick={() => { setQueueFilter("all"); setTab("queue"); }}><Users size={19} /> {isAdmin ? "Work queue" : "All distributors"} <span className="nav-count">{people.length}</span></button><button className={tab === "leaderboard" ? "active" : ""} onClick={() => setTab("leaderboard")}><Trophy size={19} /> Team coverage</button>{isAdmin && <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}><UserCog size={19} /> Manage users</button>}{isAdmin && <button className={tab === "imports" ? "active" : ""} onClick={() => setTab("imports")}><UploadCloud size={19} /> Imports</button>}</nav><div className="sidebar-bottom"><div className="close-card"><span>{sourcePeriod.toUpperCase()}</span><strong>{isAdmin ? "Source coverage" : "My Board"}</strong><p>{isAdmin ? `${contacted.toLocaleString()} of ${people.length.toLocaleString()} profiles have a recorded contact owner.` : `${people.filter((person) => person.assigned_to === userId).length.toLocaleString()} distributors are currently assigned to you.`}</p>{isAdmin && <><div className="mini-progress"><i style={{ width: `${coverage}%` }} /></div><b>{coverage}% recorded</b></>}</div><button className="signout" onClick={signOut}><LogOut size={18} /> Sign out</button></div></aside>
      <main className="main-content">{dataError ? <DataState title="The live data could not be loaded" detail={dataError} /> : !dataReady ? <DataState title="Loading the real Top Up records" detail="Reading the secured source import…" loading /> : <>{tab === "overview" && isAdmin && <Overview people={people} userName={userName} sourcePeriod={sourcePeriod} onOpen={openPerson} onNavigate={setTab} />}{tab === "mine" && <Queue mode="mine" people={filteredPeople} allPeople={queuePool} userId={userId} query={query} setQuery={setQuery} filter={queueFilter} setFilter={setQueueFilter} country={countryFilter} setCountry={setCountryFilter} state={stateFilter} setState={setStateFilter} onOpen={openPerson} onExport={exportQueue} />}{tab === "queue" && <Queue mode={isAdmin ? "admin" : "team"} people={filteredPeople} allPeople={queuePool} userId={userId} query={query} setQuery={setQuery} filter={queueFilter} setFilter={setQueueFilter} country={countryFilter} setCountry={setCountryFilter} state={stateFilter} setState={setStateFilter} onOpen={openPerson} onExport={exportQueue} />}{tab === "leaderboard" && <Leaderboard people={people} teamActivities={teamActivities} sourcePeriod={sourcePeriod} />}{tab === "users" && isAdmin && <ManageUsers users={users} saving={userSaving} onSave={saveUserName} />}{tab === "imports" && isAdmin && <Imports busy={importBusy} result={importResult} history={imports} onImport={importCsv} />}</>}</main>
    </div>
    {selected && <PersonDrawer person={selected} currentUserId={userId} activities={activities} activitiesLoading={activitiesLoading} releaseBusy={releaseBusy} onClose={() => setSelected(null)} onClaim={() => claim(selected)} onLog={() => setActivityOpen(true)} onRelease={() => release(selected)} />}
    {activityOpen && selected && <ActivityModal person={selected} type={activityType} setType={setActivityType} outcome={activityOutcome} setOutcome={setActivityOutcome} note={activityNote} setNote={setActivityNote} onClose={() => setActivityOpen(false)} onSave={saveActivity} />}
    {toast && <div className="toast"><Check size={18} />{toast}</div>}
  </div>;
}

function DataState({ title, detail, loading }: { title: string; detail: string; loading?: boolean }) {
  return <section className="panel data-state">{loading ? <Clock3 size={28} /> : <CircleAlert size={28} />}<h2>{title}</h2><p>{detail}</p></section>;
}

function Overview({ people, userName, sourcePeriod, onOpen, onNavigate }: { people: Person[]; userName: string; sourcePeriod: string; onOpen: (person: Person) => void; onNavigate: (tab: Tab) => void }) {
  const contacted = people.filter((person) => person.source_contacted_by || person.last_contacted_at).length;
  const coverage = people.length ? Math.round((contacted / people.length) * 100) : 0;
  const unassigned = people.filter((person) => !person.assigned_name).length;
  const newCount = people.filter((person) => person.is_new_distributor).length;
  const rankCount = people.filter((person) => person.is_rank_opportunity).length;
  const pcmCount = people.filter((person) => person.is_pcm_opportunity).length;
  const myQueue = people.filter((person) => ownerMatchesUser(person.assigned_name, userName) || !person.assigned_name).slice(0, 4);
  const team = getTeamMetrics(people).slice(0, 4);
  const maxCategory = Math.max(newCount, rankCount, pcmCount, 1);
  return <>
    <div className="page-heading"><div><span className="eyebrow">{sourcePeriod.toUpperCase()} SOURCE</span><h1>Welcome, {userName.split(" ")[0]}.</h1><p>Every figure below is calculated from the imported workbook.</p></div><button className="primary-button" onClick={() => onNavigate("queue")}><Target size={17} /> Open work queue</button></div>
    <section className="close-hero"><div className="hero-copy"><div className="hero-icon"><Sparkles size={22} /></div><div><span>REAL SOURCE DATA</span><h2>{people.length.toLocaleString()} unique distributor profiles are live.</h2><p>{newCount.toLocaleString()} new distributors, {rankCount.toLocaleString()} rank opportunities, and {pcmCount.toLocaleString()} PCM opportunities were reconciled by distributor ID.</p></div></div><div className="hero-score"><div className="score-ring"><strong>{coverage}%</strong><span>recorded</span></div><div className="hero-metrics"><span><b>{contacted.toLocaleString()}</b> with owner</span><span><b>{unassigned.toLocaleString()}</b> unassigned</span></div></div></section>
    <section className="stat-grid"><Stat icon={<Users />} tone="blue" label="Unique profiles" value={people.length.toLocaleString()} detail="Reconciled by distributor ID" /><Stat icon={<UserRoundCheck />} tone="violet" label="New distributors" value={newCount.toLocaleString()} detail="From the source workbook" /><Stat icon={<Target />} tone="amber" label="Rank opportunities" value={rankCount.toLocaleString()} detail="Director through ED" /><Stat icon={<Medal />} tone="green" label="PCM opportunities" value={pcmCount.toLocaleString()} detail="Presidential pathway" /></section>
    <section className="dashboard-grid"><div className="panel momentum-panel"><div className="panel-heading"><div><h3>Opportunity mix</h3><p>Real records by source category</p></div><span className="source-chip">{sourcePeriod}</span></div><div className="category-bars">{[{ label: "New distributors", value: newCount }, { label: "Rank push", value: rankCount }, { label: "PCM", value: pcmCount }].map((item) => <div className="category-row" key={item.label}><span>{item.label}</span><div><i style={{ width: `${Math.max(2, Math.round((item.value / maxCategory) * 100))}%` }} /></div><strong>{item.value.toLocaleString()}</strong></div>)}</div><div className="chart-summary"><span><i className="legend blue" /> Contact owner recorded <b>{contacted.toLocaleString()}</b></span><span><i className="legend pale" /> No owner recorded <b>{unassigned.toLocaleString()}</b></span><strong>{coverage}% coverage</strong></div></div><div className="panel leaderboard-mini"><div className="panel-heading"><div><h3>Team coverage</h3><p>Profiles attributed in the workbook</p></div><button className="link-button" onClick={() => onNavigate("leaderboard")}>View all <ChevronRight size={14} /></button></div><div className="team-list">{team.map((member, index) => <div className="team-row" key={member.name}><span className={`place place-${index + 1}`}>{index + 1}</span><div className="avatar small-avatar">{member.initials}</div><div className="team-name"><strong>{member.name}</strong><span>{member.assigned} profiles · {member.notes} notes</span></div><b>{member.assigned.toLocaleString()}</b></div>)}{!team.length && <div className="empty-inline">No source owners recorded.</div>}</div></div></section>
    <section className="panel priority-panel"><div className="panel-heading"><div><h3>Priority queue</h3><p>Unassigned and lowest-gap opportunities first</p></div><button className="link-button" onClick={() => onNavigate("queue")}>View full queue <ArrowRight size={14} /></button></div><div className="queue-table compact"><div className="queue-head"><span>Distributor</span><span>Country / State</span><span>Opportunity</span><span>Owner</span><span>Last touch</span><span>Status</span><span></span></div>{myQueue.map((person) => <PersonRow key={person.id} person={person} onOpen={onOpen} />)}{!myQueue.length && <div className="empty-inline">No profiles are available.</div>}</div></section>
  </>;
}

function Stat({ icon, tone, label, value, detail }: { icon: React.ReactNode; tone: string; label: string; value: string; detail: string }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div className="stat-top"><span>{label}</span><MoreHorizontal size={17} /></div><strong>{value}</strong><p>{detail}</p></article>;
}

function Queue({ mode, people, allPeople, userId, query, setQuery, filter, setFilter, country, setCountry, state, setState, onOpen, onExport }: { mode: "admin" | "mine" | "team"; people: Person[]; allPeople: Person[]; userId: string; query: string; setQuery: (value: string) => void; filter: string; setFilter: (value: string) => void; country: string; setCountry: (value: string) => void; state: string; setState: (value: string) => void; onOpen: (person: Person) => void; onExport: () => void }) {
  const countries = [...new Set(allPeople.map((person) => locationValue(person.country)).filter(Boolean))].sort();
  const states = [...new Set(allPeople.filter((person) => country === "all" || locationValue(person.country) === country).map((person) => locationValue(person.region)).filter(Boolean))].sort();
  const filters = [
    { id: "all", label: mode === "mine" ? "My Board" : "All", count: allPeople.length },
    ...(mode === "admin" ? [{ id: "mine", label: "My Board", count: allPeople.filter((person) => person.assigned_to === userId).length }] : []),
    ...(mode !== "mine" ? [{ id: "available", label: "Available", count: allPeople.filter((person) => !person.assigned_to && !person.assigned_name).length }] : []),
    { id: "new", label: "New", count: allPeople.filter((person) => person.is_new_distributor).length },
    { id: "rank", label: "Rank push", count: allPeople.filter((person) => person.is_rank_opportunity).length },
    { id: "pcm", label: "PCM", count: allPeople.filter((person) => person.is_pcm_opportunity).length },
  ];
  const heading = mode === "mine" ? "My Board" : mode === "team" ? "All distributors" : "Work queue";
  const description = mode === "mine" ? "Only distributors you have claimed and are actively working with." : mode === "team" ? "Browse shared activity, add team context, and claim only profiles that are available." : "New-distributor, rank, and PCM rows stay connected without duplicates.";
  const emptyDetail = mode === "mine" ? "Claim a distributor from Available to add them here." : "Try another search or queue filter.";
  return <><div className="page-heading queue-title"><div><span className="eyebrow">ONE PROFILE · ONE DISTRIBUTOR ID</span><h1>{heading}</h1><p>{description}</p></div><button className="secondary-button" onClick={onExport}><Download size={17} /> Export view</button></div><div className="queue-toolbar"><div className="filter-tabs">{filters.map((item) => <button className={filter === item.id ? "active" : ""} onClick={() => setFilter(item.id)} key={item.id}>{item.label}<span>{item.count}</span></button>)}</div><div className="toolbar-actions"><div className="location-filters"><select className="filter-select" aria-label="Filter by country" value={country} onChange={(event) => { setCountry(event.target.value); setState("all"); }}><option value="all">All countries</option>{countries.map((item) => <option value={item} key={item}>{item}</option>)}</select><select className="filter-select" aria-label="Filter by state" value={state} onChange={(event) => setState(event.target.value)}><option value="all">All states</option>{states.map((item) => <option value={item} key={item}>{item}</option>)}</select></div><div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, ID, country, state, rank or leader" /></div></div></div><section className="panel queue-panel"><div className="queue-table"><div className="queue-head"><span>Distributor</span><span>Country / State</span><span>Opportunity</span><span>Owner</span><span>Last touch</span><span>Status</span><span></span></div>{people.map((person) => <PersonRow key={person.id} person={person} onOpen={onOpen} />)}{!people.length && <div className="empty-state"><Search size={28} /><strong>No matching profiles</strong><span>{emptyDetail}</span></div>}</div></section></>;
}

function PersonRow({ person, onOpen }: { person: Person; onOpen: (person: Person) => void }) {
  const pathway = [person.is_new_distributor && "New distributor", person.is_rank_opportunity && "Rank push", person.is_pcm_opportunity && "PCM"].filter(Boolean).join(" + ") || "Source profile";
  const touchTitle = person.last_contacted_at ? formatDate(person.last_contacted_at) : person.source_contacted_by ? "Source workbook" : "No contact recorded";
  const touchDetail = person.last_outcome ?? person.source_notes ?? (person.source_contacted_by ? "Contact owner recorded" : "No activity yet");
  return <button className="queue-row" onClick={() => onOpen(person)}><span className="person-cell"><span className="avatar person-avatar">{initials(person.name)}</span><span><strong>{person.name}</strong><small>#{person.external_id}</small></span></span><span className="market-cell"><strong>{locationValue(person.country) || "Not provided"}</strong><small>{locationValue(person.region) || "State not provided"}</small></span><span className="opportunity-cell"><strong>{person.target_rank ?? person.current_rank ?? "Not provided"}</strong><small>{pathway}</small></span><span className="owner-cell">{person.assigned_name ? <><span className="avatar tiny-avatar">{initials(person.assigned_name)}</span><span>{person.assigned_name}</span></> : <span className="unassigned">Unassigned</span>}</span><span className="touch-cell"><strong>{touchTitle}</strong><small>{touchDetail}</small></span><span><Status status={person.status} /></span><ChevronRight size={17} /></button>;
}

function Status({ status }: { status: ContactStatus }) {
  const labels: Record<ContactStatus, string> = { unassigned: "Unassigned", assigned: "Ready", contacted: "Contacted", "follow-up": "Follow-up", complete: "Complete" };
  return <span className={`status status-${status}`}><i />{labels[status]}</span>;
}

function Leaderboard({ people, teamActivities, sourcePeriod }: { people: Person[]; teamActivities: Activity[]; sourcePeriod: string }) {
  const team = getTeamMetrics(people, teamActivities);
  const podium = [team[1], team[0], team[2]].filter(Boolean);
  const positions = ["2nd", "1st", "3rd"];
  const tones = ["second", "first", "third"];
  return <><div className="page-heading"><div><span className="eyebrow">SHARED TEAM VIEW</span><h1>Team coverage</h1><p>Current ownership plus preserved notes attributed to the employee who wrote them.</p></div><span className="source-chip">{sourcePeriod}</span></div>{podium.length ? <section className="podium">{podium.map((member, index) => <div className={`podium-card ${tones[index]}`} key={member.name}>{positions[index] === "1st" ? <Trophy /> : <Medal />}<div className="avatar podium-avatar">{member.initials}</div><span>{positions[index]}</span><h3>{member.name}</h3><strong>{member.assigned.toLocaleString()} profiles</strong><p>{member.rank} rank · {member.pcm} PCM · {member.notes} notes</p></div>)}</section> : null}<section className="panel leaderboard-full"><div className="panel-heading"><div><h3>{sourcePeriod} coverage</h3><p>Current boards with preserved source and Top Up notes</p></div></div><div className="standings-head"><span>Rank</span><span>Team member</span><span>Assigned</span><span>New</span><span>Rank push</span><span>PCM</span><span>Notes</span></div>{team.map((member, index) => <div className="standing-row" key={member.name}><strong>#{index + 1}</strong><span className="standing-person"><span className="avatar tiny-avatar">{member.initials}</span><b>{member.name}</b></span><b>{member.assigned}</b><b>{member.newDistributors}</b><b>{member.rank}</b><b>{member.pcm}</b><b>{member.notes}</b></div>)}{!team.length && <div className="empty-inline">No team ownership or notes are recorded yet.</div>}</section></>;
}

function ManageUsers({ users, saving, onSave }: { users: UserDirectoryEntry[]; saving: string; onSave: (entry: UserDirectoryEntry, name: string) => void }) {
  return <>
    <div className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Manage users</h1><p>Edit the name shown throughout Top Up and review the most recent successful login.</p></div><div className="admin-badge"><ShieldCheck size={16} /> Admin only</div></div>
    <section className="panel users-panel">
      <div className="users-head"><span>User</span><span>Display name</span><span>Role</span><span>Last login</span><span></span></div>
      {users.map((entry) => <UserEditor key={entry.email} entry={entry} saving={saving === entry.email} onSave={onSave} />)}
      {!users.length && <div className="empty-state"><Users size={28} /><strong>No users found</strong><span>User records appear here after provisioning or their first successful login.</span></div>}
    </section>
  </>;
}

function UserEditor({ entry, saving, onSave }: { entry: UserDirectoryEntry; saving: boolean; onSave: (entry: UserDirectoryEntry, name: string) => void }) {
  const [name, setName] = useState(entry.display_name);
  const changed = name.trim() !== entry.display_name;
  return <div className="user-row">
    <span className="user-identity"><span className="avatar person-avatar">{initials(entry.display_name)}</span><span><strong>{entry.display_name}</strong><small>{entry.email}</small></span></span>
    <label><span className="sr-only">Display name for {entry.email}</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
    <span>{entry.is_admin ? <span className="role-pill admin">Administrator</span> : <span className="role-pill">Employee</span>}</span>
    <time dateTime={entry.last_login_at ?? undefined}>{entry.last_login_at ? formatDate(entry.last_login_at) : "Never logged in"}</time>
    <button className="secondary-button user-save" disabled={!changed || !name.trim() || saving} onClick={() => onSave(entry, name)}>{saving ? "Saving…" : "Save"}</button>
  </div>;
}

function Imports({ busy, result, history, onImport }: { busy: boolean; result: string; history: ImportHistory[]; onImport: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  return <><div className="page-heading"><div><span className="eyebrow">ADMIN TOOLS</span><h1>Monthly data imports</h1><p>Import real CSV exports; existing distributor IDs update one shared profile.</p></div><div className="admin-badge"><ShieldCheck size={16} /> Admin only</div></div><section className="import-grid"><div className="panel import-panel"><div className="panel-heading"><div><h3>Upload report</h3><p>CSV files exported from the monthly workbook</p></div><FileSpreadsheet size={22} /></div><label className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) onImport(file); }}><input type="file" accept=".csv,text/csv" onChange={(event) => event.target.files?.[0] && onImport(event.target.files[0])} /><span className="upload-icon"><UploadCloud size={28} /></span><strong>{busy ? "Validating and importing…" : "Drop a CSV here or browse"}</strong><p>New Distributor, D/SD/ED, or PCM report</p><small>Maximum 10 MB</small></label>{result && <div className={result.toLowerCase().includes("stopped") || result.toLowerCase().includes("failed") ? "import-result error" : "import-result"}>{result.toLowerCase().includes("stopped") || result.toLowerCase().includes("failed") ? <CircleAlert size={17} /> : <Check size={17} />}{result}</div>}<div className="mapping-note"><CircleAlert size={17} /><p><strong>No fabricated fallback values</strong><span>Rows without a valid distributor ID or name stop the import before writes. Missing source fields stay visibly “Not provided.” Existing ownership and activity are preserved.</span></p></div></div><div className="panel import-guide"><div className="panel-heading"><div><h3>Import sequence</h3><p>Monthly operating rhythm</p></div></div><ol><li><span>1</span><div><strong>New Distributor</strong><p>Welcome outreach and 10 Pack tracking</p></div></li><li><span>2</span><div><strong>D, SD, ED</strong><p>Rank target and total OV needed</p></div></li><li><span>3</span><div><strong>PCMs</strong><p>Presidential pathway opportunities</p></div></li></ol><div className="privacy-card"><ShieldCheck size={20} /><div><strong>Protected employee workspace</strong><p>Distributor data is read only after verified @unicity.com authentication and row-level security.</p></div></div></div></section><section className="panel recent-imports"><div className="panel-heading"><div><h3>Recent imports</h3><p>Live audit trail from Supabase</p></div></div>{history.map((file) => <div className="import-row" key={file.id}><span className="file-icon"><FileSpreadsheet size={20} /></span><div><strong>{file.file_name}</strong><span>{Number(file.row_count).toLocaleString()} records · Imported by {file.imported_by_name ?? "System import"}</span></div><time>{formatDate(file.created_at)}</time><span className={`status status-${file.status === "complete" ? "complete" : "follow-up"}`}><i />{file.status}</span></div>)}{!history.length && <div className="empty-inline">No imports have been recorded yet.</div>}</section></>;
}

function PersonDrawer({ person, currentUserId, activities, activitiesLoading, releaseBusy, onClose, onClaim, onLog, onRelease }: { person: Person; currentUserId: string; activities: Activity[]; activitiesLoading: boolean; releaseBusy: boolean; onClose: () => void; onClaim: () => void; onLog: () => void; onRelease: () => void }) {
  const linkedToUser = person.assigned_to === currentUserId;
  const canLink = !person.assigned_to && !person.assigned_name;
  return <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="drawer">
      <div className="drawer-header"><div><span className="eyebrow">DISTRIBUTOR PROFILE</span><h2>{person.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close profile"><X size={20} /></button></div>
      <div className="profile-summary"><div className="avatar profile-avatar">{initials(person.name)}</div><div><strong>{person.name}</strong><span>#{person.external_id} · {locationValue(person.country) || "Country not provided"}{locationValue(person.region) ? ` / ${locationValue(person.region)}` : ""} · Joined {person.joined_at ? new Date(`${person.joined_at}T00:00:00`).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }) : "not provided"}</span><div className="profile-tags">{person.is_new_distributor && <b>New distributor</b>}{person.is_rank_opportunity && <b>Rank push</b>}{person.is_pcm_opportunity && <b>PCM pathway</b>}{person.has_ten_pack && <b>10 Pack</b>}{person.first_time_at_rank === true && <b>First time at rank</b>}</div></div></div>
      <div className="contact-actions">{person.phone ? <a href={`tel:${person.phone}`}><Phone size={17} /> Call</a> : <span aria-disabled="true"><Phone size={17} /> No phone</span>}{person.email ? <a href={`mailto:${person.email}`}><Mail size={17} /> Email</a> : <span aria-disabled="true"><Mail size={17} /> No email</span>}{person.phone ? <a href={`https://wa.me/${person.phone.replace(/\D/g, "")}`}><MessageCircle size={17} /> WhatsApp</a> : <span aria-disabled="true"><MessageCircle size={17} /> No WhatsApp</span>}</div>
      <section className="profile-section"><h3>Opportunity</h3><div className="rank-path"><div><span>CURRENT RANK</span><strong>{person.current_rank ?? "Not provided"}</strong></div><ArrowRight size={18} /><div><span>RUNNING FOR</span><strong>{person.target_rank ?? "Not provided"}</strong></div></div><div className="volume-card"><div><span>Total OV needed</span><strong>{person.gap_to_rank == null ? "Not provided" : person.gap_to_rank.toLocaleString()}</strong></div><div><span>Highest rank</span><strong>{person.highest_rank_name ?? "Not provided"}</strong></div></div>{person.nearest_leader_name && <div className="source-detail"><span>Nearest leader</span><strong>{person.nearest_leader_name}</strong></div>}</section>
      <section className="profile-section"><h3>Ownership</h3>{person.assigned_name ? <div className="owner-card"><span className="avatar tiny-avatar">{initials(person.assigned_name)}</span><div><strong>{person.assigned_name}</strong><span>{person.assigned_to ? "Linked Top Up owner" : "Owner recorded in source workbook"}</span></div><Status status={person.status} /></div> : <div className="unclaimed-card"><Users size={20} /><div><strong>This profile is available</strong><span>Claim it to add it to your personal queue.</span></div></div>}</section>
      <section className="profile-section"><h3>Activity history</h3><div className="timeline-list">{activitiesLoading ? <div className="no-activity"><Clock3 size={20} /> Loading preserved notes…</div> : activities.map((activity) => <div className="timeline" key={activity.id}><i /><div><strong>{activity.outcome}</strong><span>{formatDate(activity.created_at)} · {activity.author_name} · {activity.activity_type}</span>{activity.notes && <p>{activity.notes}</p>}</div></div>)}{person.source_notes || person.source_contacted_by ? <div className="timeline source-timeline"><i /><div><strong>Imported source record</strong><span>{person.source_contacted_by ? `Contacted By: ${person.source_contacted_by}` : "No Contacted By value"}</span>{person.source_notes && <p>{person.source_notes}</p>}</div></div> : null}{!activitiesLoading && !activities.length && !person.source_notes && !person.source_contacted_by && <div className="no-activity"><Clock3 size={20} /> No outreach is recorded yet.</div>}</div></section>
      <div className="drawer-footer">{canLink ? <div className="drawer-footer-actions"><button className="secondary-button" onClick={onClaim}><UserRoundCheck size={17} /> Claim profile</button><button className="primary-button" onClick={onLog}><MessageCircle size={17} /> Add team note</button></div> : linkedToUser ? <div className="drawer-footer-actions"><button className="secondary-button release-button" onClick={onRelease} disabled={releaseBusy}><Users size={17} /> {releaseBusy ? "Releasing…" : "Release"}</button><button className="primary-button" onClick={onLog}><MessageCircle size={17} /> Log an activity</button></div> : <div className="drawer-footer-actions"><button className="secondary-button" disabled><ShieldCheck size={17} /> Owned by {person.assigned_name}</button><button className="primary-button" onClick={onLog}><MessageCircle size={17} /> Add team note</button></div>}</div>
    </aside>
  </div>;
}

function ActivityModal({ person, type, setType, outcome, setOutcome, note, setNote, onClose, onSave }: { person: Person; type: string; setType: (value: string) => void; outcome: string; setOutcome: (value: string) => void; note: string; setNote: (value: string) => void; onClose: () => void; onSave: (event: FormEvent) => void }) {
  return <div className="modal-backdrop"><form className="modal" onSubmit={onSave}><div className="modal-header"><div><span className="eyebrow">SHARED TEAM ACTIVITY</span><h2>Add context for {person.name}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={20} /></button></div><label>Activity type<select value={type} onChange={(event) => setType(event.target.value)}><option>Context note</option><option>Phone call</option><option>Email</option><option>WhatsApp</option><option>Zoom meeting</option></select></label><label>Outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option>Shared team context</option><option>Connected — follow-up needed</option><option>Strategy call booked</option><option>Sent message — awaiting reply</option><option>Welcomed — no help needed</option><option>Completed — rank plan confirmed</option><option>No response</option></select></label><label>Notes<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Questions, next action, or context for the team…" rows={4} /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button"><Check size={17} /> Save activity</button></div></form></div>;
}
