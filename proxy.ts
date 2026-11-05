import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic check only: no session cookie → send to /login.
 * The real check (signature, user, revoked sessions) happens in requireUser() on every page.
 * /go/* (public tracking links), /u/* (email unsubscribe) and /api routes are excluded: they check the session themselves, and big uploads must not be
 * buffered by the proxy (10 MB limit).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const open = pathname === "/login" || pathname === "/setup";
  if (!open && !request.cookies.has("su_session")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|go/|u/|_next/static|_next/image|favicon.ico|icon.png|robots.txt).*)"]
};
