# Observability Constraints

Principles: P4 (Observable Architecture), P11 (Cost-Aware), P12 (Auditability), P13 (Resilient Under Load)

## Mutation Audit Trail

Every write operation must be traceable:
- **Who** requested it (user, agent, system)
- **When** it occurred (ISO 8601 timestamp)
- **What** changed (before/after or diff)
- **Why** it happened (context, trigger, reason)

Audit trails are not a compliance afterthought — they enable the system to observe and improve itself.

## Cost Tracking

External API calls must be tracked:
- Count calls per operation type
- Track latency per external service
- Monitor batch sizes and cache hit rates
- Alert on cost anomalies

Caching and deduplication are requirements, not optimizations.

## Performance Envelopes

The system should know and communicate its limits:
- Define batch size caps with clear error messages
- Set timeout budgets for external calls
- Pre-warm expensive resources at startup (not on first request)
- Surface capacity warnings before hitting hard limits

## Structured Logging

- Use structured logger (not console.log/print)
- Include correlation IDs for request tracing
- Log at appropriate levels: error (broken), warn (degraded), info (lifecycle), debug (diagnostic)
- Never log secrets, tokens, PII, or credentials
- Log errors with context: what failed, what was attempted, what the caller should do

## Health Signals

- Expose health check endpoints
- Report dependency status (database, external APIs)
- Distinguish between "healthy", "degraded", and "unhealthy"
- Include uptime, last successful operation, error counts
