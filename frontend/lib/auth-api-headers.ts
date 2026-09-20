export function withBearerToken(options: RequestInit | undefined, accessToken: string): RequestInit {
  const headers = new Headers(options?.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return { ...options, headers };
}
