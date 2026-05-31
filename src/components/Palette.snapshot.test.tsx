import { describe, it, expect } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { Palette } from "./Palette";

/**
 * DOM snapshots for the Palette. Because the Palette is rendered purely from the
 * registry, its markup is a faithful projection of the catalog: a snapshot diff
 * here surfaces both UI regressions and unintended registry changes (added /
 * removed / renamed services, re-grouped categories).
 *
 * Re-record intentional changes with `npm run test:update`.
 */
describe("Palette DOM snapshots", () => {
  it("renders the full registry-driven palette", () => {
    const { asFragment } = render(<Palette />);
    expect(asFragment()).toMatchSnapshot();
  });

  it("renders the filtered view for a keyword query", () => {
    const { asFragment } = render(<Palette />);
    fireEvent.change(screen.getByPlaceholderText("Search services…"), {
      target: { value: "serverless" },
    });
    expect(asFragment()).toMatchSnapshot();
  });

  it("renders the empty state when nothing matches", () => {
    const { asFragment } = render(<Palette />);
    fireEvent.change(screen.getByPlaceholderText("Search services…"), {
      target: { value: "zzzz-no-such-service" },
    });
    expect(asFragment()).toMatchSnapshot();
  });
});
