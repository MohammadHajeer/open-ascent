"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Difficulty, MovementSafetyContent, ReadinessPerformanceRule } from "@/features/admin/documentation/types";
import { useAdminMovements } from "@/features/admin/movements/hooks";

type ListField = "stressed_areas" | "prerequisites" | "cautions" | "stop_conditions" | "setup";

const listFields: Array<{ key: ListField; label: string; description: string }> = [
  { key: "setup", label: "Setup", description: "One setup instruction per line." },
  { key: "prerequisites", label: "Prerequisites", description: "Readiness requirements before starting." },
  { key: "stressed_areas", label: "Stressed areas", description: "Areas that receive meaningful load or demand." },
  { key: "cautions", label: "Cautions", description: "Warnings the athlete should understand." },
  { key: "stop_conditions", label: "Stop conditions", description: "Concrete reasons to stop the movement." },
];
const evidenceSources = ["uploaded_analysis", "live_coach", "manual", "self_reported", "initial_assessment"] as const;

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
  const movements = useAdminMovements();

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

  function setRule(index: number, patch: Partial<ReadinessPerformanceRule>) {
    const rules = [...(content.readiness_rules ?? [])];
    rules[index] = { ...rules[index], ...patch };
    setField("readiness_rules", rules);
  }

  function addRule() {
    const prerequisiteIndex = (content.prerequisites ?? []).findIndex((_, index) =>
      !(content.readiness_rules ?? []).some((rule) => rule.prerequisite_index === index));
    const movement = movements.data?.find((item) => item.prescription_type === "repetitions" || item.prescription_type === "duration");
    if (prerequisiteIndex < 0 || !movement) return;
    setField("readiness_rules", [...(content.readiness_rules ?? []), {
      code: `rule_${Date.now().toString(36)}`,
      type: "movement_performance",
      prerequisite_index: prerequisiteIndex,
      movement_id: movement.id,
      metric: movement.prescription_type === "duration" ? "hold_seconds" : "reps",
      operator: ">=",
      value: 1,
      max_age_days: 30,
      accepted_sources: ["manual"],
    }]);
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

      <div className="space-y-4 border-t border-border pt-6">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><Label>Structured readiness rules</Label><p className="mt-2 text-xs text-foreground-faint">Tie evidence thresholds to the documented prerequisites.</p></div>{!readOnly ? <Button type="button" variant="outline" size="sm" onClick={addRule} disabled={!movements.data?.length || (content.readiness_rules?.length ?? 0) >= (content.prerequisites?.length ?? 0)}><Plus className="size-4" /> Add rule</Button> : null}</div>
        {movements.isError ? <p className="text-sm text-destructive">Movement choices could not be loaded. Existing rules remain visible.</p> : null}
        {(content.readiness_rules ?? []).length ? (content.readiness_rules ?? []).map((rule, index) => {
          const options = (movements.data ?? []).filter(item => item.prescription_type === (rule.metric === "reps" ? "repetitions" : "duration"));
          return <div key={index} className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex items-center justify-between"><span className="text-sm font-medium">Rule {index + 1}</span>{!readOnly ? <Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${index + 1}`} onClick={() => setField("readiness_rules", (content.readiness_rules ?? []).filter((_, ruleIndex) => ruleIndex !== index))}><Trash2 className="size-4" /></Button> : null}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Rule code" description="Stable identifier, lowercase letters and underscores."><Input disabled={readOnly} value={rule.code} onChange={event => setRule(index, { code: event.target.value })} /></Field>
              <Field label="Prerequisite" description="The prose statement this rule proves."><Select disabled={readOnly} value={String(rule.prerequisite_index)} onValueChange={value => setRule(index, { prerequisite_index: Number(value) })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{(content.prerequisites ?? []).map((item, prerequisiteIndex) => <SelectItem key={prerequisiteIndex} value={String(prerequisiteIndex)}>{prerequisiteIndex + 1}. {item || "Untitled"}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Metric" description="Repetitions or hold duration."><Select disabled={readOnly} value={rule.metric} onValueChange={value => { const metric = (value ?? "reps") as "reps" | "hold_seconds"; const first = movements.data?.find(item => item.prescription_type === (metric === "reps" ? "repetitions" : "duration")); setRule(index, { metric, movement_id: first?.id ?? rule.movement_id }); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="reps">Repetitions</SelectItem><SelectItem value="hold_seconds">Hold seconds</SelectItem></SelectContent></Select></Field>
              <Field label="Source movement" description="Movement used to establish readiness."><Select disabled={readOnly || !options.length} value={rule.movement_id} onValueChange={value => setRule(index, { movement_id: value ?? rule.movement_id })}><SelectTrigger className="w-full"><SelectValue placeholder="Choose movement" /></SelectTrigger><SelectContent>{!options.some(item => item.id === rule.movement_id) ? <SelectItem value={rule.movement_id}>Unavailable movement</SelectItem> : null}{options.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></Field>
              <Field label="Minimum value" description="Evidence must be at least this amount."><Input disabled={readOnly} type="number" min="0.001" step={rule.metric === "reps" ? "1" : "0.001"} value={rule.value} onChange={event => setRule(index, { value: event.target.value })} /></Field>
              <Field label="Maximum age, days" description="How recent the evidence must be."><Input disabled={readOnly} type="number" min="1" max="365" step="1" value={rule.max_age_days} onChange={event => setRule(index, { max_age_days: Number(event.target.value) })} /></Field>
            </div>
            <div><Label>Accepted evidence sources</Label><div className="mt-3 flex flex-wrap gap-4">{evidenceSources.map(source => <label key={source} className="flex items-center gap-2 text-xs capitalize"><Checkbox disabled={readOnly} checked={rule.accepted_sources.includes(source)} onCheckedChange={checked => setRule(index, { accepted_sources: checked ? [...rule.accepted_sources, source] : rule.accepted_sources.filter(item => item !== source) })} />{source.replaceAll("_", " ")}</label>)}</div></div>
          </div>;
        }) : <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-foreground-faint">No structured readiness rules.</p>}
      </div>

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
