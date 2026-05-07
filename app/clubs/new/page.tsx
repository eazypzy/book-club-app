"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { generateInviteCode } from "@/lib/utils";

export default function NewClubPage() {
  const router = useRouter();
  const [name, setName] = useState("");
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
      setError("You must be signed in.");
      setBusy(false);
      return;
    }

    const invite_code = generateInviteCode();
    const { data, error: insertErr } = await supabase
      .from("clubs")
      .insert({ name, invite_code, created_by: user.id })
      .select("id")
      .single();

    if (insertErr || !data) {
      setError(insertErr?.message ?? "Failed to create club.");
      setBusy(false);
      return;
    }

    // Add creator as a member.
    const { error: memErr } = await supabase
      .from("club_members")
      .insert({ club_id: data.id, user_id: user.id, role: "owner" });
    if (memErr) {
      setError(memErr.message);
      setBusy(false);
      return;
    }

    router.push(`/clubs/${data.id}`);
  }

  return (
    <div className="max-w-md mx-auto card">
      <h1 className="h1 mb-3">Create a club</h1>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="name">Club name</label>
          <input
            id="name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Tuesday Readers"
          />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Creating..." : "Create club"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </div>
  );
}
