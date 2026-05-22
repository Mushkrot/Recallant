.PHONY: db-up db-down db-migrate db-reset db-psql

DB_SERVICE := postgres
DB_NAME := recallant_agent_work
DB_USER := recallant
MIGRATIONS := /migrations/0001_initial.sql

db-up:
	docker compose up -d $(DB_SERVICE)

db-down:
	docker compose down

db-migrate:
	docker compose exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME) -f $(MIGRATIONS)

db-reset:
	docker compose down -v
	docker compose up -d $(DB_SERVICE)
	docker compose exec -T $(DB_SERVICE) sh -c 'until pg_isready -U $(DB_USER) -d $(DB_NAME); do sleep 1; done'
	docker compose exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME) -f $(MIGRATIONS)

db-psql:
	docker compose exec $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME)
