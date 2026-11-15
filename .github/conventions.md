# GitLaw Team Conventions

*Automatically mined from past code reviews and reinforced on new pull requests.*

**Total Active Conventions:** 3

---

## ERROR-HANDLING

### Use Result/Either type instead of throwing raw exceptions in domain services (ERROR)

**ID:** `use-result-type-for-errors` | **Confidence:** 95% | **Occurrences:** 4

Domain services must return Result<T, E> rather than throwing raw Error instances to force explicit error handling by callers.

**Guidelines:**
- Do not throw Error in service methods
- Return Result.ok(data) or Result.fail(error)
- Handle errors explicitly at controller or route boundaries

**Applies to files:** `**/*.service.ts, src/domain/**/*.ts`

**Preferred pattern:**
```
return Result.ok(user);
return Result.fail(new NotFoundError('User not found'));
```

**Anti-pattern to avoid:**
```
throw new Error('User not found');
```

**Past Review Evidence:**
- PR #104 by @tech-lead: *"Please do not throw raw Error here; return Result.fail so caller is forced to handle it...."*
- PR #118 by @senior-arch: *"Convention reminder: all methods in *.service.ts must return Result<T, DomainError> instead of throwing...."*

---

## PERFORMANCE

### Always add index on foreign key columns in database migrations (WARNING)

**ID:** `always-specify-table-indexes-in-migrations` | **Confidence:** 92% | **Occurrences:** 3

Every foreign key column must have an explicit index defined to avoid full table scans during joins and delete cascades.

**Guidelines:**
- Define an index on every foreign key column
- Follow naming convention idx_<table_name>_<column_name>

**Applies to files:** `**/migrations/**/*.ts, **/migrations/**/*.sql`

**Preferred pattern:**
```
table.index(['organization_id', 'created_at'], 'idx_memberships_org_created');
```

**Anti-pattern to avoid:**
```
table.integer('organization_id').references('id').inTable('organizations'); // missing index
```

**Past Review Evidence:**
- PR #89 by @dba-lead: *"Missing index on organization_id. FK columns must always have an explicit index in migrations...."*

---

## ARCHITECTURE

### Use structured logger instead of console.log/console.error in application code (WARNING)

**ID:** `no-direct-console-logging` | **Confidence:** 89% | **Occurrences:** 5

Direct console calls bypass structured JSON logging, trace context, and log level filtering in production.

**Guidelines:**
- Inject logger service or import app logger
- Include context metadata in log statements

**Applies to files:** `src/**/*.ts, src/**/*.js`

**Preferred pattern:**
```
logger.info('Processing order', { orderId: order.id, userId });
```

**Anti-pattern to avoid:**
```
console.log('Processing order ' + order.id);
```

**Past Review Evidence:**
- PR #62 by @devops-eng: *"Please replace console.log with our structured logger instance...."*

---

