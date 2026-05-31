/**
 * Persistence abstraction.
 * ------------------------
 * The application talks to a `Repository`, never to a concrete store. Today the
 * default is a file-backed local store (zero infra); swapping to Postgres/RDS
 * or DynamoDB is a matter of implementing this interface — see
 * `ARCHITECTURE.md` ("Persistence & the server side").
 */
import type { InfrastructureGraph, GraphSummary } from "../aws/model";

export interface Repository {
  list(): Promise<GraphSummary[]>;
  get(id: string): Promise<InfrastructureGraph | null>;
  /** Persists a new graph, assigning id + timestamps. */
  create(graph: InfrastructureGraph): Promise<InfrastructureGraph>;
  /** Replaces an existing graph; returns null if it does not exist. */
  update(id: string, graph: InfrastructureGraph): Promise<InfrastructureGraph | null>;
  remove(id: string): Promise<boolean>;
}
