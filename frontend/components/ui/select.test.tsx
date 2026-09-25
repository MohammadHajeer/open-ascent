import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./select";

afterEach(cleanup);

describe("Select", () => {
  it("shows the selected item's label, not its raw value, when closed", () => {
    render(
      <Select value="all">
        <SelectTrigger aria-label="Filter role">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All roles</SelectItem>
          <SelectItem value="athlete">Athletes</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(screen.getByRole("combobox", { name: "Filter role" }).textContent).toContain("All roles");
  });

  it("finds items nested in groups", () => {
    render(
      <Select value="pro">
        <SelectTrigger aria-label="Plan">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="free">Free plan</SelectItem>
            <SelectItem value="pro">Pro plan</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );

    expect(screen.getByRole("combobox", { name: "Plan" }).textContent).toContain("Pro plan");
  });

  it("lets explicit items take precedence", () => {
    render(
      <Select value="a" items={[{ value: "a", label: "Explicit label" }]}>
        <SelectTrigger aria-label="Choice">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">Child label</SelectItem>
        </SelectContent>
      </Select>,
    );

    expect(screen.getByRole("combobox", { name: "Choice" }).textContent).toContain("Explicit label");
  });
});
