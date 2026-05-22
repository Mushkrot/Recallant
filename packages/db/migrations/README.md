# Recallant Database Migrations

Migrations target the `recallant_agent_work` Postgres database and must stay aligned with `docs/DATA_MODEL.md`.

Apply locally through the repository `Makefile`:

```bash
make db-up
make db-migrate
```

The development Compose profile does not publish Postgres on a host port. Use `docker compose exec postgres ...` or the Make targets for local access.
