/** Commonly used AWS regions. Extend freely — not exhaustive. */
import type { RegionRef } from "./model";

export const REGIONS: readonly RegionRef[] = [
  { code: "us-east-1", name: "US East (N. Virginia)" },
  { code: "us-east-2", name: "US East (Ohio)" },
  { code: "us-west-1", name: "US West (N. California)" },
  { code: "us-west-2", name: "US West (Oregon)" },
  { code: "ca-central-1", name: "Canada (Central)" },
  { code: "eu-west-1", name: "Europe (Ireland)" },
  { code: "eu-west-2", name: "Europe (London)" },
  { code: "eu-central-1", name: "Europe (Frankfurt)" },
  { code: "eu-north-1", name: "Europe (Stockholm)" },
  { code: "ap-south-1", name: "Asia Pacific (Mumbai)" },
  { code: "ap-southeast-1", name: "Asia Pacific (Singapore)" },
  { code: "ap-southeast-2", name: "Asia Pacific (Sydney)" },
  { code: "ap-northeast-1", name: "Asia Pacific (Tokyo)" },
  { code: "sa-east-1", name: "South America (São Paulo)" },
];

export function regionName(code: string): string {
  return REGIONS.find((r) => r.code === code)?.name ?? code;
}
