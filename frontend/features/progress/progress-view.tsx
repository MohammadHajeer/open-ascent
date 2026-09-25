"use client";

import * as React from "react";
import { Activity, CalendarDays, Dumbbell, Loader2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assets } from "@/lib/assets";

import { useProgressSummary } from "./hooks";
import { comparableMetric, trendEmptyCopy } from "./presentation";

const chartConfig = {
  value: {
    label: "Logged value",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const detailedDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function ProgressView() {
  const summary = useProgressSummary();
  const [selectedMovementId, setSelectedMovementId] = React.useState<
    string | null
  >(null);

  const defaultMovementId = React.useMemo(() => {
    if (!summary.data) return null;
    return (
      summary.data.movements
        .toSorted((left, right) => {
          const leftCount = comparableMetric(left)?.points.length ?? 0;
          const rightCount = comparableMetric(right)?.points.length ?? 0;
          return rightCount - leftCount;
        })[0]?.id ?? null
    );
  }, [summary.data]);
  const activeMovementId = selectedMovementId ?? defaultMovementId;
  const selectedMovement = summary.data?.movements.find(
    (movement) => movement.id === activeMovementId,
  );
  const metric = comparableMetric(selectedMovement);

  if (summary.isPending) {
    return (
      <div className="grid min-h-72 place-items-center text-foreground-soft">
        <Loader2 className="size-6 animate-spin" aria-label="Loading progress" />
      </div>
    );
  }

  if (summary.isError || !summary.data) {
    return (
      <DashboardEmptyState
        icon={<Activity className="size-5" />}
        title="Progress is unavailable."
        description="We could not load your training evidence. Try again in a moment."
      />
    );
  }

  const movementItems = summary.data.movements.map((movement) => ({
    value: movement.id,
    label: movement.name,
  }));
  const chartData =
    metric?.points.map((point) => ({
      ...point,
      dateLabel: dateFormatter.format(new Date(point.recorded_at)),
      detailedDate: detailedDateFormatter.format(new Date(point.recorded_at)),
    })) ?? [];

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <ConsistencyCard
          label="Workouts this week"
          value={summary.data.consistency.workouts_this_week}
          icon={<Dumbbell className="size-4" />}
        />
        <ConsistencyCard
          label="Active training days"
          value={summary.data.consistency.active_days_this_week}
          icon={<CalendarDays className="size-4" />}
        />
        <ConsistencyCard
          label="Sets logged"
          value={summary.data.consistency.sets_this_week}
          icon={<Activity className="size-4" />}
        />
      </div>

      <DashboardSection
        eyebrow="Performance trend"
        title="Compare like with like."
        description="One movement and one measurement at a time, using only sets attributed to you."
        stackAside
        aside={
          movementItems.length ? (
            <Select
              items={movementItems}
              value={activeMovementId}
              onValueChange={(value) => setSelectedMovementId(value ?? null)}
            >
              <SelectTrigger
                className="h-10 min-w-48 rounded-xl bg-background/65"
                aria-label="Movement"
              >
                <SelectValue placeholder="Choose movement" />
              </SelectTrigger>
              <SelectContent>
                {movementItems.map((movement) => (
                  <SelectItem key={movement.value} value={movement.value}>
                    {movement.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      >
        {!selectedMovement ? (
          <DashboardEmptyState
            title="No workouts logged yet."
            description="Log a self-performed set in Train to begin building trustworthy progress evidence."
            visual={
              <ThemedAsset
                asset={assets.emptyStates.noProgressData}
                alt=""
                width={176}
              />
            }
          />
        ) : chartData.length < 2 ? (
          <TrendEmptyState
            movementName={selectedMovement.name}
            metricLabel={metric?.label}
            unit={metric?.unit}
            value={chartData[0]?.value}
          />
        ) : (
          <div className="px-5 py-6 sm:px-7 sm:py-8">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-foreground-faint uppercase">
                  Metric
                </p>
                <p className="mt-1 text-lg font-medium">{metric?.label}</p>
              </div>
              <p className="text-xs text-foreground-faint">
                {chartData.length} comparable sets logged
              </p>
            </div>
            <ChartContainer
              config={chartConfig}
              className="h-[280px] w-full aspect-auto sm:h-[360px]"
            >
              <LineChart
                accessibilityLayer
                data={chartData}
                margin={{ top: 8, right: 10, left: -18, bottom: 0 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={24}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={metric?.measurement === "hold_seconds"}
                  domain={[0, "auto"]}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        payload[0]?.payload?.detailedDate ?? "Logged set"
                      }
                      formatter={(value) => (
                        <div className="flex min-w-36 items-center justify-between gap-4">
                          <span className="text-muted-foreground">
                            {metric?.label}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {Number(value).toLocaleString()} {metric?.unit}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--color-value)"
                  strokeWidth={2.5}
                  dot={{ fill: "var(--color-value)", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ChartContainer>
            <p className="mt-4 text-xs leading-5 text-foreground-faint">
              Values describe logged sets. Normal training sets are not claims of
              maximum ability.
            </p>
          </div>
        )}
      </DashboardSection>
    </div>
  );
}

function ConsistencyCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card size="sm" className="py-5">
      <CardHeader className="grid-cols-[1fr_auto] items-start gap-3">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className="mt-2 text-4xl tracking-[-0.05em] tabular-nums">
            {value}
          </CardTitle>
        </div>
        <span className="grid size-9 place-items-center rounded-xl bg-primary-light text-primary">
          {icon}
        </span>
      </CardHeader>
      <CardContent className="text-xs text-foreground-faint">
        Since Monday · self-attributed sets
      </CardContent>
    </Card>
  );
}

function TrendEmptyState({
  movementName,
  metricLabel,
  unit,
  value,
}: {
  movementName: string;
  metricLabel?: string;
  unit?: string;
  value?: number;
}) {
  const copy = trendEmptyCopy(movementName, value === undefined ? 0 : 1);
  return (
    <div className="grid min-h-80 place-items-center px-6 py-12 text-center">
      <div className="max-w-md">
        {value === undefined ? (
          <ThemedAsset
            asset={assets.emptyStates.noProgressData}
            alt=""
            width={176}
            className="mx-auto"
          />
        ) : (
          <div className="mx-auto grid size-24 place-items-center rounded-full border border-primary/20 bg-primary-light">
            <div>
              <p className="text-3xl font-medium tracking-tight tabular-nums">
                {value}
              </p>
              <p className="text-xs text-foreground-soft">{unit} logged</p>
            </div>
          </div>
        )}
        <p className="mt-5 text-xs font-medium tracking-wide text-primary uppercase">
          {metricLabel ?? "No comparable metric"}
        </p>
        <h3 className="mt-2 text-xl font-medium tracking-[-0.035em]">
          {copy.title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-foreground-soft">
          {copy.description}
        </p>
      </div>
    </div>
  );
}
