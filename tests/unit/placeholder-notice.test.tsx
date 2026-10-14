import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlaceholderNotice } from "@/components/shared/placeholder-notice";

describe("PlaceholderNotice", () => {
  it("labels unfinished areas so sample content is not mistaken for real data", () => {
    render(<PlaceholderNotice feature="reports" />);
    expect(screen.getByRole("note")).toHaveTextContent("Preview — reports is in development.");
  });
});
