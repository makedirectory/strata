# Security Policy

Thanks for helping keep Strata and its users safe.

## Supported versions

Strata is pre-1.0 and ships from `main`. Security fixes land on the latest
release line only; please make sure you can reproduce an issue against the
current code before reporting.

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Instead, report privately via a GitHub draft security advisory:

- <https://github.com/makedirectory/aws-flow-builder/security/advisories/new>

If you cannot use GitHub advisories, you can email the maintainers at
**andrew@mk-dir.com**.

Please include enough detail to reproduce — affected version/commit, steps,
impact, and any proof-of-concept. We will acknowledge your report, keep you
updated on remediation, and coordinate disclosure timing with you. We respect
the privacy and security of reporters and will credit you if you wish.

## Security model: live discovery & AWS credentials

Strata's **Connect to AWS → Live scan** flow runs server-side and is the only
place the AWS SDK is used (`src/app/api/discover/route.ts`). Its credential
handling is deliberately constrained:

- **Per-request, in-memory only.** When you supply AWS credentials
  (access key ID / secret access key / optional session token), they are used to
  build a client for that single scan and then discarded. They are **never**
  written to disk, logged, returned in a response, or saved into a diagram.
- **No secrets reach the model.** The response carries only non-sensitive
  resource descriptions (type, identifier, properties, region), and the
  normalising/graph layers keep only registry-known config — so a stray secret
  property cannot leak into a saved graph.
- **Generic error messages.** Credential/permission failures are reported with a
  safe, generic message; SDK internals and credentials are never echoed back.

### Recommendations

- **Use temporary, read-only credentials.** Prefer short-lived session
  credentials (e.g. `aws sts get-session-token`) or an assumed role scoped to
  `ReadOnlyAccess`. Discovery only needs `cloudcontrol:ListResources`.
- **Set `NEXT_PUBLIC_STRATA_HOSTED=1` on any shared/hosted deployment** (at both
  build and runtime). This disables the ambient default-credential fallback, so a
  visitor can never scan the operator's account — each user must bring their own
  credentials, and a scan without them is rejected. The credential-free
  **Paste export** tab remains available either way.
- **Terminate TLS in front of hosted deployments.** Credentials entered in the
  modal are sent to the server in the request body, so a hosted instance must be
  served over **HTTPS**. A single-user local run on `localhost` does not transit
  the network.
- **Protect the graph API in shared deployments.** Set `AWS_FLOW_API_TOKEN` to
  require an `Authorization: Bearer <token>` header on the graph routes
  (`src/server/auth.ts`).
