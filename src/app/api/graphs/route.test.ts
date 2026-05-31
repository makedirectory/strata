// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "os";
import path from "path";
import { promises as fs } from "fs";
import { randomUUID } from "crypto";

/**
 * API route handler tests for /api/graphs and /api/graphs/[id].
 *
 * The FileRepository resolves AWS_FLOW_DATA_DIR at module load, so we must set
 * a unique temp dir BEFORE importing any route module. The route modules and
 * repository are therefore pulled in via dynamic import() inside beforeAll,
 * after the env var is set.
 */

const TMP_DIR = path.join(os.tmpdir(), `aws-flow-route-test-${randomUUID()}`);

type CollectionRoute = typeof import("./route");
type IdRoute = typeof import("./[id]/route");

let collection: CollectionRoute;
let idRoute: IdRoute;

function jsonRequest(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/graphs", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A structurally-valid graph body with one resource and a valid relationship. */
function validGraphBody() {
  return {
    name: "My Architecture",
    description: "test graph",
    accounts: [],
    resources: [
      {
        id: "r1",
        serviceId: "ec2-instance",
        name: "web",
        config: {},
        source: "manual",
      },
      {
        id: "r2",
        serviceId: "rds",
        name: "db",
        config: {},
        source: "manual",
      },
    ],
    relationships: [{ id: "rel1", from: "r1", to: "r2", kind: "connects_to" }],
  };
}

beforeAll(async () => {
  process.env.AWS_FLOW_DATA_DIR = TMP_DIR;
  process.env.AWS_FLOW_REPOSITORY = "file";
  collection = await import("./route");
  idRoute = await import("./[id]/route");
});

afterAll(async () => {
  await fs.rm(TMP_DIR, { recursive: true, force: true });
});

describe("POST /api/graphs", () => {
  it("creates a graph and returns 201 with a server-assigned id", async () => {
    const res = await collection.POST(jsonRequest("POST", validGraphBody()));
    expect(res.status).toBe(201);
    const created = await res.json();
    // Server stamps a real UUID, not the empty placeholder id.
    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(created.id).not.toBe("");
    expect(created.name).toBe("My Architecture");
    expect(created.schemaVersion).toBe(1);
    expect(created.createdAt).toBeTruthy();
    expect(created.updatedAt).toBeTruthy();
    expect(created.resources).toHaveLength(2);
  });

  it("defaults the name when none is provided", async () => {
    const body = validGraphBody();
    // @ts-expect-error intentionally drop name to exercise the default
    delete body.name;
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.name).toBe("Untitled Architecture");
  });

  it("rejects a non-object body with 422", async () => {
    const res = await collection.POST(jsonRequest("POST", [1, 2, 3]));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/object body/i);
  });

  it("rejects a string body with 422", async () => {
    const res = await collection.POST(jsonRequest("POST", "not an object"));
    expect(res.status).toBe(422);
  });

  it("rejects invalid JSON with 400", async () => {
    const req = new Request("http://localhost/api/graphs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    const res = await collection.POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a dangling relationship with 422 and details", async () => {
    const body = validGraphBody();
    body.relationships = [{ id: "rel1", from: "r1", to: "missing", kind: "connects_to" }];
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid graph");
    expect(Array.isArray(json.details)).toBe(true);
    expect(json.details.join(" ")).toMatch(/missing to missing/);
  });

  it("rejects an invalid relationship kind with 422 and details", async () => {
    const body = validGraphBody();
    body.relationships = [{ id: "rel1", from: "r1", to: "r2", kind: "connects-to" }];
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid graph");
    expect(json.details.join(" ")).toMatch(/invalid kind connects-to/i);
  });

  it("rejects a non-array collection (e.g. resources: string) with 422", async () => {
    const body = validGraphBody();
    // @ts-expect-error intentionally supply a wrong-typed collection
    body.resources = "x";
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/resources must be an array/i);
  });

  it("rejects an oversized collection with 413", async () => {
    const body = validGraphBody();
    body.resources = [];
    body.relationships = [];
    for (let i = 0; i < 10_001; i++) {
      body.resources.push({
        id: `r${i}`,
        serviceId: "ec2",
        name: `n${i}`,
        config: {},
        source: "manual",
      });
    }
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toMatch(/exceeds the maximum/i);
  });
});

