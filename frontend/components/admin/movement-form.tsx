"use client";

import { Save } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  MovementAdminRead,
  MovementCreateInput,
  MovementUpdateInput,
} from "@/features/admin/movements/types";

type MovementFormValues = MovementCreateInput;

const emptyValues: MovementFormValues = {
  name: "",
  slug: "",
  family_key: "",
  illustration_path: "",
  upload_analysis_supported: false,
  live_coach_supported: false,
};

export function MovementForm({
  movement,
  saving,
  onSubmit,
}: {
  movement?: MovementAdminRead;
  saving?: boolean;
  onSubmit: (values: MovementCreateInput | MovementUpdateInput) => void;
}) {
  const [values, setValues] = useState<MovementFormValues>(() => toValues(movement));

  function setField<K extends keyof MovementFormValues>(key: K, value: MovementFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      ...values,
      name: values.name.trim(),
      slug: values.slug.trim(),
      family_key: values.family_key.trim(),
      illustration_path: values.illustration_path?.trim() || null,
    };
    onSubmit(payload);
  }

  return (
    <form className="space-y-7 px-5 py-6 sm:px-7" onSubmit={handleSubmit}>
      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Name" description="The catalog name shown to admins and athletes.">
          <Input required maxLength={120} value={values.name} onChange={(event) => setField("name", event.target.value)} placeholder="e.g. Pull-up" />
        </Field>
        <Field label="Slug" description="Lowercase URL key. Changing it changes the public route.">
          <Input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={100} value={values.slug} onChange={(event) => setField("slug", event.target.value)} placeholder="e.g. pull-up" />
        </Field>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Family key" description="Analyzer/catalog family identifier. Use an existing product family key.">
          <Input required pattern="[a-z][a-z0-9_-]*" maxLength={100} value={values.family_key} onChange={(event) => setField("family_key", event.target.value)} placeholder="e.g. vertical_pull" />
        </Field>
        <Field label="Illustration asset path" description="Optional path in the movement-illustrations storage bucket.">
          <Input maxLength={255} value={values.illustration_path ?? ""} onChange={(event) => setField("illustration_path", event.target.value)} placeholder="e.g. pull-up.png" />
        </Field>
      </div>

      <div className="grid gap-3 border-t border-border/70 pt-6 sm:grid-cols-2">
        <BooleanField checked={values.upload_analysis_supported} label="Upload analysis supported" description="Allows video upload analysis for this movement." onChange={(checked) => setField("upload_analysis_supported", checked)} />
        <BooleanField checked={values.live_coach_supported} label="Live coach supported" description="Marks this movement as available to live coaching features." onChange={(checked) => setField("live_coach_supported", checked)} />
      </div>

      <div className="flex justify-end border-t border-border/70 pt-6">
        <Button type="submit" variant="brand" disabled={saving}>
          <Save className="size-4" aria-hidden="true" />
          {saving ? "Saving…" : movement ? "Save movement" : "Create movement"}
        </Button>
      </div>
    </form>
  );
}

function toValues(movement?: MovementAdminRead): MovementFormValues {
  if (!movement) return emptyValues;
  return {
    name: movement.name,
    slug: movement.slug,
    family_key: movement.family_key,
    illustration_path: movement.illustration_path,
    upload_analysis_supported: movement.upload_analysis_supported,
    live_coach_supported: movement.live_coach_supported,
  };
}

function Field({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label><p className="text-xs leading-5 text-foreground-faint">{description}</p>{children}</div>;
}

function BooleanField({ checked, label, description, onChange }: { checked: boolean; label: string; description: string; onChange: (checked: boolean) => void }) {
  return <label className="flex items-start gap-3 rounded-xl border border-border/75 bg-background-alt/35 p-4"><Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} /><span><span className="block text-sm font-medium">{label}</span><span className="mt-1 block text-xs leading-5 text-foreground-soft">{description}</span></span></label>;
}
