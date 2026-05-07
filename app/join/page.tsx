"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function JoinForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState("");

  useEffect(() => {
    const c = searchParams.get("code");
    if (c) setCode(c.toUpperCase());
  }, [searchParams]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) {
      router.push("/login");
      return;
    }

    const upper = code.trim().toUpperCase();
    const { data: club, error: lookupErr } = await supabase
      .from("clubs")
      .select("id")
      .eq("invite_code", upper)
      .maybeSingle();

    if (lookupErr) {
      setError(lookupErr.message);
      setBusy(false);
      return;
    }
    if (!club) {
      setError("No club found with that code.");
      setBusy(false);
      return;
    }

    const { error: insertErr } = await supabase
      .from("club_members")
      .insert({ club_id: club.id, user_id: user.id })
      .select();

    // Ignore duplicate-key, just route in.
    if (insertErr && !insertErr.message.toLowerCase().includes("duplicate")) {
      setError(insertErr.message);
      setBusy(false);
      return;
    }

    router.push(`/clubs/${club.id}`);
  }

  return (
    <div className="max-w-md mx-auto card">
      <h1 className="h1 mb-3">Join a club</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="code">Invite code</label>
          <input
            id="code"
            className="input uppercase tracking-widest"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="K7P2RA"
            maxLength={12}
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Joining..." : "Join"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinForm />
    </Suspense>
  );
}