describe("GET /api/graphs (list)", () => {
  it("returns { graphs: [...] } with summary shape", async () => {
    // Ensure at least one graph exists.
    await collection.POST(jsonRequest("POST", validGraphBody()));
    const res = await collection.GET(jsonRequest("GET"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty("graphs");
    expect(Array.isArray(json.graphs)).toBe(true);
    expect(json.graphs.length).toBeGreaterThan(0);
    const summary = json.graphs[0];
    expect(summary).toHaveProperty("id");
    expect(summary).toHaveProperty("name");
    expect(summary).toHaveProperty("resourceCount");
    // Summaries are lightweight: no full resources array.
    expect(summary).not.toHaveProperty("resources");
  });
});

describe("GET /api/graphs/[id]", () => {
  it("returns the full graph when found", async () => {
    const createRes = await collection.POST(jsonRequest("POST", validGraphBody()));
    const created = await createRes.json();

    const res = await idRoute.GET(jsonRequest("GET"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const fetched = await res.json();
    expect(fetched.id).toBe(created.id);
    expect(fetched.resources).toHaveLength(2);
    expect(fetched.relationships).toHaveLength(1);
  });

  it("returns 404 for an unknown (well-formed) id", async () => {
    const res = await idRoute.GET(jsonRequest("GET"), {
      params: Promise.resolve({ id: randomUUID() }),
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Not found");
  });
});

describe("PUT /api/graphs/[id]", () => {
  it("updates an existing graph", async () => {
    const createRes = await collection.POST(jsonRequest("POST", validGraphBody()));
    const created = await createRes.json();

    const updateBody = validGraphBody();
    updateBody.name = "Renamed Architecture";
    updateBody.resources = [updateBody.resources[0]];
    updateBody.relationships = [];

    const res = await idRoute.PUT(jsonRequest("PUT", updateBody), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Renamed Architecture");
    expect(updated.resources).toHaveLength(1);
    // createdAt preserved, updatedAt re-stamped.
    expect(updated.createdAt).toBe(created.createdAt);
  });

  it("returns 404 when updating an unknown id", async () => {
    const res = await idRoute.PUT(jsonRequest("PUT", validGraphBody()), {
      params: Promise.resolve({ id: randomUUID() }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a body missing required collections with 422", async () => {
    const res = await idRoute.PUT(jsonRequest("PUT", { name: "no arrays" }), {
      params: Promise.resolve({ id: randomUUID() }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toMatch(/missing required fields/i);
  });

  it("rejects a dangling relationship with 422", async () => {
    const createRes = await collection.POST(jsonRequest("POST", validGraphBody()));
    const created = await createRes.json();

    const body = validGraphBody();
    body.relationships = [{ id: "relX", from: "ghost", to: "r2", kind: "connects_to" }];
    const res = await idRoute.PUT(jsonRequest("PUT", body), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid graph");
    expect(json.details.join(" ")).toMatch(/missing from ghost/);
  });
});

describe("DELETE /api/graphs/[id]", () => {
  it("deletes a graph, then GET returns 404", async () => {
    const createRes = await collection.POST(jsonRequest("POST", validGraphBody()));
    const created = await createRes.json();

    const delRes = await idRoute.DELETE(jsonRequest("DELETE"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(delRes.status).toBe(200);
    const delJson = await delRes.json();
    expect(delJson.ok).toBe(true);

    const getRes = await idRoute.GET(jsonRequest("GET"), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(getRes.status).toBe(404);
  });

  it("returns 404 when deleting an unknown id", async () => {
    const res = await idRoute.DELETE(jsonRequest("DELETE"), {
      params: Promise.resolve({ id: randomUUID() }),
    });
    expect(res.status).toBe(404);
  });
});

describe("malformed ids are handled gracefully (no 500)", () => {
  // A non-UUID id makes the repository throw internally; the routes must surface
  // a clean 404 rather than an unhandled 500 leaking internals.
  const badId = "../../etc/passwd";

  it("GET returns 404 for a malformed id", async () => {
    const res = await idRoute.GET(jsonRequest("GET"), { params: Promise.resolve({ id: badId }) });
    expect(res.status).toBe(404);
  });

  it("PUT returns 404 for a malformed id", async () => {
    const res = await idRoute.PUT(jsonRequest("PUT", validGraphBody()), {
      params: Promise.resolve({ id: badId }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE returns 404 for a malformed id", async () => {
    const res = await idRoute.DELETE(jsonRequest("DELETE"), {
      params: Promise.resolve({ id: badId }),
    });
    expect(res.status).toBe(404);
  });
});

describe("optional-field and element validation (422)", () => {
  it("POST rejects a non-string description with 422", async () => {
    const body = { ...validGraphBody(), description: 123 };
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/description must be a string/i);
  });

  it("POST rejects a non-object viewport with 422", async () => {
    const body = { ...validGraphBody(), viewport: "nope" };
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/viewport must be an object/i);
  });

  it("POST rejects a primitive resource element with 422", async () => {
    const body = { ...validGraphBody(), resources: [42], relationships: [] };
    const res = await collection.POST(jsonRequest("POST", body));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("Invalid graph");
    expect(json.details.join(" ")).toMatch(/not a valid resource object/i);
  });

  it("PUT rejects a primitive relationship element with 422", async () => {
    const createRes = await collection.POST(jsonRequest("POST", validGraphBody()));
    const created = await createRes.json();
    const body = { ...validGraphBody(), relationships: ["x"] };
    const res = await idRoute.PUT(jsonRequest("PUT", body), {
      params: Promise.resolve({ id: created.id }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).details.join(" ")).toMatch(/not a valid relationship object/i);
  });
});

describe("optional bearer-token auth (AWS_FLOW_API_TOKEN)", () => {
  const TOKEN = "secret-token";

  function authedRequest(method: string, token?: string, body?: unknown): Request {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["authorization"] = `Bearer ${token}`;
    return new Request("http://localhost/api/graphs", {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  afterAll(() => {
    delete process.env.AWS_FLOW_API_TOKEN;
  });

  it("rejects requests with no/incorrect token (401) and allows the correct one", async () => {
    process.env.AWS_FLOW_API_TOKEN = TOKEN;

    // No header → 401.
    const noAuth = await collection.GET(authedRequest("GET"));
    expect(noAuth.status).toBe(401);

    // Wrong token → 401.
    const wrong = await collection.GET(authedRequest("GET", "nope"));
    expect(wrong.status).toBe(401);

    // POST without token → 401 (before any body parsing/validation).
    const postNoAuth = await collection.POST(authedRequest("POST", undefined, validGraphBody()));
    expect(postNoAuth.status).toBe(401);

    // Correct token → allowed.
    const ok = await collection.GET(authedRequest("GET", TOKEN));
    expect(ok.status).toBe(200);
  });

  it("accepts a case-insensitive Bearer scheme with the correct token", async () => {
    process.env.AWS_FLOW_API_TOKEN = TOKEN;
    const req = new Request("http://localhost/api/graphs", {
      method: "GET",
      headers: { authorization: `bearer ${TOKEN}` },
    });
    const res = await collection.GET(req);
    expect(res.status).toBe(200);
  });

  it("is a no-op when the env var is unset (behaviour unchanged)", async () => {
    delete process.env.AWS_FLOW_API_TOKEN;
    const res = await collection.GET(authedRequest("GET"));
    expect(res.status).toBe(200);
  });
});
