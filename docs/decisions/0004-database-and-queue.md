# D-004 — PostgreSQL, Prisma and pg-boss

Status: Accepted; validate the connection approach in M1.

Decision:
Use PostgreSQL with Prisma for application data and pg-boss for jobs
in the same database.

Reason:
A single database reduces infrastructure overhead for the MVP.

Alternatives:
Redis with BullMQ or a custom jobs table.
