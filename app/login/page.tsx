"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, CheckCircle2, ShieldCheck } from "lucide-react";

type Mode = "login" | "setup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    const values = new FormData(event.currentTarget);
    const body = mode === "login"
      ? { email: String(values.get("email")).trim(), password: String(values.get("password")) }
      : { organizationName: String(values.get("organizationName")).trim(), coachName: String(values.get("coachName")).trim(), email: String(values.get("email")).trim(), password: String(values.get("password")) };
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/onboarding", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not continue.");
      router.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request could not be completed.");
      setBusy(false);
    }
  }

  return <main className="auth-shell">
    <section className="auth-story">
      <Link className="auth-brand" href="/"><span><ShieldCheck size={20} /></span>fieldhouse<span>.</span></Link>
      <div className="auth-story-copy"><small>SPORTS PROGRAM MANAGEMENT</small><h1>Every practice<br />has a place<br />in the <em>record.</em></h1><p>Attendance, teams, and match readiness for schools, colleges, and academies.</p></div>
      <div className="auth-story-foot"><span><CheckCircle2 size={15} /> Official records</span><span><CheckCircle2 size={15} /> Role-based access</span><span><CheckCircle2 size={15} /> Ready for the next match</span></div>
    </section>
    <section className="auth-main">
      <div className="auth-card">
        <div className="auth-mobile-brand"><span><ShieldCheck size={18} /></span> fieldhouse<span>.</span></div>
        <div className="auth-kicker">{mode === "login" ? "WELCOME BACK" : "FIRST COACH ACCOUNT"}</div>
        <h2>{mode === "login" ? "Sign in to Fieldhouse" : "Create your academy"}</h2>
        <p className="auth-intro">{mode === "login" ? "Continue to your sports program workspace." : "Create your academy workspace and coach account in one step."}</p>
        {error && <div className="auth-error" role="alert">{error}</div>}
        {notice && <div className="auth-success" role="status">{notice}</div>}
        <form className="auth-form" onSubmit={submit}>
          {mode === "setup" && <>
            <label>Academy name<input name="organizationName" required minLength={3} placeholder="e.g. Dumka Sports Academy" autoComplete="organization" /></label>
            <label>Coach name<input name="coachName" required minLength={2} placeholder="Your full name" autoComplete="name" /></label>
          </>}
          <label>Email address<input name="email" required type="email" autoComplete="email" placeholder="you@example.com" /></label>
          <label>Password<input name="password" required type="password" minLength={mode === "setup" ? 12 : 1} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "setup" ? "At least 12 characters" : "Your password"} /></label>
          <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create coach account"} <ArrowRight size={16} /></button>
        </form>
        <div className="auth-switch">{mode === "login" ? "Setting up Fieldhouse for the first time?" : "Already have an account?"}<button onClick={() => { setMode(mode === "login" ? "setup" : "login"); setError(""); setNotice(""); }}>{mode === "login" ? "Create an academy" : "Sign in"}</button></div>
        <div className="auth-security"><Building2 size={15} /><span>The first account is a coach. Each academy’s records stay in its own workspace.</span></div>
      </div>
      <footer className="auth-footer">FIELDHOUSE · SPORTS RECORDS FOR EVERY TEAM</footer>
    </section>
  </main>;
}
