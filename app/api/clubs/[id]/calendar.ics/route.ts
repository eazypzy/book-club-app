import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createEvents, type EventAttributes } from "ics";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: club } = await supabase
    .from("clubs")
    .select("id, name")
    .eq("id", params.id)
    .maybeSingle();
  if (!club) return new NextResponse("Not found", { status: 404 });

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, scheduled_at, location, description, page_target")
    .eq("club_id", club.id)
    .order("scheduled_at");

  const events: EventAttributes[] = (meetings ?? []).map((m: any) => {
    const start = new Date(m.scheduled_at);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour default
    return {
      uid: `${m.id}@bookclub`,
      title: `${club.name}: ${m.title}`,
      description:
        (m.description ?? "") +
        (m.page_target ? `\nRead through page ${m.page_target}.` : ""),
      location: m.location ?? undefined,
      start: [
        start.getUTCFullYear(),
        start.getUTCMonth() + 1,
        start.getUTCDate(),
        start.getUTCHours(),
        start.getUTCMinutes()
      ],
      startInputType: "utc",
      end: [
        end.getUTCFullYear(),
        end.getUTCMonth() + 1,
        end.getUTCDate(),
        end.getUTCHours(),
        end.getUTCMinutes()
      ],
      endInputType: "utc"
    };
  });

  const { error, value } = createEvents(events);
  if (error) {
    return new NextResponse(`ICS error: ${error.message}`, { status: 500 });
  }

  return new NextResponse(value, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${club.name.replace(
        /[^a-z0-9]+/gi,
        "-"
      )}.ics"`
    }
  });
}
