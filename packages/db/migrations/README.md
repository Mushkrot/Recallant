# Recallant Database Migrations

Migrations target the `recallant_agent_work` Postgres database and must stay aligned with `docs/DATA_MODEL.md`.

For an existing database, apply numbered migrations in order. `0002_session_scoped_checkpoints.sql`
adds opaque external-session identity hashes and session-owned checkpoints. Existing project checkpoint
rows are left untouched because they have no reliable chat owner.

Apply locally through the repository `Makefile`:

```bash
make db-up
make db-migrate
```

The development Compose profile does not publish Postgres on a host port. Use `docker compose exec postgres ...` or the Make targets for local access.
