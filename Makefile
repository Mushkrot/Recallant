.PHONY: db-up db-down db-migrate db-reset db-psql prod-db-up prod-db-down prod-db-migrate prod-db-psql prod-db-status

DB_SERVICE := postgres
DB_NAME := recallant_agent_work
DB_USER := recallant
MIGRATIONS := /migrations/0001_initial.sql
DEV_COMPOSE := docker compose -p recallant-dev
PROD_COMPOSE := ./scripts/recallant-prod-compose.sh

db-up:
	$(DEV_COMPOSE) up -d $(DB_SERVICE)

db-down:
	$(DEV_COMPOSE) down

db-migrate:
	$(DEV_COMPOSE) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME) -f $(MIGRATIONS)

db-reset:
	$(DEV_COMPOSE) down -v
	$(DEV_COMPOSE) up -d $(DB_SERVICE)
	$(DEV_COMPOSE) exec -T $(DB_SERVICE) sh -c 'until pg_isready -U $(DB_USER) -d $(DB_NAME); do sleep 1; done'
	$(DEV_COMPOSE) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME) -f $(MIGRATIONS)

db-psql:
	$(DEV_COMPOSE) exec $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME)

prod-db-up:
	$(PROD_COMPOSE) up -d $(DB_SERVICE)

prod-db-down:
	$(PROD_COMPOSE) down

prod-db-migrate:
	$(PROD_COMPOSE) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME) -f $(MIGRATIONS)

prod-db-psql:
	$(PROD_COMPOSE) exec $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME)

prod-db-status:
	$(PROD_COMPOSE) ps
