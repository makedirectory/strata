import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { Palette } from "./Palette";

/**
 * The Palette is a self-contained, registry-driven component: it depends only
 * on React local state and the pure registry helpers (no FlowProvider needed).
 * These smoke tests verify it renders the registry, groups by category, and
 * filters via the search box.
 */
describe("Palette", () => {
  it("renders the search input", () => {
    render(<Palette />);
    expect(screen.getByPlaceholderText("Search services…")).toBeInTheDocument();
  });

  it("renders category section headers", () => {
    render(<Palette />);
    // Category headers come from CATEGORIES metadata.
    expect(screen.getByText("Networking & Content Delivery")).toBeInTheDocument();
    expect(screen.getByText("Compute")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
  });

  it("renders known services from the registry", () => {
    render(<Palette />);
    // Service display names from the catalogs.
    expect(screen.getAllByText("VPC").length).toBeGreaterThan(0);
    expect(screen.getByText("Lambda")).toBeInTheDocument();
    expect(screen.getByText("S3")).toBeInTheDocument();
  });

  it("filters the list when typing a query", () => {
    render(<Palette />);
    const input = screen.getByPlaceholderText("Search services…");

    // Sanity: Lambda is visible before filtering.
    expect(screen.queryByText("Lambda")).toBeInTheDocument();

    // "serverless" is a keyword unique to the Lambda service.
    fireEvent.change(input, { target: { value: "serverless" } });

    // Lambda should still show; unrelated services should be filtered out.
    expect(screen.getByText("Lambda")).toBeInTheDocument();
    expect(screen.queryByText("VPC")).not.toBeInTheDocument();
    expect(screen.queryByText("S3")).not.toBeInTheDocument();

    // Only the Compute category section header should remain (Lambda lives there).
    expect(screen.getByText("Compute")).toBeInTheDocument();
    expect(screen.queryByText("Storage")).not.toBeInTheDocument();
    expect(screen.queryByText("Networking & Content Delivery")).not.toBeInTheDocument();
  });

  it("matches services by keyword, not just display name", () => {
    render(<Palette />);
    const input = screen.getByPlaceholderText("Search services…");

    // "object" is a keyword on the S3 service but not in its display name.
    fireEvent.change(input, { target: { value: "object" } });

    expect(screen.getByText("S3")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.queryByText("Lambda")).not.toBeInTheDocument();
  });

  it("shows an empty-state message when nothing matches", () => {
    render(<Palette />);
    const input = screen.getByPlaceholderText("Search services…");

    fireEvent.change(input, { target: { value: "zzzz-no-such-service" } });

    expect(screen.getByText(/No services match/)).toBeInTheDocument();
    // No category headers should be present in the empty state.
    expect(screen.queryByText("Compute")).not.toBeInTheDocument();
  });

  it("clearing the query restores the full list", () => {
    render(<Palette />);
    const input = screen.getByPlaceholderText("Search services…");

    fireEvent.change(input, { target: { value: "serverless" } });
    expect(screen.queryByText("S3")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("S3")).toBeInTheDocument();
    expect(screen.getAllByText("VPC").length).toBeGreaterThan(0);
  });

  it("renders service items as draggable with the correct drag payload", () => {
    render(<Palette />);

    // The Lambda item carries serviceId 'lambda' in its dragstart dataTransfer.
    const lambda = screen.getByText("Lambda").closest(".item") as HTMLElement;
    expect(lambda).not.toBeNull();
    expect(lambda).toHaveAttribute("draggable");

    let payload = "";
    const dataTransfer = {
      setData: (_type: string, data: string) => {
        payload = data;
      },
    };
    fireEvent.dragStart(lambda, { dataTransfer });
    expect(JSON.parse(payload)).toEqual({ serviceId: "lambda" });
  });

  it("disables service items and dispatches no add event in read-only mode", () => {
    const events: Event[] = [];
    const listener = (e: Event) => events.push(e);
    window.addEventListener("palette:add-service", listener);
    try {
      render(<Palette readOnly />);
      const lambda = screen.getByText("Lambda").closest(".item") as HTMLButtonElement;
      expect(lambda).toBeDisabled();
      expect(lambda).not.toHaveAttribute("draggable", "true");
      // A click on a disabled button fires nothing; assert no add event regardless.
      fireEvent.click(lambda);
      expect(events).toHaveLength(0);
    } finally {
      window.removeEventListener("palette:add-service", listener);
    }
  });

  it("groups services under their category section", () => {
    render(<Palette />);
    const storageHeader = screen.getByText("Storage");
    const section = storageHeader.closest(".palette-section") as HTMLElement;
    expect(section).not.toBeNull();
    // S3 should live inside the Storage section, not elsewhere.
    expect(within(section).getByText("S3")).toBeInTheDocument();
  });
});
