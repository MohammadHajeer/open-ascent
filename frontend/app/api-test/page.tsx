"use client";

import { useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";

type TestResponse = {
  status: string;
  message: string;
};

export default function ApiTestPage() {
  const [message, setMessage] = useState("");

  async function testSuccess() {
    try {
      const data = await apiFetch<TestResponse>("/api/test");
      setMessage(data.message);
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unknown error");
    }
  }

  async function testError() {
    try {
      await apiFetch("/api/test-error");
    } catch (error) {
      if (error instanceof ApiError) {
        setMessage(`${error.status} - ${error.code}: ${error.message}`);
      }
    }
  }

  return (
    <main className="p-8">
      <div className="flex gap-4">
        <button onClick={testSuccess}>Test API</button>

        <button onClick={testError}>Test Error</button>
      </div>

      <p className="mt-4">{message}</p>
    </main>
  );
}
