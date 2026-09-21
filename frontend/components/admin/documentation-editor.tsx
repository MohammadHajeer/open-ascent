"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Difficulty, MovementSafetyContent } from "@/features/admin/documentation/types";

type ListField = "stressed_areas" | "prerequisites" | "cautions" | "stop_conditions" | "setup";

const listFields: Array<{ key: ListField; label: string; description: string }> = [
  { key: "setup", label: "Setup", description: "One setup instruction per line." },
  { key: "prerequisites", label: "Prerequisites", description: "Readiness requirements before starting." },
  { key: "stressed_areas", label: "Stressed areas", description: "Areas that receive meaningful load or demand." },
  { key: "cautions", label: "Cautions", description: "Warnings the athlete should understand." },
  { key: "stop_conditions", label: "Stop conditions", description: "Concrete reasons to stop the movement." },
];

export function DocumentationEditor({
  initialContent,
  readOnly,
  saving,
  onSave,
  onPublish,
}: {
  initialContent: MovementSafetyContent;
  readOnly: boolean;
  saving?: boolean;
  onSave?: (content: MovementSafetyContent) => void;
  onPublish?: (content: MovementSafetyContent) => void;
}) {
  const [content, setContent] = useState<MovementSafetyContent>(initialContent);

  function setField<K extends keyof MovementSafetyContent>(key: K, value: MovementSafetyContent[K]) {
    setContent((current) => ({ ...current, [key]: value }));
  }

  function setListField(key: ListField, index: number, value: string) {
    const values = [...(content[key] ?? [])];
    values[index] = value;
    setField(key, values);
  }

  function addListField(key: ListField) {
    setField(key, [...(content[key] ?? []), ""]);
  }

  function removeListField(key: ListField, index: number) {
    const values = [...(content[key] ?? [])];
    values.splice(index, 1);
    setField(key, values.length ? values : null);
  }

  return (
    <form id="documentation-editor-form" className="space-y-8 px-5 py-6 sm:px-7" onSubmit={(event) => { event.preventDefault(); onSave?.(content); }}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <Field label="Notice" description="The short guidance notice shown at the top of the movement guide.">
          <Textarea disabled={readOnly} value={content.notice ?? ""} onChange={(event) => setField("notice", event.target.value || null)} placeholder="Write the primary safety notice…" className="min-h-28" />
        </Field>
        <Field label="Difficulty" description="The difficulty used by the movement guide and catalog.">
          <Select disabled={readOnly} value={content.difficulty ?? ""} onValueChange={(value) => setField("difficulty", (value || null) as Difficulty | null)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select difficulty" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="beginner">Beginner</SelectItem>
              <SelectItem value="intermediate">Intermediate</SelectItem>
              <SelectItem value="advanced">Advanced</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {listFields.map(({ key, label, description }) => (
        <ListEditor key={key} label={label} description={description} values={content[key] ?? []} disabled={readOnly} onAdd={() => addListField(key)} onChange={(index, value) => setListField(key, index, value)} onRemove={(index) => removeListField(key, index)} />
      ))}

      <Field label="Easier option" description="An optional regression or alternative movement.">
        <Textarea disabled={readOnly} value={content.easier_option ?? ""} onChange={(event) => setField("easier_option", event.target.value || null)} placeholder="Describe an easier option…" />
      </Field>

      {!readOnly ? (
        <div className="flex flex-wrap justify-end gap-3 border-t border-border/70 pt-6">
          <Button type="submit" variant="outline" disabled={saving}>
            <Save className="size-4" aria-hidden="true" />
            {saving ? "Saving…" : "Save draft"}
          </Button>
          <Button type="button" variant="brand" disabled={saving} onClick={() => onPublish?.(content)}>
            Publish version
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function Field({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs leading-5 text-foreground-faint">{description}</p>
      {children}
    </div>
  );
}

function ListEditor({
  label,
  description,
  values,
  disabled,
  onAdd,
  onChange,
  onRemove,
}: {
  label: string;
  description: string;
  values: string[];
  disabled: boolean;
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Label>{label}</Label>
          <p className="mt-2 text-xs leading-5 text-foreground-faint">{description}</p>
        </div>
        {!disabled ? <Button type="button" variant="ghost" size="sm" onClick={onAdd}><Plus className="size-3.5" aria-hidden="true" /> Add line</Button> : null}
      </div>
      {values.length ? values.map((value, index) => (
        <div key={`${label}-${index}`} className="flex items-start gap-2">
          <Input disabled={disabled} value={value} onChange={(event) => onChange(index, event.target.value)} placeholder={`${label} item ${index + 1}`} />
          {!disabled ? <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${label} item ${index + 1}`} onClick={() => onRemove(index)}><Trash2 className="size-4" aria-hidden="true" /></Button> : null}
        </div>
      )) : <p className="rounded-lg border border-dashed border-border/80 px-3 py-3 text-sm text-foreground-faint">No entries yet.</p>}
    </div>
  );
}
