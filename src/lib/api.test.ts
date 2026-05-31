// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { listGraphs, getGraph, createGraph, updateGraph, deleteGraph } from "./api";
import type { InfrastructureGraph } from "../aws/model";

/** A minimal, shape-valid persisted graph as the API would return it. */
function graph(over: Partial<InfrastructureGraph> = {}): InfrastructureGraph {
  return {
    id: "g1",
    name: "Env",
    accounts: [],
    resources: [],
    relationships: [],
    schemaVersion: 1,
    ...over,
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listGraphs", () => {
  it("returns the graphs array from { graphs: [...] }", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ graphs: [{ id: "a" }, { id: "b" }] }));
    const out = await listGraphs();
    expect(out.map((g) => g.id)).toEqual(["a", "b"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/graphs");
  });

  it("throws on an unexpected response shape", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ not: "graphs" }));
    await expect(listGraphs()).rejects.toThrow(/unexpected response shape/i);
  });
});

describe("getGraph", () => {
  it("encodes the id in the URL and returns the graph", async () => {
    fetchMock.mockResolvedValue(jsonResponse(graph({ id: "a b/c" })));
    const out = await getGraph("a b/c");
    expect(out.id).toBe("a b/c");
    expect(fetchMock).toHaveBeenCalledWith("/api/graphs/a%20b%2Fc");
  });

  it("throws the server-provided error message on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Not found" }, { status: 404 }));
    await expect(getGraph("missing")).rejects.toThrow("Not found");
  });

  it("throws on a malformed (wrong-shape) graph body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "a" })); // missing required fields
    await expect(getGraph("a")).rejects.toThrow(/unexpected response shape/i);
  });

  it("falls back to status text when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("boom", { status: 500, statusText: "Server Error" }));
    await expect(getGraph("a")).rejects.toThrow("Server Error");
  });
});

describe("createGraph / updateGraph", () => {
  it("POSTs the graph and returns the persisted entity", async () => {
    fetchMock.mockResolvedValue(jsonResponse(graph({ id: "new" }), { status: 201 }));
    const out = await createGraph(graph());
    expect(out.id).toBe("new");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/graphs");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ name: "Env" });
  });

  it("PUTs to the encoded id URL", async () => {
    fetchMock.mockResolvedValue(jsonResponse(graph({ id: "x/y" })));
    await updateGraph("x/y", graph({ id: "x/y" }));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/graphs/x%2Fy");
    expect(init).toMatchObject({ method: "PUT" });
  });
});

describe("deleteGraph", () => {
  it("resolves on a 200 ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    await expect(deleteGraph("a")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/graphs/a");
    expect(init).toMatchObject({ method: "DELETE" });
  });

  it("throws the server error on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Not found" }, { status: 404 }));
    await expect(deleteGraph("a")).rejects.toThrow("Not found");
  });
});
