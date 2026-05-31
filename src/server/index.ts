/**
 * Repository selection.
 * The active store is chosen by the `AWS_FLOW_REPOSITORY` env var, read once
 * and cached as a process-wide singleton. New backends (Postgres/RDS,
 * DynamoDB) plug in here without touching callers.
 *
 * NOTE: the env var is resolved on first access and the instance is memoized,
 * so `AWS_FLOW_REPOSITORY` must be set before the first request. To switch
 * backends at runtime (e.g. between tests), call `resetRepository()`.
 */
import type { Repository } from "./repository";
import { FileRepository } from "./fileRepository";

let instance: Repository | null = null;

export function getRepository(): Repository {
  if (instance) return instance;
  const kind = process.env.AWS_FLOW_REPOSITORY ?? "file";
  switch (kind) {
    // case "postgres": instance = new PostgresRepository(); break;
    // case "dynamodb": instance = new DynamoRepository(); break;
    case "file":
    default:
      instance = new FileRepository();
      break;
  }
  return instance;
}

/**
 * Clear the memoized repository so the next `getRepository()` call re-reads
 * `AWS_FLOW_REPOSITORY` and constructs a fresh instance. Intended for tests /
 * dev that need to switch backends; not used on the production path.
 */
export function resetRepository(): void {
  instance = null;
}
