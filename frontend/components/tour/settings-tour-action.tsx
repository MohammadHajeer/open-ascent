"use client";

import { Button } from "@/components/ui/button";

export function SettingsTourAction() {
  return <Button type="button" variant="outline" onClick={() => window.dispatchEvent(new Event("dashboard-tour:replay"))}>Start dashboard tour</Button>;
}
