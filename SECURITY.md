# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through
[GitHub Security Advisories](https://github.com/jbcom/persistence-drizzle/security/advisories/new), which lets us
discuss and fix the issue before it is disclosed.

You can expect an acknowledgement within a few days. If a fix is warranted, we will prepare it privately, publish a
patched release, and credit you in the advisory unless you would rather remain anonymous.

## Supported versions

The latest `0.x` release receives security fixes. Older pre-1.0 releases are not patched unless a coordinated
disclosure requires an exceptional backport.

## In scope

Examples include hostile envelope or preference text that escapes the bounded reader (prototype pollution, unbounded
memory), a way to run a statement outside the lock or inside another writer's transaction, package supply-chain issues,
and unexpected code execution during install or build. Application authorization and the contents of a user's save are
outside this repository's security boundary.
