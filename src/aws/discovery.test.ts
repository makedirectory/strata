import { describe, it, expect } from "vitest";
import { getServiceByCfnType } from "./registry";
import { mapDiscoveredToGraph } from "./mcp";
import {
  listDiscoverableTypes,
  normalizeRecords,
  parsePastedExport,
  discoverWithClient,
  type CloudControlLike,
} from "./discovery";

describe("discovery — listDiscoverableTypes", () => {
  it("returns registry-backed types that resolve to their canonical service", () => {
    const types = listDiscoverableTypes();
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) {
      // Every offered type must resolve, and to the service it claims.
      expect(getServiceByCfnType(t.cfnType)?.id).toBe(t.serviceId);
    }
    // No duplicate cfnTypes (variants collapse to the canonical winner).
    const seen = new Set(types.map((t) => t.cfnType));
    expect(seen.size).toBe(types.length);
  });
});

describe("discovery — normalizeRecords", () => {
  it("normalises lenient + Cloud Control records and feeds mapDiscoveredToGraph", () => {
    const records = [
      // Cloud Control shape: TypeName + Identifier + Properties (JSON string).
      {
        TypeName: "AWS::S3::Bucket",
        Identifier: "arn:aws:s3:::assets",
        Properties: JSON.stringify({ Name: "assets" }),
      },
      // Strata-native shape.
      { resourceType: "AWS::Lambda::Function", arn: "arn:fn", name: "worker", properties: {} },
    ];
    const discovered = normalizeRecords(records);
    expect(discovered).toHaveLength(2);
    expect(discovered[0]).toMatchObject({
      resourceType: "AWS::S3::Bucket",
      arn: "arn:aws:s3:::assets",
    });

    const graph = mapDiscoveredToGraph(discovered);
    expect(graph.resources.map((r) => r.serviceId).sort()).toEqual(["lambda", "s3-bucket"]);
  });

  it("drops records without a resolvable type", () => {
    expect(
      normalizeRecords([{ foo: "bar" }, null, 42, { TypeName: "AWS::S3::Bucket" }]),
    ).toHaveLength(1);
  });

  it("CREDENTIAL SAFETY: stray secret-like properties never reach the graph config", () => {
    const discovered = normalizeRecords([
      {
        TypeName: "AWS::S3::Bucket",
        Identifier: "arn:aws:s3:::secretive",
        Properties: JSON.stringify({
          Name: "secretive",
          SecretAccessKey: "AKIA-leaked",
          Token: "x",
        }),
      },
    ]);
    const graph = mapDiscoveredToGraph(discovered);
    const config = graph.resources[0].config;
    // The graph keeps only registry-known config keys — secrets are filtered out.
    expect(JSON.stringify(config)).not.toContain("AKIA-leaked");
    expect(config).not.toHaveProperty("SecretAccessKey");
    expect(config).not.toHaveProperty("Token");
  });
});

describe("discovery — parsePastedExport", () => {
  it("parses a Cloud Control list-resources object", () => {
    const text = JSON.stringify({
      TypeName: "AWS::S3::Bucket",
      ResourceDescriptions: [
        { Identifier: "a", Properties: JSON.stringify({ Name: "a" }) },
        { Identifier: "b", Properties: JSON.stringify({ Name: "b" }) },
      ],
    });
    const out = parsePastedExport(text);
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.resourceType === "AWS::S3::Bucket")).toBe(true);
  });

  it("parses a bare array and throws on invalid JSON / unknown shapes", () => {
    expect(parsePastedExport('[{ "resourceType": "AWS::SQS::Queue", "arn": "q" }]')).toHaveLength(
      1,
    );
    expect(parsePastedExport("")).toEqual([]);
    expect(() => parsePastedExport("not json")).toThrow(/valid JSON/);
    expect(() => parsePastedExport('{ "nope": 1 }')).toThrow(/Unrecognised/);
  });
});

describe("discovery — discoverWithClient (fixtures, no live AWS)", () => {
  /** A fake Cloud Control client driven by an in-memory fixture. */
  const fakeClient = (
    fixture: Record<string, { identifier: string; properties: string }[]>,
  ): CloudControlLike => ({
    async listResources(typeName) {
      if (typeName === "AWS::EC2::Boom") throw new Error("AccessDenied");
      return fixture[typeName] ?? [];
    },
  });

  it("scans each requested type, records counts, and continues past per-type failures", async () => {
    const client = fakeClient({
      "AWS::S3::Bucket": [
        { identifier: "arn:s3:one", properties: JSON.stringify({ Name: "one" }) },
      ],
      "AWS::Lambda::Function": [
        { identifier: "arn:fn:a", properties: JSON.stringify({ Name: "a" }) },
        { identifier: "arn:fn:b", properties: JSON.stringify({ Name: "b" }) },
      ],
    });
    const result = await discoverWithClient(client, {
      region: "us-east-1",
      types: ["AWS::S3::Bucket", "AWS::Lambda::Function", "AWS::EC2::Boom"],
    });

    expect(result.resources).toHaveLength(3);
    expect(result.resources.every((r) => r.region === "us-east-1")).toBe(true);
    // Every attempted type is reported (no silent caps), including the failed one.
    expect(result.scanned).toEqual([
      { type: "AWS::S3::Bucket", count: 1 },
      { type: "AWS::Lambda::Function", count: 2 },
      { type: "AWS::EC2::Boom", count: 0 },
    ]);
    expect(result.warnings.some((w) => w.includes("AWS::EC2::Boom"))).toBe(true);

    // End-to-end: the producer's output renders through the existing transform.
    const graph = mapDiscoveredToGraph(result.resources);
    expect(graph.resources).toHaveLength(3);
  });
});
