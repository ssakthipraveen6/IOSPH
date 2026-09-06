# Contributing to Project Sentinel

Thank you for contributing to Project Sentinel. As a mission-critical BFSI observability platform deployed across enterprise Windows Server infrastructure, all code contributions must comply with our engineering, security, and architectural standards.

---

## 1. Branch Naming Standards

All development branches must follow the standard enterprise naming scheme:

| Branch Type | Format Pattern | Example |
|---|---|---|
| **Feature** | `feature/<ticket>-<short-desc>` | `feature/OBS-420-kafka-collector` |
| **Bug Fix** | `bugfix/<ticket>-<short-desc>` | `bugfix/OBS-512-wal-lag-calculation` |
| **Security / Hotfix** | `sec/<ticket>-<short-desc>` | `sec/SEC-104-cert-rotation-remediation` |
| **Release** | `release/v<version>` | `release/v2.4.0` |

---

## 2. Commit Message Guidelines

We enforce the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body describing technical rationale and architectural context]

[optional footer(s), e.g. Resolves: OBS-420]
```

### Allowed Types
- `feat`: New feature or telemetry signal
- `fix`: Bug fix or persistence degradation correction
- `refactor`: Structural reorganization without functional behavioral change
- `sec`: Security enhancement, token encryption, or CyberArk rotation
- `perf`: Performance optimization (e.g. concurrency limiting, query batching)
- `test`: Addition or modification of regression test suites
- `docs`: Architecture, runbook, or API documentation
- `chore`: Dependency updates, tooling, or build configuration

---

## 3. Pull Request & Review Process

1. **CODEOWNERS Approval**: Every PR touching a path specified in [`CODEOWNERS`](file:///c:/Users/sspra/OneDrive/Desktop/iosph2/sentinel-webdesign/CODEOWNERS) requires sign-off from the designated squad before merge.
2. **Quality Gates Mandatory Pass**:
   - `npm run lint` (constants and syntax verification)
   - `npm test` (all 11 automated QA suites)
   - `npm run build` (clean Vite client compilation)
3. **No Unshared Literals**: Severity and status literals must be imported from `@sentinel/shared-constants`.
4. **Data-Integrity Verification**: Any modification touching persistence, audit logs, or telemetry routing must preserve fail-open safety and audit monotonicity.

---

## 4. Local Development Workflow (Windows Server)

```powershell
# Ensure correct Node runtime
nvm use

# Install workspace dependencies
npm install

# Run backend daemon & Vite frontend concurrently
npm run dev

# Run quality checks before committing
npm run lint
npm test
npm run build
```
