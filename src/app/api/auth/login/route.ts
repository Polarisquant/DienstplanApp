import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session";
import { z } from "zod";

const bodySchema = z.object({
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const { password } = bodySchema.parse(json);
    const user = await prisma.user.findFirst();
    if (!user) {
      return NextResponse.json(
        { error: "Kein Benutzer angelegt. Bitte Seed ausführen." },
        { status: 500 }
      );
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: "Falsches Passwort." }, { status: 401 });
    }
    const token = await createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return res;
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültige Eingabe." }, { status: 400 });
    }
    console.error(e);
    return NextResponse.json({ error: "Serverfehler." }, { status: 500 });
  }
}
