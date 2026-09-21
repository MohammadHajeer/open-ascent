const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export const apiUrl = (path: string) => `${API_URL}${path}`;

type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  detail?: string | { message?: string };
};

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);

    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(apiUrl(path), options);

  const data = (await response.json()) as T | ApiErrorBody;

  if (!response.ok) {
    const error = data as ApiErrorBody;
    const detailMessage =
      typeof error.detail === "string" ? error.detail : error.detail?.message;

    throw new ApiError(
      response.status,
      error.error?.code ?? "unknown_error",
      error.error?.message ?? detailMessage ?? "Something went wrong",
      error.error?.details,
    );
  }

  return data as T;
}
