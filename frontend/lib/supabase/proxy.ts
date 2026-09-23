import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  isSessionRoutedPath,
  routeDestination,
  type RouteDestination,
} from "@/lib/supabase/proxy-routing";

const cacheHeaders = ["cache-control", "expires", "pragma"] as const;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          const nextResponse = NextResponse.next({ request });
          supabaseResponse.cookies
            .getAll()
            .forEach((cookie) => nextResponse.cookies.set(cookie));
          cookiesToSet.forEach(({ name, value, options }) =>
            nextResponse.cookies.set(name, value, options),
          );
          cacheHeaders.forEach((header) => {
            const value = supabaseResponse.headers.get(header);
            if (value) nextResponse.headers.set(header, value);
          });
          Object.entries(headers).forEach(([name, value]) =>
            nextResponse.headers.set(name, value),
          );
          supabaseResponse = nextResponse;
        },
      },
    },
  );

  // Verify the cookie-backed session and refresh it before making route decisions.
  let claims: object | null = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims ?? null;
  } catch {
    if (request.method !== "GET" || !isSessionRoutedPath(pathname)) {
      return supabaseResponse;
    }

    const response = new NextResponse("Session unavailable.", { status: 503 });
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => response.cookies.set(cookie));
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  function finish(response: NextResponse) {
    if (response !== supabaseResponse) {
      supabaseResponse.cookies
        .getAll()
        .forEach((cookie) => response.cookies.set(cookie));
    }
    cacheHeaders.forEach((header) => {
      const value = supabaseResponse.headers.get(header);
      if (value) response.headers.set(header, value);
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }

  function redirect(destination: RouteDestination) {
    const url = new URL(destination, request.url);
    if (destination === "/login") {
      url.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    }
    return finish(NextResponse.redirect(url));
  }

  if (request.method !== "GET" || !isSessionRoutedPath(pathname)) {
    return supabaseResponse;
  }

  const destination = routeDestination(pathname, claims);
  if (destination) return redirect(destination);
  return finish(supabaseResponse);
}
